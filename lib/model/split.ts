/**
 * Train/test splitting by game.
 *
 * Positions from the same game are strongly correlated (the same players, the
 * same final result), so they must never be spread across both sets, or the
 * test score would flatter the model. Each game is assigned to a side by
 * hashing its id, which keeps the assignment stable as the dataset grows:
 * adding games never moves an existing game from one set to the other.
 */

/**
 * 32-bit FNV-1a hash of a string.
 *
 * @param text - Any string.
 * @returns An unsigned 32-bit integer.
 */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Whether a game belongs to the test set.
 *
 * @param gameId - The game's id.
 * @param testPercent - Share of games to hold out, from 0 to 100.
 */
export function isTestGame(gameId: string, testPercent: number): boolean {
  return hashString(gameId) % 100 < testPercent;
}
