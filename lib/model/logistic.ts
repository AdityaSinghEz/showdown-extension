/**
 * Logistic regression without an intercept, fitted by Newton's method.
 *
 * The model predicts the probability that player 1 wins from a vector of
 * "player 1 minus player 2" features:
 *
 *     P(player 1 wins) = sigmoid(w . x)
 *
 * With no intercept, equal sides give exactly 50%, and swapping the sides
 * negates `x`, which turns `p` into `1 - p`. Training minimizes the log loss
 * plus a small ridge penalty (`l2 / 2 * |w|^2`) that keeps the weights finite
 * when the data can be separated perfectly.
 *
 * Newton's method needs only a handful of iterations for a few features, and
 * the result is deterministic: the same data always yields the same weights.
 */

/** A fitted model. */
export interface LogisticModel {
  /** Feature names, in the order the weights apply. */
  featureNames: string[];
  weights: number[];
}

/** One labelled row for training. */
export interface TrainingExample {
  features: number[];
  /** 1 if the modelled outcome happened (player 1 won), otherwise 0. */
  label: 0 | 1;
}

/** Tuning options for {@link trainLogistic}. */
export interface TrainOptions {
  /** Ridge penalty strength. Defaults to 1. */
  l2?: number;
  /** Iteration cap. Defaults to 50. */
  maxIterations?: number;
  /** Stop when no weight changes by more than this. Defaults to 1e-8. */
  tolerance?: number;
}

/**
 * The logistic function, computed so that large inputs cannot overflow.
 *
 * @param z - Any real number.
 * @returns A probability between 0 and 1.
 */
export function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/** Numerically stable `log(1 + exp(z))`. */
function softplus(z: number): number {
  return Math.max(z, 0) + Math.log1p(Math.exp(-Math.abs(z)));
}

function dot(weights: readonly number[], features: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i += 1) sum += weights[i]! * features[i]!;
  return sum;
}

/**
 * Predicts the probability that player 1 wins.
 *
 * @param model - A fitted model.
 * @param features - A vector in the model's feature order.
 */
export function predictProbability(model: LogisticModel, features: readonly number[]): number {
  return sigmoid(dot(model.weights, features));
}

/** Regularized negative log-likelihood. */
function objective(weights: readonly number[], examples: readonly TrainingExample[], l2: number): number {
  let loss = 0;
  for (const example of examples) {
    const z = dot(weights, example.features);
    loss += softplus(z) - example.label * z;
  }
  let penalty = 0;
  for (const weight of weights) penalty += weight * weight;
  return loss + 0.5 * l2 * penalty;
}

/**
 * Solves `matrix * x = rhs` by Gaussian elimination with partial pivoting.
 *
 * @throws If the matrix is singular.
 */
function solve(matrix: readonly (readonly number[])[], rhs: readonly number[]): number[] {
  const n = rhs.length;
  const a: number[][] = matrix.map((row, i) => [...row, rhs[i]!]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(a[pivot]![col]!) < 1e-12) {
      throw new Error('Singular system: features are linearly dependent; increase l2');
    }
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];

    for (let row = col + 1; row < n; row += 1) {
      const factor = a[row]![col]! / a[col]![col]!;
      for (let k = col; k <= n; k += 1) a[row]![k] = a[row]![k]! - factor * a[col]![k]!;
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = a[row]![n]!;
    for (let k = row + 1; k < n; k += 1) sum -= a[row]![k]! * x[k]!;
    x[row] = sum / a[row]![row]!;
  }
  return x;
}

/**
 * Fits a logistic regression.
 *
 * @param featureNames - Names of the features, in vector order.
 * @param examples - Labelled rows; every vector must match `featureNames`.
 * @param options - Tuning options.
 * @returns The fitted model.
 * @throws If there are no examples, or a vector has the wrong length.
 */
export function trainLogistic(
  featureNames: readonly string[],
  examples: readonly TrainingExample[],
  options: TrainOptions = {},
): LogisticModel {
  const { l2 = 1, maxIterations = 50, tolerance = 1e-8 } = options;
  const size = featureNames.length;
  if (examples.length === 0) throw new Error('Cannot train on zero examples');
  for (const example of examples) {
    if (example.features.length !== size) {
      throw new Error(`Expected ${size} features per example, got ${example.features.length}`);
    }
  }

  let weights: number[] = new Array<number>(size).fill(0);
  let loss = objective(weights, examples, l2);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const gradient = weights.map((weight) => l2 * weight);
    const hessian: number[][] = Array.from({ length: size }, (_, i) =>
      Array.from({ length: size }, (_, j) => (i === j ? l2 : 0)),
    );

    for (const example of examples) {
      const p = sigmoid(dot(weights, example.features));
      const residual = p - example.label;
      const curvature = p * (1 - p);
      for (let i = 0; i < size; i += 1) {
        const xi = example.features[i]!;
        gradient[i] = gradient[i]! + residual * xi;
        for (let j = 0; j < size; j += 1) {
          hessian[i]![j] = hessian[i]![j]! + curvature * xi * example.features[j]!;
        }
      }
    }

    const step = solve(hessian, gradient);

    // Halve the step until the loss stops increasing (guards against overshoot).
    let scale = 1;
    let candidate = weights;
    let candidateLoss = loss;
    let improved = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      candidate = weights.map((weight, i) => weight - scale * step[i]!);
      candidateLoss = objective(candidate, examples, l2);
      if (candidateLoss <= loss + 1e-12) {
        improved = true;
        break;
      }
      scale /= 2;
    }
    if (!improved) break;

    let largestChange = 0;
    for (let i = 0; i < size; i += 1) {
      largestChange = Math.max(largestChange, Math.abs(candidate[i]! - weights[i]!));
    }
    weights = candidate;
    loss = candidateLoss;
    if (largestChange < tolerance) break;
  }

  return { featureNames: [...featureNames], weights };
}
