import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { parseStockCode, fetchKlineWithMeta, fetchEastMoney } from "@/core/services/eastmoney";
import { runPrediction } from "@/web/lib/predict";

export const deepPredictStock = tool(
  async ({ stockCode, stockName }: { stockCode: string; stockName?: string }) => {
    try {
      const parsed = parseStockCode(stockCode);
      if (typeof parsed === 'string') return parsed;

      const { secid, prefix, code } = parsed;
      const symbol = `${prefix}${code}`;
      const displayName = stockName || symbol;

      // Fetch real-time quote
      const quoteUrl = `http://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f116,f117,f162,f163,f164,f167,f168,f170,f171,f173,f183,f185`;
      const quoteRes = await fetch(quoteUrl, {
        headers: { 'Referer': 'https://quote.eastmoney.com' },
      });
      const quoteJson = await quoteRes.json() as { data?: Record<string, any> | null };
      const q = quoteJson.data;

      let quoteData: Record<string, any> = {};
      if (q) {
        const num = (v: any) => (v === '-' || v == null) ? null : Number(v) || 0;
        quoteData = {
          name: q.f58,
          price: num(q.f43) !== null ? (num(q.f43) as number) / 100 : null,
          high: num(q.f44) !== null ? (num(q.f44) as number) / 100 : null,
          low: num(q.f45) !== null ? (num(q.f45) as number) / 100 : null,
          open: num(q.f46) !== null ? (num(q.f46) as number) / 100 : null,
          previousClose: num(q.f60) !== null ? (num(q.f60) as number) / 100 : null,
          changePercent: num(q.f170) !== null ? (num(q.f170) as number) / 100 : null,
          pe: num(q.f162),
          pb: num(q.f167),
          roe: num(q.f164),
          eps: num(q.f183),
          totalMarketCap: num(q.f116),
        };
      }

      // Fetch kline data (120 days)
      const klineResult = await fetchKlineWithMeta(symbol, 'daily', 120);
      let technicalAnalysis: Record<string, any> = {};
      if (typeof klineResult !== 'string') {
        const prediction = runPrediction(klineResult.items);
        technicalAnalysis = {
          compositeScore: prediction.compositeScore,
          trend: prediction.trend,
          signals: prediction.signals,
          confidence: prediction.confidence,
          supportResistance: {
            supports: prediction.supportResistance.supports.slice(0, 3),
            resistances: prediction.supportResistance.resistances.slice(0, 3),
          },
        };
      }

      // Fetch news
      let newsItems: { title: string; date: string }[] = [];
      try {
        const newsParam = JSON.stringify({
          uid: "",
          keyword: code,
          type: ["cmsArticleWebOld"],
          client: "web",
          clientType: "web",
          clientVersion: "curr",
          param: {
            cmsArticleWebOld: {
              searchScope: "default",
              sort: "default",
              pageIndex: 1,
              pageSize: 5,
              preTag: "",
              postTag: "",
            },
          },
        });
        const newsUrl = `https://search-api-web.eastmoney.com/search/jsonp?cb=&param=${encodeURIComponent(newsParam)}`;
        const newsJson = await fetchEastMoney(newsUrl);
        const newsList = (newsJson?.result?.cmsArticleWebOld || []) as Array<{
          title?: string;
          date?: string;
        }>;
        newsItems = newsList.map(item => ({
          title: (item.title || '').replace(/<[^>]*>/g, ''),
          date: item.date || '',
        }));
      } catch {
        // news fetch is optional
      }

      const result = {
        symbol,
        name: displayName,
        quote: quoteData,
        technical: technicalAnalysis,
        recentNews: newsItems,
        analysisDate: new Date().toISOString().split('T')[0],
      };

      return JSON.stringify(result);
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      return `Error in deep prediction analysis: ${errorMessage}`;
    }
  },
  {
    name: "deep_predict_stock",
    description:
      "对指定股票进行深度预测分析，综合实时行情、技术指标、基本面数据和最新新闻，返回全面的预测报告。包含趋势判断、目标价位、支撑阻力位、多指标信号和新闻面分析。",
    schema: z.object({
      stockCode: z
        .string()
        .describe("股票代码（如：sh600519、sz300308、或纯6位数字 600519）"),
      stockName: z
        .string()
        .optional()
        .describe("股票名称（可选，用于显示）"),
    }),
  },
);
