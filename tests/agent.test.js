const test = require('node:test');
const assert = require('node:assert/strict');
const { makeCreateCardTool, extractCreatedCardId, normalizeBrief, verifyTrelliniTarget } = require('../volcano/functions/_shared/agent');

test('TanStack server tool writes a Trellini card once with no model-supplied fields', async () => {
  const [{ toolDefinition }, { z }] = await Promise.all([
    import('../volcano/functions/node_modules/@tanstack/ai/dist/esm/index.js'),
    import('../volcano/functions/node_modules/zod/v4/index.js'),
  ]);
  let writes = 0;
  const id = 'c1aae829-04e5-4fdb-bd4e-c8e5dc523428';
  const { tool, state } = makeCreateCardTool(toolDefinition, z, async () => { writes += 1; return id; });
  assert.deepEqual(await tool.execute({}), { card_id: id });
  assert.deepEqual(state(), { calls: 1, cardId: id });
  await assert.rejects(tool.execute({}), /only once/);
  assert.equal(writes, 1);

  const guarded = makeCreateCardTool(toolDefinition, z, async () => { throw new Error('must not write'); });
  await assert.rejects(guarded.tool.execute({ notes: 'injected' }), /Unexpected create_card arguments/);
});

test('Trellini MCP result must contain a real card UUID', () => {
  const id = 'c1aae829-04e5-4fdb-bd4e-c8e5dc523428';
  assert.equal(extractCreatedCardId({ content: [{ type: 'text', text: JSON.stringify({ id }) }] }), id);
  assert.throws(() => extractCreatedCardId({ isError: true, content: [] }), /failed/);
  assert.throws(() => extractCreatedCardId({ content: [{ type: 'text', text: '{"id":"not-a-uuid"}' }] }), /verified card id/);
});

test('brief normalization keeps 3–5 assumptions and 2–4 MVP items', () => {
  const brief = {
    research_notes: Array.from({ length: 7 }, (_, i) => ({ kind: 'assumption', text: `Assumption ${i + 1}` })),
    recommendation: { customer_problem: 'A real problem', positioning: 'A clear position', mvp_scope: ['One', 'Two', 'Three', 'Four', 'Five'] },
  };
  const result = normalizeBrief(brief);
  assert.equal(result.research_notes.length, 5);
  assert.equal(result.recommendation.mvp_scope.length, 4);
  assert.equal(brief.research_notes.length, 7);
  assert.throws(() => normalizeBrief({ ...brief, research_notes: brief.research_notes.slice(0, 2) }), /invalid brief/);
  assert.throws(() => normalizeBrief({ ...brief, research_notes: [{ kind: 'sourced', text: 'Unverified' }, ...brief.research_notes] }), /invalid brief/);
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
