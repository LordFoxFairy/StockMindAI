import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { fetchKlineWithMeta } from "@/core/services/eastmoney";
import {
  macd, rsi, bollingerBands, kdj, maCross,
  type OHLCVItem,
} from "@/web/lib/indicators";
import {
  runBacktest,
  macdToSignals, rsiToSignals, bollingerToSignals, kdjToSignals, maCrossToSignals,
} from "@/web/lib/backtest";
import { runPrediction } from "@/web/lib/predict";

/**
 * Compute indicator signals for a given strategy.
 */
function computeSignals(
  items: OHLCVItem[],
  strategy: 'macd' | 'rsi' | 'bollinger' | 'kdj' | 'maCross',
  params?: Record<string, number>,
) {
  const closes = items.map(i => i.close);
  switch (strategy) {
    case 'macd': {
      const result = macd(closes, params?.fast ?? 12, params?.slow ?? 26, params?.signal ?? 9);
      return macdToSignals(result, items);
    }
    case 'rsi': {
      const result = rsi(closes, params?.period ?? 14);
      return rsiToSignals(result, items, params?.oversold ?? 30, params?.overbought ?? 70);
    }
    case 'bollinger': {
      const result = bollingerBands(closes, params?.period ?? 20, params?.multiplier ?? 2);
      return bollingerToSignals(result, items);
    }
    case 'kdj': {
      const result = kdj(items, params?.period ?? 9, params?.kSmooth ?? 3, params?.dSmooth ?? 3);
      return kdjToSignals(result, items);
    }
    case 'maCross': {
      const result = maCross(items, params?.shortPeriod ?? 5, params?.longPeriod ?? 20);
      return maCrossToSignals(result, items);
    }
  }
}

export const backtestStrategy = tool(
  async ({ symbol, strategy, params, period, days }: {
    symbol: string;
    strategy: 'macd' | 'rsi' | 'bollinger' | 'kdj' | 'maCross';
    params?: Record<string, number>;
    period?: 'daily' | 'weekly' | 'monthly';
    days?: number;
  }) => {
    try {
      const result = await fetchKlineWithMeta(symbol, period || 'daily', days || 120);
      if (typeof result === 'string') return result;

      const signals = computeSignals(result.items, strategy, params);
      const backtestResult = runBacktest(result.items, signals);

      return JSON.stringify({
        symbol: result.symbol,
        name: result.name,
        strategy,
        params: params || {},
        dataPoints: result.items.length,
        metrics: backtestResult.metrics,
        totalTrades: backtestResult.trades.length,
        trades: backtestResult.trades.slice(-10), // last 10 trades for context
      });
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      return `Error running backtest: ${errorMessage}`;
    }
  },
  {
    name: "backtest_strategy",
    description: "Run a backtest for a trading strategy on a specific stock. Returns performance metrics including Sharpe ratio, max drawdown, win rate, and total return.",
    schema: z.object({
      symbol: z.string().describe("Stock symbol (e.g., sh600519, sz300308)"),
      strategy: z.enum(['macd', 'rsi', 'bollinger', 'kdj', 'maCross']).describe("Strategy type"),
      params: z.record(z.string(), z.number()).optional().describe("Strategy parameters (e.g., {fast: 12, slow: 26, signal: 9} for MACD)"),
      period: z.enum(['daily', 'weekly', 'monthly']).optional().describe("Data period"),
      days: z.number().optional().describe("Data range in days/weeks/months"),
    }),
  }
);

export const optimizeStrategy = tool(
  async ({ symbol, strategy, paramRanges, period, days }: {
    symbol: string;
    strategy: 'macd' | 'rsi' | 'bollinger' | 'kdj' | 'maCross';
    paramRanges: Record<string, { min: number; max: number; step: number }>;
    period?: 'daily' | 'weekly' | 'monthly';
    days?: number;
  }) => {
    try {
      const result = await fetchKlineWithMeta(symbol, period || 'daily', days || 120);
      if (typeof result === 'string') return result;

      // Generate all parameter combinations
      const paramNames = Object.keys(paramRanges);
      const paramValues: number[][] = paramNames.map(name => {
        const { min, max, step } = paramRanges[name];
        const values: number[] = [];
        for (let v = min; v <= max; v += step) values.push(+v.toFixed(6));
        return values;
      });

      // Cartesian product with limit
      const MAX_COMBOS = 50;
      const combos: Record<string, number>[] = [];
      function generate(idx: number, current: Record<string, number>) {
        if (combos.length >= MAX_COMBOS) return;
        if (idx === paramNames.length) {
          combos.push({ ...current });
          return;
        }
        for (const val of paramValues[idx]) {
          if (combos.length >= MAX_COMBOS) return;
          current[paramNames[idx]] = val;
          generate(idx + 1, current);
        }
      }
      generate(0, {});

      // Run backtest for each combo
      const results: { params: Record<string, number>; sharpe: number; totalReturn: number; maxDrawdown: number; winRate: number; trades: number }[] = [];
      for (const combo of combos) {
        try {
          const signals = computeSignals(result.items, strategy, combo);
          const bt = runBacktest(result.items, signals);
          results.push({
            params: combo,
            sharpe: bt.metrics.sharpeRatio,
            totalReturn: bt.metrics.totalReturn,
            maxDrawdown: bt.metrics.maxDrawdown,
            winRate: bt.metrics.winRate,
            trades: bt.trades.length,
          });
        } catch {
          // Skip failed combos
        }
      }

      // Sort by Sharpe ratio descending
      results.sort((a, b) => b.sharpe - a.sharpe);

      return JSON.stringify({
        symbol: result.symbol,
        name: result.name,
        strategy,
        totalCombinations: combos.length,
        topResults: results.slice(0, 5),
      });
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      return `Error optimizing strategy: ${errorMessage}`;
    }
  },
  {
    name: "optimize_strategy",
    description: "Optimize strategy parameters by grid search. Tests multiple parameter combinations and returns the best results ranked by Sharpe ratio.",
    schema: z.object({
      symbol: z.string().describe("Stock symbol (e.g., sh600519, sz300308)"),
      strategy: z.enum(['macd', 'rsi', 'bollinger', 'kdj', 'maCross']).describe("Strategy type"),
      paramRanges: z.record(z.string(), z.object({
        min: z.number(),
        max: z.number(),
        step: z.number(),
      })).describe("Parameter ranges for grid search"),
      period: z.enum(['daily', 'weekly', 'monthly']).optional().describe("Data period"),
      days: z.number().optional().describe("Data range in days/weeks/months"),
    }),
  }
);

export const predictStock = tool(
  async ({ symbol, timeframe }: {
    symbol: string;
    timeframe?: 'short' | 'medium' | 'long';
  }) => {
    try {
      // Map timeframe to data range
      const daysMap: Record<string, number> = { short: 120, medium: 250, long: 500 };
      const days = daysMap[timeframe || 'medium'] || 250;

      const result = await fetchKlineWithMeta(symbol, 'daily', days);
      if (typeof result === 'string') return result;

      if (result.items.length < 30) {
        return `Not enough data for prediction (need at least 30 data points, got ${result.items.length}).`;
      }

      const prediction = runPrediction(result.items);
      const currentPrice = result.items[result.items.length - 1].close;

      return JSON.stringify({
        symbol: result.symbol,
        name: result.name,
        currentPrice,
        compositeScore: prediction.compositeScore,
        confidence: prediction.confidence,
        trend: prediction.trend,
        signals: prediction.signals.map(s => ({
          name: s.name,
          score: s.score,
          signal: s.signal,
          description: s.description,
        })),
        supportResistance: prediction.supportResistance,
        summary: prediction.summary,
      });
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      return `Error predicting stock: ${errorMessage}`;
    }
  },
  {
    name: "predict_stock",
    description: "\u5BF9\u6307\u5B9A\u80A1\u7968\u8FDB\u884C\u591A\u7EF4\u5EA6\u6280\u672F\u5206\u6790\u9884\u6D4B\u3002\u7EFC\u5408MACD/RSI/\u5E03\u6797\u5E26/KDJ/\u5747\u7EBF\u4E94\u5927\u6307\u6807\uFF0C\u8F93\u51FA\u7EFC\u5408\u8BC4\u5206(-100\u5230+100)\u3001\u8D8B\u52BF\u65B9\u5411\u3001\u652F\u6491\u963B\u529B\u4F4D\u548C\u5404\u6307\u6807\u4FE1\u53F7\u3002",
    schema: z.object({
      symbol: z.string().describe("Stock symbol"),
      timeframe: z.enum(['short', 'medium', 'long']).optional().describe("Analysis timeframe"),
    }),
  }
);
