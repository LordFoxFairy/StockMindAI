import type { IndicatorPlugin } from '../types';
import type { OHLCVItem } from '../../indicators';
import { kdj } from '../../indicators';

export const kdjPlugin: IndicatorPlugin = {
  id: 'indicator-kdj',
  name: 'KDJ',
  category: 'indicator',
  description: 'KDJ随机指标，通过最高价、最低价及收盘价的关系来判断超买超卖和趋势转折',
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
  compute(data: OHLCVItem[], params: Record<string, any>) {
    const period = params.period ?? 9;
    const kSmooth = params.kSmooth ?? 3;
    const dSmooth = params.dSmooth ?? 3;
    return kdj(data, period, kSmooth, dSmooth);
  },
};
