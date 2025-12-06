import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { fetchKlineWithMeta } from "@/core/services/eastmoney";
import {
  normalizeReturns, compareVolatility, calculateCorrelation,
  rankByReturn, rankBySharpe, compareIndicators, generateComparisonSummary,
  type StockData,
} from "@/web/lib/compare";
import { dailyReturns, calculateRiskMetrics, monteCarloSimulation, stressTest } from "@/web/lib/risk";

export const compareStocks = tool(
  async ({ symbols, days }: { symbols: string[]; days?: number }) => {
    try {
      if (symbols.length < 2 || symbols.length > 5) {
        return 'compare_stocks requires 2-5 stock symbols.';
      }

      const dataPromises = symbols.map(s => fetchKlineWithMeta(s, 'daily', days || 60));
      const results = await Promise.all(dataPromises);

      const stockDataList: StockData[] = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (typeof r === 'string') return `Error fetching ${symbols[i]}: ${r}`;
        stockDataList.push({ code: r.symbol, name: r.name, klineData: r.items });
      }

      const normalized = normalizeReturns(stockDataList);
      const volatility = compareVolatility(stockDataList);
      const correlation = calculateCorrelation(stockDataList);
      const returnRanking = rankByReturn(stockDataList);
      const sharpeRanking = rankBySharpe(stockDataList);
      const indicators = compareIndicators(stockDataList);
      const summary = generateComparisonSummary(stockDataList);

      // Trim normalized returns to avoid excessive data
      const trimmedNormalized = {
        dates: normalized.dates.length > 30
          ? normalized.dates.filter((_: string, i: number) => i % Math.ceil(normalized.dates.length / 30) === 0 || i === normalized.dates.length - 1)
          : normalized.dates,
        series: normalized.series.map((s: { code: string; name: string; values: number[] }) => ({
          code: s.code,
          name: s.name,
          values: s.values.length > 30
            ? s.values.filter((_: number, i: number) => i % Math.ceil(s.values.length / 30) === 0 || i === s.values.length - 1)
            : s.values,
        })),
      };

      return JSON.stringify({
        normalizedReturns: trimmedNormalized,
        volatility,
        correlation,
        returnRanking,
        sharpeRanking,
        indicators,
        summary,
      });
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      return `Error comparing stocks: ${errorMessage}`;
    }
  },
  {
    name: "compare_stocks",
    description: "\u5BF9\u6BD4\u591A\u53EA\u80A1\u7968\u7684\u6536\u76CA\u3001\u6CE2\u52A8\u7387\u3001\u76F8\u5173\u6027\u3001\u6280\u672F\u6307\u6807\uFF0C\u7ED9\u51FA\u7EFC\u5408\u6392\u540D\u548C\u603B\u7ED3\u3002\u652F\u63012-5\u53EA\u80A1\u7968\u540C\u65F6\u5BF9\u6BD4\u3002",
    schema: z.object({
      symbols: z.array(z.string()).min(2).max(5).describe("\u80A1\u7968\u4EE3\u7801\u6570\u7EC4\uFF08\u5982\uFF1A['sh600519', 'sz000858']\uFF09"),
      days: z.number().optional().describe("\u6570\u636E\u5929\u6570\uFF0C\u9ED8\u8BA460\u5929"),
    }),
  }
);

export const riskAnalysis = tool(
  async ({ symbol, days }: { symbol: string; days?: number }) => {
    try {
      const result = await fetchKlineWithMeta(symbol, 'daily', days || 250);
      if (typeof result === 'string') return result;

      if (result.items.length < 10) {
        return `Not enough data for risk analysis (need at least 10 data points, got ${result.items.length}).`;
      }

      const closes = result.items.map(i => i.close);
      const returns = dailyReturns(closes);
      const riskMetrics = calculateRiskMetrics(returns);
      const currentPrice = closes[closes.length - 1];
      const monteCarlo = monteCarloSimulation(returns, 60, 200, currentPrice);
      const stress = stressTest(currentPrice, returns);

      // Strip full paths from Monte Carlo to keep response small
      const monteCarloSummary = {
        simulationDays: 60,
        simulationCount: 200,
        finalPricePercentiles: {
          p5: monteCarlo.percentiles.p5[monteCarlo.percentiles.p5.length - 1],
          p25: monteCarlo.percentiles.p25[monteCarlo.percentiles.p25.length - 1],
          p50: monteCarlo.percentiles.p50[monteCarlo.percentiles.p50.length - 1],
          p75: monteCarlo.percentiles.p75[monteCarlo.percentiles.p75.length - 1],
          p95: monteCarlo.percentiles.p95[monteCarlo.percentiles.p95.length - 1],
        },
        varFromMC: monteCarlo.varFromMC,
        cVarFromMC: monteCarlo.cVarFromMC,
      };

      return JSON.stringify({
        symbol: result.symbol,
        name: result.name,
        currentPrice,
        dataPoints: result.items.length,
        riskMetrics,
        monteCarlo: monteCarloSummary,
        stressTest: stress,
      });
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      return `Error analyzing risk: ${errorMessage}`;
    }
  },
  {
    name: "risk_analysis",
    description: "\u5206\u6790\u80A1\u7968\u98CE\u9669\uFF0C\u5305\u62ECVaR/CVaR\u3001\u5E74\u5316\u6CE2\u52A8\u7387\u3001\u504F\u5EA6/\u5CF0\u5EA6\u3001\u8499\u7279\u5361\u6D1B\u6A21\u62DF\uFF0860\u5929200\u6B21\uFF09\u3001\u538B\u529B\u6D4B\u8BD5\uFF08\u91D1\u878D\u5371\u673A/\u80A1\u707E/\u75AB\u60C5\u7B49\u573A\u666F\uFF09\u3002",
    schema: z.object({
      symbol: z.string().describe("\u80A1\u7968\u4EE3\u7801\uFF08\u5982\uFF1Ash600519\u3001sz300308\u3001\u6216 600519\uFF09"),
      days: z.number().optional().describe("\u5386\u53F2\u6570\u636E\u5929\u6570\uFF0C\u9ED8\u8BA4250\u5929\uFF08\u7EA6\u4E00\u5E74\uFF09"),
    }),
  }
);
