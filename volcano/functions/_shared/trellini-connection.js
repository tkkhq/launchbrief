// Supports the existing owner-operated stdio server and Trellini's hosted MCP.
function trelliniConnectionConfig(env = process.env) {
  const mode = env.TRELLINI_MCP_TRANSPORT || 'stdio';
  if (!['stdio', 'http'].includes(mode)) throw new Error('TRELLINI_MCP_TRANSPORT must be stdio or http');
  if (mode === 'http') {
    let url;
    try { url = new URL(env.TRELLINI_MCP_URL); } catch { throw new Error('TRELLINI_MCP_URL must be an HTTPS endpoint'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('TRELLINI_MCP_URL must be HTTPS without embedded credentials or a fragment');
    if (!env.TRELLINI_ACCESS_TOKEN || /[\r\n]/.test(env.TRELLINI_ACCESS_TOKEN)) throw new Error('TRELLINI_ACCESS_TOKEN must contain your Trellini user session token');
    return { mode, url: url.toString(), token: env.TRELLINI_ACCESS_TOKEN };
  }
  if (!env.TRELLINI_API_URL || !env.TRELLINI_SERVICE_KEY) throw new Error('Trellini stdio integration variables are incomplete');
  return { mode, apiUrl: env.TRELLINI_API_URL, serviceKey: env.TRELLINI_SERVICE_KEY, database: env.TRELLINI_DATABASE || 'trellini' };
}

async function connectTrelliniMcp(config, { name = 'launchbrief', fetch: fetchImpl } = {}) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  let transport;
  if (config.mode === 'http') {
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers: { Authorization: 'Bearer ' + config.token }, redirect: 'error' },
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
  } else {
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [require.resolve('./trellini-mcp/index.mjs')],
      env: { VOLCANO_API_URL: config.apiUrl, VOLCANO_SERVICE_KEY: config.serviceKey, VOLCANO_DATABASE: config.database },
    });
  }
  const mcp = new Client({ name, version: '1.0.0' });
  try {
    await mcp.connect(transport);
    return mcp;
  } catch {
    await mcp.close().catch(() => {});
    throw new Error('Trellini MCP connection failed. Check the endpoint and credential; refresh an expired user token.');
  }
}

async function callTrelliniTool(mcp, name, args) {
  try { return await mcp.callTool({ name, arguments: args }); }
  catch { throw new Error('Trellini MCP ' + name + ' failed. Check access and token expiry.'); }
}

async function listTrelliniTools(mcp) {
  try { return await mcp.listTools(); }
  catch { throw new Error('Trellini MCP tool discovery failed. Check access and token expiry.'); }
}

function trelliniToolData(result, name) {
  if (result?.isError) throw new Error('Trellini MCP ' + name + ' failed. Check access and token expiry.');
  const item = result?.content?.find(entry => entry.type === 'text');
  if (!item) throw new Error('Trellini MCP ' + name + ' returned no text.');
  try { return JSON.parse(item.text); }
  catch { throw new Error('Trellini MCP ' + name + ' returned invalid JSON.'); }
}

async function verifyHostedTrelliniTarget(mcp, boardId, columnId) {
  const details = trelliniToolData(await callTrelliniTool(mcp, 'get_board', { board_id: boardId }), 'get_board');
  if (details?.board?.id !== boardId || !Array.isArray(details.columns) || !details.columns.some(column => column.id === columnId)) {
    throw new Error('Trellini column does not belong to the configured visible board');
  }
}

// Older hosted revisions require board_id; current Trellini derives it from
// column_id. Send the field only when the connected server declares it.
function trelliniCardArguments(tool, boardId, fields) {
  return tool.inputSchema?.properties?.board_id ? { ...fields, board_id: boardId } : fields;
}

module.exports = { trelliniConnectionConfig, connectTrelliniMcp, callTrelliniTool, listTrelliniTools, trelliniToolData, verifyHostedTrelliniTarget, trelliniCardArguments };
