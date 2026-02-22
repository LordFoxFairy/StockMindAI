/**
 * Strategy Ensemble Methods
 *
 * Combines signals from multiple strategies to produce a single set of
 * trading signals. Supports:
 *
 * 1. Majority Voting Ensemble: Each strategy gets one vote, buy if
 *    buyVotes/total >= threshold
 *
 * 2. Weighted Ensemble: Each strategy contributes a weighted score,
 *    signals are generated based on normalized weighted thresholds
 */

import type { TradeSignal } from './backtest';

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface StrategyVoter {
  name: string;
  signals: TradeSignal[];
  weight?: number;
}

// ── Voting Ensemble ──────────────────────────────────────────────────────────

/**
 * Majority voting ensemble: each strategy casts one vote per bar.
 *
 * For each date, count the buy votes and sell votes across all voters.
 * - If buyVotes / total >= threshold -> buy
 * - If sellVotes / total >= threshold -> sell
 * - Otherwise -> hold
 *
 * All voter signal arrays must be aligned by date.
 *
 * @param voters Array of strategy voters with their signal arrays
 * @param threshold Fraction of votes needed to trigger a signal (e.g. 0.5 for majority)
 * @returns Merged signal array
 */
export function votingEnsemble(
  voters: StrategyVoter[],
  threshold: number,
): TradeSignal[] {
  if (voters.length === 0) return [];

  // All signal arrays should have the same length
  const signalLength = voters[0].signals.length;
  const result: TradeSignal[] = [];
  const total = voters.length;

  for (let i = 0; i < signalLength; i++) {
    let buyVotes = 0;
    let sellVotes = 0;
    let date = '';
    let price = 0;
    const reasons: string[] = [];

    for (const voter of voters) {
      if (i >= voter.signals.length) continue;
      const signal = voter.signals[i];

      if (!date) {
        date = signal.date;
        price = signal.price;
      }

      if (signal.action === 'buy') {
        buyVotes++;
        if (signal.reason) {
          reasons.push(`[${voter.name}] ${signal.reason}`);
        }
      } else if (signal.action === 'sell') {
        sellVotes++;
        if (signal.reason) {
          reasons.push(`[${voter.name}] ${signal.reason}`);
        }
      }
    }

    const buyFraction = buyVotes / total;
    const sellFraction = sellVotes / total;

    if (buyFraction >= threshold) {
      result.push({
        date,
        action: 'buy',
        price,
        reason: `投票买入 (${buyVotes}/${total} >= ${(threshold * 100).toFixed(0)}%): ${reasons.join('; ')}`,
      });
    } else if (sellFraction >= threshold) {
      result.push({
        date,
        action: 'sell',
        price,
        reason: `投票卖出 (${sellVotes}/${total} >= ${(threshold * 100).toFixed(0)}%): ${reasons.join('; ')}`,
      });
    } else {
      result.push({
        date,
        action: 'hold',
        price,
      });
    }
  }

  return result;
}

// ── Weighted Ensemble ────────────────────────────────────────────────────────

/**
 * Weighted ensemble: each strategy contributes a weighted score.
 *
 * For each date, compute a weighted score:
 *   score = sum(w_i * signal_i) / sum(w_i)
 * where signal_i is +1 for buy, -1 for sell, 0 for hold.
 *
 * - If normalizedScore >= buyThreshold -> buy
 * - If normalizedScore <= -sellThreshold -> sell
 * - Otherwise -> hold
 *
 * Weights default to 1.0 if not specified. All weights are normalized
 * to sum to 1.
 *
 * @param voters Array of strategy voters with optional weights
 * @param buyThreshold Normalized score threshold to trigger buy (e.g. 0.3)
 * @param sellThreshold Normalized score threshold to trigger sell (e.g. 0.3)
 * @returns Merged signal array
 */
export function weightedEnsemble(
  voters: StrategyVoter[],
  buyThreshold: number,
  sellThreshold: number,
): TradeSignal[] {
  if (voters.length === 0) return [];

  // Compute total weight for normalization
  let totalWeight = 0;
  for (const voter of voters) {
    totalWeight += voter.weight ?? 1.0;
  }
  if (totalWeight <= 0) totalWeight = 1;

  const signalLength = voters[0].signals.length;
  const result: TradeSignal[] = [];

  for (let i = 0; i < signalLength; i++) {
    let weightedScore = 0;
    let date = '';
    let price = 0;
    const reasons: string[] = [];

    for (const voter of voters) {
      if (i >= voter.signals.length) continue;
      const signal = voter.signals[i];
      const weight = (voter.weight ?? 1.0) / totalWeight;

      if (!date) {
        date = signal.date;
        price = signal.price;
      }

      if (signal.action === 'buy') {
        weightedScore += weight;
        if (signal.reason) {
          reasons.push(`[${voter.name} w=${(weight * totalWeight).toFixed(2)}] ${signal.reason}`);
        }
      } else if (signal.action === 'sell') {
        weightedScore -= weight;
        if (signal.reason) {
          reasons.push(`[${voter.name} w=${(weight * totalWeight).toFixed(2)}] ${signal.reason}`);
        }
      }
    }

    if (weightedScore >= buyThreshold) {
      result.push({
        date,
        action: 'buy',
        price,
        reason: `加权买入 (score=${weightedScore.toFixed(3)} >= ${buyThreshold}): ${reasons.join('; ')}`,
      });
    } else if (weightedScore <= -sellThreshold) {
      result.push({
        date,
        action: 'sell',
        price,
        reason: `加权卖出 (score=${weightedScore.toFixed(3)} <= -${sellThreshold}): ${reasons.join('; ')}`,
      });
    } else {
      result.push({
        date,
        action: 'hold',
        price,
      });
    }
  }

  return result;
}
