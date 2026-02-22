import type { IndicatorPlugin } from '../types';
import type { OHLCVItem } from '../../indicators';
import { rsi } from '../../indicators';

export const rsiPlugin: IndicatorPlugin = {
  id: 'indicator-rsi',
  name: 'RSI',
  category: 'indicator',
  description: 'RSI相对强弱指标，衡量价格变动的速度和幅度，判断超买超卖状态',
  params: [
    {
      key: 'period',
      label: '周期',
      type: 'number',
      default: 14,
      min: 2,
      max: 50,
      step: 1,
    },
  ],
  compute(data: OHLCVItem[], params: Record<string, any>) {
    const period = params.period ?? 14;
    const closes = data.map((d) => d.close);
    return rsi(closes, period);
  },
};
