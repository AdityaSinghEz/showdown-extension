# PS Review

A browser extension for [Pokemon Showdown](https://play.pokemonshowdown.com) that adds per-battle rating context and, in later phases, a performance review in the spirit of chess game analysis. Scope: Gen 9 Random Battles.

## Status

Implemented:

- Battle capture: the extension observes the Showdown client's inbound messages and maintains per-battle state (players, turn, winner, rating updates).
- Per-turn recording: for every turn, the moves and switches each player chose, Terastallization, HP changes, faints, and chance events (crits, misses, "can't move"), plus the board state when the turn closed and the raw protocol lines.

When a battle ends, the console shows the full state and a turn-by-turn decision table.

- Dataset pipeline (runs in Node, outside the browser): downloads public Gen 9 Random Battle replays, replays each log through the same battle recorder, and writes one compact record per game to `data/games.jsonl`.

- Win-probability baseline: tracks every Pokemon's HP plus a few board features, fits a small logistic regression on recorded games, and prints a per-turn win curve for any game.

## Building a dataset

```bash
# 1. Download a small batch first (about 1 request per second)
npm run replays:download -- --limit 20

# 2. Target a rating range
npm run replays:download -- --limit 200 --min-rating 1700 --max-rating 1900

# 3. Convert downloads into records and print a summary
npm run dataset:build
```

Downloads go to `data/raw/<id>.json` (existing files are skipped, so runs can be repeated to top up) and records to `data/games.jsonl`. The `data/` folder is git-ignored.

Games are excluded when a player has no rating, the game has no result or ends in a tie, or it ends in a forfeit before turn 5. The summary reports how many were skipped for each reason, the games per rating band, and sanity checks such as how often the higher-rated player won.

Notes on the data:

- Only replays that players chose to upload are available, so the sample is not every game played. Treat it as biased toward games players wanted to keep.
- The listing is ordered by upload time, not rating, so high-rating games are rare in a plain download. Use `--min-rating` with more `--pages` to collect them.
- Keep the dataset private. If you ever publish it, remove or hash player names.

## Training the win-probability baseline

```bash
npm run dataset:build                        # rebuild: records now include team HP and who forfeited
npm run model:train                          # fit, evaluate, save data/model.json
npm run model:train -- --show 2701866020     # per-turn win curve for one game
npm run model:train -- --include-forfeits    # keep games that ended by forfeit or timeout
```

The model estimates, after every turn, the chance that player 1 wins. Its inputs are five "player 1 minus player 2" differences: Pokemon left, total team HP (Pokemon not yet revealed count as full health), HP of the Pokemon in play, a major status on the Pokemon in play, and whether Tera has been used. There is no intercept, so equal sides give exactly 50% and swapping the players flips the probability.

Reading the output:

- **Scores** are compared with always guessing 50% (log loss 0.693, Brier 0.250). Lower is better. The test line is the one to trust: those games were held out by hashing the game id, so no game is split between training and testing.
- **Weights** show what the model learned. Each `x` figure is how much one extra unit of that advantage multiplies a player's odds of winning.
- **Calibration** checks honesty: among positions the model calls 70%, about 70% should be wins. Large gaps mean the probabilities cannot be taken at face value.
- **`--show`** prints the win curve for one game with the moves played and any crits, misses or "can't move" events, and marks swings of 15 points or more.

Choices and caveats:

- Games that ended by forfeit or timeout are left out by default, because a disconnect can decide a game that the position did not.
- Positions where one side has no Pokemon left are skipped, since the result is already known.
- Positions from one game are strongly correlated, so the number of games matters more than the number of positions. With a few hundred games, treat small score differences as noise.
- The model sees only what a spectator log shows. It does not know movesets, items or unrevealed Pokemon, so it cannot judge a play that depends on them.

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
| `lib/replay/` | Replay service types, polite HTTP client, and download selection |
| `lib/dataset/record.ts` | Game records, filtering rules, forfeit detection, rating bands and summaries |
| `lib/dataset/load.ts` | Validated reader for `games.jsonl` |
| `lib/model/features.ts` | Turns board snapshots into "player 1 minus player 2" features |
| `lib/model/logistic.ts` | Logistic regression fitted with Newton's method |
| `lib/model/evaluate.ts` | Log loss, Brier score, accuracy and calibration |
| `lib/model/split.ts` | Stable train/test split by game id |
| `lib/model/curve.ts` | Per-turn win-probability curve for a game |
| `scripts/` | Command-line tools for downloading replays and building the dataset |
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
- Team HP assumes every unrevealed Pokemon is at full health and that the team size is the one the server announces. Revival Blessing is not handled: a revived Pokemon stays counted as fainted.
- The rating-update parser targets the `|raw|` end-of-battle line format and should be re-verified against live battles.
