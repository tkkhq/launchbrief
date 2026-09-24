let VolcanoAuth;

async function client(token, service = false) {
  if (!VolcanoAuth) {
    const sdk = await import('@volcano.dev/sdk');
    VolcanoAuth = sdk.VolcanoAuth || sdk.default;
  }
  const apiUrl = process.env.VOLCANO_API_URL;
  const anonKey = process.env.VOLCANO_ANON_KEY;
  const accessToken = service ? process.env.VOLCANO_SERVICE_KEY : token;
  if (!apiUrl || !anonKey || !accessToken || !process.env.VOLCANO_DATABASE) throw new Error('Volcano variables are incomplete');
  const volcano = new VolcanoAuth({ apiUrl, anonKey, accessToken });
  volcano.database(process.env.VOLCANO_DATABASE);
  return volcano;
}

function reply(statusCode, value) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) };
}

function identity(event) {
  const auth = event && typeof event === 'object' && event.__volcano_auth;
  return auth?.role === 'authenticated' && auth.user_id && auth.access_token ? auth : null;
}

function required(value, max = 2000) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

async function one(query, message) {
  const { data, error } = await query;
  if (error) throw new Error(`${message}: ${error.message}`);
  return data?.[0] ?? null;
}

async function claimCredit(db, userId, operationId) {
  const prior = await one(db.from('launch_credits').select('id').eq('user_id', userId).eq('spent_on', operationId).limit(1), 'Checking credit');
  if (prior) return 'prior';
  const { data: available, error } = await db.from('launch_credits').select('id').eq('user_id', userId).is('spent_at', null).order('created_at', { ascending: true }).limit(20);
  if (error) throw new Error(`Reading credits: ${error.message}`);
  for (const credit of available || []) {
    const { data, error: spendError } = await db.update('launch_credits', { spent_on: operationId, spent_at: new Date().toISOString() }).eq('id', credit.id).eq('user_id', userId).is('spent_at', null);
    if (spendError) {
      // A concurrent request may have won this token; a duplicate operation is idempotent.
      const current = await one(db.from('launch_credits').select('id').eq('spent_on', operationId).limit(1), 'Checking claim');
      if (current) return 'prior';
      continue;
    }
    if (data?.length) return 'new';
  }
  return false;
}

async function refundCredit(db, operationId) {
  const { error } = await db.update('launch_credits', { spent_on: null, spent_at: null }).eq('spent_on', operationId);
  if (error) throw new Error(`Refunding credit: ${error.message}`);
}

module.exports = { client, reply, identity, required, one, claimCredit, refundCredit };
