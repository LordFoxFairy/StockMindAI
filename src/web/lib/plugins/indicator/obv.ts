import type { IndicatorPlugin } from '../types';
import type { OHLCVItem } from '../../indicators';

export interface OBVResult {
  obv: number[];
}

/**
 * On-Balance Volume (OBV) indicator.
 * Accumulates volume based on close price direction:
 * - If close > previous close: OBV += volume
 * - If close < previous close: OBV -= volume
 * - If close == previous close: OBV unchanged
 */
function computeOBV(data: OHLCVItem[]): OBVResult {
  const obv: number[] = [];

  if (data.length === 0) return { obv };

  obv.push(data[0].volume); // first bar: OBV = volume

  for (let i = 1; i < data.length; i++) {
    const prevOBV = obv[i - 1];
    if (data[i].close > data[i - 1].close) {
      obv.push(prevOBV + data[i].volume);
    } else if (data[i].close < data[i - 1].close) {
      obv.push(prevOBV - data[i].volume);
    } else {
      obv.push(prevOBV);
    }
  }

  return { obv };
}

export const obvPlugin: IndicatorPlugin = {
  id: 'indicator-obv',
  name: 'OBV',
  category: 'indicator',
  description: '能量潮指标（On-Balance Volume），通过成交量的累积变化来预测价格趋势，量在价先',
  params: [],
  compute(data: OHLCVItem[], _params: Record<string, any>) {
    return computeOBV(data);
  },
};
