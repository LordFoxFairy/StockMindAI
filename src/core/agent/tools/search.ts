import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { search, searchNews, SafeSearchType, SearchTimeType } from "duck-duck-scrape";
import { parseStockCode } from "@/core/services/eastmoney";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const MAX_RETRIES = 2;

export const duckduckgoSearch = tool(
  async ({ query }: { query: string }) => {
    let lastError = '';
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          await sleep(1000 * Math.pow(2, attempt));
        }
        const results = [];
        const searchResults = await search(query, {
          safeSearch: SafeSearchType.MODERATE as any,
        });
        let count = 0;
        for (const result of searchResults.results) {
          if (count >= 5) break;
          results.push({
            title: result.title,
            href: result.url,
            body: result.description,
          });
          count++;
        }
        return JSON.stringify(results);
      } catch (e: unknown) {
        lastError = e instanceof Error ? e.message : 'Unknown error';
        if (lastError.includes('anomaly') || lastError.includes('rate limit')) {
          if (attempt < MAX_RETRIES) continue;
        } else {
          break;
        }
      }
    }
    return `Search is temporarily unavailable (${lastError}). Please try a different query or ask me to use other tools for stock data.`;
  },
  {
    name: "internet_search",
    description: "Search the internet using DuckDuckGo for current events and real-time information.",
    schema: z.object({
      query: z.string().describe("The search query"),
    }),
  }
);

export const searchNewsTool = tool(
  async ({ query, timeRange }: { query: string; timeRange?: string }) => {
    let lastError = '';
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          await sleep(1000 * Math.pow(2, attempt));
        }
        const timeMap: Record<string, SearchTimeType> = {
          day: SearchTimeType.DAY,
          week: SearchTimeType.WEEK,
          month: SearchTimeType.MONTH,
        };
        const results = await searchNews(query, {
          locale: 'zh-cn',
          ...(timeRange && timeMap[timeRange] ? { time: timeMap[timeRange] } : {}),
        });
        const items = results.results.slice(0, 8).map(r => ({
          title: r.title,
          url: r.url,
          excerpt: r.excerpt,
          date: new Date(r.date * 1000).toISOString().split('T')[0],
          source: r.syndicate,
        }));
        return JSON.stringify(items);
      } catch (e: unknown) {
        lastError = e instanceof Error ? e.message : 'Unknown error';
        if (lastError.includes('anomaly') || lastError.includes('rate limit')) {
          if (attempt < MAX_RETRIES) continue;
        } else {
          break;
        }
      }
    }
    return `News search is temporarily unavailable (${lastError}). Please try a different query.`;
  },
  {
    name: "search_news",
    description: "\u641C\u7D22\u8D22\u7ECF\u65B0\u95FB\u548C\u8D44\u8BAF\uFF0C\u652F\u6301\u6309\u65F6\u95F4\u8303\u56F4\u7B5B\u9009\u3002\u9002\u5408\u641C\u7D22\u884C\u4E1A\u52A8\u6001\u3001\u5B8F\u89C2\u7ECF\u6D4E\u65B0\u95FB\u3001\u653F\u7B56\u53D8\u5316\u7B49\u3002",
    schema: z.object({
      query: z.string().describe("\u641C\u7D22\u5173\u952E\u8BCD"),
      timeRange: z.enum(['day', 'week', 'month']).optional().describe("\u65F6\u95F4\u8303\u56F4\uFF1Aday(\u4E00\u5929\u5185)\u3001week(\u4E00\u5468\u5185)\u3001month(\u4E00\u6708\u5185)"),
    }),
  }
);

export const searchStockInfo = tool(
  async ({ keyword }: { keyword: string }) => {
    try {
      // Step 1: Search for matching stocks
      const searchUrl = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(keyword)}&type=14&count=5`;
      const searchRes = await fetch(searchUrl, {
        headers: { 'Referer': 'https://quote.eastmoney.com' },
      });
      const searchJson = await searchRes.json() as {
        QuotationCodeTable?: { Data?: Array<{ Code: string; Name: string; MktNum: string; SecurityTypeName: string }> };
      };

      const suggestions = searchJson?.QuotationCodeTable?.Data || [];
      if (suggestions.length === 0) {
        return `No stocks found matching "${keyword}".`;
      }

      // Step 2: Fetch quote data for each matched stock
      const results = [];
      for (const item of suggestions) {
        const market = item.MktNum === '0' ? 'sz' : item.MktNum === '1' ? 'sh' : '';
        if (!market) continue;

        const secid = market === 'sz' ? `0.${item.Code}` : `1.${item.Code}`;
        const quoteUrl = `http://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f47,f116,f117,f170,f57,f58`;
        const quoteRes = await fetch(quoteUrl, {
          headers: { 'Referer': 'https://quote.eastmoney.com' },
        });
        const quoteJson = await quoteRes.json() as { data?: Record<string, any> | null };
        const d = quoteJson?.data;

        results.push({
          code: `${market}${item.Code}`,
          name: item.Name,
          market: market === 'sh' ? '\u4E0A\u6D77' : '\u6DF1\u5733',
          type: item.SecurityTypeName || '',
          price: d ? (d.f43 as number) / 100 : null,
          changePercent: d ? (d.f170 as number) / 100 : null,
          volume: d ? d.f47 : null,
          marketCap: d ? d.f116 : null,
        });
      }

      return JSON.stringify(results);
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      return `Error searching stock info: ${errorMessage}`;
    }
  },
  {
    name: "search_stock_info",
    description: "\u6309\u540D\u79F0\u3001\u4EE3\u7801\u6216\u5173\u952E\u8BCD\u641C\u7D22\u80A1\u7968\u4FE1\u606F\u3002\u8FD4\u56DE\u5339\u914D\u80A1\u7968\u7684\u4EE3\u7801\u3001\u540D\u79F0\u3001\u5E02\u573A\u3001\u4EF7\u683C\u3001\u6DA8\u8DCC\u5E45\u3001\u6210\u4EA4\u91CF\u548C\u5E02\u503C\u3002",
    schema: z.object({
      keyword: z.string().describe("\u80A1\u7968\u540D\u79F0\u3001\u4EE3\u7801\u6216\u5173\u952E\u8BCD\uFF08\u5982\uFF1A\u8305\u53F0\u3001\u94F6\u884C\u3001\u65B0\u80FD\u6E90\uFF09"),
    }),
  }
);
