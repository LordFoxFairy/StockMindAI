import type { IndicatorPlugin } from '../types';
import type { OHLCVItem } from '../../indicators';
import { maCross } from '../../indicators';

export const maCrossPlugin: IndicatorPlugin = {
  id: 'indicator-ma-cross',
  name: '均线交叉',
  category: 'indicator',
  description: '均线交叉指标，通过短期均线与长期均线的金叉/死叉来判断趋势方向',
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
  compute(data: OHLCVItem[], params: Record<string, any>) {
    const shortPeriod = params.shortPeriod ?? 5;
    const longPeriod = params.longPeriod ?? 20;
    return maCross(data, shortPeriod, longPeriod);
  },
};
