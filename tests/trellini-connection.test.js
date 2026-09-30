const test = require('node:test');
const assert = require('node:assert/strict');
const { trelliniConnectionConfig, connectTrelliniMcp, callTrelliniTool, listTrelliniTools, verifyHostedTrelliniTarget, trelliniCardArguments } = require('../volcano/functions/_shared/trellini-connection');
const { extractCreatedCardId } = require('../volcano/functions/_shared/agent');

const boardId = '11111111-1111-4111-8111-111111111111';
const columnId = '22222222-2222-4222-8222-222222222222';
const cardId = '33333333-3333-4333-8333-333333333333';
const env = { TRELLINI_MCP_TRANSPORT: 'http', TRELLINI_MCP_URL: 'https://mcp.example.test/invoke', TRELLINI_ACCESS_TOKEN: 'personal-session-token' };

test('HTTP configuration needs only a hosted endpoint and user token; stdio remains default', () => {
  assert.equal(trelliniConnectionConfig(env).mode, 'http');
  assert.equal(trelliniConnectionConfig({ TRELLINI_API_URL: 'https://api.example.test', TRELLINI_SERVICE_KEY: 'owner-key' }).mode, 'stdio');
  assert.throws(() => trelliniConnectionConfig({ ...env, TRELLINI_MCP_URL: 'http://mcp.example.test/' }), /HTTPS/);
  assert.throws(() => trelliniConnectionConfig({ ...env, TRELLINI_MCP_URL: 'https://user:password@mcp.example.test/' }), /embedded credentials/);
  assert.throws(() => trelliniConnectionConfig({ ...env, TRELLINI_ACCESS_TOKEN: '' }), /session token/);
  assert.throws(() => trelliniConnectionConfig({ ...env, TRELLINI_ACCESS_TOKEN: 'token\r\nheader' }), /session token/);
  assert.throws(() => trelliniConnectionConfig({ ...env, TRELLINI_MCP_TRANSPORT: 'unknown' }), /stdio or http/);
});

test('real HTTP MCP client authenticates reads and a single card write with the participant token', async () => {
  const calls = [];
  const createTool = { name: 'create_card', inputSchema: { type: 'object', properties: { column_id: { type: 'string' }, title: { type: 'string' } }, required: ['column_id', 'title'] } };
  const fetch = async (url, init) => {
    assert.equal(String(url), env.TRELLINI_MCP_URL);
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer personal-session-token');
    assert.equal(init.redirect, 'error');
    if (init.method === 'GET') return new Response('', { status: 405 });
    const request = JSON.parse(init.body);
    calls.push(request);
    if (!('id' in request)) return new Response(null, { status: 202 });
    let result;
    if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'trellini', version: 'test' } };
    else if (request.method === 'tools/list') result = { tools: [createTool] };
    else if (request.method === 'tools/call') {
      const { name, arguments: args } = request.params;
      if (name === 'get_board') {
        assert.deepEqual(args, { board_id: boardId });
        result = { content: [{ type: 'text', text: JSON.stringify({ board: { id: boardId }, columns: [{ id: columnId }] }) }] };
      } else {
        assert.equal(name, 'create_card');
        assert.deepEqual(args, { column_id: columnId, title: 'Sample', notes: 'Original prompt', priority: 'normal' });
        result = { content: [{ type: 'text', text: JSON.stringify({ id: cardId }) }] };
      }
    } else throw new Error('Unexpected MCP request');
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  };
  const mcp = await connectTrelliniMcp(trelliniConnectionConfig(env), { fetch });
  try {
    await verifyHostedTrelliniTarget(mcp, boardId, columnId);
    const { tools } = await listTrelliniTools(mcp);
    const args = trelliniCardArguments(tools[0], boardId, { column_id: columnId, title: 'Sample', notes: 'Original prompt', priority: 'normal' });
    assert.equal(extractCreatedCardId(await callTrelliniTool(mcp, 'create_card', args)), cardId);
    assert.equal(calls.filter(call => call.params?.name === 'create_card').length, 1);
  } finally { await mcp.close(); }
});

test('hosted target validation refuses invisible boards and mismatched columns before writing', async () => {
  let writes = 0;
  const mcp = { async callTool({ name }) {
    if (name !== 'get_board') writes += 1;
    return { content: [{ type: 'text', text: JSON.stringify({ board: { id: boardId }, columns: [{ id: 'another-column' }] }) }] };
  } };
  await assert.rejects(verifyHostedTrelliniTarget(mcp, boardId, columnId), /does not belong/);
  assert.equal(writes, 0);
  await assert.rejects(verifyHostedTrelliniTarget({ async callTool() { return { isError: true, content: [{ type: 'text', text: 'sensitive upstream error' }] }; } }, boardId, columnId), /Check access and token expiry/);
});

test('older hosted servers receive board_id only when their actual schema declares it', () => {
  const fields = { column_id: columnId, title: 'Sample' };
  assert.deepEqual(trelliniCardArguments({ inputSchema: { properties: { board_id: { type: 'string' } } } }, boardId, fields), { ...fields, board_id: boardId });
  assert.deepEqual(trelliniCardArguments({ inputSchema: { properties: {} } }, boardId, fields), fields);
});

test('expired hosted credentials produce a useful error without exposing the token or response', async () => {
  await assert.rejects(connectTrelliniMcp(trelliniConnectionConfig(env), {
    fetch: async () => new Response('personal-session-token sensitive-error', { status: 401 }),
  }), error => {
    assert.match(error.message, /refresh an expired user token/);
    assert.doesNotMatch(error.message, /personal-session-token|sensitive-error/);
    return true;
  });
});

test('tool discovery and calls do not expose upstream error bodies', async () => {
  const fail = async () => { throw new Error('personal-session-token sensitive-error'); };
  await assert.rejects(listTrelliniTools({ listTools: fail }), /tool discovery failed\. Check access and token expiry\.$/);
  await assert.rejects(callTrelliniTool({ callTool: fail }, 'create_card', {}), /create_card failed\. Check access and token expiry\.$/);
});
