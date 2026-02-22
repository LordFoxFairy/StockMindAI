import { type OHLCVItem } from "@/web/lib/indicators";
import {
  macd, rsi, bollingerBands, kdj, maCross,
} from "@/web/lib/indicators";
import {
  runBacktest,
  macdToSignals, rsiToSignals, bollingerToSignals, kdjToSignals, maCrossToSignals,
  type BacktestConfig,
} from "@/web/lib/backtest";
import {
  calculateRiskMetrics, monteCarloSimulation, stressTest, dailyReturns,
} from "@/web/lib/risk";
import { runPrediction } from "@/web/lib/predict";
import {
  normalizeReturns, compareVolatility, calculateCorrelation,
  rankByReturn, rankBySharpe, compareIndicators, generateComparisonSummary,
  type StockData,
} from "@/web/lib/compare";
import {
  fetchEastMoney, fetchKline, resolveSecid,
} from "@/core/services/eastmoney";
import { jsonResponse, errorResponse } from "./shared";

/**
 * Compute indicator signals for a given strategy (server-side version for API routes).
 */
function computeSignalsServer(
  items: OHLCVItem[],
  strategy: string,
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
    default:
      throw new Error(`Unknown strategy: ${strategy}`);
  }
}

export async function handleAnalysisRoute(req: Request, url: URL): Promise<Response | null> {
  // =========================================================================
  // POST /api/backtest — 策略回测 (backtest a strategy)
  // =========================================================================
  if (req.method === "POST" && url.pathname === "/api/backtest") {
    try {
      const body = await req.json();
      const { code, strategy, params, period, days, config } = body as {
        code: string;
        strategy: string;
        params?: Record<string, number>;
        period?: number;
        days?: number;
        config?: BacktestConfig;
      };

      if (!code || !strategy) {
        return errorResponse("Missing required fields: code, strategy", 400);
      }

      const klt = period || 101;
      const lmt = days || 120;
      const items = await fetchKline(code, lmt, klt);
      if (items.length === 0) {
        return errorResponse(`No kline data found for ${code}`, 404);
      }

      const signals = computeSignalsServer(items, strategy, params);
      const result = runBacktest(items, signals, config);
      return jsonResponse(result);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error("Error in backtest route:", err);
      return errorResponse(errorMessage);
    }
  }

  // =========================================================================
  // POST /api/risk — 风险分析 (risk analysis)
  // =========================================================================
  if (req.method === "POST" && url.pathname === "/api/risk") {
    try {
      const body = await req.json();
      const { code, period, days } = body as {
        code: string;
        period?: number;
        days?: number;
      };

      if (!code) {
        return errorResponse("Missing required field: code", 400);
      }

      const klt = period || 101;
      const lmt = days || 250;
      const items = await fetchKline(code, lmt, klt);
      if (items.length < 2) {
        return errorResponse(`Not enough data for risk analysis on ${code}`, 404);
      }

      const closes = items.map(i => i.close);
      const returns = dailyReturns(closes);
      const riskMetrics = calculateRiskMetrics(returns);
      const monteCarlo = monteCarloSimulation(returns, 60, 500, closes[closes.length - 1]);
      const stress = stressTest(closes[closes.length - 1], returns);

      return jsonResponse({
        code,
        dataPoints: items.length,
        riskMetrics,
        monteCarlo,
        stressTest: stress,
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error("Error in risk route:", err);
      return errorResponse(errorMessage);
    }
  }

  // =========================================================================
  // POST /api/optimize — 策略参数优化 (strategy parameter optimization)
  // =========================================================================
  if (req.method === "POST" && url.pathname === "/api/optimize") {
    try {
      const body = await req.json();
      const { code, strategy, paramRanges, period, days } = body as {
        code: string;
        strategy: string;
        paramRanges: Record<string, { min: number; max: number; step: number }>;
        period?: number;
        days?: number;
      };

      if (!code || !strategy || !paramRanges) {
        return errorResponse("Missing required fields: code, strategy, paramRanges", 400);
      }

      const klt = period || 101;
      const lmt = days || 120;
      const items = await fetchKline(code, lmt, klt);
      if (items.length === 0) {
        return errorResponse(`No kline data found for ${code}`, 404);
      }

      const MAX_COMBOS = 50;
      const paramNames = Object.keys(paramRanges);
      const paramValues: number[][] = paramNames.map(name => {
        const { min, max, step } = paramRanges[name];
        const values: number[] = [];
        for (let v = min; v <= max; v += step) values.push(+v.toFixed(6));
        return values;
      });

      const combos: Record<string, number>[] = [];
      function generateCombos(idx: number, current: Record<string, number>) {
        if (combos.length >= MAX_COMBOS) return;
        if (idx === paramNames.length) {
          combos.push({ ...current });
          return;
        }
        for (const val of paramValues[idx]) {
          if (combos.length >= MAX_COMBOS) return;
          current[paramNames[idx]] = val;
          generateCombos(idx + 1, current);
        }
      }
      generateCombos(0, {});

      const results: { params: Record<string, number>; sharpe: number; totalReturn: number; maxDrawdown: number; winRate: number; trades: number }[] = [];
      for (const combo of combos) {
        try {
          const signals = computeSignalsServer(items, strategy, combo);
          const bt = runBacktest(items, signals);
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

      results.sort((a, b) => b.sharpe - a.sharpe);

      return jsonResponse({
        code,
        strategy,
        totalCombinations: combos.length,
        topResults: results.slice(0, 10),
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error("Error in optimize route:", err);
      return errorResponse(errorMessage);
    }
  }

  // =========================================================================
  // POST /api/predict — AI 预测分析 (multi-indicator prediction)
  // =========================================================================
  if (req.method === "POST" && url.pathname === "/api/predict") {
    try {
      const body = await req.json();
      const { code, period, days: reqDays } = body as {
        code: string;
        period?: number;
        days?: number;
      };

      if (!code) {
        return errorResponse("Missing required field: code", 400);
      }

      const klt = period || 101;
      const lmt = reqDays || 120;
      const items = await fetchKline(code, lmt, klt);
      if (items.length < 30) {
        return errorResponse(`Not enough data for prediction on ${code} (need ≥30, got ${items.length})`, 404);
      }

      const prediction = runPrediction(items);
      const currentPrice = items[items.length - 1].close;

      return jsonResponse({
        code,
        currentPrice,
        dataPoints: items.length,
        ...prediction,
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error("Error in predict route:", err);
      return errorResponse(errorMessage);
    }
  }

  // =========================================================================
  // POST /api/compare — 多股对比分析 (multi-stock comparison)
  // =========================================================================
  if (req.method === "POST" && url.pathname === "/api/compare") {
    try {
      const body = await req.json();
      const { codes, period, days: reqDays } = body as {
        codes: string[];
        period?: number;
        days?: number;
      };

      if (!codes || !Array.isArray(codes) || codes.length < 2 || codes.length > 10) {
        return errorResponse("codes must be an array of 2-10 stock codes", 400);
      }

      const klt = period || 101;
      const lmt = reqDays || 60;

      const stockDataList: StockData[] = [];
      for (const code of codes) {
        const items = await fetchKline(code, lmt, klt);
        if (items.length === 0) {
          return errorResponse(`No kline data found for ${code}`, 404);
        }

        const secid = resolveSecid(code);
        let stockName = code;
        try {
          const quoteUrl = `http://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f58`;
          const quoteJson = await fetchEastMoney(quoteUrl);
          if (quoteJson?.data?.f58) stockName = quoteJson.data.f58;
        } catch { /* use code as fallback name */ }

        stockDataList.push({ code, name: stockName, klineData: items });
      }

      const normalized = normalizeReturns(stockDataList);
      const volatility = compareVolatility(stockDataList);
      const correlation = calculateCorrelation(stockDataList);
      const returnRanking = rankByReturn(stockDataList);
      const sharpeRanking = rankBySharpe(stockDataList);
      const indicators = compareIndicators(stockDataList);
      const summary = generateComparisonSummary(stockDataList);

      return jsonResponse({
        codes,
        dataPoints: stockDataList.map(s => ({ code: s.code, name: s.name, count: s.klineData.length })),
        normalizedReturns: normalized,
        volatility,
        correlation,
        returnRanking,
        sharpeRanking,
        indicators,
        summary,
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error("Error in compare route:", err);
      return errorResponse(errorMessage);
    }
  }

  // =========================================================================
  // POST /api/stock/screen — 股票筛选
  // =========================================================================
  if (req.method === "POST" && url.pathname === "/api/stock/screen") {
    try {
      const body = await req.json() as { conditions?: { field: string; operator: string; value: number }[]; limit?: number };
      const { conditions = [], limit = 20 } = body;
      const maxResults = Math.min(limit, 50);

      const screenUrl = `http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=200&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,0+t:80,m:1+t:2,m:1+t:23&fields=f2,f3,f5,f8,f9,f12,f14,f20,f23,f37,f55`;
      const json = await fetchEastMoney(screenUrl) as { data?: { diff?: any[] } };

      if (!json?.data?.diff) {
        return jsonResponse({ totalMatched: 0, stocks: [] });
      }

      let list = json.data.diff.map((d: any) => ({
        code: d.f12, name: d.f14, price: d.f2, changePercent: d.f3,
        turnover: d.f8, pe: d.f9, marketCap: d.f20, pb: d.f23, roe: d.f37, eps: d.f55,
      }));

      for (const c of conditions) {
        list = list.filter((s: any) => {
          const v = Number(s[c.field as keyof typeof s]);
          if (isNaN(v)) return false;
          switch (c.operator) {
            case '>': return v > c.value;
            case '<': return v < c.value;
            case '>=': return v >= c.value;
            case '<=': return v <= c.value;
            default: return true;
          }
        });
      }

      return jsonResponse({ totalMatched: list.length, stocks: list.slice(0, maxResults) });
    } catch (e: unknown) {
      return errorResponse(e instanceof Error ? e.message : 'Unknown error');
    }
  }

  return null;
}
