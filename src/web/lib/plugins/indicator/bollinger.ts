import type { IndicatorPlugin } from '../types';
import type { OHLCVItem } from '../../indicators';
import { bollingerBands } from '../../indicators';

export const bollingerPlugin: IndicatorPlugin = {
  id: 'indicator-bollinger',
  name: '布林带',
  category: 'indicator',
  description: '布林带指标（Bollinger Bands），由中轨、上轨、下轨组成，用于判断价格波动区间和超买超卖',
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
  compute(data: OHLCVItem[], params: Record<string, any>) {
    const period = params.period ?? 20;
    const multiplier = params.multiplier ?? 2;
    const closes = data.map((d) => d.close);
    return bollingerBands(closes, period, multiplier);
  },
};
