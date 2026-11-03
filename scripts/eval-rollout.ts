/**
 * Measures whether rollouts predict winners better than the model alone.
 *
 * Usage:
 *   npm run eval:rollout -- --model data/model-rich.json --games 40
 *   npm run eval:rollout -- --model data/model-rich.json --games 40 --rollouts 8 --depth 8
 *
 * For positions taken from held-out human games (the same 20% split the model
 * was never trained on), it compares two predictions of who wins:
 *   - the model's reading of the position, and
 *   - the average over several forward games from that position (see
 *     `lib/review/rollout.ts`), each ending in a model reading.
 * Lower log loss is better. This is the honest test of the review's accuracy:
 * if the rollout number scores lower, grades built on it are better grounded.
 */

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseGames } from '../lib/dataset/load';
import type { LogisticModel } from '../lib/model/logistic';
import { isTestGame } from '../lib/model/split';
import { collectTurnStarts } from '../lib/review/engine';
import { winProbability } from '../lib/review/position';
import { rolloutValue } from '../lib/review/rollout';
import { loadBuiltSim, type SimModule } from '../lib/review/sim';
import { simFolderName, versionFromInputLog } from '../lib/replay/version';

interface Tally {
  count: number;
  modelLoss: number;
  rolloutLoss: number;
  blendLoss: number;
  modelRight: number;
  rolloutRight: number;
}

function logLoss(p: number, y: number): number {
  const clipped = Math.min(1 - 1e-4, Math.max(1e-4, p));
  return -(y * Math.log(clipped) + (1 - y) * Math.log(1 - clipped));
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      data: { type: 'string', default: 'data' },
      model: { type: 'string', default: 'data/model-rich.json' },
      'sim-root': { type: 'string', default: '..' },
      games: { type: 'string', default: '40' },
      every: { type: 'string', default: '3' },
      rollouts: { type: 'string', default: '6' },
      depth: { type: 'string', default: '6' },
      'test-percent': { type: 'string', default: '20' },
    },
  });
  const dataDir = values.data ?? 'data';
  const maxGames = Number(values.games);
  const every = Number(values.every);
  const rollouts = Number(values.rollouts);
  const depth = Number(values.depth);
  const testPercent = Number(values['test-percent']);
  const model = JSON.parse(await readFile(values.model ?? 'data/model-rich.json', 'utf8')) as LogisticModel;

  const recordsPath = join(dataDir, 'games.jsonl');
  if (!existsSync(recordsPath)) throw new Error(`Missing ${recordsPath}. Run: npm run dataset:build`);
  const { records } = parseGames(await readFile(recordsPath, 'utf8'));
  const byId = new Map(records.map((r) => [r.id, r]));

  const rawDir = join(dataDir, 'raw');
  const files = (await readdir(rawDir)).filter((f) => f.endsWith('.json')).sort();
  const sims = new Map<string, SimModule>();
  const stages: Record<string, Tally> = {};
  const tally = (stage: string): Tally =>
    (stages[stage] ??= { count: 0, modelLoss: 0, rolloutLoss: 0, blendLoss: 0, modelRight: 0, rolloutRight: 0 });

  let games = 0;
  for (const file of files) {
    if (games >= maxGames) break;
    const id = file.slice(0, -5);
    const record = byId.get(id);
    if (!record || record.forfeited || !isTestGame(id, testPercent)) continue;
    const replay = JSON.parse(await readFile(join(rawDir, file), 'utf8')) as { inputlog?: string };
    const version = replay.inputlog ? versionFromInputLog(replay.inputlog) : null;
    if (!replay.inputlog || !version) continue;
    try {
      const folder = join(resolve(values['sim-root'] ?? '..'), simFolderName(version));
      const sim = sims.get(folder) ?? loadBuiltSim(folder);
      sims.set(folder, sim);
      const y = record.winner === 'p1' ? 1 : 0;
      await collectTurnStarts(sim, replay.inputlog, {
        keepState: false,
        onTurnStart: (battle) => {
          if (battle.turn % every !== 0) return;
          const stage = battle.turn <= 8 ? 'turns 1-8' : battle.turn <= 20 ? 'turns 9-20' : 'turns 21+';
          const t = tally(stage);
          const pm = winProbability(battle, model);
          const pr = rolloutValue(sim, battle, model, { rollouts, depth, seed: battle.turn });
          t.count += 1;
          t.modelLoss += logLoss(pm, y);
          t.rolloutLoss += logLoss(pr, y);
          t.blendLoss += logLoss(0.5 * pm + 0.5 * pr, y);
          t.modelRight += (pm > 0.5) === (y === 1) ? 1 : 0;
          t.rolloutRight += (pr > 0.5) === (y === 1) ? 1 : 0;
        },
      });
      games += 1;
      if (games % 10 === 0) console.log(`${games} games`);
    } catch (error) {
      console.warn(`FAILED ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`\n${games} held-out games, every ${every}rd turn, ${rollouts} rollouts of ${depth} turns. Lower log loss is better.`);
  console.log('stage        positions   model loss   rollout loss   50/50 blend   model acc   rollout acc');
  const all: Tally = { count: 0, modelLoss: 0, rolloutLoss: 0, blendLoss: 0, modelRight: 0, rolloutRight: 0 };
  for (const stage of ['turns 1-8', 'turns 9-20', 'turns 21+']) {
    const t = stages[stage];
    if (!t || t.count === 0) continue;
    for (const key of Object.keys(all) as (keyof Tally)[]) all[key] += t[key];
    console.log(
      `${stage.padEnd(12)} ${String(t.count).padStart(9)}   ${(t.modelLoss / t.count).toFixed(4).padStart(10)}   ${(t.rolloutLoss / t.count).toFixed(4).padStart(12)}   ${(t.blendLoss / t.count).toFixed(4).padStart(11)}   ${((t.modelRight / t.count) * 100).toFixed(1).padStart(8)}%   ${((t.rolloutRight / t.count) * 100).toFixed(1).padStart(10)}%`,
    );
  }
  if (all.count > 0) {
    console.log(
      `${'all'.padEnd(12)} ${String(all.count).padStart(9)}   ${(all.modelLoss / all.count).toFixed(4).padStart(10)}   ${(all.rolloutLoss / all.count).toFixed(4).padStart(12)}   ${(all.blendLoss / all.count).toFixed(4).padStart(11)}   ${((all.modelRight / all.count) * 100).toFixed(1).padStart(8)}%   ${((all.rolloutRight / all.count) * 100).toFixed(1).padStart(10)}%`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
