const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../volcano/functions/_shared/core');
const agent = require('../volcano/functions/_shared/agent');

test('sidebar shows an immediate draft, persisted progress, and the latest failed follow-up without duplicates', async () => {
  const { getSidebarIdeas } = await import('../web/lib/sidebar-ideas.mjs');
  const pending = { id: 'idea', label: 'A rough product idea' };
  assert.equal(getSidebarIdeas([], [], pending)[0].statusLabel, 'Preparing brief…');
  assert.equal(getSidebarIdeas([], [], { ...pending, status: 'failed' })[0].statusLabel, 'Failed');
  const ideas = [{ id: 'idea', product_name: 'Working title', category: 'Uncategorized' }];
  for (const [status, expected] of [['queued', 'Organizing idea…'], ['tracking', 'Recording request…'], ['writing', 'Writing brief…'], ['complete', 'Ready']]) {
    const entries = getSidebarIdeas(ideas, [{ idea_id: 'idea', status, created_at: '2026-09-30T12:00:00Z' }], pending);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].statusLabel, expected);
    assert.equal(entries[0].isPending, undefined);
  }
  const turns = [
    { idea_id: 'idea', status: 'failed', created_at: '2026-09-30T13:00:00Z' },
    { idea_id: 'idea', status: 'complete', created_at: '2026-09-30T12:00:00Z' },
  ];
  assert.equal(getSidebarIdeas(ideas, turns, null)[0].statusLabel, 'Failed');
});

test('freeform input is saved before model processing and stays visible when organization fails', async () => {
  const originalCore = { ...core }, originalAgent = { ...agent };
  const handlerPath = require.resolve('../volcano/functions/generate-brief');
  const env = {
    ANTHROPIC_API_KEY: 'fixture-model', APP_BASE_URL: 'https://launch.example.test',
    TRELLINI_MCP_TRANSPORT: 'http', TRELLINI_MCP_URL: 'https://trellini.example.test/mcp',
    TRELLINI_ACCESS_TOKEN: 'fixture-token', TRELLINI_BOARD_ID: 'fixture-board', TRELLINI_COLUMN_ID: 'fixture-column',
  };
  const previous = Object.keys(env).map(key => [key, process.env[key]]);
  const tables = { launch_ideas: [], launch_turns: [] };
  const query = () => ({ select() { return this; }, eq() { return this; }, limit() { return this; } });
  const db = {
    from: query,
    async insert(table, row) { tables[table].push({ ...row }); return { error: null }; },
    update(table, values) {
      const filters = [];
      return {
        eq(key, value) { filters.push(row => row[key] === value); return this; },
        then(resolve, reject) {
          tables[table].filter(row => filters.every(filter => filter(row))).forEach(row => Object.assign(row, values));
          return Promise.resolve({ error: null }).then(resolve, reject);
        },
      };
    },
  };
  let rejectModel, startModel, refunds = 0;
  const modelStarted = new Promise(resolve => { startModel = resolve; });
  try {
    Object.assign(process.env, env);
    core.client = async () => db;
    core.one = async () => null;
    core.claimCredit = async () => 'new';
    core.refundCredit = async () => { refunds++; };
    agent.organizeIdeaPrompt = () => { startModel(); return new Promise((_resolve, reject) => { rejectModel = reject; }); };
    agent.createTrelliniTask = async () => { assert.fail('No Trellini write before successful organization'); };
    delete require.cache[handlerPath];
    const { handler } = require(handlerPath);
    const event = {
      __volcano_auth: { role: 'authenticated', user_id: 'fixture-user', access_token: 'fixture-session' },
      kind: 'initial', input_mode: 'freeform', idea_id: '11111111-1111-4111-8111-111111111111',
      turn_id: '22222222-2222-4222-8222-222222222222', idea_prompt: 'A simple tool for a small team',
    };
    const running = handler(event);
    await modelStarted;
    assert.equal(tables.launch_ideas[0].description, event.idea_prompt);
    assert.equal(tables.launch_turns[0].prompt, event.idea_prompt);
    assert.equal(tables.launch_turns[0].status, 'queued');
    rejectModel(new Error('Model unavailable'));
    const result = await running;
    assert.equal(result.statusCode, 500);
    assert.equal(tables.launch_turns[0].status, 'failed');
    assert.equal(tables.launch_turns[0].error_message, 'Model unavailable');
    assert.equal(tables.launch_ideas.length, 1);
    assert.equal(refunds, 1);
  } finally {
    Object.assign(core, originalCore); Object.assign(agent, originalAgent);
    delete require.cache[handlerPath];
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
