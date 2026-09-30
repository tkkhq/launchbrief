import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
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
  LAUNCHBRIEF_CREDIT_GATE_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'stripe-test-secret',
  STRIPE_PRICE_ID: 'price_test',
  CREDITS_PER_PACK: '5',
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

test('lab helpers load Stripe settings from the repository-root .env by default', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'launchbrief-env-'));
  try {
    await writeFile(join(directory, '.env'), 'STRIPE_SECRET_KEY=fixture-private-key\nCREDITS_PER_PACK=5\n');
    const moduleUrl = new URL('../scripts/env-file.mjs', import.meta.url).href;
    const script = `import assert from 'node:assert/strict'; import {readLabEnv} from ${JSON.stringify(moduleUrl)};
      const values = await readLabEnv();
      assert.equal(values.STRIPE_SECRET_KEY, 'fixture-private-key');
      assert.equal(values.CREDITS_PER_PACK, '5');`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, 'Default .env loading must succeed');
    assert.equal(result.stdout, '');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('lab env checker distinguishes predeploy from ready and catches cross-project keys', () => {
  assert.deepEqual(validateLabEnv(valid, 'predeploy').errors, []);
  assert.match(validateLabEnv(valid, 'ready').errors.join('\n'), /APP_BASE_URL/);
  assert.deepEqual(validateLabEnv({ ...valid, APP_BASE_URL: 'https://launch.example.test/', STRIPE_WEBHOOK_SECRET: 'webhook-test-secret' }, 'ready').errors, []);
  const failures = validateLabEnv({ ...valid, TRELLINI_SERVICE_KEY: 'owner-secret', LAUNCHBRIEF_CREDIT_GATE_ENABLED: 'false' }).errors.join('\n');
  assert.match(failures, /remove this/);
  assert.match(failures, /LAUNCHBRIEF_CREDIT_GATE_ENABLED/);
  assert.doesNotMatch(failures, /owner-secret/);
});

test('credit-gated lab requires checkout fields and a webhook secret before testing', () => {
  assert.match(validateLabEnv({ ...valid, STRIPE_SECRET_KEY: '' }).errors.join('\n'), /STRIPE_SECRET_KEY/);
  assert.match(validateLabEnv({ ...valid, STRIPE_PRICE_ID: '' }).errors.join('\n'), /STRIPE_PRICE_ID/);
  for (const pack of ['', '0', '1.5', '1001', 'not-a-number']) {
    assert.match(validateLabEnv({ ...valid, CREDITS_PER_PACK: pack }).errors.join('\n'), /CREDITS_PER_PACK/);
  }
  assert.deepEqual(validateLabEnv(valid, 'predeploy').errors, []);
  assert.match(validateLabEnv({ ...valid, APP_BASE_URL: 'https://launch.example.test/' }, 'ready').errors.join('\n'), /STRIPE_WEBHOOK_SECRET/);
  assert.match(validateLabEnv({ ...valid, CREDITS_PER_PACK: '1' }).warnings.join('\n'), /at least 3 credits/);
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
