const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function runAgent(prompt, options = {}) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  let result = '';
  const toolCalls = [];
  const toolResults = [];
  for await (const message of query({
    prompt,
    options: {
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
      maxTurns: options.maxTurns || 2,
      allowedTools: options.allowedTools || [],
      disallowedTools: ['Bash', 'Read', 'Write', 'Edit', 'WebSearch', 'WebFetch'],
      ...(options.mcpServers ? { mcpServers: options.mcpServers } : {}),
      ...(options.hooks ? { hooks: options.hooks } : {}),
      systemPrompt: options.systemPrompt || 'Follow the user request exactly. Return only valid JSON.',
      tools: [],
      settingSources: [],
      permissionMode: 'dontAsk',
    },
  })) {
    if (message.type === 'assistant') {
      for (const block of message.message?.content || []) if (block.type === 'tool_use') toolCalls.push(block);
    }
    if (message.type === 'user') {
      for (const block of message.message?.content || []) if (block.type === 'tool_result') toolResults.push(block);
    }
    if (message.type === 'result') {
      if (message.subtype !== 'success') throw new Error(`Claude run ended: ${message.subtype}`);
      result = message.result || '';
    }
  }
  if (!result) throw new Error('Claude returned no result');
  const clean = result.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let output;
  try { output = JSON.parse(clean); } catch (error) { if (options.requireJson !== false) throw error; }
  return { output, toolCalls, toolResults };
}

function makeTrelliniCardGuard({ boardId, columnId, title, notes }) {
  let approvedCalls = 0;
  const guard = async (input) => {
    const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
    if (input.tool_name !== 'mcp__trellini__create_card') return deny('Only Trellini create_card is available');
    if (approvedCalls >= 1) return deny('The prompt can create only one Trellini card');
    approvedCalls += 1;
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { board_id: boardId, column_id: columnId, title, notes, priority: 'normal' } } };
  };
  return { guard, count: () => approvedCalls };
}

async function createTrelliniTask(idea, prompt, ideaId) {
  const { TRELLINI_MCP_URL, TRELLINI_MCP_TOKEN, TRELLINI_BOARD_ID, TRELLINI_COLUMN_ID, APP_BASE_URL } = process.env;
  if (![TRELLINI_MCP_URL, TRELLINI_MCP_TOKEN, TRELLINI_BOARD_ID, TRELLINI_COLUMN_ID, APP_BASE_URL].every(Boolean)) throw new Error('Trellini integration variables are incomplete');
  if (![TRELLINI_BOARD_ID, TRELLINI_COLUMN_ID].every(id => UUID.test(id))) throw new Error('Trellini board or column ID is invalid');
  const notes = `LaunchBrief idea: ${new URL(`/ideas/${ideaId}`, APP_BASE_URL).toString()}\n\nProduct: ${idea.product_name}\nTarget customer: ${idea.target_customer}\nCategory: ${idea.category}\n\nPrompt:\n${prompt}`;
  const cardGuard = makeTrelliniCardGuard({ boardId: TRELLINI_BOARD_ID, columnId: TRELLINI_COLUMN_ID, title: `LaunchBrief: ${idea.product_name}`, notes });
  const run = await runAgent(
    `Use the Trellini create_card tool exactly once with column_id=${TRELLINI_COLUMN_ID}, board_id=${TRELLINI_BOARD_ID}, title=${JSON.stringify(`LaunchBrief: ${idea.product_name}`)}, notes=${JSON.stringify(notes)}, priority=normal. Return JSON with the card id from the tool response as {"card_id":"..."}. If the tool fails, report the failure instead of inventing an id.`,
    {
      maxTurns: 3,
      requireJson: false,
      allowedTools: ['mcp__trellini__create_card'],
      hooks: { PreToolUse: [{ matcher: '^mcp__', hooks: [cardGuard.guard] }] },
      mcpServers: { trellini: { type: 'http', url: TRELLINI_MCP_URL, alwaysLoad: true, headers: { Authorization: `Bearer ${TRELLINI_MCP_TOKEN}` } } },
      systemPrompt: 'You are recording a LaunchBrief request in Trellini. Call only create_card. Never invent a task id. Return only JSON.',
    },
  );
  const calls = run.toolCalls.filter(c => c.name === 'mcp__trellini__create_card');
  if (calls.length !== 1 || cardGuard.count() !== 1) throw new Error('Trellini create_card was not called exactly once');
  let verifiedId = null;
  for (const block of run.toolResults) {
    if (block.tool_use_id !== calls[0].id || block.is_error) continue;
    const content = Array.isArray(block.content) ? block.content : [{ type: 'text', text: block.content }];
    for (const item of content) {
      if (item.type !== 'text') continue;
      try { const parsed = JSON.parse(item.text); const id = parsed.id || parsed.card?.id; if (UUID.test(id || '')) verifiedId = id; } catch {}
    }
  }
  if (!verifiedId) throw new Error('Trellini did not return a verified card id');
  const template = process.env.TRELLINI_CARD_URL_TEMPLATE;
  const taskUrl = template ? template.replace('{board_id}', TRELLINI_BOARD_ID).replace('{card_id}', verifiedId) : null;
  if (taskUrl && !/^https:\/\//.test(taskUrl)) throw new Error('Trellini card URL template must produce an HTTPS URL');
  return { cardId: verifiedId, taskUrl };
}

async function writeBrief(idea, prompt, history) {
  const { output: response } = await runAgent(JSON.stringify({ idea, prompt, history }), {
    maxTurns: 1,
    systemPrompt: `You write concise launch briefs. Return only JSON with keys research_notes and recommendation. research_notes is an array of 3 to 5 objects {kind:"assumption",text:string}. You have no external research tools or supplied sources, so every observation must be labeled assumption. Do not include citations, source URLs, market statistics, or claims of external research. recommendation is {customer_problem:string,positioning:string,mvp_scope:string[]} with 2 to 4 specific small-scope items. For follow-ups, use the conversation history and address the latest user prompt.`,
  });
  if (!Array.isArray(response.research_notes) || !response.research_notes.every(n => n.kind === 'assumption' && typeof n.text === 'string') || !response.recommendation || typeof response.recommendation.customer_problem !== 'string' || typeof response.recommendation.positioning !== 'string' || !Array.isArray(response.recommendation.mvp_scope)) throw new Error('Claude returned an invalid brief');
  return response;
}

module.exports = { createTrelliniTask, writeBrief, makeTrelliniCardGuard };
