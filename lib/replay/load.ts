/**
 * Converts downloaded replays into tracked battle state.
 *
 * Replay logs contain the same protocol lines the live client receives, but
 * without the `>roomid` header that addresses them to a room. This module adds
 * the header so replays flow through the exact code path used for live games.
 */

import { BattleTracker } from '../battle/state';
import type { BattleState } from '../battle/types';
import type { ReplayJson } from './types';

/**
 * Replays a downloaded log through {@link BattleTracker}.
 *
 * @param replay - The replay to process.
 * @returns The final battle state, including every recorded turn.
 * @throws If the replay id does not describe a battle room.
 */
export function replayToState(replay: ReplayJson): BattleState {
  const roomId = `battle-${replay.id}`;
  const tracker = new BattleTracker();
  tracker.ingest(`>${roomId}\n${replay.log}`);

  const state = tracker.get(roomId);
  if (!state) throw new Error(`Replay id "${replay.id}" is not a battle room id`);
  return state;
}
