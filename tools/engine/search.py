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
    generate_instructions,
    iterative_deepening_expectiminimax,
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


# A turn can split into dozens of outcomes (every damage roll, crit and extra hit). Only the
# likeliest ones, covering about 97% of the chance, are searched, which keeps the pass fast.
MAX_BRANCHES = 8

# Replies tested per choice. Too few and the opponent looks weaker than it is, because a reply it
# rarely plays can still be its best answer to a particular move.
MAX_REPLIES = 9


def side_value(state, for_side_one, iterations, threads):
    """A side's win score in a position, from a search of its own.

    A position where one side has no Pokemon left is decided and needs no search.
    """
    if all(p.hp <= 0 for p in state.side_two.pokemon):
        return 1.0 if for_side_one else 0.0
    if all(p.hp <= 0 for p in state.side_one.pokemon):
        return 0.0 if for_side_one else 1.0
    result = monte_carlo_tree_search(state, iterations=iterations, threads=threads)
    options = result.side_one if for_side_one else result.side_two
    visits = sum(o.visits for o in options)
    return sum(o.total_score for o in options) / visits if visits else 0.5


def q_table(state, for_side_one, own, theirs, actual_reply, iterations, threads):
    """Values every choice of one side against the opponent's likely replies, with equal effort.

    The main search gives most of its tries to the move it likes best, so the other
    moves are valued from very few tries and look worse than they are. Here each
    choice is played out one turn against each likely reply, and the position that
    results is searched with the same effort every time, so the values can be compared.

    rows     every choice the side had
    cols     the opponent's likely replies (enough to cover 98% of its mix, at most nine),
             plus the reply that was actually played
    weights  how often the opponent's search played each reply (0 for a reply included
             only because it was played)
    values   values[i][j] is the side's own win score for rows[i] against cols[j], or None
             when the turn could not be simulated
    """
    rows = []
    for option in own:
        if option.move_choice not in rows:
            rows.append(option.move_choice)
    mix = {}
    for option in theirs:
        mix[option.move_choice] = mix.get(option.move_choice, 0) + option.visits
    total = sum(mix.values())
    cols, weights, covered = [], [], 0
    for choice in sorted(mix, key=lambda c: -mix[c]):
        if len(cols) >= MAX_REPLIES or (total and covered / total >= 0.98):
            break
        cols.append(choice)
        weights.append(mix[choice] / total if total else 0.0)
        covered += mix[choice]
    if actual_reply is not None and actual_reply in mix and actual_reply not in cols:
        cols.append(actual_reply)
        weights.append(0.0)
    values = []
    for mine in rows:
        line = []
        for reply in cols:
            move_one, move_two = (mine, reply) if for_side_one else (reply, mine)
            try:
                branches = sorted(generate_instructions(state, move_one, move_two), key=lambda b: -b.percentage)
                kept, mass = [], 0.0
                for branch in branches:
                    if len(kept) >= MAX_BRANCHES or (kept and mass >= 97.0):
                        break
                    kept.append(branch)
                    mass += branch.percentage
                value = 0.0
                for branch in kept:
                    after = state.apply_instructions(branch)
                    value += branch.percentage / mass * side_value(after, for_side_one, iterations, threads)
                line.append(value)
            except BaseException:  # a choice the engine cannot play out
                line.append(None)
        values.append(line)
    return {"rows": rows, "cols": cols, "weights": weights, "values": values}


def payoff_matrix(state, milliseconds):
    """Runs the expectiminimax pass and returns the payoff table.

    Rows are side one's choices and columns side two's, scored from side one's
    point of view in the engine's own evaluation units. Cells the search pruned
    are returned as None.
    """
    result = iterative_deepening_expectiminimax(state, duration_ms=milliseconds)
    values = [None if v != v else v for v in result.matrix]  # NaN marks a pruned cell
    return {
        "p1": list(result.side_one),
        "p2": list(result.side_two),
        "values": values,
        "depth": result.depth_searched,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("out")
    parser.add_argument("--iterations", type=int, default=100000)
    parser.add_argument("--threads", type=int, default=1)
    parser.add_argument(
        "--q-iterations",
        type=int,
        default=12000,
        help="search effort used to value each choice one turn ahead (0 turns the equal-effort values off)",
    )
    parser.add_argument(
        "--matrix-ms",
        type=int,
        default=0,
        help="also run a timed expectiminimax pass of this many milliseconds to record the payoff table",
    )
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
                # Each side is judged from what it could see: `state` hides side two's
                # unrevealed Tera types and `stateP2` hides side one's.
                state = build_state(row["state"])
                result = monte_carlo_tree_search(state, iterations=args.iterations, threads=args.threads)
                p2_options = result.side_two
                state_two = state
                result_two = result
                if "stateP2" in row:
                    state_two = build_state(row["stateP2"])
                    result_two = monte_carlo_tree_search(state_two, iterations=args.iterations, threads=args.threads)
                    p2_options = result_two.side_two
                record = {
                    "id": row["id"],
                    "turn": row["turn"],
                    "total": result.total_visits,
                    "p1": summarize(result.side_one),
                    "p2": summarize(p2_options),
                }
                if args.matrix_ms > 0:
                    record["matrix"] = payoff_matrix(state, args.matrix_ms)
                if args.q_iterations > 0:
                    played = row.get("played") or {}
                    record["q"] = {
                        "p1": q_table(state, True, result.side_one, result.side_two, played.get("p2"), args.q_iterations, args.threads),
                        "p2": q_table(state_two, False, p2_options, result_two.side_one, played.get("p1"), args.q_iterations, args.threads),
                    }
            except BaseException as error:  # the engine reports bad input as a panic
                failed += 1
                record = {"id": row["id"], "turn": row["turn"], "error": str(error)[:120]}
            out.write(json.dumps(record) + "\n")
            done += 1
            print(f"{done} positions done ({failed} failed)", file=log, flush=True)
    print(f"Searched {done} positions, {failed} failed. Wrote {args.out}", file=log, flush=True)


if __name__ == "__main__":
    sys.exit(main())
