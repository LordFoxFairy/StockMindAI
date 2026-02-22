import type { IndicatorPlugin } from '../types';
import type { OHLCVItem } from '../../indicators';
import { macd } from '../../indicators';

export const macdPlugin: IndicatorPlugin = {
  id: 'indicator-macd',
  name: 'MACD',
  category: 'indicator',
  description: 'MACD指标（指数平滑异同移动平均线），通过快慢均线的离散与聚合来判断买卖时机',
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
  compute(data: OHLCVItem[], params: Record<string, any>) {
    const fast = params.fast ?? 12;
    const slow = params.slow ?? 26;
    const signal = params.signal ?? 9;
    const closes = data.map((d) => d.close);
    return macd(closes, fast, slow, signal);
  },
};
