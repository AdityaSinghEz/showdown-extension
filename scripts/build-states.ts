/**
 * Builds a full-information training set from the downloaded replays.
 *
 * Usage:
 *
 * ```
 * npm run states:build
 * npm run states:build -- --limit 50
 * ```
 *
 * Each replay is re-simulated with the Showdown build that played it, and at
 * the start of every turn the position features of `lib/review/features.ts`
 * are written to `data/states.jsonl`, one line per position, together with who
 * won. Games that ended by forfeit or timeout are left out, as in the
 * spectator-log model, because a disconnect can decide a game the position did
 * not. Needs `npm run sim:setup` to have built the required Showdown versions.
 */

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseGames } from '../lib/dataset/load';
import { collectTurnStarts } from '../lib/review/engine';
import { richFeatures, RICH_FEATURE_NAMES } from '../lib/review/features';
import { loadBuiltSim, type SimModule } from '../lib/review/sim';
import { simFolderName, versionFromInputLog } from '../lib/replay/version';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      data: { type: 'string', default: 'data' },
      'sim-root': { type: 'string', default: '..' },
      out: { type: 'string', default: 'data/states.jsonl' },
      limit: { type: 'string' },
    },
  });
  const dataDir = values.data ?? 'data';
  const rawDir = join(dataDir, 'raw');
  const limit = values.limit === undefined ? Infinity : Number(values.limit);

  // Winners come from the dataset records, which also say which games were forfeits.
  const recordsPath = join(dataDir, 'games.jsonl');
  if (!existsSync(recordsPath)) throw new Error(`Missing ${recordsPath}. Run: npm run dataset:build`);
  const { records } = parseGames(await readFile(recordsPath, 'utf8'));
  const byId = new Map(records.map((r) => [r.id, r]));

  const files = (await readdir(rawDir)).filter((f) => f.endsWith('.json')).sort();
  const sims = new Map<string, SimModule>();
  const lines: string[] = [];
  let games = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    if (games >= limit) break;
    const id = file.slice(0, -5);
    const record = byId.get(id);
    if (!record || record.forfeited) {
      skipped += 1;
      continue;
    }
    const replay = JSON.parse(await readFile(join(rawDir, file), 'utf8')) as { inputlog?: string };
    const version = replay.inputlog ? versionFromInputLog(replay.inputlog) : null;
    if (!replay.inputlog || !version) {
      skipped += 1;
      continue;
    }
    try {
      const folder = join(resolve(values['sim-root'] ?? '..'), simFolderName(version));
      const sim = sims.get(folder) ?? loadBuiltSim(folder);
      sims.set(folder, sim);

      const label = record.winner === 'p1' ? 1 : 0;
      const rows: string[] = [];
      await collectTurnStarts(sim, replay.inputlog, {
        keepState: false,
        onTurnStart: (battle) => {
          const features = richFeatures(battle);
          if (features !== null) rows.push(JSON.stringify({ id, turn: battle.turn, f: features.map((v) => Math.round(v * 1e4) / 1e4), y: label }));
        },
      });
      lines.push(...rows);
      games += 1;
      if (games % 50 === 0) console.log(`${games} games, ${lines.length} positions`);
    } catch (error) {
      failed += 1;
      console.warn(`FAILED ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const out = values.out ?? 'data/states.jsonl';
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, lines.join('\n') + (lines.length > 0 ? '\n' : ''));
  console.log(
    `Wrote ${lines.length} positions from ${games} games to ${out} (${skipped} games skipped as forfeits or unusable, ${failed} failed).`,
  );
  console.log(`Features: ${RICH_FEATURE_NAMES.join(', ')}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
