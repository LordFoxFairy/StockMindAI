import type { StrategyPlugin } from '../types';
import type { OHLCVItem } from '../../indicators';
import type { TradeSignal } from '../../backtest';
import { kdj } from '../../indicators';
import { kdjToSignals } from '../../backtest';

export const kdjStrategyPlugin: StrategyPlugin = {
  id: 'strategy-kdj',
  name: 'KDJ策略',
  category: 'strategy',
  description: 'KDJ金叉死叉策略：超卖区K上穿D时买入，超买区K下穿D时卖出',
  params: [
    {
      key: 'period',
      label: '周期',
      type: 'number',
      default: 9,
      min: 3,
      max: 30,
      step: 1,
    },
    {
      key: 'kSmooth',
      label: 'K平滑系数',
      type: 'number',
      default: 3,
      min: 1,
      max: 10,
      step: 1,
    },
    {
      key: 'dSmooth',
      label: 'D平滑系数',
      type: 'number',
      default: 3,
      min: 1,
      max: 10,
      step: 1,
    },
  ],
  generateSignals(data: OHLCVItem[], params: Record<string, any>): TradeSignal[] {
    const period = params.period ?? 9;
    const kSmooth = params.kSmooth ?? 3;
    const dSmooth = params.dSmooth ?? 3;
    const kdjResult = kdj(data, period, kSmooth, dSmooth);
    return kdjToSignals(kdjResult, data);
  },
};
