/**
 * Checks whether the Showdown simulator can reproduce downloaded replays.
 *
 * Usage:
 *
 * ```
 * npm run sim:verify
 * npm run sim:verify -- --limit 50
 * npm run sim:verify -- --id gen9randombattle-2701782369
 * npm run sim:verify -- --oldest --limit 10
 * npm run sim:verify -- --sim ../ps-sim
 * ```
 *
 * Every replay stores an `inputlog`: the random seed and each choice both
 * players made. For Random Battles the teams are generated from that seed, so
 * if the installed simulator matches the one that ran the game, feeding the
 * input log back in reproduces the whole game, including both full teams.
 *
 * By default the bundled `@pkmn/sim` is used. `--sim <folder>` points at a built
 * copy of the Showdown repository instead, so a game can be checked against the
 * exact version that played it (the version is printed with every difference).
 *
 * This script replays each game and compares its main events (moves,
 * switches, faints, turns, result) with the replay's own log. A game that
 * matches can be searched from; a game that diverges is reported with the
 * first differing line, which usually means the installed simulator is a
 * different version from the one that played the game.
 */

import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { TeamGenerators } from '@pkmn/randoms';
import { BattleStreams, Teams } from '@pkmn/sim';

/** The two simulator entry points this script needs. */
interface SimApi {
  BattleStream: new () => unknown;
  getPlayerStreams: (stream: never) => {
    omniscient: { write(data: string): Promise<void>; [Symbol.asyncIterator](): AsyncIterator<string> };
  };
}

/**
 * Loads a simulator.
 *
 * Without a path, the bundled `@pkmn/sim` is used. With a path, a built copy of
 * the Showdown repository is used instead (its `dist/sim` folder), which is how
 * a replay is checked against the exact version that played it.
 */
export function loadSim(simPath?: string): SimApi {
  if (simPath === undefined) {
    // The simulator cannot generate Random Battles teams unless it is given the generator.
    Teams.setGeneratorFactory(TeamGenerators);
    return BattleStreams as unknown as SimApi;
  }
  const require = createRequire(import.meta.url);
  return require(join(resolve(simPath), 'dist', 'sim')) as SimApi;
}

/** Events compared between the replay log and the re-simulated log. */
const COMPARED = /^\|(move|switch|drag|faint|turn|win|tie|cant|-crit|-miss|-terastallize)\|/;

interface ReplayFile {
  id: string;
  log: string;
  inputlog?: string | null;
}

/**
 * Keeps only the event lines that can be compared between the two logs.
 *
 * Switch lines end with the Pokemon's HP, which is a percentage in a replay and
 * exact points in the simulator's own log, so that last field is dropped.
 */
export function comparableLines(log: string): string[] {
  return log
    .split('\n')
    .filter((line) => COMPARED.test(line))
    .map((line) => (/^\|(switch|drag)\|/.test(line) ? line.split('|').slice(0, 4).join('|') : line));
}

/** Re-simulates a game from its input log and returns the omniscient log. */
export async function resimulate(inputlog: string, sim: SimApi = loadSim()): Promise<string> {
  const stream = new sim.BattleStream();
  const streams = sim.getPlayerStreams(stream as never);
  const chunks: string[] = [];
  void (async () => {
    for await (const chunk of streams.omniscient) chunks.push(chunk);
  })();
  for (const line of inputlog.split('\n')) {
    if (line === '' || line.startsWith('>version') || line.startsWith('>chat')) continue;
    await streams.omniscient.write(line);
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  return chunks.join('\n');
}

/** First position where two line lists differ, or null when identical. */
export function firstDifference(
  expected: readonly string[],
  actual: readonly string[],
): { index: number; expected: string; actual: string } | null {
  const length = Math.max(expected.length, actual.length);
  for (let i = 0; i < length; i++) {
    if (expected[i] !== actual[i]) {
      return { index: i, expected: expected[i] ?? '(end of log)', actual: actual[i] ?? '(end of log)' };
    }
  }
  return null;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string', default: 'data/raw' },
      limit: { type: 'string', default: '20' },
      id: { type: 'string' },
      oldest: { type: 'boolean', default: false },
      sim: { type: 'string' },
    },
  });
  const dir = values.dir ?? 'data/raw';
  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a whole number of 1 or more');

  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const wanted = values.id !== undefined ? files.filter((f) => f === `${values.id}.json`) : (values.oldest === true ? files.slice(0, limit) : files.slice(-limit));
  if (wanted.length === 0) {
    console.error(`No replays found in ${dir}. Run: npm run replays:download`);
    process.exitCode = 1;
    return;
  }

  const sim = loadSim(values.sim);
  const byVersion = new Map<string, { checked: number; matched: number }>();
  let matched = 0;
  let missing = 0;
  const divergences: string[] = [];
  for (const file of wanted) {
    const replay = JSON.parse(await readFile(join(dir, file), 'utf8')) as ReplayFile;
    if (!replay.inputlog) {
      missing += 1;
      continue;
    }
    const version = /^>version (\S+)/.exec(replay.inputlog)?.[1]?.slice(0, 8) ?? '?';
    const simulated = comparableLines(await resimulate(replay.inputlog, sim));
    const real = comparableLines(replay.log);
    const diff = firstDifference(real, simulated);
    const stats = byVersion.get(version) ?? { checked: 0, matched: 0 };
    stats.checked += 1;
    if (diff === null) stats.matched += 1;
    byVersion.set(version, stats);
    if (diff === null) {
      matched += 1;
    } else {
      divergences.push(
        `${replay.id} (game version ${version}) differs at event ${diff.index}:\n` +
          `    replay:    ${diff.expected}\n    simulated: ${diff.actual}`,
      );
    }
  }

  const total = wanted.length;
  console.log(`Checked ${total} replays: ${matched} reproduced exactly, ${divergences.length} differ, ${missing} had no input log.`);
  console.log('\nBy game version (the build of Showdown that played each game):');
  for (const [version, stats] of [...byVersion].sort()) {
    console.log(`  ${version}: ${stats.matched} of ${stats.checked} reproduced`);
  }
  for (const text of divergences.slice(0, 5)) console.log(`\n  ${text}`);
  if (divergences.length > 5) console.log(`\n  ... and ${divergences.length - 5} more`);
  if (divergences.length > 0) {
    console.log(
      '\nIf most games differ from the first teams or moves, the installed simulator is a different version from the one that played them.',
    );
  }
  process.exit(0);
}

// Run only when executed directly, so the helpers stay importable in tests.
if (process.argv[1] && /verify-sim\.[tj]s$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
