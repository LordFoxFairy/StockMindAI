import type { StrategyPlugin } from '../types';
import type { OHLCVItem } from '../../indicators';
import type { TradeSignal } from '../../backtest';
import { macd } from '../../indicators';
import { macdToSignals } from '../../backtest';

export const macdStrategyPlugin: StrategyPlugin = {
  id: 'strategy-macd',
  name: 'MACD策略',
  category: 'strategy',
  description: 'MACD金叉死叉策略：柱状图由负转正时买入，由正转负时卖出',
  params: [
    {
      key: 'fast',
      label: '快线周期',
      type: 'number',
      default: 12,
      min: 2,
      max: 50,
      step: 1,
    },
    {
      key: 'slow',
      label: '慢线周期',
      type: 'number',
      default: 26,
      min: 5,
      max: 100,
      step: 1,
    },
    {
      key: 'signal',
      label: '信号线周期',
      type: 'number',
      default: 9,
      min: 2,
      max: 30,
      step: 1,
    },
  ],
  generateSignals(data: OHLCVItem[], params: Record<string, any>): TradeSignal[] {
    const fast = params.fast ?? 12;
    const slow = params.slow ?? 26;
    const signal = params.signal ?? 9;
    const closes = data.map((d) => d.close);
    const macdResult = macd(closes, fast, slow, signal);
    return macdToSignals(macdResult, data);
  },
};
