"""Runs the poke-engine search on exported positions.

Usage:
    python tools/engine/search.py data/engine-states.jsonl data/engine-results.jsonl --iterations 100000

Each input line is one position written by `npm run engine:export`. For every
position the engine's Monte Carlo tree search plays both sides at once, which
gives, for each legal choice, how often the search picked it (visits) and the
average result it led to (a win score from that side's point of view, 0 to 1).

poke-engine is MIT licensed. This script uses only its public Python API.
"""

import argparse
import json
import os
import sys

from poke_engine import (
    Move,
    Pokemon,
    Side,
    SideConditions,
    State,
    VolatileStatusDurations,
    monte_carlo_tree_search,
)


def build_pokemon(p):
    moves = [Move(id=m["id"], pp=m["pp"], disabled=m["disabled"]) for m in p["moves"]]
    while len(moves) < 4:
        moves.append(Move(id="none", pp=32, disabled=False))
    types = tuple(p["types"])
    stats = p["stats"]
    return Pokemon(
        id=p["id"],
        level=p["level"],
        types=types,
        base_types=types,
        hp=p["hp"],
        maxhp=p["maxhp"],
        ability=p["ability"],
        base_ability=p["ability"],
        item=p["item"],
        attack=stats["atk"],
        defense=stats["def"],
        special_attack=stats["spa"],
        special_defense=stats["spd"],
        speed=stats["spe"],
        status=p["status"],
        weight_kg=p["weightKg"],
        terastallized=p["terastallized"],
        tera_type=p["teraType"],
        moves=moves,
    )


def build_side(s):
    mons = [build_pokemon(p) for p in s["pokemon"]]
    while len(mons) < 6:
        mons.append(Pokemon.create_fainted())
    b = s["boosts"]
    return Side(
        pokemon=mons,
        active_index=str(s["activeIndex"]),
        side_conditions=SideConditions(**s["sideConditions"]),
        volatile_status_durations=VolatileStatusDurations(taunt=s["taunt"], yawn=s["yawn"]),
        volatile_statuses=set(s["volatileStatuses"]),
        substitute_health=s["substituteHealth"],
        attack_boost=b["atk"],
        defense_boost=b["def"],
        special_attack_boost=b["spa"],
        special_defense_boost=b["spd"],
        speed_boost=b["spe"],
        accuracy_boost=b["accuracy"],
        evasion_boost=b["evasion"],
    )


def build_state(d):
    return State(
        side_one=build_side(d["sideOne"]),
        side_two=build_side(d["sideTwo"]),
        weather=d["weather"],
        weather_turns_remaining=d["weatherTurns"],
        terrain=d["terrain"],
        terrain_turns_remaining=d["terrainTurns"],
        trick_room=d["trickRoom"],
        trick_room_turns_remaining=d["trickRoomTurns"],
    )


def summarize(side_results):
    return [
        {"engine": r.move_choice, "visits": r.visits, "score": r.total_score}
        for r in side_results
    ]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("out")
    parser.add_argument("--iterations", type=int, default=100000)
    parser.add_argument("--threads", type=int, default=1)
    args = parser.parse_args()

    # The Rust engine prints a long message for every position it cannot
    # handle. Those positions are reported in the output file instead, so the
    # message stream is discarded and our own progress goes to a saved copy.
    log = os.fdopen(os.dup(2), "w")
    devnull = os.open(os.devnull, os.O_WRONLY)
    os.dup2(devnull, 2)

    done = failed = 0
    with open(args.source) as src, open(args.out, "w") as out:
        for line in src:
            row = json.loads(line)
            try:
                result = monte_carlo_tree_search(
                    build_state(row["state"]), iterations=args.iterations, threads=args.threads
                )
                record = {
                    "id": row["id"],
                    "turn": row["turn"],
                    "total": result.total_visits,
                    "p1": summarize(result.side_one),
                    "p2": summarize(result.side_two),
                }
            except BaseException as error:  # the engine reports bad input as a panic
                failed += 1
                record = {"id": row["id"], "turn": row["turn"], "error": str(error)[:120]}
            out.write(json.dumps(record) + "\n")
            done += 1
            if done % 200 == 0:
                print(f"{done} positions ({failed} failed)", file=log, flush=True)
    print(f"Searched {done} positions, {failed} failed. Wrote {args.out}", file=log, flush=True)


if __name__ == "__main__":
    sys.exit(main())
