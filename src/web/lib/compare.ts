import type { OHLCVItem } from './indicators';
import { macd, rsi, kdj, bollingerBands, sma } from './indicators';
import { dailyReturns, stdDev, mean } from './risk';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface StockData {
  code: string;
  name: string;
  klineData: OHLCVItem[];
}

export interface NormalizedReturn {
  dates: string[];
  series: { code: string; name: string; values: number[] }[];
}

export interface VolatilityComparison {
  stocks: { code: string; name: string; annualizedVol: number; dailyVol: number }[];
}

export interface CorrelationMatrix {
  stockNames: string[];
  matrix: number[][];
}

export interface MetricRanking {
  metric: string;
  rankings: { code: string; name: string; value: number }[];
}

export interface ComparisonSummary {
  bestReturn: { name: string; value: number };
  lowestVolatility: { name: string; value: number };
  highestSharpe: { name: string; value: number };
  description: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);
  const sumX2 = x.reduce((a, b) => a + b * b, 0);
  const sumY2 = y.reduce((a, b) => a + b * b, 0);
  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));
  return den === 0 ? 0 : num / den;
}

/** Build a date->close map for a stock */
function buildDateMap(items: OHLCVItem[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const item of items) m.set(item.date, item.close);
  return m;
}

/** Get sorted intersection of dates across all stocks */
function getCommonDates(stocks: StockData[]): string[] {
  if (stocks.length === 0) return [];
  const dateSets = stocks.map(s => new Set(s.klineData.map(k => k.date)));
  const common = Array.from(dateSets[0]).filter(d => dateSets.every(ds => ds.has(d)));
  return common.sort();
}

/** Get aligned close prices for common dates */
function getAlignedPrices(stocks: StockData[], commonDates: string[]): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (const stock of stocks) {
    const dateMap = buildDateMap(stock.klineData);
    const prices = commonDates.map(d => dateMap.get(d)!);
    result.set(stock.code, prices);
  }
  return result;
}

// ── Core Functions ──────────────────────────────────────────────────────────

export function normalizeReturns(stocks: StockData[]): NormalizedReturn {
  const commonDates = getCommonDates(stocks);
  if (commonDates.length === 0) return { dates: [], series: [] };

  const aligned = getAlignedPrices(stocks, commonDates);
  const series = stocks.map(stock => {
    const prices = aligned.get(stock.code)!;
    const base = prices[0];
    const values = prices.map(p => +(p / base * 100).toFixed(2));
    return { code: stock.code, name: stock.name, values };
  });

  return { dates: commonDates, series };
}

export function compareVolatility(stocks: StockData[]): VolatilityComparison {
  const result = stocks.map(stock => {
    const closes = stock.klineData.map(k => k.close);
    const returns = dailyReturns(closes);
    const dailyVol = stdDev(returns);
    const annualizedVol = dailyVol * Math.sqrt(252);
    return {
      code: stock.code,
      name: stock.name,
      annualizedVol: +annualizedVol.toFixed(4),
      dailyVol: +dailyVol.toFixed(6),
    };
  });
  return { stocks: result };
}

export function calculateCorrelation(stocks: StockData[]): CorrelationMatrix {
  const commonDates = getCommonDates(stocks);
  const aligned = getAlignedPrices(stocks, commonDates);

  // Calculate daily returns for each stock on common dates
  const returnsMap = new Map<string, number[]>();
  for (const stock of stocks) {
    const prices = aligned.get(stock.code)!;
    returnsMap.set(stock.code, dailyReturns(prices));
  }

  const stockNames = stocks.map(s => s.name);
  const n = stocks.length;
  const matrix: number[][] = [];

  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    const ri = returnsMap.get(stocks[i].code)!;
    for (let j = 0; j < n; j++) {
      if (i === j) {
        row.push(1);
      } else {
        const rj = returnsMap.get(stocks[j].code)!;
        row.push(+pearsonCorrelation(ri, rj).toFixed(4));
      }
    }
    matrix.push(row);
  }

  return { stockNames, matrix };
}

export function rankByReturn(stocks: StockData[]): MetricRanking {
  const rankings = stocks.map(stock => {
    const closes = stock.klineData.map(k => k.close);
    const totalReturn = closes.length >= 2
      ? (closes[closes.length - 1] - closes[0]) / closes[0]
      : 0;
    return { code: stock.code, name: stock.name, value: +totalReturn.toFixed(4) };
  });
  rankings.sort((a, b) => b.value - a.value);
  return { metric: '区间收益率', rankings };
}

export function rankByVolatility(stocks: StockData[]): MetricRanking {
  const rankings = stocks.map(stock => {
    const closes = stock.klineData.map(k => k.close);
    const returns = dailyReturns(closes);
    const annualizedVol = stdDev(returns) * Math.sqrt(252);
    return { code: stock.code, name: stock.name, value: +annualizedVol.toFixed(4) };
  });
  rankings.sort((a, b) => a.value - b.value);
  return { metric: '年化波动率', rankings };
}

export function rankBySharpe(stocks: StockData[]): MetricRanking {
  const rf = 0.025;
  const rankings = stocks.map(stock => {
    const closes = stock.klineData.map(k => k.close);
    const returns = dailyReturns(closes);
    const annualReturn = mean(returns) * 252;
    const annualVol = stdDev(returns) * Math.sqrt(252);
    const sharpe = annualVol > 0 ? (annualReturn - rf) / annualVol : 0;
    return { code: stock.code, name: stock.name, value: +sharpe.toFixed(4) };
  });
  rankings.sort((a, b) => b.value - a.value);
  return { metric: '夏普比率', rankings };
}

export function generateComparisonSummary(stocks: StockData[]): ComparisonSummary {
  const returnRanking = rankByReturn(stocks);
  const volRanking = rankByVolatility(stocks);
  const sharpeRanking = rankBySharpe(stocks);

  const bestReturn = returnRanking.rankings[0];
  const lowestVol = volRanking.rankings[0];
  const highestSharpe = sharpeRanking.rankings[0];

  const description =
    `在所选股票中，${bestReturn.name}区间收益率最高，为${(bestReturn.value * 100).toFixed(2)}%；` +
    `${lowestVol.name}波动率最低，年化波动率为${(lowestVol.value * 100).toFixed(2)}%；` +
    `${highestSharpe.name}风险调整后收益最优，夏普比率为${highestSharpe.value.toFixed(2)}。`;

  return {
    bestReturn: { name: bestReturn.name, value: bestReturn.value },
    lowestVolatility: { name: lowestVol.name, value: lowestVol.value },
    highestSharpe: { name: highestSharpe.name, value: highestSharpe.value },
    description,
  };
}

export function compareIndicators(
  stocks: StockData[],
): { code: string; name: string; macd: number; rsi: number; kdj_k: number; bollPosition: number; maTrend: string }[] {
  return stocks.map(stock => {
    const items = stock.klineData;
    const closes = items.map(k => k.close);
    const last = closes.length - 1;

    // MACD — latest histogram value
    const macdResult = macd(closes);
    const macdVal = macdResult.histogram[last] ?? 0;

    // RSI — latest value
    const rsiArr = rsi(closes, 14);
    const rsiVal = rsiArr[last] ?? 50;

    // KDJ — latest K value
    const kdjResult = kdj(items, 9);
    const kdjK = kdjResult.k[last] ?? 50;

    // Bollinger position — where close sits between lower and upper (0 = lower, 1 = upper)
    const boll = bollingerBands(closes, 20);
    const upper = boll.upper[last];
    const lower = boll.lower[last];
    let bollPosition = 0.5;
    if (upper !== null && lower !== null && upper !== lower) {
      bollPosition = +((closes[last] - lower) / (upper - lower)).toFixed(4);
    }

    // MA trend — compare MA5 vs MA20
    const ma5 = sma(closes, 5);
    const ma20 = sma(closes, 20);
    let maTrend = '横盘';
    if (ma5[last] !== null && ma20[last] !== null) {
      if (ma5[last]! > ma20[last]!) maTrend = '多头';
      else if (ma5[last]! < ma20[last]!) maTrend = '空头';
    }

    return {
      code: stock.code,
      name: stock.name,
      macd: +macdVal.toFixed(4),
      rsi: +rsiVal.toFixed(2),
      kdj_k: +kdjK.toFixed(2),
      bollPosition: +bollPosition.toFixed(4),
      maTrend,
    };
  });
}
