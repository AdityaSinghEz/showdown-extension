# Engine judge (poke-engine)

This folder runs the search engine behind [Foul Play](https://github.com/pmariglia/foul-play), a bot that its author reports near the top of the Gen 9 Random Battle ladder. The engine itself is [poke-engine](https://github.com/pmariglia/poke-engine), which is MIT licensed. Foul Play's own code is GPL-3.0 and is **not** used or copied here; this project only calls the engine's public Python API.

The search runs on a CPU. In testing, 100,000 search iterations take about 0.3 to 0.5 seconds per position on one core.

## Install

You need Python 3.11 or newer and Rust (https://rustup.rs). On Windows, Rust also needs the "Desktop development with C++" part of the Visual Studio Build Tools. If that is a problem, WSL or a Linux machine works the same way.

From the project folder, in PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -v --no-cache-dir "poke-engine==0.0.48" --config-settings="build-args=--features poke-engine/terastallization --no-default-features"
```

The `terastallization` build option is what gives Gen 9 rules. The build takes a minute or two. `.venv` is not committed.

## Use

Review one game with the engine as the judge:

```powershell
npm run engine:review -- --id gen9randombattle-2701773375 --python .venv\Scripts\python.exe
```

Or measure how good the engine is against your held-out games (this is the accuracy check):

```powershell
npm run engine:export -- --games 120 --every 3 --split test
.venv\Scripts\python.exe tools/engine/search.py data/engine-states.jsonl data/engine-results.jsonl
npm run engine:report
```

## What the numbers mean

For each position the search tries every legal choice for both sides at once and reports how often it picked each (visits) and how well each did on average. A decision's grade is the gap between the best well-tried choice and the one played, using the same cut-offs as the rest of the project.

Limits to keep in mind: the engine models a subset of Showdown's rules, so unusual moves and abilities may be handled loosely, and a choice the search almost never tries has a noisy average. Positions the engine cannot handle are counted as failed in the report rather than guessed at.
