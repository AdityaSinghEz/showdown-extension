/**
 * Builds the Showdown versions needed to re-simulate the downloaded replays.
 *
 * Usage:
 *
 * ```
 * npm run sim:setup
 * npm run sim:setup -- --root ..
 * ```
 *
 * Reads every replay in `data/raw`, collects the distinct Showdown builds named
 * in their input logs, and for each build that is not already present fetches
 * that commit from GitHub into `<root>/ps-sim-<first 8 characters>` and builds it.
 * Builds already present are left alone, so the command is safe to rerun.
 *
 * Needs `git`, `node` and `npm` on the path, and network access to GitHub.
 */

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { simFolderName, versionFromInputLog, type SimVersion } from '../lib/replay/version';

const REPO_URL = 'https://github.com/smogon/pokemon-showdown.git';

/** Runs a command, stopping the whole script if it fails. */
function run(command: string, args: string[], cwd: string): void {
  console.log(`  > ${command} ${args.join(' ')}`);
  // A shell is needed on Windows, where npm and git are batch or cmd shims.
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error(`Command failed: ${command} ${args.join(' ')}`);
}

/** Collects the distinct builds named by the saved replays, with how many games each played. */
async function collectVersions(rawDir: string): Promise<Map<string, { version: SimVersion; games: number }>> {
  const found = new Map<string, { version: SimVersion; games: number }>();
  for (const file of (await readdir(rawDir)).filter((f) => f.endsWith('.json'))) {
    const replay = JSON.parse(await readFile(join(rawDir, file), 'utf8')) as { inputlog?: string };
    const version = versionFromInputLog(replay.inputlog);
    if (!version) continue;
    const entry = found.get(version.full) ?? { version, games: 0 };
    entry.games += 1;
    found.set(version.full, entry);
  }
  return found;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      data: { type: 'string', default: 'data' },
      root: { type: 'string', default: '..' },
    },
  });
  const rawDir = join(values.data ?? 'data', 'raw');
  const root = resolve(values.root ?? '..');

  const versions = await collectVersions(rawDir);
  if (versions.size === 0) {
    console.error(`No replays with an input log in ${rawDir}. Run: npm run replays:download -- --backfill`);
    process.exitCode = 1;
    return;
  }

  console.log(`Found ${versions.size} Showdown build(s) across the saved replays. Folders go in ${root}\n`);
  for (const { version, games } of versions.values()) {
    const dir = join(root, simFolderName(version));
    if (existsSync(join(dir, 'dist', 'sim', 'index.js'))) {
      console.log(`${version.short}: ${games} games, already built at ${dir}`);
      continue;
    }
    console.log(`${version.short}: ${games} games, building at ${dir}`);
    await mkdir(dir, { recursive: true });
    if (!existsSync(join(dir, '.git'))) run('git', ['init'], dir);
    run('git', ['remote', 'add', 'origin', REPO_URL], dir);
    run('git', ['fetch', '--depth', '1', 'origin', version.full], dir);
    run('git', ['checkout', 'FETCH_HEAD'], dir);
    // Optional packages are database drivers the simulator does not need.
    run('npm', ['install', '--omit=optional', '--no-audit', '--no-fund'], dir);
    run(process.execPath, ['build'], dir);
  }
  console.log('\nDone. Re-simulate with: npm run sim:verify -- --limit 1000 --sim-root ' + (values.root ?? '..'));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
