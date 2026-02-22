/**
 * Overfit Detection: Deflated Sharpe Ratio
 *
 * The Deflated Sharpe Ratio (DSR) adjusts the observed Sharpe ratio for the number
 * of trials (strategies tested), skewness, and kurtosis of returns. It provides a
 * p-value testing whether the observed SR is statistically significant given
 * multiple testing bias.
 *
 * DSR = Phi( (SR - E[max(SR)]) * sqrt(T-1) / sqrt(1 - gamma3*SR + (gamma4-1)/4 * SR^2) )
 *
 * where:
 *   E[max(SR)] ~ sqrt(2*ln(N)) * (1 - gamma/(2*ln(N))) + gamma/sqrt(2*ln(N))
 *   gamma = Euler-Mascheroni constant ~ 0.5772
 *   N = number of trials
 *   T = sample size
 *   gamma3 = skewness
 *   gamma4 = kurtosis (excess + 3, i.e., raw kurtosis)
 *
 * Reference: Bailey & Lopez de Prado (2014) "The Deflated Sharpe Ratio"
 */

// ── Constants ────────────────────────────────────────────────────────────────

const EULER_MASCHERONI = 0.5772156649015329;

// ── Standard Normal CDF ──────────────────────────────────────────────────────

/**
 * Standard normal CDF using Abramowitz & Stegun approximation.
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Inverse standard normal CDF (probit function).
 */
function normalInvCDF(prob: number): number {
  if (prob <= 0) return -Infinity;
  if (prob >= 1) return Infinity;
  if (prob === 0.5) return 0;

  const a = [
    -3.969683028665376e+01,
     2.209460984245205e+02,
    -2.759285104469687e+02,
     1.383577518672690e+02,
    -3.066479806614716e+01,
     2.506628277459239e+00,
  ];
  const b = [
    -5.447609879822406e+01,
     1.615858368580409e+02,
    -1.556989798598866e+02,
     6.680131188771972e+01,
    -1.328068155288572e+01,
  ];
  const c = [
    -7.784894002430293e-03,
    -3.223964580411365e-01,
    -2.400758277161838e+00,
    -2.549732539343734e+00,
     4.374664141464968e+00,
     2.938163982698783e+00,
  ];
  const d = [
     7.784695709041462e-03,
     3.224671290700398e-01,
     2.445134137142996e+00,
     3.754408661907416e+00,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  let q: number;

  if (prob < pLow) {
    q = Math.sqrt(-2 * Math.log(prob));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (prob <= pHigh) {
    q = prob - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
           (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - prob));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
}

// ── Deflated Sharpe Ratio ────────────────────────────────────────────────────

export interface DeflatedSharpeParams {
  /** Observed Sharpe ratio (annualized or not, but be consistent) */
  observedSR: number;
  /** Number of strategy trials/variants tested */
  trials: number;
  /** Skewness of the return series (gamma3) */
  skewness: number;
  /** Kurtosis of the return series (excess kurtosis, gamma4 - 3 convention) */
  kurtosis: number;
  /** Number of return observations (sample size T) */
  sampleSize: number;
}

export interface DeflatedSharpeResult {
  /** Deflated Sharpe Ratio (probability that observed SR is genuine) */
  dsr: number;
  /** P-value: probability that the observed SR is due to chance */
  pValue: number;
  /** Whether the result is statistically significant at 5% level */
  isSignificant: boolean;
}

/**
 * Compute the expected maximum Sharpe ratio under the null hypothesis
 * of zero true Sharpe, given N independent trials.
 *
 * E[max(SR)] ~ sqrt(2*ln(N)) * (1 - gamma/(2*ln(N))) + gamma/sqrt(2*ln(N))
 *
 * where gamma is the Euler-Mascheroni constant.
 *
 * @param trials Number of strategy trials
 * @returns Expected maximum Sharpe ratio under the null
 */
function expectedMaxSR(trials: number): number {
  if (trials <= 1) return 0;

  const lnN = Math.log(trials);
  const sqrtLnN = Math.sqrt(2 * lnN);

  // E[max(SR)] from extreme value theory (Gumbel distribution)
  const eMaxSR = sqrtLnN * (1 - EULER_MASCHERONI / (2 * lnN)) +
                 EULER_MASCHERONI / sqrtLnN;

  return eMaxSR;
}

/**
 * Compute the Deflated Sharpe Ratio.
 *
 * The DSR tests whether the observed Sharpe ratio is statistically significant
 * after accounting for:
 * - The number of trials (multiple testing adjustment)
 * - Non-normality of returns (skewness and kurtosis)
 * - Sample size
 *
 * DSR = Phi( (SR_obs - E[max(SR)]) * sqrt(T-1) / sqrt(1 - skew*SR + (kurt-1)/4 * SR^2) )
 *
 * Note: The kurtosis parameter uses the excess kurtosis convention (normal = 0).
 * Internally, we need raw kurtosis (gamma4) = excessKurtosis + 3.
 *
 * @param params Deflated Sharpe parameters
 * @returns DSR result with p-value and significance flag
 */
export function deflatedSharpeRatio(params: DeflatedSharpeParams): DeflatedSharpeResult {
  const { observedSR, trials, skewness, kurtosis, sampleSize } = params;

  if (sampleSize <= 1 || trials <= 0) {
    return { dsr: 0, pValue: 1, isSignificant: false };
  }

  // Expected maximum SR under the null of N trials
  const eMaxSR = expectedMaxSR(trials);

  // Raw kurtosis (gamma4) from excess kurtosis
  const rawKurtosis = kurtosis + 3;

  // Variance of the SR estimator, adjusted for non-normality:
  // Var(SR) = (1 - skew*SR + (gamma4-1)/4 * SR^2) / (T - 1)
  const sr2 = observedSR * observedSR;
  const varNumerator = 1 - skewness * observedSR + ((rawKurtosis - 1) / 4) * sr2;

  // Ensure variance is positive
  const variance = Math.max(varNumerator, 1e-10) / (sampleSize - 1);
  const stdSR = Math.sqrt(variance);

  // Test statistic: z = (SR_obs - E[max(SR)]) / std(SR)
  const zScore = stdSR > 0 ? (observedSR - eMaxSR) / stdSR : 0;

  // DSR = Phi(z) = probability that the observed SR is genuine
  const dsr = normalCDF(zScore);

  // p-value = 1 - DSR (probability that the observed SR is due to chance)
  const pValue = 1 - dsr;

  return {
    dsr,
    pValue,
    isSignificant: pValue < 0.05,
  };
}

// ── Minimum Backtest Length ──────────────────────────────────────────────────

/**
 * Compute the minimum backtest length (number of observations) required for
 * the observed Sharpe ratio to be statistically significant.
 *
 * Derived from the DSR formula by solving for T such that the z-score
 * equals the critical value at the desired confidence level.
 *
 * From the SR variance formula:
 *   T_min = 1 + (z_alpha / SR)^2 * (1 - skew*SR + (kurt-1)/4 * SR^2)
 *
 * where z_alpha is the critical value for the given confidence level.
 *
 * @param targetSR Target annualized Sharpe ratio to validate
 * @param skew Skewness of the return distribution
 * @param kurt Excess kurtosis of the return distribution
 * @param confidence Confidence level (default 0.95)
 * @returns Minimum number of return observations needed
 */
export function minimumBacktestLength(
  targetSR: number,
  skew: number,
  kurt: number,
  confidence = 0.95,
): number {
  if (targetSR <= 0) return Infinity;

  // Critical z-value for the desired confidence
  const zAlpha = normalInvCDF(confidence);

  // Raw kurtosis
  const rawKurt = kurt + 3;

  // Non-normality adjustment
  const nonNormalAdj = 1 - skew * targetSR + ((rawKurt - 1) / 4) * targetSR * targetSR;

  // Minimum backtest length
  const minT = 1 + (zAlpha / targetSR) ** 2 * Math.max(nonNormalAdj, 1e-10);

  return Math.ceil(minT);
}

// ── Probability of Backtest Overfitting (PBO) ────────────────────────────────

/**
 * Estimate the Probability of Backtest Overfitting using a simplified approach.
 *
 * PBO is the probability that the best in-sample strategy will underperform
 * the median out-of-sample. This is estimated by counting the fraction of
 * combinatorial train/test splits where the best IS strategy has negative OOS rank.
 *
 * @param inSampleSharpes Array of in-sample Sharpe ratios for each strategy variant
 * @param outOfSampleSharpes Corresponding out-of-sample Sharpe ratios
 * @returns Probability of backtest overfitting [0, 1]
 */
export function probabilityOfOverfitting(
  inSampleSharpes: number[],
  outOfSampleSharpes: number[],
): number {
  const n = inSampleSharpes.length;
  if (n < 2 || outOfSampleSharpes.length !== n) return 0;

  // Find the index of the best in-sample strategy
  let bestISIdx = 0;
  for (let i = 1; i < n; i++) {
    if (inSampleSharpes[i] > inSampleSharpes[bestISIdx]) {
      bestISIdx = i;
    }
  }

  // Compute the rank of the best IS strategy in OOS
  const bestOOS = outOfSampleSharpes[bestISIdx];

  // Compute median of OOS Sharpes
  const sortedOOS = [...outOfSampleSharpes].sort((a, b) => a - b);
  const medianIdx = Math.floor(sortedOOS.length / 2);
  const medianOOS = sortedOOS.length % 2 === 0
    ? (sortedOOS[medianIdx - 1] + sortedOOS[medianIdx]) / 2
    : sortedOOS[medianIdx];

  // PBO: fraction of strategies where the best IS underperforms the OOS median
  // In a single comparison, it's binary: 0 or 1
  // For a more robust estimate, compute the relative rank
  let rankBelow = 0;
  for (let i = 0; i < n; i++) {
    if (outOfSampleSharpes[i] > bestOOS) {
      rankBelow++;
    }
  }

  // PBO = rank position of best-IS strategy in OOS (0 = best, 1 = worst)
  const pbo = rankBelow / (n - 1);

  return pbo;
}
