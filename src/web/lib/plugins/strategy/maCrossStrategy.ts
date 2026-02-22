import type { StrategyPlugin } from '../types';
import type { OHLCVItem } from '../../indicators';
import type { TradeSignal } from '../../backtest';
import { maCross } from '../../indicators';
import { maCrossToSignals } from '../../backtest';

export const maCrossStrategyPlugin: StrategyPlugin = {
  id: 'strategy-ma-cross',
  name: '均线交叉策略',
  category: 'strategy',
  description: '均线交叉策略：短期均线上穿长期均线（金叉）时买入，下穿（死叉）时卖出',
  params: [
    {
      key: 'shortPeriod',
      label: '短期均线周期',
      type: 'number',
      default: 5,
      min: 2,
      max: 30,
      step: 1,
    },
    {
      key: 'longPeriod',
      label: '长期均线周期',
      type: 'number',
      default: 20,
      min: 10,
      max: 120,
      step: 1,
    },
  ],
  generateSignals(data: OHLCVItem[], params: Record<string, any>): TradeSignal[] {
    const shortPeriod = params.shortPeriod ?? 5;
    const longPeriod = params.longPeriod ?? 20;
    const crossResult = maCross(data, shortPeriod, longPeriod);
    return maCrossToSignals(crossResult, data);
  },
};
