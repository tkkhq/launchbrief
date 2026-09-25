import { readFile } from 'node:fs/promises';

// The lab template deliberately uses simple KEY=value lines. Keep parsing
// independent of application dependencies so it works before cloud deployment.
export function parseEnvFile(source) {
  const values = {};
  for (const [index, original] of source.split(/\r?\n/).entries()) {
    const line = original.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error(`Expected KEY=value on line ${index + 1}.`);
    const [, name, raw] = match;
    if (Object.hasOwn(values, name)) throw new Error(`Duplicate ${name} on line ${index + 1}.`);
    let value = raw.trim();
    if (value.startsWith('"') || value.startsWith("'")) {
      if (value.length < 2 || value.at(-1) !== value[0]) throw new Error(`Unclosed quote on line ${index + 1}.`);
      value = value.slice(1, -1);
    }
    values[name] = value;
  }
  return values;
}

export async function readLabEnv(file = '.env.cloud') {
  return parseEnvFile(await readFile(file, 'utf8'));
}

export function isMissing(value) {
  return !value || /^<[^>]+>$/.test(value) || /^YOUR_[A-Z0-9_]+$/.test(value) || /^(?:ak|sk)-\.\.\.$/.test(value);
}
