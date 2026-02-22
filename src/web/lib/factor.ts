/**
 * 因子分析库
 *
 * - 动量因子 (Momentum)
 * - 波动率因子 (Volatility)
 * - 技术因子 (RSI, MACD Histogram)
 * - IC (Information Coefficient) 分析
 * - 因子综合评分与排名
 *
 * 无外部依赖，纯 TypeScript 实现。
 */

import type { OHLCVItem } from './indicators';
import { macd, rsi } from './indicators';
import { mean, stdDev, dailyReturns } from './risk';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface FactorExposure {
  factorName: string;
  stockCode: string;
  exposure: number;
}

export interface ICResult {
  factorName: string;
  ic: number;          // Information Coefficient (Spearman 秩相关)
  icIR: number;        // IC Information Ratio (mean IC / std IC)
  pValue: number;
}

export interface FactorScore {
  stockCode: string;
  stockName: string;
  scores: Record<string, number>;  // factorName -> score
  compositeScore: number;
}

export interface FactorAnalysisResult {
  exposures: FactorExposure[];
  icResults: ICResult[];
  rankings: FactorScore[];
}

// ── 因子计算 ────────────────────────────────────────────────────────────────

/**
 * 计算动量因子: 过去 N 个交易日的累计收益率。
 *
 * 动量 = (P_T / P_{T-N}) - 1
 *
 * @param klineMap 股票代码 -> K线数据
 * @param lookback 回望天数 (默认 20)
 * @returns 股票代码 -> 动量值
 */
export function computeMomentumFactor(
  klineMap: Map<string, OHLCVItem[]>,
  lookback = 20,
): Map<string, number> {
  const result = new Map<string, number>();

  for (const [code, kline] of klineMap) {
    if (kline.length < lookback + 1) {
      result.set(code, 0);
      continue;
    }

    const endPrice = kline[kline.length - 1].close;
    const startPrice = kline[kline.length - 1 - lookback].close;

    if (startPrice > 0) {
      result.set(code, (endPrice / startPrice) - 1);
    } else {
      result.set(code, 0);
    }
  }

  return result;
}

/**
 * 计算波动率因子: 过去 N 个交易日的年化波动率。
 *
 * @param klineMap 股票代码 -> K线数据
 * @param lookback 回望天数 (默认 20)
 * @returns 股票代码 -> 年化波动率
 */
export function computeVolatilityFactor(
  klineMap: Map<string, OHLCVItem[]>,
  lookback = 20,
): Map<string, number> {
  const result = new Map<string, number>();

  for (const [code, kline] of klineMap) {
    if (kline.length < lookback + 1) {
      result.set(code, 0);
      continue;
    }

    const recentKline = kline.slice(-(lookback + 1));
    const closes = recentKline.map(k => k.close);
    const returns = dailyReturns(closes);
    const vol = stdDev(returns) * Math.sqrt(252);
    result.set(code, vol);
  }

  return result;
}

/**
 * 计算技术因子: 最新 RSI 和 MACD 柱状图值。
 *
 * @param klineMap 股票代码 -> K线数据
 * @returns 股票代码 -> { rsi, macdHist }
 */
export function computeTechnicalFactors(
  klineMap: Map<string, OHLCVItem[]>,
): Map<string, { rsi: number; macdHist: number }> {
  const result = new Map<string, { rsi: number; macdHist: number }>();

  for (const [code, kline] of klineMap) {
    if (kline.length < 30) {
      result.set(code, { rsi: 50, macdHist: 0 });
      continue;
    }

    const closes = kline.map(k => k.close);

    // RSI (14日)
    const rsiValues = rsi(closes, 14);
    const latestRSI = rsiValues[rsiValues.length - 1] ?? 50;

    // MACD 柱状图
    const macdResult = macd(closes, 12, 26, 9);
    const latestHist = macdResult.histogram[macdResult.histogram.length - 1] ?? 0;

    result.set(code, {
      rsi: latestRSI,
      macdHist: latestHist,
    });
  }

  return result;
}

// ── IC 分析 ──────────────────────────────────────────────────────────────────

/**
 * 计算排名 (用于 Spearman 秩相关)。
 *
 * 处理相同值 (tie) 时取平均排名。
 */
function computeRanks(values: number[]): number[] {
  const n = values.length;
  const indexed: { value: number; index: number }[] = values.map((v, i) => ({ value: v, index: i }));
  indexed.sort((a, b) => a.value - b.value);

  const ranks = new Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n - 1 && indexed[j + 1].value === indexed[i].value) {
      j++;
    }
    // 相同值取平均排名
    const avgRank = (i + j) / 2 + 1; // 1-based
    for (let k = i; k <= j; k++) {
      ranks[indexed[k].index] = avgRank;
    }
    i = j + 1;
  }

  return ranks;
}

/**
 * 计算 Spearman 秩相关系数 (Information Coefficient)。
 *
 * IC = corr(rank(factor), rank(forwardReturn))
 *
 * @param factorScores 股票代码 -> 因子值
 * @param forwardReturns 股票代码 -> 前瞻收益率
 * @returns Spearman 秩相关系数
 */
export function computeIC(
  factorScores: Map<string, number>,
  forwardReturns: Map<string, number>,
): number {
  // 取交集
  const commonCodes: string[] = [];
  for (const code of factorScores.keys()) {
    if (forwardReturns.has(code)) {
      commonCodes.push(code);
    }
  }

  const n = commonCodes.length;
  if (n < 3) return 0;

  const factorValues: number[] = commonCodes.map(c => factorScores.get(c)!);
  const returnValues: number[] = commonCodes.map(c => forwardReturns.get(c)!);

  const factorRanks = computeRanks(factorValues);
  const returnRanks = computeRanks(returnValues);

  // Pearson correlation on ranks
  const meanF = mean(factorRanks);
  const meanR = mean(returnRanks);

  let sumProd = 0;
  let sumFSq = 0;
  let sumRSq = 0;

  for (let i = 0; i < n; i++) {
    const df = factorRanks[i] - meanF;
    const dr = returnRanks[i] - meanR;
    sumProd += df * dr;
    sumFSq += df * df;
    sumRSq += dr * dr;
  }

  const denom = Math.sqrt(sumFSq * sumRSq);
  if (denom < 1e-15) return 0;

  return sumProd / denom;
}

/**
 * 计算 IC 的近似 p 值 (基于 t 检验)。
 *
 * t = IC * sqrt(n - 2) / sqrt(1 - IC²)
 * p ≈ 2 * (1 - Φ(|t|))
 */
function computeICPValue(ic: number, n: number): number {
  if (n < 3) return 1;
  const ic2 = ic * ic;
  if (ic2 >= 1) return 0;

  const t = ic * Math.sqrt(n - 2) / Math.sqrt(1 - ic2);
  const absT = Math.abs(t);

  // 正态近似 (对于 n 较大时，t 分布近似正态)
  const p = 2 * (1 - normalCDF(absT));
  return Math.max(0, Math.min(1, p));
}

/**
 * 标准正态分布 CDF (Abramowitz & Stegun 近似)。
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);

  return 0.5 * (1.0 + sign * y);
}

// ── 因子标准化 ──────────────────────────────────────────────────────────────

/**
 * Z-score 标准化因子值。
 */
function zScoreNormalize(values: Map<string, number>): Map<string, number> {
  const arr = Array.from(values.values());
  if (arr.length === 0) return new Map();

  const m = mean(arr);
  const s = stdDev(arr);

  const result = new Map<string, number>();
  for (const [code, val] of values) {
    result.set(code, s > 0 ? (val - m) / s : 0);
  }
  return result;
}

// ── 前瞻收益率计算 ──────────────────────────────────────────────────────────

/**
 * 计算 N 日前瞻收益率。
 */
function computeForwardReturns(
  klineMap: Map<string, OHLCVItem[]>,
  days = 20,
): Map<string, number> {
  const result = new Map<string, number>();

  for (const [code, kline] of klineMap) {
    if (kline.length < days + 1) {
      continue;
    }

    // 从倒数第 (days+1) 个到倒数第 1 个
    const startIdx = kline.length - 1 - days;
    const startPrice = kline[startIdx].close;
    const endPrice = kline[kline.length - 1].close;

    if (startPrice > 0) {
      result.set(code, (endPrice / startPrice) - 1);
    }
  }

  return result;
}

// ── 完整因子分析 ─────────────────────────────────────────────────────────────

/**
 * 执行完整的因子分析流程。
 *
 * 1. 计算所有因子 (动量、波动率、RSI、MACD)
 * 2. 对因子进行 Z-score 标准化
 * 3. 计算每个因子的 IC (对未来20日收益)
 * 4. 计算综合因子得分并排名
 *
 * @param stocks 股票数据列表
 * @param factorWeights 因子权重 (默认等权)
 * @returns 因子分析结果
 */
export function runFactorAnalysis(
  stocks: Array<{ code: string; name: string; klineData: OHLCVItem[] }>,
  factorWeights?: Record<string, number>,
): FactorAnalysisResult {
  if (stocks.length === 0) {
    return { exposures: [], icResults: [], rankings: [] };
  }

  // 构建 klineMap
  const klineMap = new Map<string, OHLCVItem[]>();
  const nameMap = new Map<string, string>();
  for (const stock of stocks) {
    klineMap.set(stock.code, stock.klineData);
    nameMap.set(stock.code, stock.name);
  }

  // ── 计算因子 ──────────────────────────────────────────────────────────
  const momentumRaw = computeMomentumFactor(klineMap, 20);
  const volatilityRaw = computeVolatilityFactor(klineMap, 20);
  const technicalRaw = computeTechnicalFactors(klineMap);

  // 拆分技术因子为独立因子
  const rsiRaw = new Map<string, number>();
  const macdHistRaw = new Map<string, number>();
  for (const [code, tech] of technicalRaw) {
    rsiRaw.set(code, tech.rsi);
    macdHistRaw.set(code, tech.macdHist);
  }

  // Z-score 标准化
  const momentum = zScoreNormalize(momentumRaw);
  const volatility = zScoreNormalize(volatilityRaw);
  const rsiScores = zScoreNormalize(rsiRaw);
  const macdScores = zScoreNormalize(macdHistRaw);

  // 因子字典 (名称 -> 标准化值)
  const factors: Record<string, Map<string, number>> = {
    '动量': momentum,
    '波动率': volatility,
    'RSI': rsiScores,
    'MACD': macdScores,
  };

  // 原始因子值 (用于曝露度)
  const rawFactors: Record<string, Map<string, number>> = {
    '动量': momentumRaw,
    '波动率': volatilityRaw,
    'RSI': rsiRaw,
    'MACD': macdHistRaw,
  };

  // ── 计算因子曝露度 ────────────────────────────────────────────────────
  const exposures: FactorExposure[] = [];
  for (const [factorName, factorMap] of Object.entries(rawFactors)) {
    for (const [code, value] of factorMap) {
      exposures.push({
        factorName,
        stockCode: code,
        exposure: +value.toFixed(6),
      });
    }
  }

  // ── IC 分析 ───────────────────────────────────────────────────────────
  const forwardReturns = computeForwardReturns(klineMap, 20);
  const icResults: ICResult[] = [];

  for (const [factorName, factorMap] of Object.entries(factors)) {
    const ic = computeIC(factorMap, forwardReturns);

    // 滚动 IC 计算 (用于 IC IR)
    // 简化: 使用多个子窗口计算 IC 序列
    const icSeries = computeRollingIC(klineMap, factorName, factors[factorName]);
    const icMean = icSeries.length > 0 ? mean(icSeries) : ic;
    const icStd = icSeries.length > 1 ? stdDev(icSeries) : Math.abs(ic) > 0 ? Math.abs(ic) * 0.5 : 0.01;
    const icIR = icStd > 0 ? icMean / icStd : 0;

    const nStocks = [...factorMap.keys()].filter(c => forwardReturns.has(c)).length;
    const pValue = computeICPValue(ic, nStocks);

    icResults.push({
      factorName,
      ic: +ic.toFixed(4),
      icIR: +icIR.toFixed(4),
      pValue: +pValue.toFixed(4),
    });
  }

  // ── 综合评分 ──────────────────────────────────────────────────────────
  const defaultWeights: Record<string, number> = {
    '动量': 0.25,
    '波动率': 0.25,
    'RSI': 0.25,
    'MACD': 0.25,
  };
  const weights = factorWeights ?? defaultWeights;

  // 归一化权重
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  const normWeights: Record<string, number> = {};
  for (const [k, v] of Object.entries(weights)) {
    normWeights[k] = totalWeight > 0 ? v / totalWeight : 0;
  }

  // 注意: 波动率因子取反 (低波动率更好)
  const volatilityDirection: Record<string, number> = {
    '动量': 1,        // 高动量好
    '波动率': -1,     // 低波动率好
    'RSI': -1,        // RSI 中性偏低更好 (超买不好)
    'MACD': 1,        // MACD 柱状图正值更好
  };

  const rankings: FactorScore[] = [];
  const codes = [...klineMap.keys()];

  for (const code of codes) {
    const scores: Record<string, number> = {};
    let composite = 0;

    for (const [factorName, factorMap] of Object.entries(factors)) {
      const score = factorMap.get(code) ?? 0;
      const direction = volatilityDirection[factorName] ?? 1;
      const adjustedScore = score * direction;
      scores[factorName] = +score.toFixed(4);
      const w = normWeights[factorName] ?? 0;
      composite += adjustedScore * w;
    }

    rankings.push({
      stockCode: code,
      stockName: nameMap.get(code) ?? code,
      scores,
      compositeScore: +composite.toFixed(4),
    });
  }

  // 按综合得分降序排列
  rankings.sort((a, b) => b.compositeScore - a.compositeScore);

  return { exposures, icResults, rankings };
}

// ── 滚动 IC 计算 ────────────────────────────────────────────────────────────

/**
 * 使用自举 (bootstrap) 方法计算滚动 IC 序列。
 *
 * 将数据按时间分成多个子窗口，每个窗口计算一次 IC，
 * 用于估算 IC 的稳定性 (IC IR)。
 */
function computeRollingIC(
  klineMap: Map<string, OHLCVItem[]>,
  _factorName: string,
  factorScores: Map<string, number>,
): number[] {
  const icSeries: number[] = [];

  // 获取最短 K 线长度
  let minLen = Infinity;
  for (const kline of klineMap.values()) {
    if (kline.length < minLen) minLen = kline.length;
  }

  if (minLen < 60) return icSeries;

  const windowSize = 20;
  const stepSize = 10;
  const maxWindows = Math.min(12, Math.floor((minLen - 40) / stepSize));

  for (let w = 0; w < maxWindows; w++) {
    const endOffset = 20 + w * stepSize;
    if (endOffset >= minLen - windowSize) break;

    // 计算该窗口的前瞻收益
    const windowReturns = new Map<string, number>();
    for (const [code, kline] of klineMap) {
      const startIdx = kline.length - 1 - endOffset - windowSize;
      const endIdx = kline.length - 1 - endOffset;
      if (startIdx < 0 || endIdx < 0) continue;

      const startPrice = kline[startIdx].close;
      const endPrice = kline[endIdx].close;
      if (startPrice > 0) {
        windowReturns.set(code, (endPrice / startPrice) - 1);
      }
    }

    if (windowReturns.size >= 3) {
      const ic = computeIC(factorScores, windowReturns);
      icSeries.push(ic);
    }
  }

  return icSeries;
}
