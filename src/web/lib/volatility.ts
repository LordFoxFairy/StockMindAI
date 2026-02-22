/**
 * Volatility Models: EWMA, GARCH(1,1), GJR-GARCH
 *
 * EWMA Volatility: sigma^2_t = lambda * sigma^2_{t-1} + (1 - lambda) * r^2_{t-1}
 *   lambda = 0.94 (RiskMetrics default)
 *
 * GARCH(1,1): sigma^2_t = omega + alpha * epsilon^2_{t-1} + beta * sigma^2_{t-1}
 *   Estimate omega, alpha, beta via Nelder-Mead MLE on log-likelihood:
 *   L = -0.5 * sum [ln(sigma^2_t) + r^2_t / sigma^2_t]
 *
 * GJR-GARCH: sigma^2_t = omega + (alpha + gamma * I_{t-1}) * epsilon^2_{t-1} + beta * sigma^2_{t-1}
 *   where I_{t-1} = 1 if epsilon_{t-1} < 0 (leverage effect)
 */

import { mean } from './risk';

// ── EWMA Volatility ──────────────────────────────────────────────────────────

/**
 * Compute EWMA conditional variances.
 * @param returns Array of log or simple returns
 * @param lambda Decay factor, default 0.94 (RiskMetrics)
 * @returns Array of conditional variances (same length as returns)
 */
export function ewmaVolatility(returns: number[], lambda = 0.94): number[] {
  if (returns.length === 0) return [];

  // Initialize with sample variance
  let variance = 0;
  for (let i = 0; i < returns.length; i++) {
    variance += returns[i] * returns[i];
  }
  variance /= returns.length;

  const variances: number[] = [];
  let prevVariance = variance;

  for (let i = 0; i < returns.length; i++) {
    if (i === 0) {
      variances.push(prevVariance);
    } else {
      const newVariance = lambda * prevVariance + (1 - lambda) * returns[i - 1] * returns[i - 1];
      variances.push(newVariance);
      prevVariance = newVariance;
    }
  }

  return variances;
}

// ── Nelder-Mead Simplex Optimizer ────────────────────────────────────────────

interface NelderMeadOptions {
  maxIterations: number;
  tolerance: number;
  initialStep: number[];
}

/**
 * Minimizes `fn` using the Nelder-Mead simplex method.
 * @param fn Objective function to minimize
 * @param x0 Initial parameter vector
 * @param options Configuration
 * @returns Optimized parameter vector
 */
function nelderMead(
  fn: (x: number[]) => number,
  x0: number[],
  options: NelderMeadOptions,
): number[] {
  const n = x0.length;
  const { maxIterations, tolerance, initialStep } = options;

  const alpha = 1.0; // reflection
  const gamma = 2.0; // expansion
  const rho = 0.5;   // contraction
  const sigma = 0.5;  // shrink

  // Build initial simplex: n+1 vertices
  const simplex: { point: number[]; value: number }[] = [];

  const val0 = fn(x0);
  simplex.push({ point: [...x0], value: val0 });

  for (let i = 0; i < n; i++) {
    const xi = [...x0];
    xi[i] += initialStep[i];
    simplex.push({ point: xi, value: fn(xi) });
  }

  for (let iter = 0; iter < maxIterations; iter++) {
    // Sort by function value
    simplex.sort((a, b) => a.value - b.value);

    // Check convergence
    const fRange = Math.abs(simplex[n].value - simplex[0].value);
    if (fRange < tolerance) break;

    // Centroid of all points except worst
    const centroid = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        centroid[j] += simplex[i].point[j];
      }
    }
    for (let j = 0; j < n; j++) {
      centroid[j] /= n;
    }

    const worst = simplex[n];
    const secondWorst = simplex[n - 1];
    const best = simplex[0];

    // Reflection
    const reflected = centroid.map((c, j) => c + alpha * (c - worst.point[j]));
    const fReflected = fn(reflected);

    if (fReflected < secondWorst.value && fReflected >= best.value) {
      simplex[n] = { point: reflected, value: fReflected };
      continue;
    }

    // Expansion
    if (fReflected < best.value) {
      const expanded = centroid.map((c, j) => c + gamma * (reflected[j] - c));
      const fExpanded = fn(expanded);
      if (fExpanded < fReflected) {
        simplex[n] = { point: expanded, value: fExpanded };
      } else {
        simplex[n] = { point: reflected, value: fReflected };
      }
      continue;
    }

    // Contraction
    const contracted = centroid.map((c, j) => c + rho * (worst.point[j] - c));
    const fContracted = fn(contracted);

    if (fContracted < worst.value) {
      simplex[n] = { point: contracted, value: fContracted };
      continue;
    }

    // Shrink
    for (let i = 1; i <= n; i++) {
      for (let j = 0; j < n; j++) {
        simplex[i].point[j] = best.point[j] + sigma * (simplex[i].point[j] - best.point[j]);
      }
      simplex[i].value = fn(simplex[i].point);
    }
  }

  simplex.sort((a, b) => a.value - b.value);
  return simplex[0].point;
}

// ── GARCH(1,1) ───────────────────────────────────────────────────────────────

export interface GarchResult {
  omega: number;
  alpha: number;
  beta: number;
  logLikelihood: number;
  conditionalVol: number[];
}

/**
 * Compute GARCH(1,1) conditional variances given parameters.
 * sigma^2_t = omega + alpha * r^2_{t-1} + beta * sigma^2_{t-1}
 */
function garchVariances(
  returns: number[],
  omega: number,
  alpha: number,
  beta: number,
): number[] {
  const n = returns.length;
  const variances: number[] = new Array(n);

  // Initialize with unconditional variance: omega / (1 - alpha - beta)
  const persistence = alpha + beta;
  const uncondVar = persistence < 1 && persistence > 0
    ? omega / (1 - persistence)
    : returns.reduce((s, r) => s + r * r, 0) / returns.length;

  variances[0] = Math.max(uncondVar, 1e-10);

  for (let t = 1; t < n; t++) {
    variances[t] = omega + alpha * returns[t - 1] * returns[t - 1] + beta * variances[t - 1];
    variances[t] = Math.max(variances[t], 1e-10);
  }

  return variances;
}

/**
 * Negative log-likelihood for GARCH(1,1).
 * L = -0.5 * sum [ln(sigma^2_t) + r^2_t / sigma^2_t]
 * We return -L so that minimization corresponds to maximizing likelihood.
 */
function garchNegLogLikelihood(returns: number[], params: number[]): number {
  const [omega, alpha, beta] = params;

  // Enforce constraints with penalty
  if (omega <= 0 || alpha < 0 || beta < 0 || alpha + beta >= 1) {
    return 1e15;
  }

  const variances = garchVariances(returns, omega, alpha, beta);
  let ll = 0;
  for (let t = 0; t < returns.length; t++) {
    const v = variances[t];
    ll += Math.log(v) + (returns[t] * returns[t]) / v;
  }

  return 0.5 * ll; // We minimize this (negative of the true log-likelihood up to constant)
}

/**
 * Fit a GARCH(1,1) model to return data via Nelder-Mead MLE.
 * @param returns Array of returns (log or simple)
 * @returns Estimated GARCH parameters and conditional volatilities
 */
export function garchFit(returns: number[]): GarchResult {
  if (returns.length < 10) {
    const sampleVar = returns.reduce((s, r) => s + r * r, 0) / Math.max(returns.length, 1);
    return {
      omega: sampleVar * 0.05,
      alpha: 0.1,
      beta: 0.85,
      logLikelihood: 0,
      conditionalVol: returns.map(() => Math.sqrt(sampleVar)),
    };
  }

  const mu = mean(returns);
  const demeaned = returns.map(r => r - mu);

  const sampleVar = demeaned.reduce((s, r) => s + r * r, 0) / demeaned.length;

  // Initial parameters: omega, alpha, beta
  const x0 = [sampleVar * 0.05, 0.1, 0.85];

  const objective = (params: number[]) => garchNegLogLikelihood(demeaned, params);

  const optimized = nelderMead(objective, x0, {
    maxIterations: 500,
    tolerance: 1e-10,
    initialStep: [sampleVar * 0.01, 0.02, 0.05],
  });

  let [omega, alpha, beta] = optimized;

  // Clamp parameters to valid range
  omega = Math.max(omega, 1e-10);
  alpha = Math.max(alpha, 0);
  beta = Math.max(beta, 0);
  if (alpha + beta >= 1) {
    const scale = 0.999 / (alpha + beta);
    alpha *= scale;
    beta *= scale;
  }

  const variances = garchVariances(demeaned, omega, alpha, beta);
  const negLL = garchNegLogLikelihood(demeaned, [omega, alpha, beta]);
  const logLikelihood = -negLL;

  const conditionalVol = variances.map(v => Math.sqrt(v));

  return { omega, alpha, beta, logLikelihood, conditionalVol };
}

// ── GJR-GARCH ────────────────────────────────────────────────────────────────

export interface GjrGarchResult {
  omega: number;
  alpha: number;
  beta: number;
  gamma: number;
  logLikelihood: number;
  conditionalVol: number[];
}

/**
 * Compute GJR-GARCH conditional variances.
 * sigma^2_t = omega + (alpha + gamma * I_{t-1}) * epsilon^2_{t-1} + beta * sigma^2_{t-1}
 * where I_{t-1} = 1 if epsilon_{t-1} < 0
 */
function gjrGarchVariances(
  returns: number[],
  omega: number,
  alpha: number,
  beta: number,
  gamma: number,
): number[] {
  const n = returns.length;
  const variances: number[] = new Array(n);

  // Unconditional variance for GJR: omega / (1 - alpha - beta - gamma/2)
  const persistence = alpha + beta + gamma / 2;
  const uncondVar = persistence < 1 && persistence > 0
    ? omega / (1 - persistence)
    : returns.reduce((s, r) => s + r * r, 0) / returns.length;

  variances[0] = Math.max(uncondVar, 1e-10);

  for (let t = 1; t < n; t++) {
    const r_prev = returns[t - 1];
    const indicator = r_prev < 0 ? 1 : 0;
    variances[t] = omega + (alpha + gamma * indicator) * r_prev * r_prev + beta * variances[t - 1];
    variances[t] = Math.max(variances[t], 1e-10);
  }

  return variances;
}

/**
 * Negative log-likelihood for GJR-GARCH.
 */
function gjrGarchNegLogLikelihood(returns: number[], params: number[]): number {
  const [omega, alpha, beta, gamma] = params;

  // Constraints: omega > 0, alpha >= 0, beta >= 0, gamma >= 0, alpha + beta + gamma/2 < 1
  if (omega <= 0 || alpha < 0 || beta < 0 || gamma < 0 || alpha + beta + gamma / 2 >= 1) {
    return 1e15;
  }

  const variances = gjrGarchVariances(returns, omega, alpha, beta, gamma);
  let ll = 0;
  for (let t = 0; t < returns.length; t++) {
    const v = variances[t];
    ll += Math.log(v) + (returns[t] * returns[t]) / v;
  }

  return 0.5 * ll;
}

/**
 * Fit a GJR-GARCH model to return data via Nelder-Mead MLE.
 * @param returns Array of returns
 * @returns Estimated GJR-GARCH parameters and conditional volatilities
 */
export function gjrGarchFit(returns: number[]): GjrGarchResult {
  if (returns.length < 10) {
    const sampleVar = returns.reduce((s, r) => s + r * r, 0) / Math.max(returns.length, 1);
    return {
      omega: sampleVar * 0.05,
      alpha: 0.05,
      beta: 0.85,
      gamma: 0.1,
      logLikelihood: 0,
      conditionalVol: returns.map(() => Math.sqrt(sampleVar)),
    };
  }

  const mu = mean(returns);
  const demeaned = returns.map(r => r - mu);

  const sampleVar = demeaned.reduce((s, r) => s + r * r, 0) / demeaned.length;

  // Initial parameters: omega, alpha, beta, gamma
  const x0 = [sampleVar * 0.05, 0.05, 0.85, 0.1];

  const objective = (params: number[]) => gjrGarchNegLogLikelihood(demeaned, params);

  const optimized = nelderMead(objective, x0, {
    maxIterations: 500,
    tolerance: 1e-10,
    initialStep: [sampleVar * 0.01, 0.02, 0.05, 0.03],
  });

  let [omega, alpha, beta, gamma] = optimized;

  // Clamp to valid range
  omega = Math.max(omega, 1e-10);
  alpha = Math.max(alpha, 0);
  beta = Math.max(beta, 0);
  gamma = Math.max(gamma, 0);
  if (alpha + beta + gamma / 2 >= 1) {
    const scale = 0.999 / (alpha + beta + gamma / 2);
    alpha *= scale;
    beta *= scale;
    gamma *= scale;
  }

  const variances = gjrGarchVariances(demeaned, omega, alpha, beta, gamma);
  const negLL = gjrGarchNegLogLikelihood(demeaned, [omega, alpha, beta, gamma]);
  const logLikelihood = -negLL;

  const conditionalVol = variances.map(v => Math.sqrt(v));

  return { omega, alpha, beta, gamma, logLikelihood, conditionalVol };
}
