const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function openAIClient() {
  const { default: OpenAI } = await import('openai');
  const options = { apiKey: process.env.OPENAI_API_KEY };
  if (process.env.OPENAI_BASE_URL) options.baseURL = process.env.OPENAI_BASE_URL;
  return new OpenAI(options);
}

function modelName() {
  return process.env.OPENAI_MODEL || 'gpt-5-mini';
}

function requireCreateCardCall(response) {
  if (response?.status !== 'completed') throw new Error('OpenAI did not complete the Trellini tool request');
  const calls = (response.output || []).filter(item => item.type === 'function_call');
  if (calls.length !== 1 || calls[0].name !== 'create_card') throw new Error('OpenAI did not request exactly one create_card call');
  let args;
  try { args = JSON.parse(calls[0].arguments); } catch { throw new Error('OpenAI returned invalid create_card arguments'); }
  if (!args || Array.isArray(args) || typeof args !== 'object' || Object.keys(args).length !== 0) throw new Error('OpenAI returned unexpected create_card arguments');
  return calls[0];
}

function extractCreatedCardId(result) {
  if (result?.isError) throw new Error('Trellini create_card failed');
  for (const item of result?.content || []) {
    if (item.type !== 'text') continue;
    try {
      const card = JSON.parse(item.text);
      const id = card.id || card.card?.id;
      if (UUID.test(id || '')) return id;
    } catch {}
  }
  throw new Error('Trellini did not return a verified card id');
}

async function verifyTrelliniTarget(apiUrl, serviceKey, database, boardId, columnId) {
  const response = await fetch(apiUrl.replace(/\/$/, '') + '/databases/' + encodeURIComponent(database) + '/query/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + serviceKey },
    body: JSON.stringify({ table: 'board_columns', select: ['id', 'board_id'], filters: [{ column: 'id', operator: 'eq', value: columnId }], limit: 1 }),
  });
  if (!response.ok) throw new Error('Trellini target check failed: ' + response.status);
  const result = await response.json();
  if (result.data?.[0]?.board_id !== boardId) throw new Error('Trellini column does not belong to the configured board');
}

async function createTrelliniTask(idea, prompt, ideaId) {
  const { TRELLINI_API_URL, TRELLINI_SERVICE_KEY, TRELLINI_DATABASE, TRELLINI_BOARD_ID, TRELLINI_COLUMN_ID, APP_BASE_URL } = process.env;
  if (![TRELLINI_API_URL, TRELLINI_SERVICE_KEY, TRELLINI_BOARD_ID, TRELLINI_COLUMN_ID, APP_BASE_URL].every(Boolean)) throw new Error('Trellini integration variables are incomplete');
  if (![TRELLINI_BOARD_ID, TRELLINI_COLUMN_ID].every(id => UUID.test(id))) throw new Error('Trellini board or column ID is invalid');
  await verifyTrelliniTarget(TRELLINI_API_URL, TRELLINI_SERVICE_KEY, TRELLINI_DATABASE || 'trellini', TRELLINI_BOARD_ID, TRELLINI_COLUMN_ID);

  const title = 'LaunchBrief: ' + idea.product_name;
  const notes = [
    'LaunchBrief idea: ' + new URL('/ideas/' + ideaId, APP_BASE_URL).toString(),
    'Product: ' + idea.product_name,
    'Target customer: ' + idea.target_customer,
    'Category: ' + idea.category,
    'Prompt:',
    prompt,
  ].join('\n\n');

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [require.resolve('./trellini-mcp/index.mjs')],
    env: { VOLCANO_API_URL: TRELLINI_API_URL, VOLCANO_SERVICE_KEY: TRELLINI_SERVICE_KEY, VOLCANO_DATABASE: TRELLINI_DATABASE || 'trellini' },
  });
  const mcp = new Client({ name: 'launchbrief', version: '1.0.0' });
  try {
    await mcp.connect(transport);
    const available = await mcp.listTools();
    if (!available.tools?.some(tool => tool.name === 'create_card')) throw new Error('Trellini MCP create_card is unavailable');

    const openai = await openAIClient();
    const response = await openai.responses.create({
      model: modelName(),
      instructions: 'Record this LaunchBrief request in Trellini. Call create_card exactly once. The application supplies the exact card fields.',
      input: JSON.stringify({ title, notes }),
      tools: [{
        type: 'function',
        name: 'create_card',
        description: 'Ask LaunchBrief to create the submitted task in Trellini.',
        strict: true,
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      }],
      tool_choice: { type: 'function', name: 'create_card' },
      parallel_tool_calls: false,
    });
    requireCreateCardCall(response);

    const result = await mcp.callTool({ name: 'create_card', arguments: { column_id: TRELLINI_COLUMN_ID, title, notes, priority: 'normal' } });
    const verifiedId = extractCreatedCardId(result);
    const template = process.env.TRELLINI_CARD_URL_TEMPLATE;
    const taskUrl = template ? template.replace('{board_id}', TRELLINI_BOARD_ID).replace('{card_id}', verifiedId) : null;
    if (taskUrl && !/^https:\/\//.test(taskUrl)) throw new Error('Trellini card URL template must produce an HTTPS URL');
    return { cardId: verifiedId, taskUrl };
  } finally {
    await mcp.close().catch(() => {});
  }
}

async function writeBrief(idea, prompt, history) {
  const { z } = await import('zod/v4');
  const { zodTextFormat } = await import('openai/helpers/zod');
  const Brief = z.object({
    research_notes: z.array(z.object({ kind: z.literal('assumption'), text: z.string() })),
    recommendation: z.object({
      customer_problem: z.string(),
      positioning: z.string(),
      mvp_scope: z.array(z.string()),
    }),
  });
  const openai = await openAIClient();
  const response = await openai.responses.parse({
    model: modelName(),
    instructions: 'Write a concise launch brief. You have no external research tools or supplied sources. Every research note must be a model-generated assumption. Do not include citations, source URLs, market statistics, or claims of external research. Recommend a specific customer problem, positioning, and 2 to 4 small MVP items. For follow-ups, use the conversation history and address the latest prompt.',
    input: JSON.stringify({ idea, prompt, history }),
    text: { format: zodTextFormat(Brief, 'launch_brief') },
  });
  if (response.status !== 'completed' || !response.output_parsed) throw new Error('OpenAI did not return a complete brief');
  const brief = response.output_parsed;
  if (brief.research_notes.length < 3 || brief.research_notes.length > 5 ||
      brief.research_notes.some(note => !note.text.trim()) ||
      !brief.recommendation.customer_problem.trim() ||
      !brief.recommendation.positioning.trim() ||
      brief.recommendation.mvp_scope.length < 2 ||
      brief.recommendation.mvp_scope.length > 4 ||
      brief.recommendation.mvp_scope.some(item => !item.trim())) throw new Error('OpenAI returned an invalid brief');
  return brief;
}

module.exports = { createTrelliniTask, writeBrief, requireCreateCardCall, extractCreatedCardId, verifyTrelliniTarget };
