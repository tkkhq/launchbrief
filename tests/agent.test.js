const test = require('node:test');
const assert = require('node:assert/strict');
const { requireCreateCardCall, extractCreatedCardId, verifyTrelliniTarget } = require('../volcano/functions/_shared/agent');

test('OpenAI must request exactly one empty create_card call before MCP writes', () => {
  const call = { type: 'function_call', name: 'create_card', arguments: '{}' };
  assert.equal(requireCreateCardCall({ status: 'completed', output: [call] }), call);
  assert.throws(() => requireCreateCardCall({ status: 'incomplete', output: [call] }), /did not complete/);
  assert.throws(() => requireCreateCardCall({ status: 'completed', output: [call, call] }), /exactly one/);
  assert.throws(() => requireCreateCardCall({ status: 'completed', output: [{ ...call, name: 'create_board' }] }), /exactly one/);
  assert.throws(() => requireCreateCardCall({ status: 'completed', output: [{ ...call, arguments: '{"notes":"injected"}' }] }), /unexpected/);
  assert.throws(() => requireCreateCardCall({ status: 'completed', output: [{ ...call, arguments: 'invalid' }] }), /invalid/);
});

test('Trellini MCP result must contain a real card UUID', () => {
  const id = 'c1aae829-04e5-4fdb-bd4e-c8e5dc523428';
  assert.equal(extractCreatedCardId({ content: [{ type: 'text', text: JSON.stringify({ id }) }] }), id);
  assert.throws(() => extractCreatedCardId({ isError: true, content: [] }), /failed/);
  assert.throws(() => extractCreatedCardId({ content: [{ type: 'text', text: '{"id":"not-a-uuid"}' }] }), /verified card id/);
});

test('Trellini target check rejects a column on another board', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async (_url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer test-service-key');
      const request = JSON.parse(options.body);
      assert.equal(request.table, 'board_columns');
      return { ok: true, json: async () => ({ data: [{ id: 'column', board_id: 'other-board' }] }) };
    };
    await assert.rejects(
      verifyTrelliniTarget('https://trellini.example', 'test-service-key', 'trellini', 'expected-board', 'column'),
      /does not belong/,
    );
  } finally {
    global.fetch = originalFetch;
  }
});
