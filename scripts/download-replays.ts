/**
 * Downloads public replays to disk.
 *
 * Usage:
 *
 * ```
 * npm run replays:download -- --limit 20
 * npm run replays:download -- --limit 200 --min-rating 1700 --max-rating 1900
 * ```
 *
 * Files are written to `<out>/raw/<replay id>.json`. Replays already on disk
 * are skipped, so the command can be re-run to top up the collection.
 *
 * ```
 * npm run replays:download -- --backfill
 * ```
 *
 * Re-downloads saved replays that lack an input log (files saved by earlier
 * versions of this script did not keep it), so they can be re-simulated.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ReplayClient } from '../lib/replay/client';
import { collectEntries } from '../lib/replay/collect';

function numberOption(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Not a number: ${value}`);
  return parsed;
}

function optionalNumber(value: string | undefined): number | undefined {
  return value === undefined ? undefined : numberOption(value, 0);
}

async function existingIds(dir: string): Promise<Set<string>> {
  try {
    const files = await readdir(dir);
    return new Set(files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)));
  } catch {
    return new Set();
  }
}

/** True when a saved replay file already holds its input log. */
async function hasInputLog(path: string): Promise<boolean> {
  try {
    const saved = JSON.parse(await readFile(path, 'utf8')) as { inputlog?: unknown };
    return typeof saved.inputlog === 'string';
  } catch {
    return false;
  }
}

/** Re-downloads every saved replay that has no input log. */
async function backfill(client: ReplayClient, rawDir: string): Promise<void> {
  const ids = [...(await existingIds(rawDir))].sort();
  const missing: string[] = [];
  for (const id of ids) {
    if (!(await hasInputLog(join(rawDir, `${id}.json`)))) missing.push(id);
  }
  console.log(`${ids.length} replays on disk, ${missing.length} without an input log`);

  let updated = 0;
  let failed = 0;
  for (const id of missing) {
    try {
      const replay = await client.getReplay(id);
      if (replay.inputlog === undefined) throw new Error('the replay service returned no input log');
      await writeFile(join(rawDir, `${id}.json`), JSON.stringify(replay));
      updated += 1;
      console.log(`[${updated + failed}/${missing.length}] updated ${id}`);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[${updated + failed}/${missing.length}] FAILED ${id}: ${message}`);
    }
  }
  console.log(`Done. Updated ${updated}, failed ${failed}.`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      format: { type: 'string', default: 'gen9randombattle' },
      limit: { type: 'string', default: '20' },
      pages: { type: 'string', default: '10' },
      'min-rating': { type: 'string' },
      'max-rating': { type: 'string' },
      'delay-ms': { type: 'string', default: '1000' },
      out: { type: 'string', default: 'data' },
      backfill: { type: 'boolean', default: false },
    },
  });

  const rawDir = join(values.out ?? 'data', 'raw');
  await mkdir(rawDir, { recursive: true });

  const client = new ReplayClient({ delayMs: numberOption(values['delay-ms'], 1000) });
  if (values.backfill === true) {
    await backfill(client, rawDir);
    return;
  }
  const exclude = await existingIds(rawDir);
  console.log(`Already on disk: ${exclude.size}`);

  const entries = await collectEntries(client, {
    format: values.format ?? 'gen9randombattle',
    limit: numberOption(values.limit, 20),
    maxPages: numberOption(values.pages, 10),
    minRating: optionalNumber(values['min-rating']),
    maxRating: optionalNumber(values['max-rating']),
    exclude,
    onPage: (page, found, selected) =>
      console.log(`Search page ${page}: ${found} listed, ${selected} selected`),
  });
  console.log(`Downloading ${entries.length} replays to ${rawDir}`);

  let saved = 0;
  let failed = 0;
  for (const entry of entries) {
    try {
      const replay = await client.getReplay(entry.id);
      await writeFile(join(rawDir, `${entry.id}.json`), JSON.stringify(replay));
      saved += 1;
      console.log(`[${saved + failed}/${entries.length}] saved ${entry.id} (rating ${entry.rating})`);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[${saved + failed}/${entries.length}] FAILED ${entry.id}: ${message}`);
    }
  }
  console.log(`Done. Saved ${saved}, failed ${failed}.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
