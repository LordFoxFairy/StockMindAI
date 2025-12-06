import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { parseStockCode, fetchKlineWithMeta, fetchEastMoney } from "@/core/services/eastmoney";

export const queryStockData = tool(
  async ({ symbol }: { symbol: string }) => {
    try {
      const parsed = parseStockCode(symbol);
      if (typeof parsed === 'string') return parsed;

      const { secid, prefix, code } = parsed;
      const url = `http://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f116,f117,f170,f171`;
      const response = await fetch(url, {
        headers: {
          'Referer': 'https://quote.eastmoney.com',
        },
      });
      const json = await response.json() as {
        data?: Record<string, unknown> | null;
      };

      if (!json.data) {
        return `No data found for symbol ${symbol}. Please verify the stock code is correct.`;
      }

      const d = json.data;
      // East Money returns prices in units of 1/100 yuan (fen) for some fields
      const divisor = 100;
      const result = {
        symbol: `${prefix}${code}`,
        code: d.f57 as string,
        name: d.f58 as string,
        price: (d.f43 as number) / divisor,
        high: (d.f44 as number) / divisor,
        low: (d.f45 as number) / divisor,
        open: (d.f46 as number) / divisor,
        volume: d.f47 as number,       // in lots
        turnover: d.f48 as number,      // in yuan
        previousClose: (d.f60 as number) / divisor,
        totalMarketCap: d.f116 as number,
        floatMarketCap: d.f117 as number,
        changePercent: (d.f170 as number) / divisor,
        changeAmount: (d.f171 as number) / divisor,
      };

      return JSON.stringify(result);
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      return `Error fetching stock data: ${errorMessage}`;
    }
  },
  {
    name: "query_stock_data",
    description: "Query real-time stock quotes from East Money for A-share stocks. Accepts symbol formats: 'sh600519', 'sz300308', or bare 6-digit code like '300308'.",
    schema: z.object({
      symbol: z.string().describe("The stock symbol (e.g., sh600519, sz300308, or 300308)"),
    }),
  }
);

export const queryStockKline = tool(
  async ({ symbol, period }: { symbol: string; period?: string }) => {
    try {
      const result = await fetchKlineWithMeta(symbol, (period as 'daily' | 'weekly' | 'monthly') || 'daily', 30);
      if (typeof result === 'string') return result;

      const klines = result.items.map(item => ({
        ...item,
        turnover: 0,
        amplitude: '',
      }));

      return JSON.stringify({
        symbol: result.symbol,
        name: result.name,
        code: result.code,
        period: period || 'daily',
        count: klines.length,
        klines,
      });
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      return `Error fetching kline data: ${errorMessage}`;
    }
  },
  {
    name: "query_stock_kline",
    description: "Query historical kline (candlestick) data from East Money for A-share stocks. Returns up to 30 recent data points with OHLCV. Accepts 'sh600519', 'sz300308', or bare 6-digit code like '300308'.",
    schema: z.object({
      symbol: z.string().describe("The stock symbol (e.g., sh600519, sz300308, or 300308)"),
      period: z.enum(['daily', 'weekly', 'monthly']).optional().describe("Kline period: daily (default), weekly, or monthly"),
    }),
  }
);

export const queryStockNews = tool(
  async ({ symbol, count }: { symbol: string; count?: number }) => {
    try {
      const parsed = parseStockCode(symbol);
      if (typeof parsed === 'string') return parsed;

      const { code } = parsed;
      const limit = Math.min(count || 10, 20);

      // Use East Money search-api-web for stock news articles
      const param = JSON.stringify({
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
            pageSize: limit,
            preTag: "",
            postTag: "",
          },
        },
      });
      const apiUrl = `https://search-api-web.eastmoney.com/search/jsonp?cb=&param=${encodeURIComponent(param)}`;
      const json = await fetchEastMoney(apiUrl);

      const newsList = (json?.result?.cmsArticleWebOld || []) as Array<{
        title?: string;
        date?: string;
        mediaName?: string;
        url?: string;
        content?: string;
      }>;
      const results = newsList.map(item => ({
        title: (item.title || '').replace(/<[^>]*>/g, ''),
        date: item.date || '',
        source: item.mediaName || '',
        url: item.url || '',
        summary: (item.content || '').replace(/<[^>]*>/g, '').slice(0, 200),
      }));

      return JSON.stringify(results);
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      return `Error fetching stock news: ${errorMessage}`;
    }
  },
  {
    name: "query_stock_news",
    description: "\u67E5\u8BE2\u6307\u5B9A\u80A1\u7968\u7684\u6700\u65B0\u65B0\u95FB\u548C\u516C\u544A\u3002\u8F93\u5165\u80A1\u7968\u4EE3\u7801\uFF0C\u8FD4\u56DE\u6700\u65B0\u7684\u65B0\u95FB\u6807\u9898\u3001\u65E5\u671F\u3001\u6765\u6E90\u548C\u6458\u8981\u3002",
    schema: z.object({
      symbol: z.string().describe("\u80A1\u7968\u4EE3\u7801\uFF08\u5982\uFF1Ash600519\u3001sz300308\u3001\u6216 600519\uFF09"),
      count: z.number().optional().describe("\u8FD4\u56DE\u6761\u6570\uFF0C\u9ED8\u8BA410\u6761\uFF0C\u6700\u591A20\u6761"),
    }),
  }
);

export const queryStockFundamentals = tool(
  async ({ symbol }: { symbol: string }) => {
    try {
      const parsed = parseStockCode(symbol);
      if (typeof parsed === 'string') return parsed;

      const { secid, prefix, code } = parsed;
      const url = `http://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f57,f58,f43,f162,f163,f167,f164,f168,f114,f116,f117,f173,f183,f185,f186,f187`;
      const response = await fetch(url, {
        headers: { 'Referer': 'https://quote.eastmoney.com' },
      });
      const json = await response.json() as { data?: Record<string, any> | null };

      if (!json.data) {
        return `No data found for symbol ${symbol}.`;
      }

      const d = json.data;
      const num = (v: any) => (v === '-' || v === undefined || v === null) ? null : Number(v) || 0;

      const result = {
        symbol: `${prefix}${code}`,
        code: d.f57,
        name: d.f58,
        price: num(d.f43) !== null ? (num(d.f43) as number) / 100 : null,
        pe: num(d.f162),
        peStatic: num(d.f163),
        pb: num(d.f167),
        roe: num(d.f164),
        turnoverRate: num(d.f168),
        floatShares: num(d.f114),
        totalMarketCap: num(d.f116),
        floatMarketCap: num(d.f117),
        roa: num(d.f173),
        eps: num(d.f183),
        bvps: num(d.f185),
        ps: num(d.f186),
        cashFlowPerShare: num(d.f187),
      };

      return JSON.stringify(result);
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      return `Error fetching fundamentals: ${errorMessage}`;
    }
  },
  {
    name: "query_stock_fundamentals",
    description: "\u67E5\u8BE2\u80A1\u7968\u57FA\u672C\u9762\u6570\u636E\uFF0C\u5305\u62ECPE(\u5E02\u76C8\u7387)\u3001PB(\u5E02\u51C0\u7387)\u3001ROE(\u51C0\u8D44\u4EA7\u6536\u76CA\u7387)\u3001ROA\u3001EPS(\u6BCF\u80A1\u6536\u76CA)\u3001\u6BCF\u80A1\u51C0\u8D44\u4EA7\u3001\u5E02\u9500\u7387\u3001\u6BCF\u80A1\u73B0\u91D1\u6D41\u3001\u603B\u5E02\u503C\u3001\u6D41\u901A\u5E02\u503C\u7B49\u6307\u6807\u3002",
    schema: z.object({
      symbol: z.string().describe("\u80A1\u7968\u4EE3\u7801\uFF08\u5982\uFF1Ash600519\u3001sz300308\u3001\u6216 600519\uFF09"),
    }),
  }
);
