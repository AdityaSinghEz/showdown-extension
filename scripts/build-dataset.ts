/**
 * Converts downloaded replays into a dataset file.
 *
 * Usage:
 *
 * ```
 * npm run dataset:build
 * ```
 *
 * Reads every `<out>/raw/*.json`, runs each through the battle recorder, and
 * writes one JSON object per line to `<out>/games.jsonl`. A summary of what
 * was kept and why other replays were skipped is printed at the end.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { buildGameRecord, summarize, type GameRecord, type SkipReason } from '../lib/dataset/record';
import { parseReplayJson } from '../lib/replay/types';

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: 'string', default: 'data' } } });
  const outDir = values.out ?? 'data';
  const rawDir = join(outDir, 'raw');

  const files = (await readdir(rawDir)).filter((f) => f.endsWith('.json')).sort();
  const records: GameRecord[] = [];
  const skipped = new Map<SkipReason | 'unreadable', number>();
  const bump = (reason: SkipReason | 'unreadable'): void => {
    skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  };

  for (const file of files) {
    try {
      const replay = parseReplayJson(JSON.parse(await readFile(join(rawDir, file), 'utf8')));
      if (!replay) {
        bump('unreadable');
        continue;
      }
      const result = buildGameRecord(replay);
      if (result.ok) records.push(result.record);
      else bump(result.reason);
    } catch {
      bump('unreadable');
    }
  }

  const target = join(outDir, 'games.jsonl');
  await writeFile(target, records.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const summary = summarize(records);
  console.log(`Read ${files.length} replays, kept ${summary.games}, wrote ${target}`);
  for (const [reason, count] of skipped) console.log(`  skipped (${reason}): ${count}`);
  console.log(`Average turns: ${summary.averageTurns.toFixed(1)}  Forfeits: ${summary.forfeits}`);
  console.log(`p1 win rate: ${(summary.p1WinRate * 100).toFixed(1)}%`);
  console.log(`Higher-rated player won: ${(summary.higherRatedWinRate * 100).toFixed(1)}%`);
  console.log('Games per rating band:');
  for (const { band, games } of summary.byBand) console.log(`  ${band}-${band + 99}: ${games}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
