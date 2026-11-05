/**
 * Reviews one game with the poke-engine search as the judge.
 *
 * Usage:
 *   npm run engine:review -- --id gen9randombattle-2701773375
 *   npm run engine:review -- --id gen9randombattle-2701773375 --python .venv\Scripts\python.exe
 *
 * Runs the three steps in order: export every turn of the game, search each
 * position with the engine (`tools/engine/search.py`), and print the engine's
 * grade for both players. Setup for the Python side is in
 * `tools/engine/README.md`.
 */

import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: true });
  if (result.status !== 0) throw new Error(`Step failed: ${command} ${args.join(' ')}`);
}

function quote(text: string): string {
  return /\s/.test(text) ? `"${text}"` : text;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      id: { type: 'string' },
      python: { type: 'string', default: process.env.PYTHON ?? 'python' },
      iterations: { type: 'string', default: '100000' },
      data: { type: 'string', default: 'data' },
      model: { type: 'string', default: 'data/model-rich.json' },
      'sim-root': { type: 'string', default: '..' },
    },
  });
  if (values.id === undefined) throw new Error('Give a game with --id, for example --id gen9randombattle-2701773375');
  const dataDir = values.data ?? 'data';
  const states = `${dataDir}/engine-states-${values.id}.jsonl`;
  const results = `${dataDir}/engine-results-${values.id}.jsonl`;

  run('npx', [
    'tsx', 'scripts/engine-export.ts',
    '--id', values.id, '--every', '1', '--rollouts', '0',
    '--data', quote(dataDir), '--model', quote(values.model ?? ''), '--sim-root', quote(values['sim-root'] ?? '..'),
    '--out', quote(states),
  ]);
  run(quote(values.python ?? 'python'), ['tools/engine/search.py', quote(states), quote(results), '--iterations', values.iterations ?? '100000']);
  run('npx', ['tsx', 'scripts/engine-report.ts', '--states', quote(states), '--results', quote(results), '--id', values.id]);
}

main();
