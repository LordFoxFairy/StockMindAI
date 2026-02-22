import type { StrategyPlugin } from '../types';
import type { OHLCVItem } from '../../indicators';
import type { TradeSignal } from '../../backtest';
import { rsi } from '../../indicators';
import { rsiToSignals } from '../../backtest';

export const rsiStrategyPlugin: StrategyPlugin = {
  id: 'strategy-rsi',
  name: 'RSI策略',
  category: 'strategy',
  description: 'RSI超买超卖策略：RSI从超卖区上穿买入，从超买区下穿卖出',
  params: [
    {
      key: 'period',
      label: 'RSI周期',
      type: 'number',
      default: 14,
      min: 2,
      max: 50,
      step: 1,
    },
    {
      key: 'oversold',
      label: '超卖阈值',
      type: 'number',
      default: 30,
      min: 5,
      max: 45,
      step: 5,
    },
    {
      key: 'overbought',
      label: '超买阈值',
      type: 'number',
      default: 70,
      min: 55,
      max: 95,
      step: 5,
    },
  ],
  generateSignals(data: OHLCVItem[], params: Record<string, any>): TradeSignal[] {
    const period = params.period ?? 14;
    const oversold = params.oversold ?? 30;
    const overbought = params.overbought ?? 70;
    const closes = data.map((d) => d.close);
    const rsiData = rsi(closes, period);
    return rsiToSignals(rsiData, data, oversold, overbought);
  },
};
