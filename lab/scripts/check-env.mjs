#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMissing, readLabEnv } from './env-file.mjs';

const required = [
  'VOLCANO_API_URL', 'VOLCANO_ANON_KEY', 'VOLCANO_SERVICE_KEY', 'VOLCANO_DATABASE',
  'NEXT_PUBLIC_VOLCANO_API_URL', 'NEXT_PUBLIC_VOLCANO_ANON_KEY', 'NEXT_PUBLIC_VOLCANO_DATABASE',
  'ANTHROPIC_API_KEY', 'LAUNCHBRIEF_CREDIT_GATE_ENABLED',
  'TRELLINI_API_URL', 'TRELLINI_SERVICE_KEY', 'TRELLINI_DATABASE',
  'TRELLINI_BOARD_ID', 'TRELLINI_COLUMN_ID',
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

export function validateLabEnv(values, phase = 'predeploy') {
  const errors = [];
  const warnings = [];
  for (const name of required) if (isMissing(values[name])) errors.push(`${name}: missing or still a placeholder`);
  if (phase === 'ready' && isMissing(values.APP_BASE_URL)) errors.push('APP_BASE_URL: set this from the deployed frontend URL');
  for (const name of ['VOLCANO_API_URL', 'NEXT_PUBLIC_VOLCANO_API_URL', 'TRELLINI_API_URL', 'APP_BASE_URL']) {
    if (!isMissing(values[name]) && !validHttps(values[name])) errors.push(`${name}: must be an HTTPS URL without embedded credentials`);
  }
  for (const name of ['TRELLINI_BOARD_ID', 'TRELLINI_COLUMN_ID']) {
    if (!isMissing(values[name]) && !uuid.test(values[name])) errors.push(`${name}: must be a UUID`);
  }
  if (!isMissing(values.TRELLINI_BOARD_ID) && values.TRELLINI_BOARD_ID === values.TRELLINI_COLUMN_ID) errors.push('TRELLINI_BOARD_ID and TRELLINI_COLUMN_ID must differ');
  for (const [name, expected] of Object.entries({ VOLCANO_DATABASE: 'app', NEXT_PUBLIC_VOLCANO_DATABASE: 'app', TRELLINI_DATABASE: 'trellini', LAUNCHBRIEF_CREDIT_GATE_ENABLED: 'false' })) {
    if (!isMissing(values[name]) && values[name] !== expected) errors.push(`${name}: expected ${expected} for this lab`);
  }
  if (!isMissing(values.VOLCANO_SERVICE_KEY) && values.VOLCANO_SERVICE_KEY === values.TRELLINI_SERVICE_KEY) errors.push('VOLCANO_SERVICE_KEY and TRELLINI_SERVICE_KEY must come from separate projects');
  if (!isMissing(values.VOLCANO_SERVICE_KEY) && values.VOLCANO_SERVICE_KEY === values.NEXT_PUBLIC_VOLCANO_ANON_KEY) errors.push('A service key must never be a NEXT_PUBLIC value');
  if (!isMissing(values.TRELLINI_SERVICE_KEY) && values.TRELLINI_SERVICE_KEY === values.NEXT_PUBLIC_VOLCANO_ANON_KEY) errors.push('A Trellini service key must never be a NEXT_PUBLIC value');
  if (!isMissing(values.VOLCANO_SERVICE_KEY) && values.VOLCANO_SERVICE_KEY === values.VOLCANO_ANON_KEY) errors.push('VOLCANO_ANON_KEY must be a browser key, not a service key');
  if (['STRIPE_SECRET_KEY', 'STRIPE_PRICE_ID', 'STRIPE_WEBHOOK_SECRET'].some(name => !isMissing(values[name]))) warnings.push('Stripe values are not needed in no-credit lab mode');
  return { errors, warnings };
}

async function main() {
  const phase = process.argv[2] || 'predeploy';
  if (!['predeploy', 'ready'].includes(phase)) throw new Error('Usage: node lab/scripts/check-env.mjs [predeploy|ready]');
  const ignored = spawnSync('git', ['check-ignore', '--quiet', '.env.cloud'], { stdio: 'ignore' });
  if (ignored.status !== 0) throw new Error('.env.cloud must be ignored by Git before it contains secrets.');
  const values = await readLabEnv();
  const { errors, warnings } = validateLabEnv(values, phase);
  for (const warning of warnings) console.warn(`Warning: ${warning}`);
  if (errors.length) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${phase} environment check passed. Secret values were not printed.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Environment check failed: ${error.message}`); process.exitCode = 1; });
}
