import type { StrategyPlugin } from '../types';
import type { OHLCVItem } from '../../indicators';
import type { TradeSignal } from '../../backtest';

/**
 * DualThrust breakout strategy.
 *
 * Over the lookback period of N days:
 *   HH = highest high, HC = highest close, LC = lowest close, LL = lowest low
 *   Range = max(HH - LC, HC - LL)
 *
 * For each bar:
 *   Upper = Open + K1 * Range
 *   Lower = Open - K2 * Range
 *
 * Buy when price breaks above Upper.
 * Sell when price falls below Lower.
 */
function computeDualThrust(
  data: OHLCVItem[],
  lookback: number,
  k1: number,
  k2: number,
): TradeSignal[] {
  const signals: TradeSignal[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i < lookback) {
      signals.push({
        date: data[i].date,
        action: 'hold',
        price: data[i].close,
      });
      continue;
    }

    // Calculate range over lookback period (not including current bar)
    let highestHigh = -Infinity;
    let highestClose = -Infinity;
    let lowestClose = Infinity;
    let lowestLow = Infinity;

    for (let j = i - lookback; j < i; j++) {
      if (data[j].high > highestHigh) highestHigh = data[j].high;
      if (data[j].close > highestClose) highestClose = data[j].close;
      if (data[j].close < lowestClose) lowestClose = data[j].close;
      if (data[j].low < lowestLow) lowestLow = data[j].low;
    }

    const range = Math.max(highestHigh - lowestClose, highestClose - lowestLow);
    const upper = data[i].open + k1 * range;
    const lower = data[i].open - k2 * range;

    if (data[i].close > upper) {
      signals.push({
        date: data[i].date,
        action: 'buy',
        price: data[i].close,
        reason: `DualThrust突破上轨（上轨=${upper.toFixed(2)}），买入信号`,
      });
    } else if (data[i].close < lower) {
      signals.push({
        date: data[i].date,
        action: 'sell',
        price: data[i].close,
        reason: `DualThrust跌破下轨（下轨=${lower.toFixed(2)}），卖出信号`,
      });
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

export const dualThrustPlugin: StrategyPlugin = {
  id: 'strategy-dual-thrust',
  name: 'DualThrust突破策略',
  category: 'strategy',
  description: 'DualThrust突破策略：基于N日价格区间计算上下轨，价格突破上轨买入，跌破下轨卖出，适合趋势行情',
  params: [
    {
      key: 'lookback',
      label: '回看周期(N)',
      type: 'number',
      default: 4,
      min: 1,
      max: 20,
      step: 1,
    },
    {
      key: 'k1',
      label: '上轨系数(K1)',
      type: 'number',
      default: 0.5,
      min: 0.1,
      max: 1.5,
      step: 0.1,
    },
    {
      key: 'k2',
      label: '下轨系数(K2)',
      type: 'number',
      default: 0.5,
      min: 0.1,
      max: 1.5,
      step: 0.1,
    },
  ],
  generateSignals(data: OHLCVItem[], params: Record<string, any>): TradeSignal[] {
    const lookback = params.lookback ?? 4;
    const k1 = params.k1 ?? 0.5;
    const k2 = params.k2 ?? 0.5;
    return computeDualThrust(data, lookback, k1, k2);
  },
};
