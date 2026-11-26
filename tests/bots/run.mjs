// Runs one bot check: `node tests/bots/run.mjs ratio [--autocast]` or `node tests/bots/run.mjs pacing`.
import { spawnSync } from 'node:child_process';

const [bot, ...flags] = process.argv.slice(2);
const env = { ...process.env, BOT_AUTOCAST: flags.includes('--autocast') ? '1' : '' };
const unknown = flags.filter((f) => f !== '--autocast');
if (!bot || unknown.length > 0) {
  console.error(`Usage: node tests/bots/run.mjs <ratio|pacing> [--autocast]${unknown.length ? ` (unknown: ${unknown.join(' ')})` : ''}`);
  process.exit(2);
}
const result = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.bots.config.ts', bot], { stdio: 'inherit', env, shell: true });
process.exit(result.status ?? 1);
