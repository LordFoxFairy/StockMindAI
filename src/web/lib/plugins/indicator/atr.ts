import type { IndicatorPlugin } from '../types';
import type { OHLCVItem } from '../../indicators';

export interface ATRResult {
  tr: (number | null)[];
  atr: (number | null)[];
}

/**
 * Average True Range (ATR) indicator.
 * True Range = max(High - Low, |High - PrevClose|, |Low - PrevClose|)
 * ATR = smoothed average (Wilder smoothing) of True Range over N periods.
 */
function computeATR(data: OHLCVItem[], period: number): ATRResult {
  const tr: (number | null)[] = [];
  const atr: (number | null)[] = [];

  if (data.length === 0) return { tr, atr };

  // First bar: TR = High - Low (no previous close)
  tr.push(data[0].high - data[0].low);
  atr.push(null);

  for (let i = 1; i < data.length; i++) {
    const highLow = data[i].high - data[i].low;
    const highPrevClose = Math.abs(data[i].high - data[i - 1].close);
    const lowPrevClose = Math.abs(data[i].low - data[i - 1].close);
    const trueRange = Math.max(highLow, highPrevClose, lowPrevClose);
    tr.push(+trueRange.toFixed(4));

    if (i < period) {
      // Not enough data yet for ATR
      atr.push(null);
    } else if (i === period) {
      // First ATR: simple average of first `period` TR values
      let sum = 0;
      for (let j = 1; j <= period; j++) {
        sum += tr[j] as number;
      }
      atr.push(+(sum / period).toFixed(4));
    } else {
      // Wilder smoothing: ATR = (prevATR * (period - 1) + currentTR) / period
      const prevATR = atr[i - 1] as number;
      const currentATR = (prevATR * (period - 1) + trueRange) / period;
      atr.push(+currentATR.toFixed(4));
    }
  }

  return { tr, atr };
}

export const atrPlugin: IndicatorPlugin = {
  id: 'indicator-atr',
  name: 'ATR',
  category: 'indicator',
  description: '平均真实波幅（Average True Range），衡量市场波动性的指标，常用于设置止损和仓位管理',
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
    return computeATR(data, period);
  },
};
