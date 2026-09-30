const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../volcano/functions/_shared/core');

test('HTTP brief preflight reaches the credit gate without any Trellini service credentials', async () => {
  const originalCore = { ...core };
  const handlerPath = require.resolve('../volcano/functions/generate-brief');
  const env = {
    ANTHROPIC_API_KEY: 'fixture-model-key', APP_BASE_URL: 'https://launch.example.test',
    TRELLINI_MCP_TRANSPORT: 'http', TRELLINI_MCP_URL: 'https://trellini.example.test/mcp',
    TRELLINI_ACCESS_TOKEN: 'fixture-user-token',
    TRELLINI_BOARD_ID: '11111111-1111-4111-8111-111111111111',
    TRELLINI_COLUMN_ID: '22222222-2222-4222-8222-222222222222',
    TRELLINI_API_URL: undefined, TRELLINI_SERVICE_KEY: undefined, TRELLINI_DATABASE: undefined,
  };
  const previous = Object.keys(env).map(key => [key, process.env[key]]);
  let creditChecks = 0;
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    core.client = async () => ({ from: () => ({ select() { return this; }, eq() { return this; }, limit() { return this; } }) });
    core.one = async () => null;
    core.claimCredit = async () => { creditChecks++; return false; };
    delete require.cache[handlerPath];
    const { handler } = require(handlerPath);
    const event = {
      __volcano_auth: { role: 'authenticated', user_id: 'fixture-user', access_token: 'fixture-token' },
      kind: 'initial', input_mode: 'freeform', idea_id: env.TRELLINI_BOARD_ID,
      turn_id: env.TRELLINI_COLUMN_ID, idea_prompt: 'A tool to organize launch plans',
    };
    const response = await handler(event);
    console.log('HTTP generation preflight status:', response.statusCode);
    assert.equal(response.statusCode, 402);
    assert.equal(creditChecks, 1);
    delete process.env.TRELLINI_ACCESS_TOKEN;
    assert.equal((await handler(event)).statusCode, 503);
    assert.equal(creditChecks, 1, 'Incomplete MCP auth must not reach credit spending');
    process.env.TRELLINI_MCP_TRANSPORT = 'stdio';
    assert.equal((await handler(event)).statusCode, 503);
    assert.equal(creditChecks, 1);
  } finally {
    Object.assign(core, originalCore);
    delete require.cache[handlerPath];
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
