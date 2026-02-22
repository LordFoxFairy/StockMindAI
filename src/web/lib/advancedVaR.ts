/**
 * Advanced Value-at-Risk (VaR) models:
 *
 * 1. Cornish-Fisher VaR: Adjusts the normal quantile for skewness and kurtosis
 *    z_CF = z + (z^2 - 1)*S/6 + (z^3 - 3z)*K/24 - (2z^3 - 5z)*S^2/36
 *
 * 2. GARCH-VaR: Uses GARCH(1,1) conditional volatility for time-varying VaR
 *    VaR_t = mu - z_alpha * sigma_t
 */

import { mean, stdDev } from './risk';
import { garchFit } from './volatility';

// ── Normal CDF (Abramowitz & Stegun approximation) ───────────────────────────

/**
 * Standard normal CDF using the rational approximation.
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
 * Inverse standard normal CDF (probit function) using rational approximation.
 * Beasley-Springer-Moro algorithm.
 */
function normalInvCDF(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;

  // Rational approximation for central region
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
  let r: number;

  if (p < pLow) {
    // Rational approx for lower region
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= pHigh) {
    // Rational approx for central region
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
           (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    // Rational approx for upper region
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
}

// ── Cornish-Fisher VaR ───────────────────────────────────────────────────────

export interface CornishFisherResult {
  var: number;
  adjustedZ: number;
}

/**
 * Compute skewness of a return series.
 */
function skewness(returns: number[]): number {
  const n = returns.length;
  if (n < 3) return 0;
  const m = mean(returns);
  const s = stdDev(returns);
  if (s === 0) return 0;

  let m3 = 0;
  for (let i = 0; i < n; i++) {
    m3 += ((returns[i] - m) / s) ** 3;
  }
  return m3 / n;
}

/**
 * Compute excess kurtosis of a return series.
 */
function excessKurtosis(returns: number[]): number {
  const n = returns.length;
  if (n < 4) return 0;
  const m = mean(returns);
  const s = stdDev(returns);
  if (s === 0) return 0;

  let m4 = 0;
  for (let i = 0; i < n; i++) {
    m4 += ((returns[i] - m) / s) ** 4;
  }
  return m4 / n - 3;
}

/**
 * Cornish-Fisher VaR: adjusts the normal quantile for skewness and kurtosis.
 *
 * z_CF = z + (z^2 - 1)*S/6 + (z^3 - 3z)*K/24 - (2z^3 - 5z)*S^2/36
 *
 * @param returns Array of returns
 * @param confidence Confidence level (e.g. 0.95 or 0.99)
 * @returns VaR (negative number indicating loss) and adjusted z-score
 */
export function cornishFisherVaR(
  returns: number[],
  confidence: number,
): CornishFisherResult {
  if (returns.length < 4) {
    const m = mean(returns);
    const s = stdDev(returns);
    const z = normalInvCDF(1 - confidence);
    return { var: m + z * s, adjustedZ: z };
  }

  const m = mean(returns);
  const s = stdDev(returns);
  const S = skewness(returns);
  const K = excessKurtosis(returns);

  // z is the normal quantile for the left tail (negative)
  const z = normalInvCDF(1 - confidence); // e.g., for 95%: z ~ -1.645

  // Cornish-Fisher expansion
  const z2 = z * z;
  const z3 = z2 * z;
  const zCF = z
    + (z2 - 1) * S / 6
    + (z3 - 3 * z) * K / 24
    - (2 * z3 - 5 * z) * S * S / 36;

  const varValue = m + zCF * s;

  return { var: varValue, adjustedZ: zCF };
}

// ── GARCH-VaR ────────────────────────────────────────────────────────────────

export interface GarchVaRResult {
  var: number;
  currentVol: number;
}

/**
 * GARCH-VaR: Uses GARCH(1,1) conditional volatility for time-varying VaR.
 * VaR_t = mu - z_alpha * sigma_t
 *
 * @param returns Array of returns
 * @param confidence Confidence level (e.g. 0.95)
 * @returns VaR at current time step and the current conditional volatility
 */
export function garchVaR(
  returns: number[],
  confidence: number,
): GarchVaRResult {
  if (returns.length < 10) {
    const m = mean(returns);
    const s = stdDev(returns);
    const z = normalInvCDF(confidence); // positive z for right tail
    return { var: m - z * s, currentVol: s };
  }

  const garch = garchFit(returns);
  const mu = mean(returns);
  const currentVol = garch.conditionalVol[garch.conditionalVol.length - 1];

  // z_alpha is the positive quantile (e.g., 1.645 for 95%)
  const zAlpha = normalInvCDF(confidence);

  const varValue = mu - zAlpha * currentVol;

  return { var: varValue, currentVol };
}
