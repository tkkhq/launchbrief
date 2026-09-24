const test = require('node:test');
const assert = require('node:assert/strict');

test('paid Checkout with a standard user UUID reaches the line-item check', async () => {
  const stripePath = require.resolve('../volcano/functions/node_modules/stripe');
  const originalModule = require.cache[stripePath];
  const originalKey = process.env.STRIPE_SECRET_KEY;
  const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const userId = '7f4d379d-3a3b-4934-9051-5b45f785af4d';
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy';
  require.cache[stripePath] = {
    id: stripePath,
    filename: stripePath,
    loaded: true,
    exports: class StripeStub {
      constructor() {
        this.webhooks = { constructEvent: () => ({
          type: 'checkout.session.completed',
          data: { object: {
            id: 'cs_test_dummy', mode: 'payment', payment_status: 'paid',
            client_reference_id: userId,
            metadata: { launchbrief_user_id: userId, launchbrief_credits: '1', launchbrief_price_id: 'price_dummy' },
          } },
        }) };
        this.checkout = { sessions: { listLineItems: async () => ({ has_more: false, data: [] }) } };
      }
    },
  };
  try {
    const { handler } = require('../volcano/functions/stripe-webhook');
    const response = await handler({ headers: { 'Stripe-Signature': ['dummy'] }, body: '{}' });
    assert.equal(response.statusCode, 400);
    assert.equal(JSON.parse(response.body).error, 'Checkout price does not match the credit pack.');
  } finally {
    if (originalModule) require.cache[stripePath] = originalModule;
    else delete require.cache[stripePath];
    if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalKey;
    if (originalSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
  }
});
