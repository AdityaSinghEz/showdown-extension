/**
 * Solving a two-player zero-sum matrix game.
 *
 * In a Pokemon turn both players choose at the same time, so there is no
 * single best move: the value of a move depends on what the opponent does.
 * The standard answer is a payoff matrix. Rows are player 1's options, columns
 * are player 2's, and each cell is the chance that player 1 wins if that pair
 * is played. Player 1 wants a high number and player 2 a low one. The solution
 * is each side's best mixed strategy (how often to play each option) and the
 * value of the game.
 */

/** The solution of a matrix game. */
export interface MatrixSolution {
  /** Expected payoff to the row player when both play their best mix. */
  value: number;
  /** The row player's best mixed strategy; sums to 1. */
  rowStrategy: number[];
  /** The column player's best mixed strategy; sums to 1. */
  columnStrategy: number[];
}

const EPSILON = 1e-10;

/**
 * Solves a matrix game with the simplex method.
 *
 * The row player maximizes the payoff and the column player minimizes it. The
 * matrix is shifted so every entry is positive, which turns the game into a
 * standard linear program; the shift is removed again from the value.
 *
 * @param payoff - A non-empty rectangular matrix of payoffs to the row player.
 * @returns The value and both best strategies.
 * @throws If the matrix is empty or not rectangular.
 */
export function solveMatrixGame(payoff: readonly (readonly number[])[]): MatrixSolution {
  const m = payoff.length;
  const n = payoff[0]?.length ?? 0;
  if (m === 0 || n === 0 || payoff.some((row) => row.length !== n)) {
    throw new Error('payoff must be a non-empty rectangular matrix');
  }

  let min = Infinity;
  for (const row of payoff) for (const value of row) min = Math.min(min, value);
  const shift = 1 - min;
  const a = payoff.map((row) => row.map((value) => value + shift));

  // Maximize sum(y) subject to A y <= 1, y >= 0. Columns are y_0..y_{n-1}, then
  // the m slack variables, then the right-hand side.
  const width = n + m + 1;
  const rows: number[][] = a.map((row, i) => {
    const line = new Array<number>(width).fill(0);
    row.forEach((value, j) => {
      line[j] = value;
    });
    line[n + i] = 1;
    line[width - 1] = 1;
    return line;
  });
  const objective = new Array<number>(width).fill(0);
  for (let j = 0; j < n; j++) objective[j] = -1;
  const basis = rows.map((_, i) => n + i);

  for (let guard = 0; guard < 10_000; guard++) {
    // Bland's rule (lowest index) cannot cycle.
    let enter = -1;
    for (let j = 0; j < width - 1; j++) {
      if ((objective[j] ?? 0) < -EPSILON) {
        enter = j;
        break;
      }
    }
    if (enter === -1) break;

    let leave = -1;
    let bestRatio = Infinity;
    for (let i = 0; i < m; i++) {
      const row = rows[i] as number[];
      const pivot = row[enter] as number;
      if (pivot > EPSILON) {
        const ratio = (row[width - 1] as number) / pivot;
        const better =
          ratio < bestRatio - EPSILON ||
          (Math.abs(ratio - bestRatio) <= EPSILON && leave !== -1 && (basis[i] as number) < (basis[leave] as number));
        if (better) {
          bestRatio = ratio;
          leave = i;
        }
      }
    }
    if (leave === -1) throw new Error('matrix game is unbounded, which cannot happen for a positive matrix');

    const pivotRow = rows[leave] as number[];
    const pivotValue = pivotRow[enter] as number;
    for (let j = 0; j < width; j++) pivotRow[j] = (pivotRow[j] as number) / pivotValue;
    for (let i = 0; i < m; i++) {
      if (i === leave) continue;
      const row = rows[i] as number[];
      const factor = row[enter] as number;
      if (Math.abs(factor) > 0) for (let j = 0; j < width; j++) row[j] = (row[j] as number) - factor * (pivotRow[j] as number);
    }
    const factor = objective[enter] as number;
    for (let j = 0; j < width; j++) objective[j] = (objective[j] as number) - factor * (pivotRow[j] as number);
    basis[leave] = enter;
  }

  const total = objective[width - 1] as number; // sum of y' = 1 / (value of the shifted game)
  const columnStrategy = new Array<number>(n).fill(0);
  basis.forEach((variable, i) => {
    if (variable < n) columnStrategy[variable] = (rows[i] as number[])[width - 1] as number;
  });
  const rowStrategy = a.map((_, i) => objective[n + i] as number);

  return {
    value: 1 / total - shift,
    rowStrategy: rowStrategy.map((p) => p / total),
    columnStrategy: columnStrategy.map((p) => p / total),
  };
}

/**
 * Expected payoff of each row option against a column mix.
 *
 * @param payoff - The payoff matrix.
 * @param columnMix - How often the column player plays each column.
 */
export function rowPayoffs(payoff: readonly (readonly number[])[], columnMix: readonly number[]): number[] {
  return payoff.map((row) => row.reduce((sum, value, j) => sum + value * (columnMix[j] ?? 0), 0));
}

/**
 * Expected payoff of each column option against a row mix.
 *
 * @param payoff - The payoff matrix, as payoffs to the row player.
 * @param rowMix - How often the row player plays each row.
 */
export function columnPayoffs(payoff: readonly (readonly number[])[], rowMix: readonly number[]): number[] {
  const n = payoff[0]?.length ?? 0;
  const out = new Array<number>(n).fill(0);
  payoff.forEach((row, i) => {
    row.forEach((value, j) => {
      out[j] = (out[j] as number) + value * (rowMix[i] ?? 0);
    });
  });
  return out;
}
