import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { fetchKlineWithMeta } from "@/core/services/eastmoney";
import { macd, rsi, type OHLCVItem } from "@/web/lib/indicators";

function spearmanRank(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0;
  const rankArr = (arr: number[]) => {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    for (let i = 0; i < n; i++) ranks[sorted[i].i] = i + 1;
    return ranks;
  };
  const rx = rankArr(x);
  const ry = rankArr(y);
  let sumD2 = 0;
  for (let i = 0; i < n; i++) sumD2 += (rx[i] - ry[i]) ** 2;
  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

export const factorAnalysis = tool(
  async ({ symbols, factors, days }: {
    symbols: string[];
    factors: string[];
    days?: number;
  }) => {
    try {
      if (symbols.length < 2 || symbols.length > 15) {
        return '因子分析需要2-15只股票。';
      }

      const d = days || 120;
      const dataPromises = symbols.map(s => fetchKlineWithMeta(s, 'daily', d));
      const results = await Promise.all(dataPromises);

      const stocks: { code: string; name: string; items: OHLCVItem[] }[] = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (typeof r === 'string') return `获取 ${symbols[i]} 数据失败: ${r}`;
        stocks.push({ code: r.symbol, name: r.name, items: r.items });
      }

      const exposures: { stockCode: string; factorName: string; exposure: number }[] = [];
      const scores: Record<string, Record<string, number>> = {};

      for (const stock of stocks) {
        const closes = stock.items.map(k => k.close);
        scores[stock.code] = {};

        for (const factor of factors) {
          let value = 0;

          if (factor === 'momentum') {
            if (closes.length >= 20) {
              value = (closes[closes.length - 1] - closes[closes.length - 20]) / closes[closes.length - 20];
            }
          } else if (factor === 'volatility') {
            if (closes.length >= 20) {
              const rets: number[] = [];
              for (let i = closes.length - 20; i < closes.length; i++) {
                if (i > 0) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
              }
              const m = rets.reduce((s, v) => s + v, 0) / rets.length;
              const variance = rets.reduce((s, v) => s + (v - m) ** 2, 0) / rets.length;
              value = -Math.sqrt(variance) * Math.sqrt(252); // negative: lower vol = better
            }
          } else if (factor === 'rsi') {
            const rsiVals = rsi(closes, 14);
            const lastRsi = rsiVals.filter((v): v is number => v !== null);
            if (lastRsi.length > 0) {
              const r = lastRsi[lastRsi.length - 1];
              // Normalize: 30-70 is neutral, below 30 is bullish, above 70 is bearish
              value = r < 50 ? (50 - r) / 50 : -(r - 50) / 50;
            }
          } else if (factor === 'macd') {
            const macdResult = macd(closes);
            const hist = macdResult.histogram.filter((v): v is number => v !== null);
            if (hist.length > 0) {
              value = hist[hist.length - 1];
            }
          }

          scores[stock.code][factor] = +value.toFixed(6);
          exposures.push({ stockCode: stock.code, factorName: factor, exposure: +value.toFixed(6) });
        }
      }

      // Compute IC: correlation between factor scores and forward 20-day returns
      const icResults: { factorName: string; ic: number; pValue: number }[] = [];
      for (const factor of factors) {
        const factorScores: number[] = [];
        const forwardReturns: number[] = [];
        for (const stock of stocks) {
          const closes = stock.items.map(k => k.close);
          if (closes.length >= 40) {
            factorScores.push(scores[stock.code][factor] || 0);
            const fwdRet = (closes[closes.length - 1] - closes[closes.length - 20]) / closes[closes.length - 20];
            forwardReturns.push(fwdRet);
          }
        }
        const ic = factorScores.length >= 3 ? spearmanRank(factorScores, forwardReturns) : 0;
        const n = factorScores.length;
        const tStat = n > 2 ? ic * Math.sqrt((n - 2) / (1 - ic * ic + 1e-10)) : 0;
        const pValue = n > 2 ? Math.exp(-0.5 * tStat * tStat) : 1; // approximate
        icResults.push({ factorName: factor, ic: +ic.toFixed(4), pValue: +pValue.toFixed(4) });
      }

      // Composite ranking (equal weight)
      const rankings = stocks.map(stock => {
        const factorScores = scores[stock.code];
        const values = factors.map(f => factorScores[f] || 0);
        // Normalize each factor to z-score across stocks
        const composite = values.reduce((s, v) => s + v, 0) / values.length;
        return {
          code: stock.code,
          name: stock.name,
          scores: factorScores,
          compositeScore: +composite.toFixed(6),
        };
      }).sort((a, b) => b.compositeScore - a.compositeScore);

      return JSON.stringify({ rankings, exposures, icResults });
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      return `因子分析错误: ${errorMessage}`;
    }
  },
  {
    name: "factor_analysis",
    description: "多因子选股分析。计算动量、波动率、RSI、MACD等因子对多只股票的暴露度、IC值和综合排名。用于量化选股和因子研究。",
    schema: z.object({
      symbols: z.array(z.string()).min(2).max(15).describe("股票代码数组"),
      factors: z.array(z.enum(['momentum', 'volatility', 'rsi', 'macd'])).describe("因子列表"),
      days: z.number().optional().describe("历史数据天数，默认120天"),
    }),
  }
);

export const factorTools = [factorAnalysis];
