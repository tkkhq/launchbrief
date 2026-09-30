#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLabEnv } from './env-file.mjs';
import connection from '../../volcano/functions/_shared/trellini-connection.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const { trelliniConnectionConfig, connectTrelliniMcp, callTrelliniTool, trelliniToolData: toolData } = connection;

export async function listTrelliniTargets(mcp) {
  const boards = toolData(await callTrelliniTool(mcp, 'list_boards', {}), 'list_boards');
  if (!Array.isArray(boards)) throw new Error('Trellini MCP list_boards returned an unexpected result.');
  const targets = [];
  for (const board of boards) {
    if (!uuid.test(board?.id || '')) throw new Error('Trellini MCP returned an invalid board ID.');
    const details = toolData(await callTrelliniTool(mcp, 'get_board', { board_id: board.id }), 'get_board');
    if (!Array.isArray(details?.columns)) throw new Error('Trellini MCP get_board returned no columns list.');
    if (details.columns.some(column => !uuid.test(column?.id || ''))) throw new Error('Trellini MCP returned an invalid column ID.');
    targets.push({ id: board.id, name: board.name, columns: details.columns.map(column => ({ id: column.id, title: column.title })) });
  }
  return targets;
}

function display(value) { return String(value || '').replace(/\s+/g, ' ').slice(0, 80); }

async function main() {
  const values = await readLabEnv();
  const config = trelliniConnectionConfig(values);
  if (config.mode !== 'http') throw new Error('Use TRELLINI_MCP_TRANSPORT=http for the shared-board lab.');
  const mcp = await connectTrelliniMcp(config, { name: 'launchbrief-lab-targets' });
  try {
    const targets = await listTrelliniTargets(mcp);
    if (!targets.length) console.log('No Trellini boards found. Ask the facilitator to confirm the shared board is visible to your account.');
    for (const board of targets) {
      console.log(`Board: ${display(board.name)} (${board.id})`);
      for (const column of board.columns) console.log(`  Column: ${display(column.title)} (${column.id})`);
    }
  } finally {
    await mcp.close().catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Could not list Trellini targets. Check .env, Function dependencies, and Trellini access; no credentials were printed.'); process.exitCode = 1; });
}
