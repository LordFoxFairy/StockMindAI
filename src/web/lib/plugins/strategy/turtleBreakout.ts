import type { StrategyPlugin } from '../types';
import type { OHLCVItem } from '../../indicators';
import type { TradeSignal } from '../../backtest';

/**
 * Turtle Breakout Strategy (Donchian Channel).
 *
 * Entry:
 *   - Buy when close breaks above the highest high of the past entryPeriod days.
 *   - Sell when close breaks below the lowest low of the past entryPeriod days.
 *
 * Exit:
 *   - Sell long position when close breaks below the lowest low of the past exitPeriod days.
 *   - Cover short (buy) when close breaks above the highest high of the past exitPeriod days.
 *
 * Since we only do long-side trading in this framework, the logic is:
 *   - Buy: close > highest high over entryPeriod (entry channel breakout)
 *   - Sell: close < lowest low over exitPeriod (exit channel breakdown)
 */
function computeTurtleBreakout(
  data: OHLCVItem[],
  entryPeriod: number,
  exitPeriod: number,
): TradeSignal[] {
  const signals: TradeSignal[] = [];
  const minPeriod = Math.max(entryPeriod, exitPeriod);
  let inPosition = false;

  for (let i = 0; i < data.length; i++) {
    if (i < minPeriod) {
      signals.push({
        date: data[i].date,
        action: 'hold',
        price: data[i].close,
      });
      continue;
    }

    // Calculate entry channel: highest high over entryPeriod (excluding current bar)
    let entryHigh = -Infinity;
    for (let j = i - entryPeriod; j < i; j++) {
      if (data[j].high > entryHigh) entryHigh = data[j].high;
    }

    // Calculate exit channel: lowest low over exitPeriod (excluding current bar)
    let exitLow = Infinity;
    for (let j = i - exitPeriod; j < i; j++) {
      if (data[j].low < exitLow) exitLow = data[j].low;
    }

    if (!inPosition && data[i].close > entryHigh) {
      // Entry: breakout above N-day high
      signals.push({
        date: data[i].date,
        action: 'buy',
        price: data[i].close,
        reason: `突破${entryPeriod}日最高价（${entryHigh.toFixed(2)}），海龟买入信号`,
      });
      inPosition = true;
    } else if (inPosition && data[i].close < exitLow) {
      // Exit: breakdown below M-day low
      signals.push({
        date: data[i].date,
        action: 'sell',
        price: data[i].close,
        reason: `跌破${exitPeriod}日最低价（${exitLow.toFixed(2)}），海龟卖出信号`,
      });
      inPosition = false;
    } else {
      signals.push({
        date: data[i].date,
        action: 'hold',
        price: data[i].close,
      });
    }
  }

  return signals;
}

export const turtleBreakoutPlugin: StrategyPlugin = {
  id: 'strategy-turtle-breakout',
  name: '海龟突破策略',
  category: 'strategy',
  description: '海龟突破策略（唐奇安通道）：价格突破N日最高价时买入，跌破M日最低价时卖出，经典趋势跟踪系统',
  params: [
    {
      key: 'entryPeriod',
      label: '入场周期(N)',
      type: 'number',
      default: 20,
      min: 5,
      max: 60,
      step: 1,
    },
    {
      key: 'exitPeriod',
      label: '出场周期(M)',
      type: 'number',
      default: 10,
      min: 3,
      max: 30,
      step: 1,
    },
  ],
  generateSignals(data: OHLCVItem[], params: Record<string, any>): TradeSignal[] {
    const entryPeriod = params.entryPeriod ?? 20;
    const exitPeriod = params.exitPeriod ?? 10;
    return computeTurtleBreakout(data, entryPeriod, exitPeriod);
  },
};
