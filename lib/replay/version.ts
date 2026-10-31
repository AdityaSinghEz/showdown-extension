/**
 * Showdown build identification.
 *
 * Every replay's input log starts with `>version <commit hash>`: the exact
 * build of the Showdown server that played the game. Random Battles team
 * generation and game mechanics change between builds, so a game can only be
 * re-simulated reliably with the build that played it.
 */

/** A Showdown build, identified by its git commit. */
export interface SimVersion {
  /** Full 40-character commit hash. */
  full: string;
  /** First 8 characters, used in folder names and reports. */
  short: string;
}

/**
 * Reads the build from a replay's input log.
 *
 * @param inputlog - The replay's `inputlog` text.
 * @returns The build, or `null` if the log has no valid version line.
 */
export function versionFromInputLog(inputlog: string | undefined): SimVersion | null {
  if (!inputlog) return null;
  const match = /^>version ([0-9a-f]{40})\s*$/m.exec(inputlog);
  const full = match?.[1];
  return full ? { full, short: full.slice(0, 8) } : null;
}

/** Folder name that holds a built copy of one version, for example `ps-sim-de1cf598`. */
export function simFolderName(version: Pick<SimVersion, 'short'>): string {
  return `ps-sim-${version.short}`;
}
