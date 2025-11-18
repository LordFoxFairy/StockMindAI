export interface OHLCVItem {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

export function sma(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j];
      result.push(+(sum / period).toFixed(4));
    }
  }
  return result;
}

export function ema(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += data[j];
      prev = +(sum / period).toFixed(4);
      result.push(prev);
    } else {
      prev = +(data[i] * k + prev! * (1 - k)).toFixed(4);
      result.push(prev);
    }
  }
  return result;
}

export interface MACDResult {
  dif: (number | null)[];
  dea: (number | null)[];
  histogram: (number | null)[];
}

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): MACDResult {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);

  const dif: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (emaFast[i] !== null && emaSlow[i] !== null) {
      dif.push(+(emaFast[i]! - emaSlow[i]!).toFixed(4));
    } else {
      dif.push(null);
    }
  }

  // DEA = EMA of DIF values (only non-null portion)
  const difValues = dif.filter((v): v is number => v !== null);
  const deaRaw = ema(difValues, signal);
  const dea: (number | null)[] = [];
  const histogram: (number | null)[] = [];
  let idx = 0;
  for (let i = 0; i < closes.length; i++) {
    if (dif[i] !== null) {
      const deaVal = deaRaw[idx];
      dea.push(deaVal);
      if (deaVal !== null && dif[i] !== null) {
        histogram.push(+((dif[i]! - deaVal) * 2).toFixed(4));
      } else {
        histogram.push(null);
      }
      idx++;
    } else {
      dea.push(null);
      histogram.push(null);
    }
  }

  return { dif, dea, histogram };
}

export function rsi(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = [];
  if (closes.length < 2) return closes.map(() => null);

  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }

  result.push(null); // first bar has no RSI

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < gains.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else if (i === period - 1) {
      let sumGain = 0, sumLoss = 0;
      for (let j = 0; j <= i; j++) {
        sumGain += gains[j];
        sumLoss += losses[j];
      }
      avgGain = sumGain / period;
      avgLoss = sumLoss / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      result.push(+(100 - 100 / (1 + rs)).toFixed(2));
    } else {
      // Wilder smoothing
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      result.push(+(100 - 100 / (1 + rs)).toFixed(2));
    }
  }

  return result;
}

export interface BollingerResult {
  middle: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
}

export function bollingerBands(
  closes: number[],
  period = 20,
  multiplier = 2,
): BollingerResult {
  const middle = sma(closes, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (middle[i] === null) {
      upper.push(null);
      lower.push(null);
    } else {
      let sumSq = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sumSq += (closes[j] - middle[i]!) ** 2;
      }
      const std = Math.sqrt(sumSq / period);
      upper.push(+(middle[i]! + multiplier * std).toFixed(4));
      lower.push(+(middle[i]! - multiplier * std).toFixed(4));
    }
  }

  return { middle, upper, lower };
}

export interface KDJResult {
  k: (number | null)[];
  d: (number | null)[];
  j: (number | null)[];
}

export function kdj(
  items: OHLCVItem[],
  period = 9,
  kSmooth = 3,
  dSmooth = 3,
): KDJResult {
  const kArr: (number | null)[] = [];
  const dArr: (number | null)[] = [];
  const jArr: (number | null)[] = [];

  let prevK = 50;
  let prevD = 50;

  for (let i = 0; i < items.length; i++) {
    if (i < period - 1) {
      kArr.push(null);
      dArr.push(null);
      jArr.push(null);
    } else {
      let highest = -Infinity;
      let lowest = Infinity;
      for (let j = i - period + 1; j <= i; j++) {
        if (items[j].high > highest) highest = items[j].high;
        if (items[j].low < lowest) lowest = items[j].low;
      }
      const rsv = highest === lowest ? 50 : ((items[i].close - lowest) / (highest - lowest)) * 100;
      const curK = +((prevK * (kSmooth - 1) + rsv) / kSmooth).toFixed(2);
      const curD = +((prevD * (dSmooth - 1) + curK) / dSmooth).toFixed(2);
      const curJ = +(3 * curK - 2 * curD).toFixed(2);
      kArr.push(curK);
      dArr.push(curD);
      jArr.push(curJ);
      prevK = curK;
      prevD = curD;
    }
  }

  return { k: kArr, d: dArr, j: jArr };
}

export interface CrossSignal {
  index: number;
  type: 'golden' | 'dead';
  date: string;
  price: number;
}

export interface MACrossResult {
  shortMA: (number | null)[];
  longMA: (number | null)[];
  signals: CrossSignal[];
}

export function maCross(
  items: OHLCVItem[],
  shortPeriod = 5,
  longPeriod = 20,
): MACrossResult {
  const closes = items.map(i => i.close);
  const shortMA = sma(closes, shortPeriod);
  const longMA = sma(closes, longPeriod);
  const signals: CrossSignal[] = [];

  for (let i = 1; i < items.length; i++) {
    const prev_s = shortMA[i - 1];
    const prev_l = longMA[i - 1];
    const cur_s = shortMA[i];
    const cur_l = longMA[i];
    if (prev_s === null || prev_l === null || cur_s === null || cur_l === null) continue;

    if (prev_s <= prev_l && cur_s > cur_l) {
      signals.push({ index: i, type: 'golden', date: items[i].date, price: items[i].close });
    } else if (prev_s >= prev_l && cur_s < cur_l) {
      signals.push({ index: i, type: 'dead', date: items[i].date, price: items[i].close });
    }
  }

  return { shortMA, longMA, signals };
}
