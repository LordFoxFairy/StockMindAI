/**
 * Parameter Optimization Algorithms
 *
 * 1. Grid Search: exhaustive search over parameter grid
 * 2. Bayesian Optimization: Gaussian Process with UCB acquisition function
 *    UCB(x) = mu(x) + kappa * sigma(x)
 *    Uses RBF kernel: k(x, x') = exp(-||x - x'||^2 / (2 * l^2))
 * 3. Differential Evolution: population-based evolutionary optimizer
 *    Mutation: v = x_r1 + F * (x_r2 - x_r3)
 *    Crossover: binomial
 *    Selection: greedy
 */

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface ParameterRange {
  name: string;
  min: number;
  max: number;
  step?: number; // for grid search; if undefined, treated as continuous
}

export interface OptimizerParams {
  /** Parameter ranges to optimize over */
  ranges: ParameterRange[];
  /** Objective function to maximize (e.g., Sharpe ratio) */
  objective: (params: Record<string, number>) => number;
  /** Maximum number of function evaluations */
  maxEvaluations?: number;
}

export interface EvaluatedPoint {
  params: Record<string, number>;
  value: number;
}

export interface OptimizerResult {
  bestParams: Record<string, number>;
  bestValue: number;
  evaluations: EvaluatedPoint[];
  totalEvaluations: number;
}

// ── Grid Search ──────────────────────────────────────────────────────────────

/**
 * Generate all parameter combinations for grid search.
 */
function generateGrid(ranges: ParameterRange[]): Record<string, number>[] {
  if (ranges.length === 0) return [{}];

  const gridValues: { name: string; values: number[] }[] = [];

  for (const range of ranges) {
    const step = range.step ?? (range.max - range.min) / 10;
    const values: number[] = [];
    for (let v = range.min; v <= range.max + step * 0.001; v += step) {
      values.push(Math.min(v, range.max));
    }
    // Deduplicate (for floating point issues)
    const unique = values
      .map(v => +v.toFixed(10))
      .filter((v, idx, arr) => idx === 0 || v !== arr[idx - 1]);
    gridValues.push({ name: range.name, values: unique });
  }

  // Cartesian product
  let combos: Record<string, number>[] = [{}];

  for (const { name, values } of gridValues) {
    const newCombos: Record<string, number>[] = [];
    for (const combo of combos) {
      for (const val of values) {
        newCombos.push({ ...combo, [name]: val });
      }
    }
    combos = newCombos;
  }

  return combos;
}

/**
 * Grid search: exhaustive evaluation over all parameter combinations.
 *
 * @param params Optimizer parameters with step sizes in ranges
 * @returns Best parameters and all evaluations
 */
export function gridSearch(params: OptimizerParams): OptimizerResult {
  const { ranges, objective, maxEvaluations = Infinity } = params;
  const grid = generateGrid(ranges);

  const evaluations: EvaluatedPoint[] = [];
  let bestValue = -Infinity;
  let bestParams: Record<string, number> = {};

  const limit = Math.min(grid.length, maxEvaluations);

  for (let i = 0; i < limit; i++) {
    const paramSet = grid[i];
    const value = objective(paramSet);
    evaluations.push({ params: paramSet, value });

    if (value > bestValue) {
      bestValue = value;
      bestParams = { ...paramSet };
    }
  }

  return {
    bestParams,
    bestValue,
    evaluations,
    totalEvaluations: evaluations.length,
  };
}

// ── Gaussian Process (for Bayesian Optimization) ─────────────────────────────

/**
 * RBF (Radial Basis Function) kernel.
 * k(x, x') = variance * exp(-||x - x'||^2 / (2 * lengthScale^2))
 */
function rbfKernel(
  x1: number[],
  x2: number[],
  lengthScale: number,
  variance = 1.0,
): number {
  let sqDist = 0;
  for (let i = 0; i < x1.length; i++) {
    const d = x1[i] - x2[i];
    sqDist += d * d;
  }
  return variance * Math.exp(-sqDist / (2 * lengthScale * lengthScale));
}

/**
 * Compute the kernel matrix K for a set of points.
 */
function computeKernelMatrix(
  X: number[][],
  lengthScale: number,
  variance: number,
  noise: number,
): number[][] {
  const n = X.length;
  const K: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const kij = rbfKernel(X[i], X[j], lengthScale, variance);
      K[i][j] = kij;
      K[j][i] = kij;
    }
    // Add noise to diagonal for numerical stability
    K[i][i] += noise;
  }

  return K;
}

/**
 * Solve the linear system K * alpha = y using Cholesky decomposition.
 * Returns alpha = K^{-1} * y
 */
function choleskySolve(K: number[][], y: number[]): number[] | null {
  const n = K.length;

  // Cholesky decomposition: K = L * L^T
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) {
        sum += L[i][k] * L[j][k];
      }

      if (i === j) {
        const diag = K[i][i] - sum;
        if (diag <= 0) return null; // Not positive definite
        L[i][j] = Math.sqrt(diag);
      } else {
        L[i][j] = (K[i][j] - sum) / L[j][j];
      }
    }
  }

  // Forward substitution: L * z = y
  const z = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < i; j++) {
      sum += L[i][j] * z[j];
    }
    z[i] = (y[i] - sum) / L[i][i];
  }

  // Backward substitution: L^T * alpha = z
  const alpha = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = 0;
    for (let j = i + 1; j < n; j++) {
      sum += L[j][i] * alpha[j];
    }
    alpha[i] = (z[i] - sum) / L[i][i];
  }

  return alpha;
}

/**
 * GP prediction at a new point x*, given observed data.
 * Returns (mean, variance) of the predictive distribution.
 */
function gpPredict(
  xStar: number[],
  X: number[][],
  alpha: number[],
  lengthScale: number,
  kernelVariance: number,
  noise: number,
): { mean: number; variance: number } {
  const n = X.length;

  // k* = kernel between x* and all training points
  const kStar: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    kStar[i] = rbfKernel(xStar, X[i], lengthScale, kernelVariance);
  }

  // Predictive mean: mu = k*^T * alpha
  let mu = 0;
  for (let i = 0; i < n; i++) {
    mu += kStar[i] * alpha[i];
  }

  // Predictive variance: sigma^2 = k(x*, x*) - k*^T * K^{-1} * k*
  // We approximate K^{-1} * k* by solving K * v = k*
  // For efficiency, we reuse the Cholesky factor, but here we use a simpler approach
  const kSelf = rbfKernel(xStar, xStar, lengthScale, kernelVariance) + noise;

  // Approximate: compute k*^T * alpha_kstar where alpha_kstar solves K * alpha_kstar = k*
  const K = computeKernelMatrix(X, lengthScale, kernelVariance, noise);
  const alphaKStar = choleskySolve(K, kStar);

  let varReduction = 0;
  if (alphaKStar) {
    for (let i = 0; i < n; i++) {
      varReduction += kStar[i] * alphaKStar[i];
    }
  }

  const variance = Math.max(kSelf - varReduction, 1e-10);

  return { mean: mu, variance };
}

// ── Bayesian Optimization ────────────────────────────────────────────────────

/**
 * Normalize parameters to [0, 1] range.
 */
function normalizeParams(
  params: Record<string, number>,
  ranges: ParameterRange[],
): number[] {
  return ranges.map(r => {
    const range = r.max - r.min;
    return range > 0 ? (params[r.name] - r.min) / range : 0;
  });
}

/**
 * Denormalize parameters from [0, 1] range back to original.
 */
function denormalizeParams(
  normalized: number[],
  ranges: ParameterRange[],
): Record<string, number> {
  const result: Record<string, number> = {};
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    const range = r.max - r.min;
    let value = r.min + normalized[i] * range;

    // Snap to step grid if defined
    if (r.step !== undefined && r.step > 0) {
      value = r.min + Math.round((value - r.min) / r.step) * r.step;
      value = Math.max(r.min, Math.min(r.max, value));
    }

    result[r.name] = value;
  }
  return result;
}

/**
 * Generate a random point in the normalized [0, 1]^d space.
 */
function randomPoint(dim: number): number[] {
  return Array.from({ length: dim }, () => Math.random());
}

/**
 * Bayesian Optimization using a Gaussian Process surrogate with UCB acquisition.
 *
 * UCB(x) = mu(x) + kappa * sigma(x)
 *
 * The algorithm:
 * 1. Start with a few random evaluations
 * 2. Fit a GP to observed data
 * 3. Find the point that maximizes UCB
 * 4. Evaluate the objective at that point
 * 5. Repeat until budget exhausted
 *
 * @param params Optimizer parameters
 * @returns Best parameters found
 */
export function bayesianOptimize(params: OptimizerParams): OptimizerResult {
  const { ranges, objective, maxEvaluations = 50 } = params;
  const dim = ranges.length;
  const kappa = 2.576; // UCB exploration parameter (~99% confidence)
  const noise = 1e-4;
  const kernelVariance = 1.0;

  // Initial random evaluations
  const nInitial = Math.min(Math.max(2 * dim, 5), Math.floor(maxEvaluations / 3));

  const X: number[][] = [];
  const Y: number[] = [];
  const evaluations: EvaluatedPoint[] = [];
  let bestValue = -Infinity;
  let bestParams: Record<string, number> = {};

  // Phase 1: Random initialization
  for (let i = 0; i < nInitial; i++) {
    const normalized = randomPoint(dim);
    const paramSet = denormalizeParams(normalized, ranges);
    const value = objective(paramSet);

    X.push(normalized);
    Y.push(value);
    evaluations.push({ params: paramSet, value });

    if (value > bestValue) {
      bestValue = value;
      bestParams = { ...paramSet };
    }
  }

  // Adaptive length scale: use median pairwise distance
  function computeLengthScale(): number {
    if (X.length < 2) return 0.5;
    const distances: number[] = [];
    for (let i = 0; i < X.length; i++) {
      for (let j = i + 1; j < X.length; j++) {
        let dist = 0;
        for (let k = 0; k < dim; k++) {
          const d = X[i][k] - X[j][k];
          dist += d * d;
        }
        distances.push(Math.sqrt(dist));
      }
    }
    distances.sort((a, b) => a - b);
    const median = distances[Math.floor(distances.length / 2)] || 0.5;
    return Math.max(median, 0.1);
  }

  // Phase 2: Bayesian optimization loop
  for (let iter = nInitial; iter < maxEvaluations; iter++) {
    const lengthScale = computeLengthScale();

    // Normalize Y values for numerical stability
    const yMean = Y.reduce((s, v) => s + v, 0) / Y.length;
    let yStd = 0;
    for (const y of Y) yStd += (y - yMean) ** 2;
    yStd = Math.sqrt(yStd / Y.length) || 1;
    const yNorm = Y.map(y => (y - yMean) / yStd);

    // Fit GP: compute K^{-1} * y
    const K = computeKernelMatrix(X, lengthScale, kernelVariance, noise);
    const alpha = choleskySolve(K, yNorm);

    if (!alpha) {
      // If Cholesky fails, fall back to random sampling
      const normalized = randomPoint(dim);
      const paramSet = denormalizeParams(normalized, ranges);
      const value = objective(paramSet);

      X.push(normalized);
      Y.push(value);
      evaluations.push({ params: paramSet, value });

      if (value > bestValue) {
        bestValue = value;
        bestParams = { ...paramSet };
      }
      continue;
    }

    // Find the point that maximizes UCB via random sampling
    let bestUCB = -Infinity;
    let bestCandidate: number[] = randomPoint(dim);
    const nCandidates = Math.max(100, 20 * dim);

    for (let c = 0; c < nCandidates; c++) {
      const candidate = randomPoint(dim);
      const pred = gpPredict(candidate, X, alpha, lengthScale, kernelVariance, noise);

      // UCB = mu + kappa * sigma (on normalized scale)
      const ucb = pred.mean + kappa * Math.sqrt(pred.variance);

      if (ucb > bestUCB) {
        bestUCB = ucb;
        bestCandidate = candidate;
      }
    }

    // Evaluate objective at the best candidate
    const paramSet = denormalizeParams(bestCandidate, ranges);
    const value = objective(paramSet);

    X.push(bestCandidate);
    Y.push(value);
    evaluations.push({ params: paramSet, value });

    if (value > bestValue) {
      bestValue = value;
      bestParams = { ...paramSet };
    }
  }

  return {
    bestParams,
    bestValue,
    evaluations,
    totalEvaluations: evaluations.length,
  };
}

// ── Differential Evolution ───────────────────────────────────────────────────

/**
 * Differential Evolution: a population-based evolutionary optimizer.
 *
 * Algorithm:
 * 1. Initialize a random population of NP candidate solutions
 * 2. For each individual x_i:
 *    a. Mutation: v = x_r1 + F * (x_r2 - x_r3)  (DE/rand/1)
 *    b. Crossover: u_j = v_j if rand < CR or j == j_rand, else x_i_j
 *    c. Selection: x_i = u if f(u) > f(x_i), else x_i
 * 3. Repeat until convergence or budget exhausted
 *
 * @param params Optimizer parameters
 * @returns Best parameters found
 */
export function differentialEvolution(params: OptimizerParams): OptimizerResult {
  const { ranges, objective, maxEvaluations = 200 } = params;
  const dim = ranges.length;

  // DE hyperparameters
  const F = 0.8;    // Mutation factor (differential weight)
  const CR = 0.9;   // Crossover probability
  const NP = Math.max(4 * dim, 15); // Population size (at least 4*dim)

  // Budget for generations
  const maxGenerations = Math.max(1, Math.floor((maxEvaluations - NP) / NP));

  const evaluations: EvaluatedPoint[] = [];
  let bestValue = -Infinity;
  let bestParams: Record<string, number> = {};

  // Initialize population in normalized [0, 1]^dim space
  const population: number[][] = [];
  const fitness: number[] = [];

  for (let i = 0; i < NP; i++) {
    const individual = randomPoint(dim);
    population.push(individual);

    const paramSet = denormalizeParams(individual, ranges);
    const value = objective(paramSet);
    fitness.push(value);
    evaluations.push({ params: paramSet, value });

    if (value > bestValue) {
      bestValue = value;
      bestParams = { ...paramSet };
    }
  }

  // Evolution loop
  for (let gen = 0; gen < maxGenerations; gen++) {
    for (let i = 0; i < NP; i++) {
      // Select three distinct random indices r1, r2, r3 != i
      let r1 = i, r2 = i, r3 = i;
      while (r1 === i) r1 = Math.floor(Math.random() * NP);
      while (r2 === i || r2 === r1) r2 = Math.floor(Math.random() * NP);
      while (r3 === i || r3 === r1 || r3 === r2) r3 = Math.floor(Math.random() * NP);

      // Mutation: v = x_r1 + F * (x_r2 - x_r3)
      const mutant: number[] = new Array(dim);
      for (let j = 0; j < dim; j++) {
        mutant[j] = population[r1][j] + F * (population[r2][j] - population[r3][j]);
        // Bounce back if out of bounds
        if (mutant[j] < 0) mutant[j] = Math.random() * population[i][j];
        if (mutant[j] > 1) mutant[j] = population[i][j] + Math.random() * (1 - population[i][j]);
        mutant[j] = Math.max(0, Math.min(1, mutant[j]));
      }

      // Crossover: binomial
      const trial: number[] = [...population[i]];
      const jRand = Math.floor(Math.random() * dim);
      for (let j = 0; j < dim; j++) {
        if (Math.random() < CR || j === jRand) {
          trial[j] = mutant[j];
        }
      }

      // Evaluate trial
      const paramSet = denormalizeParams(trial, ranges);
      const value = objective(paramSet);
      evaluations.push({ params: paramSet, value });

      // Selection: greedy (we're maximizing)
      if (value >= fitness[i]) {
        population[i] = trial;
        fitness[i] = value;

        if (value > bestValue) {
          bestValue = value;
          bestParams = { ...paramSet };
        }
      }
    }

    // Check if evaluations budget is exhausted
    if (evaluations.length >= maxEvaluations) break;
  }

  return {
    bestParams,
    bestValue,
    evaluations,
    totalEvaluations: evaluations.length,
  };
}

// ── Random Search (baseline) ─────────────────────────────────────────────────

/**
 * Random search: uniformly sample parameter space.
 * Useful as a baseline comparison for other optimizers.
 *
 * @param params Optimizer parameters
 * @returns Best parameters found via random sampling
 */
export function randomSearch(params: OptimizerParams): OptimizerResult {
  const { ranges, objective, maxEvaluations = 100 } = params;

  const evaluations: EvaluatedPoint[] = [];
  let bestValue = -Infinity;
  let bestParams: Record<string, number> = {};

  for (let i = 0; i < maxEvaluations; i++) {
    const paramSet: Record<string, number> = {};
    for (const range of ranges) {
      let value = range.min + Math.random() * (range.max - range.min);
      if (range.step !== undefined && range.step > 0) {
        value = range.min + Math.round((value - range.min) / range.step) * range.step;
        value = Math.max(range.min, Math.min(range.max, value));
      }
      paramSet[range.name] = value;
    }

    const value = objective(paramSet);
    evaluations.push({ params: paramSet, value });

    if (value > bestValue) {
      bestValue = value;
      bestParams = { ...paramSet };
    }
  }

  return {
    bestParams,
    bestValue,
    evaluations,
    totalEvaluations: evaluations.length,
  };
}
