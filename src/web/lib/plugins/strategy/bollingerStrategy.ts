import type { StrategyPlugin } from '../types';
import type { OHLCVItem } from '../../indicators';
import type { TradeSignal } from '../../backtest';
import { bollingerBands } from '../../indicators';
import { bollingerToSignals } from '../../backtest';

export const bollingerStrategyPlugin: StrategyPlugin = {
  id: 'strategy-bollinger',
  name: '布林带策略',
  category: 'strategy',
  description: '布林带突破策略：价格从下方突破下轨时买入，从上方跌破上轨时卖出',
  params: [
    {
      key: 'period',
      label: '周期',
      type: 'number',
      default: 20,
      min: 5,
      max: 60,
      step: 1,
    },
    {
      key: 'multiplier',
      label: '标准差倍数',
      type: 'number',
      default: 2,
      min: 0.5,
      max: 4,
      step: 0.5,
    },
  ],
  generateSignals(data: OHLCVItem[], params: Record<string, any>): TradeSignal[] {
    const period = params.period ?? 20;
    const multiplier = params.multiplier ?? 2;
    const closes = data.map((d) => d.close);
    const bollResult = bollingerBands(closes, period, multiplier);
    return bollingerToSignals(bollResult, data);
  },
};
