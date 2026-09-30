import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvFile } from '../scripts/env-file.mjs';
import { validateLabEnv } from '../scripts/check-env.mjs';
import { listTrelliniTargets } from '../scripts/list-trellini-targets.mjs';

const valid = {
  VOLCANO_API_URL: 'https://api.example.test',
  VOLCANO_ANON_KEY: 'launch-anon',
  VOLCANO_SERVICE_KEY: 'launch-server',
  VOLCANO_DATABASE: 'app',
  NEXT_PUBLIC_VOLCANO_API_URL: 'https://api.example.test',
  NEXT_PUBLIC_VOLCANO_ANON_KEY: 'launch-anon',
  NEXT_PUBLIC_VOLCANO_DATABASE: 'app',
  ANTHROPIC_API_KEY: 'model-key',
  LAUNCHBRIEF_CREDIT_GATE_ENABLED: 'false',
  TRELLINI_MCP_TRANSPORT: 'http',
  TRELLINI_MCP_URL: 'https://mcp.example.test/',
  TRELLINI_ACCESS_TOKEN: 'participant-token',
  TRELLINI_BOARD_ID: '11111111-1111-4111-8111-111111111111',
  TRELLINI_COLUMN_ID: '22222222-2222-4222-8222-222222222222',
};

test('lab env parser handles the simple private file format without echoing values', () => {
  assert.deepEqual(parseEnvFile('# comment\nKEY=value\nSECOND="quoted"\n'), { KEY: 'value', SECOND: 'quoted' });
  assert.throws(() => parseEnvFile('SECRET=private\nSECRET=private'), /Duplicate SECRET on line 2/);
  assert.throws(() => parseEnvFile('SECRET=private\ninvalid line'), /Expected KEY=value on line 2/);
});

test('lab env checker distinguishes predeploy from ready and catches cross-project keys', () => {
  assert.deepEqual(validateLabEnv(valid, 'predeploy').errors, []);
  assert.match(validateLabEnv(valid, 'ready').errors.join('\n'), /APP_BASE_URL/);
  assert.deepEqual(validateLabEnv({ ...valid, APP_BASE_URL: 'https://launch.example.test/' }, 'ready').errors, []);
  const failures = validateLabEnv({ ...valid, TRELLINI_SERVICE_KEY: 'owner-secret', LAUNCHBRIEF_CREDIT_GATE_ENABLED: 'true' }).errors.join('\n');
  assert.match(failures, /remove this/);
  assert.match(failures, /LAUNCHBRIEF_CREDIT_GATE_ENABLED/);
  assert.doesNotMatch(failures, /owner-secret/);
});

test('Trellini target finder only calls existing read-only MCP tools', async () => {
  const calls = [];
  const mcp = { async callTool(call) {
    calls.push(call);
    if (call.name === 'list_boards') return { content: [{ type: 'text', text: JSON.stringify([{ id: valid.TRELLINI_BOARD_ID, name: 'Launch tasks' }]) }] };
    if (call.name === 'get_board') return { content: [{ type: 'text', text: JSON.stringify({ columns: [{ id: valid.TRELLINI_COLUMN_ID, title: 'New requests' }] }) }] };
    throw new Error('unexpected tool');
  } };
  assert.deepEqual(await listTrelliniTargets(mcp), [{ id: valid.TRELLINI_BOARD_ID, name: 'Launch tasks', columns: [{ id: valid.TRELLINI_COLUMN_ID, title: 'New requests' }] }]);
  assert.deepEqual(calls, [
    { name: 'list_boards', arguments: {} },
    { name: 'get_board', arguments: { board_id: valid.TRELLINI_BOARD_ID } },
  ]);
});

test('Trellini MCP errors do not echo remote error text', async () => {
  const mcp = { async callTool() { return { isError: true, content: [{ type: 'text', text: 'private-token' }] }; } };
  await assert.rejects(() => listTrelliniTargets(mcp), error => /Trellini MCP list_boards failed/.test(error.message));
});
