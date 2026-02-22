/**
 * Walk-Forward Analysis
 *
 * Walk-forward analysis is a robust method for evaluating trading strategies
 * by repeatedly training on in-sample data and testing on out-of-sample data,
 * rolling forward through time.
 *
 * This module provides:
 * 1. Split generation: creates train/test window pairs
 * 2. Result aggregation: computes overfit ratio and average performance metrics
 */

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface WalkForwardSplit {
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
}

export interface WalkForwardSplitResult {
  inSampleSharpe: number;
  outOfSampleSharpe: number;
  bestParams: Record<string, number>;
}

export interface WalkForwardResult {
  splits: WalkForwardSplitResult[];
  avgInSampleSharpe: number;
  avgOutOfSampleSharpe: number;
  overfitRatio: number;
}

// ── Walk-Forward Split Generation ────────────────────────────────────────────

/**
 * Generate train/test splits for walk-forward analysis.
 *
 * Creates a series of rolling windows where each window has:
 * - A training period of `trainSize` bars
 * - A test period of `testSize` bars immediately following the training period
 * - Each subsequent window is shifted forward by `step` bars
 *
 * Example with dataLength=100, trainSize=60, testSize=20, step=10:
 *   Split 0: train [0, 59], test [60, 79]
 *   Split 1: train [10, 69], test [70, 89]
 *   Split 2: train [20, 79], test [80, 99]
 *
 * @param dataLength Total number of data points
 * @param trainSize Number of bars in training window
 * @param testSize Number of bars in test window
 * @param step Number of bars to shift forward between windows
 * @returns Array of train/test split configurations
 */
export function walkForwardSplits(
  dataLength: number,
  trainSize: number,
  testSize: number,
  step: number,
): WalkForwardSplit[] {
  if (dataLength <= 0 || trainSize <= 0 || testSize <= 0 || step <= 0) {
    return [];
  }

  if (trainSize + testSize > dataLength) {
    return [];
  }

  const splits: WalkForwardSplit[] = [];
  let trainStart = 0;

  while (true) {
    const trainEnd = trainStart + trainSize - 1;
    const testStart = trainEnd + 1;
    const testEnd = testStart + testSize - 1;

    // Ensure test window does not exceed data length
    if (testEnd >= dataLength) break;

    splits.push({ trainStart, trainEnd, testStart, testEnd });
    trainStart += step;
  }

  return splits;
}

// ── Walk-Forward Result Aggregation ──────────────────────────────────────────

/**
 * Aggregate walk-forward results and compute the overfit ratio.
 *
 * The overfit ratio is defined as:
 *   overfitRatio = 1 - (avgOutOfSampleSharpe / avgInSampleSharpe)
 *
 * An overfitRatio close to 0 means out-of-sample performance matches
 * in-sample performance (low overfit). A ratio close to 1 or above 1
 * indicates significant overfitting.
 *
 * @param splitResults Array of results from each walk-forward split
 * @returns Aggregated walk-forward result with overfit ratio
 */
export function aggregateWalkForward(
  splitResults: WalkForwardSplitResult[],
): WalkForwardResult {
  if (splitResults.length === 0) {
    return {
      splits: [],
      avgInSampleSharpe: 0,
      avgOutOfSampleSharpe: 0,
      overfitRatio: 0,
    };
  }

  let sumIS = 0;
  let sumOOS = 0;

  for (const split of splitResults) {
    sumIS += split.inSampleSharpe;
    sumOOS += split.outOfSampleSharpe;
  }

  const avgInSampleSharpe = sumIS / splitResults.length;
  const avgOutOfSampleSharpe = sumOOS / splitResults.length;

  // Overfit ratio: how much performance degrades from IS to OOS
  // Avoid division by zero
  let overfitRatio: number;
  if (Math.abs(avgInSampleSharpe) < 1e-10) {
    overfitRatio = avgOutOfSampleSharpe < 0 ? 1 : 0;
  } else {
    overfitRatio = 1 - (avgOutOfSampleSharpe / avgInSampleSharpe);
  }

  // Clamp to reasonable range [0, +inf)
  overfitRatio = Math.max(0, overfitRatio);

  return {
    splits: splitResults,
    avgInSampleSharpe,
    avgOutOfSampleSharpe,
    overfitRatio,
  };
}

// ── Expanding Window Variant ─────────────────────────────────────────────────

/**
 * Generate expanding window splits for walk-forward analysis.
 *
 * Unlike rolling windows, the training window expands from a fixed start point.
 * Each subsequent window includes all prior data plus additional bars.
 *
 * @param dataLength Total number of data points
 * @param minTrainSize Minimum number of bars in initial training window
 * @param testSize Number of bars in test window
 * @param step Number of bars to expand the training window each iteration
 * @returns Array of train/test split configurations
 */
export function expandingWindowSplits(
  dataLength: number,
  minTrainSize: number,
  testSize: number,
  step: number,
): WalkForwardSplit[] {
  if (dataLength <= 0 || minTrainSize <= 0 || testSize <= 0 || step <= 0) {
    return [];
  }

  if (minTrainSize + testSize > dataLength) {
    return [];
  }

  const splits: WalkForwardSplit[] = [];
  let trainEnd = minTrainSize - 1;

  while (true) {
    const testStart = trainEnd + 1;
    const testEnd = testStart + testSize - 1;

    if (testEnd >= dataLength) break;

    splits.push({
      trainStart: 0,
      trainEnd,
      testStart,
      testEnd,
    });

    trainEnd += step;
  }

  return splits;
}

// ── Combinatorial Purged Cross-Validation Split Generation ───────────────────

/**
 * Generate purged k-fold cross-validation splits.
 *
 * Standard k-fold CV can lead to data leakage in time series. Purging removes
 * a buffer of `purgeSize` bars between training and test sets to prevent leakage.
 *
 * @param dataLength Total number of data points
 * @param nFolds Number of folds
 * @param purgeSize Number of bars to purge between train and test (default 0)
 * @returns Array of train/test split configurations (using indices into the data)
 */
export function purgedKFoldSplits(
  dataLength: number,
  nFolds: number,
  purgeSize = 0,
): Array<{ trainIndices: number[]; testIndices: number[] }> {
  if (dataLength <= 0 || nFolds <= 1) return [];

  const foldSize = Math.floor(dataLength / nFolds);
  const results: Array<{ trainIndices: number[]; testIndices: number[] }> = [];

  for (let fold = 0; fold < nFolds; fold++) {
    const testStart = fold * foldSize;
    const testEnd = fold === nFolds - 1 ? dataLength - 1 : (fold + 1) * foldSize - 1;

    const testIndices: number[] = [];
    for (let i = testStart; i <= testEnd; i++) {
      testIndices.push(i);
    }

    // Training indices: everything outside [testStart - purgeSize, testEnd + purgeSize]
    const purgedStart = Math.max(0, testStart - purgeSize);
    const purgedEnd = Math.min(dataLength - 1, testEnd + purgeSize);

    const trainIndices: number[] = [];
    for (let i = 0; i < dataLength; i++) {
      if (i < purgedStart || i > purgedEnd) {
        trainIndices.push(i);
      }
    }

    results.push({ trainIndices, testIndices });
  }

  return results;
}
