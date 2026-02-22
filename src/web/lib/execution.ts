/**
 * A-Share Execution Model
 *
 * Models the unique execution constraints of the Chinese A-share market:
 *
 * 1. Price Limit Rules:
 *    - Main board (SSE/SZSE): +/-10% daily limit
 *    - STAR Market (688xxx) and ChiNext (300xxx): +/-20% daily limit
 *
 * 2. T+1 Settlement:
 *    - Shares bought today cannot be sold until the next trading day
 *
 * 3. Execution uses next bar open price with optional slippage
 */

import type { OHLCVItem } from './indicators';

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface ExecutionResult {
  canExecute: boolean;
  executionPrice: number;
  reason?: string;
}

// ── Helper: Determine limit percentage by stock code ─────────────────────────

/**
 * Determines the price limit percentage based on stock code embedded in the date
 * or bar context. For simplicity, we use the change percentage thresholds:
 *   - STAR Market (688xxx) and ChiNext (300xxx): 20%
 *   - Main board: 10%
 *
 * Since OHLCVItem does not include a stock code, the caller should determine
 * the board type. We provide a helper that checks the actual price change.
 *
 * @param limitPercent The board-specific limit (0.10 or 0.20)
 */
function getLimitPercent(bar: OHLCVItem, prevBar: OHLCVItem): number {
  // Heuristic: if the actual change approaches 20%, it's likely STAR/ChiNext
  // Otherwise default to 10%
  const change = Math.abs((bar.close - prevBar.close) / prevBar.close);
  // If the stock has moved more than ~10.5%, it must be on a 20% limit board
  if (change > 0.105) {
    return 0.20;
  }
  return 0.10;
}

/**
 * Detect limit-up/down with an explicit limit percentage.
 */
const MAIN_BOARD_LIMIT = 0.10;
const STAR_CHINEXT_LIMIT = 0.20;

// ── Limit Up Detection ───────────────────────────────────────────────────────

/**
 * Check if a bar is at the daily price limit up.
 *
 * For main board: close >= prevClose * 1.0995 (rounded to 9.95% to account for tick size)
 * For STAR/ChiNext: close >= prevClose * 1.1995 (rounded to 19.95%)
 *
 * We check both thresholds: if it exceeds 19.95% of previous close, it's limit-up
 * on the 20% board. If it exceeds 9.95%, it's limit-up on the 10% board.
 *
 * @param bar Current bar
 * @param prevBar Previous bar
 * @returns true if the stock is at limit up
 */
export function checkLimitUp(bar: OHLCVItem, prevBar: OHLCVItem): boolean {
  const changePercent = (bar.close - prevBar.close) / prevBar.close;
  const limitPercent = getLimitPercent(bar, prevBar);

  // Check if at limit up: change >= (limit - 0.05%) to account for rounding
  // Main board: >= 9.95%, STAR/ChiNext: >= 19.95%
  const threshold = limitPercent - 0.0005;
  return changePercent >= threshold;
}

// ── Limit Down Detection ─────────────────────────────────────────────────────

/**
 * Check if a bar is at the daily price limit down.
 *
 * For main board: close <= prevClose * 0.9005 (down 9.95%)
 * For STAR/ChiNext: close <= prevClose * 0.8005 (down 19.95%)
 *
 * @param bar Current bar
 * @param prevBar Previous bar
 * @returns true if the stock is at limit down
 */
export function checkLimitDown(bar: OHLCVItem, prevBar: OHLCVItem): boolean {
  const changePercent = (bar.close - prevBar.close) / prevBar.close;
  const limitPercent = getLimitPercent(bar, prevBar);

  // Check if at limit down: change <= -(limit - 0.05%)
  const threshold = -(limitPercent - 0.0005);
  return changePercent <= threshold;
}

// ── Buy Execution Check ──────────────────────────────────────────────────────

/**
 * Check if a buy order can be executed on the current bar.
 *
 * In A-shares, when a stock hits the daily limit up, buy orders are typically
 * queued and may not execute because all sellers have withdrawn. The stock
 * is "locked" at limit up with no sell orders.
 *
 * @param bar Current bar
 * @param prevBar Previous bar
 * @returns ExecutionResult indicating if buy can execute
 */
export function canExecuteBuy(bar: OHLCVItem, prevBar: OHLCVItem): ExecutionResult {
  if (checkLimitUp(bar, prevBar)) {
    return {
      canExecute: false,
      executionPrice: 0,
      reason: '涨停板封死，无法买入 (Limit up - cannot buy)',
    };
  }

  return {
    canExecute: true,
    executionPrice: bar.close,
  };
}

// ── Sell Execution Check ─────────────────────────────────────────────────────

/**
 * Check if a sell order can be executed on the current bar.
 *
 * Enforces:
 * 1. T+1 rule: Cannot sell on the same day as purchase (entryBarIndex must be < currentBarIndex)
 * 2. Limit down: When at limit down, sell orders are queued and may not execute
 *
 * @param bar Current bar
 * @param prevBar Previous bar
 * @param entryBarIndex Index of the bar when the position was entered
 * @param currentBarIndex Index of the current bar
 * @returns ExecutionResult indicating if sell can execute
 */
export function canExecuteSell(
  bar: OHLCVItem,
  prevBar: OHLCVItem,
  entryBarIndex: number,
  currentBarIndex: number,
): ExecutionResult {
  // T+1 rule: must hold for at least one trading day
  if (currentBarIndex <= entryBarIndex) {
    return {
      canExecute: false,
      executionPrice: 0,
      reason: 'T+1规则限制，当日买入不可卖出 (T+1 rule - cannot sell same day)',
    };
  }

  // Limit down check
  if (checkLimitDown(bar, prevBar)) {
    return {
      canExecute: false,
      executionPrice: 0,
      reason: '跌停板封死，无法卖出 (Limit down - cannot sell)',
    };
  }

  return {
    canExecute: true,
    executionPrice: bar.close,
  };
}

// ── Next Bar Execution Price ─────────────────────────────────────────────────

/**
 * Get the execution price using next bar's open price with slippage.
 *
 * In realistic backtesting, orders placed at bar t are executed at bar t+1's open
 * with some slippage to account for market impact.
 *
 * @param nextBar The next bar (t+1) after the signal
 * @param action 'buy' or 'sell'
 * @param slippage Slippage as a fraction of price (default 0.001 = 0.1%)
 * @returns Execution price adjusted for slippage
 */
export function getNextBarExecutionPrice(
  nextBar: OHLCVItem,
  action: 'buy' | 'sell',
  slippage = 0.001,
): number {
  const openPrice = nextBar.open;

  if (action === 'buy') {
    // When buying, slippage works against us (pay more)
    return openPrice * (1 + slippage);
  } else {
    // When selling, slippage works against us (receive less)
    return openPrice * (1 - slippage);
  }
}
