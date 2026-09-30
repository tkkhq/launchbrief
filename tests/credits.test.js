const test = require('node:test');
const assert = require('node:assert/strict');
const { client, creditGateEnabled, claimCredit, refundCredit } = require('../volcano/functions/_shared/core');
const { grantCredits } = require('../volcano/functions/stripe-webhook');
const creditMode = require('../volcano/functions/credit-mode');
const checkout = require('../volcano/functions/create-checkout');

function fakeDatabase() {
  const credits = [];
  const table = {
    select() { return new Query(credits); },
  };
  class Query {
    constructor(rows) { this.rows = rows; this.filters = []; this.max = Infinity; }
    eq(key, value) { this.filters.push(row => row[key] === value); return this; }
    is(key, value) { this.filters.push(row => row[key] === value); return this; }
    order() { return this; }
    limit(max) { this.max = max; return this; }
    then(resolve, reject) { return Promise.resolve({ data: this.rows.filter(row => this.filters.every(test => test(row))).slice(0, this.max), error: null }).then(resolve, reject); }
  }
  return {
    credits,
    from: () => table,
    async insert(_table, value) {
      if (credits.some(row => row.stripe_session_id === value.stripe_session_id && row.ordinal === value.ordinal)) return { data: null, error: new Error('duplicate') };
      const row = { id: String(credits.length + 1), spent_on: null, spent_at: null, ...value };
      credits.push(row);
      return { data: [row], error: null };
    },
    update(_table, values) {
      const filters = [];
      return {
        eq(key, value) { filters.push(row => row[key] === value); return this; },
        is(key, value) { filters.push(row => row[key] === value); return this; },
        then(resolve, reject) {
          const rows = credits.filter(row => filters.every(test => test(row)));
          for (const row of rows) Object.assign(row, values);
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
    },
  };
}

test('paid session grant is idempotent and bound to one user', async () => {
  const db = fakeDatabase();
  await grantCredits(db, 'cs_123', 'user-1', 3);
  await grantCredits(db, 'cs_123', 'user-1', 3);
  assert.equal(db.credits.length, 3);
  await assert.rejects(grantCredits(db, 'cs_123', 'user-2', 3), /another user/);
});

test('one credit is spent once, repeat operation does not spend another, and refund restores it', async () => {
  const db = fakeDatabase();
  await grantCredits(db, 'cs_123', 'user-1', 1);
  assert.equal(await claimCredit(db, 'user-1', 'op-1'), 'new');
  assert.equal(await claimCredit(db, 'user-1', 'op-1'), 'prior');
  assert.equal(await claimCredit(db, 'user-1', 'op-2'), false);
  await refundCredit(db, 'op-1');
  assert.equal(await claimCredit(db, 'user-1', 'op-2'), 'new');
});

test('a user cannot spend another user credit', async () => {
  const db = fakeDatabase();
  await grantCredits(db, 'cs_123', 'user-1', 1);
  assert.equal(await claimCredit(db, 'user-2', 'op-2'), false);
  assert.equal(db.credits[0].spent_on, null);
});

test('test mode skips credit spending while paid mode remains the default', async () => {
  const previous = process.env.LAUNCHBRIEF_CREDIT_GATE_ENABLED;
  const db = fakeDatabase();
  try {
    delete process.env.LAUNCHBRIEF_CREDIT_GATE_ENABLED;
    assert.equal(creditGateEnabled(), true);
    assert.equal(await claimCredit(db, 'user-1', 'paid-1'), false);
    process.env.LAUNCHBRIEF_CREDIT_GATE_ENABLED = 'false';
    assert.equal(creditGateEnabled(), false);
    assert.equal(await claimCredit(db, 'user-1', 'free-1'), 'free');
    assert.equal(db.credits.length, 0);
    process.env.LAUNCHBRIEF_CREDIT_GATE_ENABLED = 'true';
    assert.equal(await claimCredit(db, 'user-1', 'paid-2'), false);
  } finally {
    if (previous === undefined) delete process.env.LAUNCHBRIEF_CREDIT_GATE_ENABLED;
    else process.env.LAUNCHBRIEF_CREDIT_GATE_ENABLED = previous;
  }
});

test('test mode status requires sign-in and Checkout stays closed', async () => {
  const previous = process.env.LAUNCHBRIEF_CREDIT_GATE_ENABLED;
  const signedIn = { __volcano_auth: { role: 'authenticated', user_id: 'user-1', access_token: 'token' } };
  try {
    process.env.LAUNCHBRIEF_CREDIT_GATE_ENABLED = 'false';
    assert.equal((await creditMode.handler({})).statusCode, 401);
    assert.deepEqual(JSON.parse((await creditMode.handler(signedIn)).body), { credits_required: false });
    const result = await checkout.handler(signedIn);
    assert.equal(result.statusCode, 503);
    assert.match(result.body, /not required in test mode/);
  } finally {
    if (previous === undefined) delete process.env.LAUNCHBRIEF_CREDIT_GATE_ENABLED;
    else process.env.LAUNCHBRIEF_CREDIT_GATE_ENABLED = previous;
  }
});

test('server client uses the service key as its access token', async () => {
  const previous = ['NEXT_PUBLIC_VOLCANO_API_URL','NEXT_PUBLIC_VOLCANO_ANON_KEY','VOLCANO_SERVICE_KEY','VOLCANO_DATABASE'].map(key => [key, process.env[key]]);
  process.env.NEXT_PUBLIC_VOLCANO_API_URL = 'http://localhost:8000';
  process.env.NEXT_PUBLIC_VOLCANO_ANON_KEY = 'ak-test';
  process.env.VOLCANO_SERVICE_KEY = 'sk-test';
  process.env.VOLCANO_DATABASE = 'app';
  try {
    const db = await client(null, true);
    assert.equal(db.anonKey, 'ak-test');
    assert.equal(db.accessToken, 'sk-test');
  } finally {
    for (const [key, value] of previous) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
