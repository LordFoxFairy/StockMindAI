/**
 * Position Sizing Algorithms
 *
 * - Fixed Fractional: Risk a fixed percentage of capital per trade
 * - Kelly Criterion: f* = (bp - q) / b, use half-Kelly by default
 * - ATR-based: Size = Capital * riskPercent / (atrMultiplier * ATR)
 */

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface PositionSizeResult {
  shares: number;
  positionValue: number;
  riskAmount: number;
}

export interface PositionSizerParams {
  capital: number;
  price: number;
  atr?: number;
  winRate?: number;
  avgWin?: number;
  avgLoss?: number;
  stopLossPercent?: number;
}

// ── Fixed Fractional Position Sizing ─────────────────────────────────────────

/**
 * Fixed fractional position sizing: risk a fixed percentage of capital per trade.
 *
 * Risk amount = capital * riskPercent
 * Per-share risk = price * stopLossPercent (default 5%)
 * Shares = floor(riskAmount / perShareRisk)
 *
 * @param params Position sizing parameters (requires capital, price, stopLossPercent)
 * @param riskPercent Fraction of capital to risk per trade (e.g. 0.02 for 2%)
 * @returns Position size result
 */
export function fixedFractionalSize(
  params: PositionSizerParams,
  riskPercent: number,
): PositionSizeResult {
  const { capital, price } = params;
  const stopLossPercent = params.stopLossPercent ?? 0.05;

  if (capital <= 0 || price <= 0 || riskPercent <= 0 || stopLossPercent <= 0) {
    return { shares: 0, positionValue: 0, riskAmount: 0 };
  }

  const riskAmount = capital * riskPercent;
  const perShareRisk = price * stopLossPercent;
  const shares = Math.floor(riskAmount / perShareRisk);

  // Ensure we don't exceed available capital
  const maxShares = Math.floor(capital / price);
  const finalShares = Math.min(shares, maxShares);

  return {
    shares: finalShares,
    positionValue: finalShares * price,
    riskAmount: finalShares * perShareRisk,
  };
}

// ── Kelly Criterion Position Sizing ──────────────────────────────────────────

/**
 * Kelly Criterion position sizing.
 *
 * Full Kelly: f* = (b*p - q) / b
 * where:
 *   p = probability of winning (winRate)
 *   q = probability of losing = 1 - p
 *   b = ratio of average win to average loss (win/loss ratio)
 *
 * Half-Kelly is used by default (fraction = 0.5) to reduce volatility.
 *
 * @param params Position sizing parameters (requires capital, price, winRate, avgWin, avgLoss)
 * @param fraction Kelly fraction to use (default 0.5 for half-Kelly)
 * @returns Position size result
 */
export function kellySize(
  params: PositionSizerParams,
  fraction = 0.5,
): PositionSizeResult {
  const { capital, price, winRate, avgWin, avgLoss } = params;

  if (
    capital <= 0 || price <= 0 ||
    winRate === undefined || avgWin === undefined || avgLoss === undefined ||
    winRate <= 0 || winRate >= 1 ||
    avgWin <= 0 || avgLoss >= 0
  ) {
    return { shares: 0, positionValue: 0, riskAmount: 0 };
  }

  const p = winRate;
  const q = 1 - p;
  const b = avgWin / Math.abs(avgLoss); // win/loss ratio (positive number)

  // Kelly fraction: f* = (b*p - q) / b
  const fullKelly = (b * p - q) / b;

  // If Kelly fraction is negative or zero, don't trade
  if (fullKelly <= 0) {
    return { shares: 0, positionValue: 0, riskAmount: 0 };
  }

  // Apply fractional Kelly
  const kellyFraction = fullKelly * fraction;

  // Position value = capital * kellyFraction
  const positionValue = capital * kellyFraction;
  const shares = Math.floor(positionValue / price);

  // Ensure we don't exceed available capital
  const maxShares = Math.floor(capital / price);
  const finalShares = Math.min(shares, maxShares);

  // Risk amount: estimated expected loss based on Kelly fraction
  const riskAmount = finalShares * price * Math.abs(avgLoss);

  return {
    shares: finalShares,
    positionValue: finalShares * price,
    riskAmount,
  };
}

// ── ATR-Based Position Sizing ────────────────────────────────────────────────

/**
 * ATR-based position sizing.
 *
 * Size = Capital * riskPercent / (atrMultiplier * ATR)
 *
 * Uses Average True Range as a volatility-adjusted stop distance.
 *
 * @param params Position sizing parameters (requires capital, price, atr)
 * @param riskPercent Fraction of capital to risk per trade
 * @param atrMultiplier Multiplier for ATR to determine stop distance (default 2)
 * @returns Position size result
 */
export function atrSize(
  params: PositionSizerParams,
  riskPercent: number,
  atrMultiplier = 2,
): PositionSizeResult {
  const { capital, price, atr } = params;

  if (
    capital <= 0 || price <= 0 || riskPercent <= 0 ||
    atr === undefined || atr <= 0 || atrMultiplier <= 0
  ) {
    return { shares: 0, positionValue: 0, riskAmount: 0 };
  }

  const riskAmount = capital * riskPercent;
  const stopDistance = atrMultiplier * atr;
  const shares = Math.floor(riskAmount / stopDistance);

  // Ensure we don't exceed available capital
  const maxShares = Math.floor(capital / price);
  const finalShares = Math.min(shares, maxShares);

  return {
    shares: finalShares,
    positionValue: finalShares * price,
    riskAmount: finalShares * stopDistance,
  };
}
