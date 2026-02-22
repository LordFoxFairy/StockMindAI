import type { IndicatorPlugin } from '../types';
import type { OHLCVItem } from '../../indicators';

export interface WRResult {
  wr: (number | null)[];
}

/**
 * Williams %R indicator.
 * WR = (Highest High - Close) / (Highest High - Lowest Low) * -100
 *
 * Range: -100 to 0
 * Values near -100 indicate oversold; values near 0 indicate overbought.
 */
function computeWR(data: OHLCVItem[], period: number): WRResult {
  const wr: (number | null)[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      wr.push(null);
    } else {
      let highestHigh = -Infinity;
      let lowestLow = Infinity;
      for (let j = i - period + 1; j <= i; j++) {
        if (data[j].high > highestHigh) highestHigh = data[j].high;
        if (data[j].low < lowestLow) lowestLow = data[j].low;
      }
      if (highestHigh === lowestLow) {
        wr.push(-50); // midpoint when range is zero
      } else {
        const value = ((highestHigh - data[i].close) / (highestHigh - lowestLow)) * -100;
        wr.push(+value.toFixed(4));
      }
    }
  }

  return { wr };
}

export const wrPlugin: IndicatorPlugin = {
  id: 'indicator-wr',
  name: 'Williams %R',
  category: 'indicator',
  description: '威廉指标（Williams %R），衡量市场超买超卖程度，值在-100到0之间波动，接近-100为超卖，接近0为超买',
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
    return computeWR(data, period);
  },
};
