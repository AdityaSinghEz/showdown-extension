/**
 * Exports game positions for the poke-engine search.
 *
 * Usage:
 *   npm run engine:export -- --games 120 --every 3 --split test
 *   npm run engine:export -- --id gen9randombattle-2701773375 --every 1
 *
 * Replays each game with the exact Showdown build that played it and writes
 * one line per position to `data/engine-states.jsonl`: the position in the
 * engine's format, the legal options for both sides with the engine's names
 * for them, what was actually played, who won, and this project's own estimate
 * of the position (model and rollouts) so the three can be compared.
 *
 * Next steps (see tools/engine/README.md):
 *   python tools/engine/search.py data/engine-states.jsonl data/engine-results.jsonl
 *   npm run engine:report
 */

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseGames } from '../lib/dataset/load';
import type { LogisticModel } from '../lib/model/logistic';
import { isTestGame } from '../lib/model/split';
import { simFolderName, versionFromInputLog } from '../lib/replay/version';
import { collectTurnStarts, legalOptions, matchChoice, type ChoiceOption } from '../lib/review/engine';
import { engineOptions, toEngineState, type EngineOption } from '../lib/review/engine-state';
import { winProbability } from '../lib/review/position';
import { rolloutValue } from '../lib/review/rollout';
import { loadBuiltSim, type SimModule, type SimSide } from '../lib/review/sim';

interface Row {
  id: string;
  turn: number;
  y: number | null;
  state: unknown;
  p1: EngineOption[];
  p2: EngineOption[];
  played: { p1: string | null; p2: string | null };
  model: number;
  rollout: number | null;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      data: { type: 'string', default: 'data' },
      model: { type: 'string', default: 'data/model-rich.json' },
      'sim-root': { type: 'string', default: '..' },
      out: { type: 'string', default: 'data/engine-states.jsonl' },
      id: { type: 'string' },
      games: { type: 'string', default: '120' },
      every: { type: 'string', default: '3' },
      split: { type: 'string', default: 'test' },
      'test-percent': { type: 'string', default: '20' },
      rollouts: { type: 'string', default: '6' },
      depth: { type: 'string', default: '6' },
    },
  });
  const dataDir = values.data ?? 'data';
  const every = Number(values.every);
  const maxGames = Number(values.games);
  const testPercent = Number(values['test-percent']);
  const rollouts = Number(values.rollouts);
  const depth = Number(values.depth);
  const split = values.split ?? 'test';
  if (!['test', 'train', 'all'].includes(split)) throw new Error('--split must be test, train or all');
  const model = JSON.parse(await readFile(values.model ?? 'data/model-rich.json', 'utf8')) as LogisticModel;

  const recordsPath = join(dataDir, 'games.jsonl');
  const winners = new Map<string, number>();
  const forfeits = new Set<string>();
  if (existsSync(recordsPath)) {
    for (const record of parseGames(await readFile(recordsPath, 'utf8')).records) {
      winners.set(record.id, record.winner === 'p1' ? 1 : 0);
      if (record.forfeited) forfeits.add(record.id);
    }
  }

  const rawDir = join(dataDir, 'raw');
  const files = values.id !== undefined ? [`${values.id}.json`] : (await readdir(rawDir)).filter((f) => f.endsWith('.json')).sort();
  const sims = new Map<string, SimModule>();
  const lines: string[] = [];
  let games = 0;

  for (const file of files) {
    if (games >= maxGames && values.id === undefined) break;
    const id = file.slice(0, -5);
    if (values.id === undefined) {
      if (forfeits.has(id) || !winners.has(id)) continue;
      if (split === 'test' && !isTestGame(id, testPercent)) continue;
      if (split === 'train' && isTestGame(id, testPercent)) continue;
    }
    const replay = JSON.parse(await readFile(join(rawDir, file), 'utf8')) as { inputlog?: string };
    const version = replay.inputlog ? versionFromInputLog(replay.inputlog) : null;
    if (!replay.inputlog || !version) continue;
    try {
      const folder = join(resolve(values['sim-root'] ?? '..'), simFolderName(version));
      const sim = sims.get(folder) ?? loadBuiltSim(folder);
      sims.set(folder, sim);
      const rows = new Map<number, Row>();
      // The full options are kept here (not written out) to match what was played.
      const choices = new Map<number, { p1: ChoiceOption[]; p2: ChoiceOption[] }>();
      const starts = await collectTurnStarts(sim, replay.inputlog, {
        keepState: false,
        onTurnStart: (battle) => {
          if (battle.turn % every !== 0) return;
          const state = toEngineState(battle);
          const [side1, side2] = battle.sides as [SimSide, SimSide];
          const options1 = legalOptions(side1.activeRequest, true);
          const options2 = legalOptions(side2.activeRequest, true);
          if (state === null || options1.length === 0 || options2.length === 0) return;
          choices.set(battle.turn, { p1: options1, p2: options2 });
          rows.set(battle.turn, {
            id,
            turn: battle.turn,
            y: winners.get(id) ?? null,
            state,
            p1: engineOptions(side1, options1),
            p2: engineOptions(side2, options2),
            played: { p1: null, p2: null },
            model: winProbability(battle, model),
            rollout: rollouts > 0 ? rolloutValue(sim, battle, model, { rollouts, depth, seed: battle.turn }) : null,
          });
        },
      });
      // Attach what was actually played, matched against each side's options.
      for (const start of starts) {
        const row = rows.get(start.turn);
        if (!row) continue;
        for (const side of ['p1', 'p2'] as const) {
          const line = start.played[side];
          if (line === null) continue;
          const index = matchChoice(line, (choices.get(start.turn) as { p1: ChoiceOption[]; p2: ChoiceOption[] })[side]);
          if (index >= 0) row.played[side] = row[side][index]?.engine ?? null;
        }
      }
      for (const row of rows.values()) lines.push(JSON.stringify(row));
      games += 1;
      if (games % 10 === 0) console.log(`${games} games, ${lines.length} positions`);
    } catch (error) {
      console.warn(`FAILED ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const out = values.out ?? 'data/engine-states.jsonl';
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, lines.join('\n') + (lines.length > 0 ? '\n' : ''));
  console.log(`Wrote ${lines.length} positions from ${games} games to ${out}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
