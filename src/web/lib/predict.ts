import type { OHLCVItem } from './indicators';
import { macd, rsi, bollingerBands, kdj, maCross, sma } from './indicators';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface TrendResult {
  direction: 'up' | 'down' | 'sideways';
  strength: number;      // 0-100
  ma5Slope: number;
  ma20Slope: number;
  ma60Slope: number;
  description: string;   // Chinese description
}

export interface SupportResistance {
  supports: { price: number; strength: number }[];   // sorted by price desc
  resistances: { price: number; strength: number }[]; // sorted by price asc
}

export interface IndicatorSignal {
  name: string;          // 'MACD' | 'RSI' | '布林带' | 'KDJ' | '均线'
  signal: 'bullish' | 'bearish' | 'neutral';
  score: number;         // -100 to +100
  description: string;   // Chinese
}

export interface PredictionResult {
  compositeScore: number;  // -100 to +100
  trend: TrendResult;
  supportResistance: SupportResistance;
  signals: IndicatorSignal[];
  summary: string;         // Chinese summary paragraph
  confidence: number;      // 0-100
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Calculate slope of a moving average over the last N bars.
 * Returns average percent change per bar.
 */
function maSlope(maValues: (number | null)[], lookback: number): number {
  const valid: number[] = [];
  for (let i = maValues.length - 1; i >= 0 && valid.length < lookback + 1; i--) {
    if (maValues[i] !== null) valid.unshift(maValues[i]!);
  }
  if (valid.length < 2) return 0;
  let totalChange = 0;
  for (let i = 1; i < valid.length; i++) {
    if (valid[i - 1] !== 0) {
      totalChange += (valid[i] - valid[i - 1]) / valid[i - 1];
    }
  }
  return totalChange / (valid.length - 1);
}

// ── Core Functions ──────────────────────────────────────────────────────────

export function detectTrend(klineData: OHLCVItem[]): TrendResult {
  const closes = klineData.map(k => k.close);
  const ma5 = sma(closes, 5);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);

  const lookback = 10;
  const ma5Slope = maSlope(ma5, lookback);
  const ma20Slope = maSlope(ma20, lookback);
  const ma60Slope = maSlope(ma60, lookback);

  const lastMA5 = ma5.filter((v): v is number => v !== null).slice(-1)[0] ?? 0;
  const lastMA20 = ma20.filter((v): v is number => v !== null).slice(-1)[0] ?? 0;
  const lastMA60 = ma60.filter((v): v is number => v !== null).slice(-1)[0] ?? 0;

  const allPositive = ma5Slope > 0 && ma20Slope > 0 && ma60Slope > 0;
  const allNegative = ma5Slope < 0 && ma20Slope < 0 && ma60Slope < 0;
  const maAligned = lastMA5 > lastMA20 && lastMA20 > lastMA60;
  const maInverted = lastMA5 < lastMA20 && lastMA20 < lastMA60;

  let direction: 'up' | 'down' | 'sideways';
  let description: string;

  if (allPositive && maAligned) {
    direction = 'up';
    description = '多头排列，均线系统呈上升趋势，MA5>MA20>MA60且斜率均为正';
  } else if (allNegative && maInverted) {
    direction = 'down';
    description = '空头排列，均线系统呈下降趋势，MA5<MA20<MA60且斜率均为负';
  } else if (allPositive) {
    direction = 'up';
    description = '均线斜率均为正，呈上升趋势，但均线尚未完全多头排列';
  } else if (allNegative) {
    direction = 'down';
    description = '均线斜率均为负，呈下降趋势，但均线尚未完全空头排列';
  } else {
    direction = 'sideways';
    description = '均线方向不一致，市场处于震荡整理阶段';
  }

  // Strength based on slope magnitude (scaled to 0-100)
  const avgAbsSlope = (Math.abs(ma5Slope) + Math.abs(ma20Slope) + Math.abs(ma60Slope)) / 3;
  const strength = clamp(Math.round(avgAbsSlope * 5000), 0, 100);

  return {
    direction,
    strength,
    ma5Slope: +ma5Slope.toFixed(6),
    ma20Slope: +ma20Slope.toFixed(6),
    ma60Slope: +ma60Slope.toFixed(6),
    description,
  };
}

export function findSupportResistance(klineData: OHLCVItem[], lookback = 120): SupportResistance {
  const data = klineData.slice(-lookback);
  const closes = data.map(k => k.close);
  const window = 5;

  const localMin: number[] = [];
  const localMax: number[] = [];

  for (let i = window; i < closes.length - window; i++) {
    let isMin = true;
    let isMax = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (closes[j] <= closes[i]) isMin = false;
      if (closes[j] >= closes[i]) isMax = false;
    }
    if (isMin) localMin.push(closes[i]);
    if (isMax) localMax.push(closes[i]);
  }

  // Cluster nearby levels (within 1%)
  function clusterLevels(levels: number[]): { price: number; strength: number }[] {
    if (levels.length === 0) return [];
    const sorted = [...levels].sort((a, b) => a - b);
    const clusters: { prices: number[] }[] = [];
    let current = { prices: [sorted[0]] };

    for (let i = 1; i < sorted.length; i++) {
      const avg = current.prices.reduce((a, b) => a + b, 0) / current.prices.length;
      if (Math.abs(sorted[i] - avg) / avg <= 0.01) {
        current.prices.push(sorted[i]);
      } else {
        clusters.push(current);
        current = { prices: [sorted[i]] };
      }
    }
    clusters.push(current);

    return clusters.map(c => ({
      price: +(c.prices.reduce((a, b) => a + b, 0) / c.prices.length).toFixed(2),
      strength: c.prices.length,
    }));
  }

  const supports = clusterLevels(localMin).sort((a, b) => b.price - a.price);
  const resistances = clusterLevels(localMax).sort((a, b) => a.price - b.price);

  return { supports, resistances };
}

export function calculateIndicatorSignals(klineData: OHLCVItem[]): IndicatorSignal[] {
  const closes = klineData.map(k => k.close);
  const signals: IndicatorSignal[] = [];

  // --- MACD ---
  {
    const result = macd(closes);
    const last = closes.length - 1;
    const dif = result.dif[last];
    const dea = result.dea[last];
    const hist = result.histogram[last];
    const prevHist = result.histogram[last - 1];

    let score = 0;
    const parts: string[] = [];

    if (dif !== null && dea !== null && hist !== null) {
      if (dif > dea) {
        score += 30;
        parts.push('DIF在DEA上方');
      } else {
        score -= 30;
        parts.push('DIF在DEA下方');
      }

      if (prevHist !== null) {
        if (hist > prevHist && hist > 0) {
          score += 20;
          parts.push('红柱放大，动能增强');
        } else if (hist < prevHist && hist > 0) {
          score += 5;
          parts.push('红柱缩短，动能减弱');
        } else if (hist < prevHist && hist < 0) {
          score -= 20;
          parts.push('绿柱放大，空头增强');
        } else if (hist > prevHist && hist < 0) {
          score -= 5;
          parts.push('绿柱缩短，空头减弱');
        }
      }

      if (dif > 0 && dea > 0) {
        score += 15;
        parts.push('位于零轴上方');
      } else if (dif < 0 && dea < 0) {
        score -= 15;
        parts.push('位于零轴下方');
      }
    } else {
      parts.push('MACD数据不足');
    }

    score = clamp(score, -100, 100);
    signals.push({
      name: 'MACD',
      signal: score > 15 ? 'bullish' : score < -15 ? 'bearish' : 'neutral',
      score,
      description: parts.join('，'),
    });
  }

  // --- RSI ---
  {
    const rsiArr = rsi(closes, 14);
    const last = closes.length - 1;
    const current = rsiArr[last];
    const prev = rsiArr[last - 1];

    let score = 0;
    const parts: string[] = [];

    if (current !== null) {
      if (current <= 20) {
        score = 80;
        parts.push(`RSI=${current.toFixed(1)}，极度超卖`);
      } else if (current <= 30) {
        score = 50;
        parts.push(`RSI=${current.toFixed(1)}，超卖区间`);
      } else if (current >= 80) {
        score = -80;
        parts.push(`RSI=${current.toFixed(1)}，极度超买`);
      } else if (current >= 70) {
        score = -50;
        parts.push(`RSI=${current.toFixed(1)}，超买区间`);
      } else {
        score = Math.round((current - 50) * 100 / 40);
        parts.push(`RSI=${current.toFixed(1)}，中性区间`);
      }

      if (prev !== null) {
        if (current > prev) {
          score += 10;
          parts.push('RSI上升');
        } else {
          score -= 10;
          parts.push('RSI下降');
        }
      }
    } else {
      parts.push('RSI数据不足');
    }

    score = clamp(score, -100, 100);
    signals.push({
      name: 'RSI',
      signal: score > 15 ? 'bullish' : score < -15 ? 'bearish' : 'neutral',
      score,
      description: parts.join('，'),
    });
  }

  // --- Bollinger Bands ---
  {
    const boll = bollingerBands(closes, 20);
    const last = closes.length - 1;
    const upper = boll.upper[last];
    const middle = boll.middle[last];
    const lower = boll.lower[last];
    const price = closes[last];

    let score = 0;
    const parts: string[] = [];

    if (upper !== null && middle !== null && lower !== null) {
      const bandwidth = upper - lower;
      const position = bandwidth > 0 ? (price - lower) / bandwidth : 0.5;

      if (price <= lower) {
        score = 60;
        parts.push('价格触及下轨，可能反弹');
      } else if (price >= upper) {
        score = -60;
        parts.push('价格触及上轨，可能回调');
      } else if (position < 0.3) {
        score = 30;
        parts.push('价格接近下轨');
      } else if (position > 0.7) {
        score = -30;
        parts.push('价格接近上轨');
      } else {
        score = 0;
        parts.push('价格在中轨附近');
      }

      // Squeeze detection
      if (last >= 1) {
        const prevUpper = boll.upper[last - 1];
        const prevLower = boll.lower[last - 1];
        if (prevUpper !== null && prevLower !== null) {
          const prevBW = prevUpper - prevLower;
          if (bandwidth < prevBW * 0.9) {
            parts.push('带宽收窄，可能变盘');
          }
        }
      }
    } else {
      parts.push('布林带数据不足');
    }

    score = clamp(score, -100, 100);
    signals.push({
      name: '布林带',
      signal: score > 15 ? 'bullish' : score < -15 ? 'bearish' : 'neutral',
      score,
      description: parts.join('，'),
    });
  }

  // --- KDJ ---
  {
    const result = kdj(klineData, 9);
    const last = klineData.length - 1;
    const kVal = result.k[last];
    const dVal = result.d[last];
    const jVal = result.j[last];
    const prevK = result.k[last - 1];
    const prevD = result.d[last - 1];

    let score = 0;
    const parts: string[] = [];

    if (kVal !== null && dVal !== null && jVal !== null) {
      if (kVal < 20 && dVal < 20) {
        score += 50;
        parts.push('KD位于超卖区');
      } else if (kVal > 80 && dVal > 80) {
        score -= 50;
        parts.push('KD位于超买区');
      }

      if (prevK !== null && prevD !== null) {
        if (kVal > dVal && prevK <= prevD) {
          score += 30;
          parts.push('K上穿D，金叉');
        } else if (kVal < dVal && prevK >= prevD) {
          score -= 30;
          parts.push('K下穿D，死叉');
        } else if (kVal > dVal) {
          score += 10;
          parts.push('K在D上方');
        } else {
          score -= 10;
          parts.push('K在D下方');
        }
      }

      if (jVal > 100) {
        score -= 15;
        parts.push(`J值=${jVal.toFixed(1)}，短期超买`);
      } else if (jVal < 0) {
        score += 15;
        parts.push(`J值=${jVal.toFixed(1)}，短期超卖`);
      }
    } else {
      parts.push('KDJ数据不足');
    }

    score = clamp(score, -100, 100);
    signals.push({
      name: 'KDJ',
      signal: score > 15 ? 'bullish' : score < -15 ? 'bearish' : 'neutral',
      score,
      description: parts.join('，'),
    });
  }

  // --- MA Cross ---
  {
    const result = maCross(klineData, 5, 20);
    const last = klineData.length - 1;
    const shortMA = result.shortMA[last];
    const longMA = result.longMA[last];
    const prevShort = result.shortMA[last - 1];
    const prevLong = result.longMA[last - 1];

    let score = 0;
    const parts: string[] = [];

    if (shortMA !== null && longMA !== null) {
      if (prevShort !== null && prevLong !== null) {
        if (shortMA > longMA && prevShort <= prevLong) {
          score += 60;
          parts.push('MA5上穿MA20，金叉信号');
        } else if (shortMA < longMA && prevShort >= prevLong) {
          score -= 60;
          parts.push('MA5下穿MA20，死叉信号');
        }
      }

      if (shortMA > longMA) {
        score += 20;
        parts.push('短期均线在长期均线上方，多头排列');
      } else {
        score -= 20;
        parts.push('短期均线在长期均线下方，空头排列');
      }

      const distance = (shortMA - longMA) / longMA * 100;
      if (Math.abs(distance) > 5) {
        parts.push(`偏离度${distance.toFixed(2)}%`);
      }
    } else {
      parts.push('均线数据不足');
    }

    score = clamp(score, -100, 100);
    signals.push({
      name: '均线',
      signal: score > 15 ? 'bullish' : score < -15 ? 'bearish' : 'neutral',
      score,
      description: parts.join('，'),
    });
  }

  return signals;
}

export function calculateCompositeScore(signals: IndicatorSignal[]): number {
  const weights: Record<string, number> = {
    'MACD': 0.25,
    'RSI': 0.20,
    '布林带': 0.20,
    'KDJ': 0.15,
    '均线': 0.20,
  };

  let totalScore = 0;
  let totalWeight = 0;
  for (const sig of signals) {
    const w = weights[sig.name] ?? 0.2;
    totalScore += sig.score * w;
    totalWeight += w;
  }

  if (totalWeight === 0) return 0;
  return clamp(Math.round(totalScore / totalWeight), -100, 100);
}

export function generatePredictionSummary(result: PredictionResult): string {
  const { compositeScore, trend, signals, supportResistance } = result;

  let outlook: string;
  if (compositeScore >= 50) outlook = '强烈看涨';
  else if (compositeScore >= 20) outlook = '偏多';
  else if (compositeScore > -20) outlook = '中性震荡';
  else if (compositeScore > -50) outlook = '偏空';
  else outlook = '强烈看跌';

  const bullish = signals.filter(s => s.signal === 'bullish').length;
  const bearish = signals.filter(s => s.signal === 'bearish').length;
  const neutral = signals.filter(s => s.signal === 'neutral').length;

  const trendDesc = trend.direction === 'up' ? '上升趋势'
    : trend.direction === 'down' ? '下降趋势' : '震荡走势';

  const nearestSupport = supportResistance.supports[0];
  const nearestResistance = supportResistance.resistances[0];
  let srDesc = '';
  if (nearestSupport) srDesc += `最近支撑位${nearestSupport.price.toFixed(2)}`;
  if (nearestSupport && nearestResistance) srDesc += '，';
  if (nearestResistance) srDesc += `最近阻力位${nearestResistance.price.toFixed(2)}`;

  return `综合评分${compositeScore}分，整体${outlook}。` +
    `当前处于${trendDesc}（趋势强度${trend.strength}），` +
    `${bullish}项指标看多、${bearish}项看空、${neutral}项中性。` +
    (srDesc ? `${srDesc}。` : '');
}

export function runPrediction(klineData: OHLCVItem[]): PredictionResult {
  const trend = detectTrend(klineData);
  const supportResistance = findSupportResistance(klineData);
  const signals = calculateIndicatorSignals(klineData);
  const compositeScore = calculateCompositeScore(signals);

  // Confidence based on signal agreement
  const agreeing = signals.filter(s =>
    (compositeScore >= 0 && s.score >= 0) || (compositeScore < 0 && s.score < 0)
  ).length;
  const confidence = clamp(Math.round((agreeing / signals.length) * 100), 0, 100);

  const partial: PredictionResult = {
    compositeScore,
    trend,
    supportResistance,
    signals,
    summary: '',
    confidence,
  };

  partial.summary = generatePredictionSummary(partial);

  return partial;
}
