# PS Review

A browser extension for [Pokemon Showdown](https://play.pokemonshowdown.com) that adds per-battle rating context and, in later phases, a performance review in the spirit of chess game analysis. Scope: Gen 9 Random Battles.

## Status

Implemented:

- Battle capture: the extension observes the Showdown client's inbound messages and maintains per-battle state (players, turn, winner, rating updates).
- Per-turn recording: for every turn, the moves and switches each player chose, Terastallization, HP changes, faints, and chance events (crits, misses, "can't move"), plus the board state when the turn closed and the raw protocol lines.

When a battle ends, the console shows the full state and a turn-by-turn decision table.

## Architecture

```
Showdown client (page)
        |  raw server messages
        v
entrypoints/ps-hook.content.ts        MAIN world
        |  window.postMessage (validated)
        v
entrypoints/battle-listener.content.ts  ISOLATED world
        |
        v
lib/protocol/parser.ts  ->  lib/battle/state.ts (BattleTracker)
                                  |
                                  +-> lib/battle/turns.ts (per-turn recorder)
                                  +-> lib/battle/summary.ts (decision table)
```

| Path | Responsibility |
| --- | --- |
| `lib/hook.ts` | Locate the client host object and wrap its `receive` method |
| `lib/messaging.ts` | Cross-world message contract and validation |
| `lib/protocol/parser.ts` | Parse the Showdown text protocol |
| `lib/battle/types.ts` | Shared data model (battle, turn, action, luck records) |
| `lib/battle/state.ts` | Reduce protocol events into battle state |
| `lib/battle/turns.ts` | Record actions, damage, faints and chance events per turn (singles) |
| `lib/battle/summary.ts` | Human-readable decision table |
| `entrypoints/` | Thin WXT wiring only; no business logic |

`lib/` has no browser dependencies and is fully unit-tested.

## Development

```bash
npm install
npm run dev        # launches a dev browser with the extension loaded
npm run typecheck
npm test
npm run build      # output in .output/chrome-mv3
npm run zip        # packaged for store upload
```

To load a build manually: open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `.output/chrome-mv3`.

## Privacy

All processing happens locally in the browser. The extension requests no permissions and sends no data anywhere.

## Known limitations

- The client hook depends on Showdown exposing `window.app` or `window.PS` with a `receive` method. If Showdown changes this, update `HOST_GLOBAL_NAMES` in `lib/hook.ts`.
- Turn recording supports singles only; events for positions other than `a` are ignored.
- Rejoining a battle room makes the server replay its log; the tracker resets that room's state on `|init|` so turns are not recorded twice.
- The rating-update parser targets the `|raw|` end-of-battle line format and should be re-verified against live battles.
