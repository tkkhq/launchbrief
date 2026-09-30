const test = require('node:test');
const assert = require('node:assert/strict');
const { organizeIdeaPrompt, createTrelliniTask } = require('../volcano/functions/_shared/agent');

test('Sonnet 5.5 sends the workspace header and native JSON schema without forced tool choice', async () => {
  const values = { ANTHROPIC_API_KEY: 'fixture-key', ANTHROPIC_WORKSPACE_ID: 'fixture-workspace', ANTHROPIC_MODEL: 'claude-sonnet-5-5', ANTHROPIC_BASE_URL: undefined };
  const previous = Object.keys(values).map(key => [key, process.env[key]]);
  const originalFetch = global.fetch;
  const idea = { product_name: 'Launch Checklist', description: 'A simple checklist', target_customer: 'Solo founders', category: 'Productivity', goal: '' };
  let requests = 0;
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    global.fetch = async (_url, init) => {
      requests++;
      const headers = new Headers(init.headers);
      assert.equal(headers.get('anthropic-workspace-id'), 'fixture-workspace');
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'claude-sonnet-5-5');
      assert.equal(body.thinking.type, 'between_tools');
      assert.equal(body.output_config.format.type, 'json_schema');
      assert.ok(body.output_config.format.schema.properties.product_name);
      assert.equal(body.tool_choice, undefined);
      const events = [
        { type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(idea) } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } },
        { type: 'message_stop' },
      ];
      return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
    };
    assert.deepEqual(await organizeIdeaPrompt('A checklist for solo founders'), idea);
    assert.equal(requests, 1);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('Sonnet 5.5 automatic tool selection executes exactly one application-supplied Trellini card', async () => {
  const values = {
    ANTHROPIC_API_KEY: 'fixture-key', ANTHROPIC_WORKSPACE_ID: 'fixture-workspace', ANTHROPIC_MODEL: 'claude-sonnet-5-5',
    ANTHROPIC_BASE_URL: undefined, TRELLINI_MCP_TRANSPORT: 'http', TRELLINI_MCP_URL: 'https://mcp.example.test/',
    TRELLINI_ACCESS_TOKEN: 'fixture-session', APP_BASE_URL: 'https://launch.example.test', TRELLINI_CARD_URL_TEMPLATE: undefined,
    TRELLINI_BOARD_ID: '11111111-1111-4111-8111-111111111111', TRELLINI_COLUMN_ID: '22222222-2222-4222-8222-222222222222',
  };
  const previous = Object.keys(values).map(key => [key, process.env[key]]);
  const originalFetch = global.fetch;
  const cardId = '33333333-3333-4333-8333-333333333333';
  let writes = 0;
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    global.fetch = async (url, init) => {
      const request = JSON.parse(init.body);
      if (String(url).startsWith(values.TRELLINI_MCP_URL)) {
        if (!('id' in request)) return new Response(null, { status: 202 });
        let result;
        if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'trellini', version: 'fixture' } };
        else if (request.method === 'tools/list') result = { tools: [{ name: 'create_card', inputSchema: { type: 'object', properties: { column_id: { type: 'string' } } } }] };
        else if (request.params.name === 'get_board') result = { content: [{ type: 'text', text: JSON.stringify({ board: { id: values.TRELLINI_BOARD_ID }, columns: [{ id: values.TRELLINI_COLUMN_ID }] }) }] };
        else {
          assert.equal(request.params.name, 'create_card'); writes++;
          assert.equal(request.params.arguments.title, 'LaunchBrief: Checklist');
          assert.equal(request.params.arguments.column_id, values.TRELLINI_COLUMN_ID);
          assert.ok(request.params.arguments.notes.includes('Original user prompt'));
          result = { content: [{ type: 'text', text: JSON.stringify({ id: cardId }) }] };
        }
        return Response.json({ jsonrpc: '2.0', id: request.id, result });
      }
      assert.equal(request.tool_choice.type, 'auto');
      assert.equal(request.thinking.type, 'between_tools');
      const events = [
        { type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: request.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool_fixture', name: 'create_card', input: {} } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } },
        { type: 'message_stop' },
      ];
      return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
    };
    const result = await createTrelliniTask({ product_name: 'Checklist', target_customer: 'Solo founders', category: 'Productivity' }, 'Original user prompt', values.TRELLINI_BOARD_ID);
    assert.equal(result.cardId, cardId);
    assert.equal(writes, 1);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
