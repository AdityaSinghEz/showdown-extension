/**
 * The review engine: for each turn of a recorded game, tries every combination
 * of choices from the same position and grades what the players actually did.
 *
 * How it works, per turn:
 *
 * 1. The game is replayed from its input log and the full simulator state is
 *    saved at the start of the turn.
 * 2. Every legal choice for both sides is listed (moves, with and without
 *    Terastallizing, and switches).
 * 3. For every pair of choices the turn is simulated from a fresh copy of the
 *    saved state, with several random seeds, and the resulting position is
 *    scored by the win-probability model. The average is one cell of a payoff
 *    matrix. The same seeds are used for every cell so differences between
 *    cells come from the choices, not from luck.
 * 4. The matrix game is solved, which gives each side's best mix of options.
 * 5. A player's loss is how much their actual choice was worth less than the
 *    best option, against the opponent's best mix. The opponent's actual move
 *    is deliberately not used: the point is to judge the decision without
 *    hindsight.
 *
 * Because the replay was simulated with the exact build that played it, the
 * teams, movesets, items and abilities of both players are known.
 */

import type { LogisticModel } from '../model/logistic';
import { gradeLoss, type Grade } from './grade';
import { columnPayoffs, rowPayoffs, solveMatrixGame } from './matrix';
import { winProbability } from './position';
import { scoreOptions } from './policy';
import { rolloutValue, type RolloutOptions } from './rollout';
import type { SimBattle, SimModule, SimRequest, SimSide } from './sim';

/** One choice a side could make. */
export interface ChoiceOption {
  /** The text the simulator accepts, for example `move 2 terastallize`. */
  choice: string;
  kind: 'move' | 'switch';
  /** Readable name: the move or the Pokemon switched to. */
  label: string;
  /** Move id, for matching against the input log. */
  id: string;
  /** 1-based position among the moves or the party. */
  slot: number;
  tera: boolean;
}

/** The start of one turn, saved so it can be replayed any number of times. */
export interface TurnStart {
  turn: number;
  /** The serialized battle as text; parse it afresh for every copy. */
  state: string;
  /** Choice lines from the input log that were played this turn, per side. */
  played: { p1: string | null; p2: string | null };
}

/** How one side's actual choice was judged. */
export interface Judgement {
  /** The choice made, or `null` if it could not be matched to a legal option. */
  played: ChoiceOption | null;
  /** Win probability given up against the best option, from this side's view. */
  loss: number | null;
  grade: Grade | 'forced' | 'unknown';
  /** The best options, with how often a best-playing side would pick each. */
  best: { option: ChoiceOption; share: number }[];
}

/** The review of one turn. */
export interface TurnReview {
  turn: number;
  /** Player 1's win probability with best play from here (the game's value). */
  value: number;
  p1: Judgement;
  p2: Judgement;
  /** Cells of the matrix that failed to simulate and were left out. */
  failures: number;
}

/** Makes a string comparable: lower case, letters and digits only. */
export function toId(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const CHOICE_LINE = /^>(p[12]) ((?:move|switch) .+)$/;

/**
 * Lists the legal choices in a request.
 *
 * Returns nothing when the side is not choosing a normal turn action: it is
 * waiting, or being asked for a forced replacement.
 *
 * @param request - The side's pending request.
 * @param includeTera - Whether to list the Terastallize variant of each move.
 */
export function legalOptions(request: SimRequest | null | undefined, includeTera = true): ChoiceOption[] {
  if (!request || request.wait || request.forceSwitch || !request.active) return [];
  const active = request.active[0];
  if (!active) return [];

  const options: ChoiceOption[] = [];
  active.moves.forEach((move, index) => {
    if (move.disabled) return;
    const slot = index + 1;
    options.push({ choice: `move ${slot}`, kind: 'move', label: move.move, id: move.id, slot, tera: false });
    if (includeTera && active.canTerastallize) {
      options.push({
        choice: `move ${slot} terastallize`,
        kind: 'move',
        label: `${move.move} (Tera ${active.canTerastallize})`,
        id: move.id,
        slot,
        tera: true,
      });
    }
  });
  if (!active.trapped) {
    request.side.pokemon.forEach((mon, index) => {
      if (mon.active || mon.condition.endsWith(' fnt')) return;
      const slot = index + 1;
      options.push({
        choice: `switch ${slot}`,
        kind: 'switch',
        label: `switch to ${mon.details.split(',')[0]}`,
        id: toId(mon.details.split(',')[0] ?? ''),
        slot,
        tera: false,
      });
    });
  }
  return options;
}

/**
 * Finds which legal option an input-log choice corresponds to.
 *
 * The log names moves (`move facade`) but numbers switches (`switch 5`).
 *
 * @param line - The choice text without the side prefix, for example `move facade terastallize`.
 * @param options - The legal options at that moment.
 * @returns The index into `options`, or -1 if none matches.
 */
export function matchChoice(line: string, options: readonly ChoiceOption[]): number {
  const parts = line.trim().split(/\s+/);
  const kind = parts[0];
  const wantsTera = parts.includes('terastallize');
  const target = parts.filter((p, i) => i > 0 && p !== 'terastallize').join(' ');
  return options.findIndex((option) => {
    if (option.kind !== kind) return false;
    if (kind === 'move') {
      const matches = /^\d+$/.test(target) ? option.slot === Number(target) : option.id === toId(target);
      return matches && option.tera === wantsTera;
    }
    return /^\d+$/.test(target) ? option.slot === Number(target) : option.id === toId(target);
  });
}

/** Optional behavior while replaying a game. */
export interface TurnHooks {
  /** Called with the live battle at the start of every turn. */
  onTurnStart?: (battle: SimBattle) => void;
  /** Set to false to skip saving the state text, which saves memory when only the hook is needed. */
  keepState?: boolean;
  /** Called once when the replay finishes, with the final battle. */
  onEnd?: (battle: SimBattle) => void;
}

/**
 * Replays an input log and saves the state at the start of every turn.
 *
 * @param sim - The simulator build that played the game.
 * @param inputlog - The replay's input log.
 * @returns One entry per turn, with the choices the players made on it.
 */
export async function collectTurnStarts(
  sim: SimModule,
  inputlog: string,
  hooks: TurnHooks = {},
): Promise<TurnStart[]> {
  const lines = inputlog.split('\n').filter((line) => line !== '' && !line.startsWith('>version'));
  const stream = new sim.BattleStream();
  const streams = sim.getPlayerStreams(stream as never);
  void (async () => {
    for await (const chunk of streams.omniscient) void chunk;
  })();

  const starts: (TurnStart & { startLine: number })[] = [];
  let lastTurn = -1;
  for (let i = 0; i < lines.length; i++) {
    await streams.omniscient.write(lines[i] as string);
    const battle = stream.battle;
    if (battle && !battle.ended && battle.turn !== lastTurn && battle.turn > 0) {
      lastTurn = battle.turn;
      hooks.onTurnStart?.(battle);
      starts.push({
        turn: battle.turn,
        state: hooks.keepState === false ? '' : JSON.stringify(battle.toJSON()),
        played: { p1: null, p2: null },
        startLine: i + 1,
      });
    }
  }

  if (stream.battle) hooks.onEnd?.(stream.battle);

  // The first move or switch each side chose after a turn began is that turn's decision.
  // Later lines before the next turn are forced replacements after a faint.
  starts.forEach((start, index) => {
    const end = starts[index + 1]?.startLine ?? lines.length;
    for (const line of lines.slice(start.startLine, end)) {
      const match = CHOICE_LINE.exec(line);
      if (!match) continue;
      const side = match[1] as 'p1' | 'p2';
      if (start.played[side] === null) start.played[side] = match[2] as string;
    }
  });
  return starts.map(({ startLine: _unused, ...rest }) => rest);
}

/** Options for {@link reviewTurn}. */
export interface ReviewOptions {
  /** Random seeds per matrix cell. More is steadier and slower. */
  samples: number;
  /** Whether Terastallize variants of each move are tried. */
  includeTera: boolean;
  /**
   * When set, each branch is judged by playing it forward (see `rollout.ts`)
   * instead of by the model alone. `samples` then counts branches, each
   * followed by `rollouts` forward games.
   */
  rollout?: Omit<RolloutOptions, 'seed'>;
  /**
   * Most options per side that are simulated; the rest are ignored, except the
   * one actually played. Keeps a review fast. Omit to try every legal option.
   */
  maxOptions?: number;
}

function restore(sim: SimModule, state: string): SimBattle {
  return sim.Battle.fromJSON(JSON.parse(state));
}

function bestShares(options: readonly ChoiceOption[], mix: readonly number[]): { option: ChoiceOption; share: number }[] {
  return options
    .map((option, i) => ({ option, share: mix[i] ?? 0 }))
    .filter((entry) => entry.share >= 0.05)
    .sort((a, b) => b.share - a.share);
}

/**
 * Keeps the most promising options (by the practice player's scores) plus the
 * one that was played, so grading never loses the player's real choice.
 */
function prune(
  battle: SimBattle,
  sideIndex: 0 | 1,
  list: ChoiceOption[],
  playedLine: string | null,
  limit: number | undefined,
): ChoiceOption[] {
  if (limit === undefined || list.length <= limit) return list;
  const scores = scoreOptions(battle, sideIndex, list);
  const ranked = list.map((option, i) => ({ option, score: scores[i] as number })).sort((a, b) => b.score - a.score);
  const kept = new Set(ranked.slice(0, limit).map((entry) => entry.option));
  const playedIndex = playedLine === null ? -1 : matchChoice(playedLine, list);
  if (playedIndex >= 0) kept.add(list[playedIndex] as ChoiceOption);
  return list.filter((option) => kept.has(option));
}

/**
 * Reviews one turn.
 *
 * @param sim - The simulator build that played the game.
 * @param model - The win-probability model that scores positions.
 * @param start - The saved start of the turn.
 * @param options - Sampling settings.
 * @returns The review, or `null` if a side was not making a normal choice.
 */
export function reviewTurn(
  sim: SimModule,
  model: LogisticModel,
  start: TurnStart,
  options: ReviewOptions,
): TurnReview | null {
  const probe = restore(sim, start.state);
  const [side1, side2] = probe.sides as [SimSide, SimSide];
  const rows = prune(probe, 0, legalOptions(side1.activeRequest, options.includeTera), start.played.p1, options.maxOptions);
  const columns = prune(probe, 1, legalOptions(side2.activeRequest, options.includeTera), start.played.p2, options.maxOptions);
  if (rows.length === 0 || columns.length === 0) return null;

  let failures = 0;
  const matrix = rows.map((row) =>
    columns.map((column) => {
      let total = 0;
      let done = 0;
      for (let k = 0; k < options.samples; k++) {
        try {
          const battle = restore(sim, start.state);
          battle.prng = new sim.PRNG([k + 1, 17, 29, 41]);
          battle.choose('p1', row.choice);
          battle.choose('p2', column.choice);
          total += options.rollout
            ? rolloutValue(sim, battle, model, { ...options.rollout, seed: 100 * (k + 1) })
            : winProbability(battle, model);
          done += 1;
        } catch {
          // A branch the simulator rejects is skipped rather than guessed at.
        }
      }
      if (done === 0) failures += 1;
      return done === 0 ? 0.5 : total / done;
    }),
  );

  const solution = solveMatrixGame(matrix);
  const p1Payoffs = rowPayoffs(matrix, solution.columnStrategy);
  const p2Payoffs = columnPayoffs(matrix, solution.rowStrategy);

  const judge = (
    side: 'p1' | 'p2',
    list: readonly ChoiceOption[],
    payoffs: readonly number[],
    mix: readonly number[],
  ): Judgement => {
    const best = bestShares(list, mix);
    const line = start.played[side];
    const index = line === null ? -1 : matchChoice(line, list);
    if (index === -1) return { played: null, loss: null, grade: 'unknown', best };
    const played = list[index] as ChoiceOption;
    if (list.length === 1) return { played, loss: 0, grade: 'forced', best };
    // Player 1 wants a high payoff, player 2 a low one.
    const loss =
      side === 'p1'
        ? solution.value - (payoffs[index] as number)
        : (payoffs[index] as number) - solution.value;
    return { played, loss, grade: gradeLoss(loss), best };
  };

  return {
    turn: start.turn,
    value: solution.value,
    p1: judge('p1', rows, p1Payoffs, solution.rowStrategy),
    p2: judge('p2', columns, p2Payoffs, solution.columnStrategy),
    failures,
  };
}
