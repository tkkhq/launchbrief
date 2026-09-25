#!/usr/bin/env node
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { isMissing, readLabEnv } from './env-file.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toolData(result, name) {
  if (result?.isError) throw new Error(`Trellini MCP ${name} failed.`);
  const item = result?.content?.find(entry => entry.type === 'text');
  if (!item) throw new Error(`Trellini MCP ${name} returned no text.`);
  try { return JSON.parse(item.text); }
  catch { throw new Error(`Trellini MCP ${name} returned invalid JSON.`); }
}

export async function listTrelliniTargets(mcp) {
  const boards = toolData(await mcp.callTool({ name: 'list_boards', arguments: {} }), 'list_boards');
  if (!Array.isArray(boards)) throw new Error('Trellini MCP list_boards returned an unexpected result.');
  const targets = [];
  for (const board of boards) {
    if (!uuid.test(board?.id || '')) throw new Error('Trellini MCP returned an invalid board ID.');
    const details = toolData(await mcp.callTool({ name: 'get_board', arguments: { board_id: board.id } }), 'get_board');
    if (!Array.isArray(details?.columns)) throw new Error('Trellini MCP get_board returned no columns list.');
    if (details.columns.some(column => !uuid.test(column?.id || ''))) throw new Error('Trellini MCP returned an invalid column ID.');
    targets.push({ id: board.id, name: board.name, columns: details.columns.map(column => ({ id: column.id, title: column.title })) });
  }
  return targets;
}

function display(value) { return String(value || '').replace(/\s+/g, ' ').slice(0, 80); }

async function main() {
  const values = await readLabEnv();
  for (const name of ['TRELLINI_API_URL', 'TRELLINI_SERVICE_KEY']) {
    if (isMissing(values[name])) throw new Error(`Set ${name} in .env.cloud first.`);
  }
  try { if (new URL(values.TRELLINI_API_URL).protocol !== 'https:') throw new Error(); }
  catch { throw new Error('TRELLINI_API_URL must be HTTPS.'); }
  const requireFromFunctions = createRequire(resolve('volcano/functions/package.json'));
  let clientPath, transportPath;
  try {
    clientPath = requireFromFunctions.resolve('@modelcontextprotocol/sdk/client/index.js');
    transportPath = requireFromFunctions.resolve('@modelcontextprotocol/sdk/client/stdio.js');
  } catch { throw new Error('Run npm ci --prefix volcano/functions before using this helper.'); }
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import(pathToFileURL(clientPath).href), import(pathToFileURL(transportPath).href),
  ]);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('volcano/functions/_shared/trellini-mcp/index.mjs')],
    env: {
      VOLCANO_API_URL: values.TRELLINI_API_URL,
      VOLCANO_SERVICE_KEY: values.TRELLINI_SERVICE_KEY,
      VOLCANO_DATABASE: values.TRELLINI_DATABASE || 'trellini',
    },
  });
  const mcp = new Client({ name: 'launchbrief-lab-targets', version: '1.0.0' });
  try {
    await mcp.connect(transport);
    const targets = await listTrelliniTargets(mcp);
    if (!targets.length) console.log('No Trellini boards found. Create a board and column in Trellini first.');
    for (const board of targets) {
      console.log(`Board: ${display(board.name)} (${board.id})`);
      for (const column of board.columns) console.log(`  Column: ${display(column.title)} (${column.id})`);
    }
  } finally {
    await mcp.close().catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Could not list Trellini targets. Check .env.cloud, Function dependencies, and Trellini access; no credentials were printed.'); process.exitCode = 1; });
}
