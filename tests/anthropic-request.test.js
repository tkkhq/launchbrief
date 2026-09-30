const test = require('node:test');
const assert = require('node:assert/strict');
const { organizeIdeaPrompt } = require('../volcano/functions/_shared/agent');

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
