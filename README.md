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

Replays saved by earlier versions lack the input log that `sim:verify` needs. Run `npm run replays:download -- --backfill` once to re-download those files.

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

## Re-simulating replays

```bash
npm run sim:verify                     # check the 20 newest downloaded replays
npm run sim:verify -- --limit 100
npm run sim:verify -- --id gen9randombattle-2701782369
```

Each replay stores an `inputlog` with the random seed and every choice. Random Battles teams come from that seed, so feeding the log into the [@pkmn/sim](https://www.npmjs.com/package/@pkmn/sim) simulator can reproduce the whole game with both full teams. The check reports how many replays reproduce exactly and where the others first differ. A difference usually means the installed simulator is a different version from the one that played the game. `--sim <folder>` checks against a built copy of the Showdown repository instead, and the report lists how many games reproduced for each game version.

Showdown is updated several times a week, and a game can only be reproduced exactly with the build that played it. `npm run sim:setup` reads the build named in each saved replay and fetches and builds every missing one into a `ps-sim-<8 characters>` folder next to the project (it needs `git`, `node` and network access to GitHub). Then `npm run sim:verify -- --limit 1000 --sim-root ..` checks every game against its own build.

## Reviewing a game

```bash
npm run review:game -- --id gen9randombattle-2701773375
npm run review:game -- --id gen9randombattle-2701773375 --turns 3-8 --samples 4
```

For each turn the review engine restores the exact simulator position, tries every legal choice for both players (moves, moves with Terastallization, switches), plays the turn forward with several random seeds, and scores the resulting positions with the win-probability model. The scores form a payoff matrix, which is solved as a simultaneous-move game. A player's choice is graded by how much win probability it gave up against best play: best, good, inaccuracy, mistake or blunder (thresholds in `lib/review/grade.ts`, a first guess). The opponent's actual move is not used, so each decision is judged without hindsight.

Needs the replay input logs (`npm run replays:download -- --backfill`), the model (`npm run model:train`) and the matching Showdown builds (`npm run sim:setup`). The grades are only as good as the position scorer, which currently looks at team HP, status and Terastallization only, and each option is evaluated one turn ahead.

## A stronger position scorer

The spectator-log model sees only HP, status and Terastallization. Re-simulating each replay exposes the whole position, so a richer scorer can be trained:

```bash
npm run states:build        # re-simulate every game and save features for each turn to data/states.jsonl
npm run model:train-rich    # compare the original 5 features with the full set; saves data/model-rich.json
npm run review:game -- --id gen9randombattle-2701773375 --model data/model-rich.json
```

Recorded human games are few, so the simulator can also produce practice games: a modest rule-based player plays itself in real Random Battles (teams generated by the simulator), and each turn's features are saved with the winner.

```bash
npm run selfplay -- --games 5000                              # writes data/selfplay.jsonl
npm run model:train-rich -- --extra data/selfplay.jsonl       # adds them to training only
```

Self-play positions are never used for testing, so the scores still measure how well the model predicts human games. The practice games are played by a weak player, so they teach the scorer the mechanics but not what strong play looks like.

The added features are stat boosts, entry hazards weighted by the Pokemon left to switch in, which side moves first, and each active Pokemon's best damage against the other (base power, accuracy, same-type bonus and type effectiveness). `model:train-rich` prints the test score of both feature sets on the same held-out games, then a cross-validation by game (`--folds 5`) that tests each extra feature on its own against the original five, which is a steadier answer than one test split. It then adds the extra features one at a time, keeping each only while the cross-validated gain is clear, and saves that model to `data/model-rich.json`. The review engine reads any subset of the features by name.

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
| `lib/review/` | Review engine: legal choices, matrix-game solver, position scoring and grades |
| `scripts/` | Command-line tools for downloading replays, building the dataset, training the model and re-simulating replays |
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

## Rollout evaluation

The win-probability model only sees a snapshot, so it misjudges positions that depend on what happens next, such as a boosted sweeper or a setup move. A rollout plays the position forward a few turns with the practice player and averages how those games end.

```powershell
npm run review:game -- --id gen9randombattle-2701773375 --model data/model-rich.json
```

Rollouts are on by default (6 forward games, 6 turns deep, 5 options per side, weight 0.5). Use `--rollouts 0` for the model-only review.

- `--rollouts` is the number of forward games per option pair (0 turns rollouts off).
- `--depth` is how many turns each forward game runs before the model reads the position.
- `--max-options` simulates only the most promising options per side, plus the one played, which keeps a review to about two seconds a turn.
- `--rollout-weight` mixes rollouts with the model reading (1 is rollouts only, 0 is model only). The default is 0.5: on held-out games rollouts beat the model early but are overconfident late, and the blend scored best overall. On held-out games, rollouts alone beat the model in the early and middle game but were overconfident late, and an even blend scored best overall.

To check whether rollouts really predict winners better, run `npm run eval:rollout -- --model data/model-rich.json --games 40`. It scores several mixes of the two on held-out human games and shows the best weight per stage of the game.

## Judging with the engine behind Foul Play

The rollout judge uses a simple practice bot, which limits its accuracy. For a stronger judge, positions can be searched with poke-engine, the MIT-licensed Rust engine used by Foul Play, which its author reports near the top of the Gen 9 Random Battle ladder. Setup is in `tools/engine/README.md`.

```powershell
npm run engine:review -- --id gen9randombattle-2701773375 --python .venv\Scripts\python.exe
```

To measure how well it predicts winners compared with the model and rollouts, and whether the winner of a game tends to have fewer engine-graded errors:

```powershell
npm run engine:export -- --games 120 --every 3 --split test
.venv\Scripts\python.exe tools/engine/search.py data/engine-states.jsonl data/engine-results.jsonl
npm run engine:report
```
