import { createDeepAgent, CompositeBackend, StateBackend, StoreBackend } from "deepagents";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { search, SafeSearchType } from "duck-duck-scrape";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const MAX_RETRIES = 2;

const duckduckgoSearch = tool(
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

/**
 * Parse a user-provided stock symbol into a secid for East Money APIs.
 * Accepts: "sz300308", "sh600519", "300308", "600519", "000001"
 * Returns: { secid: "0.300308", prefix: "sz", code: "300308" } or an error string.
 */
function parseSecid(symbol: string): { secid: string; prefix: string; code: string } | string {
  const clean = symbol.toLowerCase().replace(/[^a-z0-9]/g, '');
  let prefix: string;
  let code: string;

  if (clean.startsWith('sz')) {
    prefix = 'sz';
    code = clean.slice(2);
  } else if (clean.startsWith('sh')) {
    prefix = 'sh';
    code = clean.slice(2);
  } else if (/^\d{6}$/.test(clean)) {
    // Bare 6-digit code: infer exchange from code range
    // Shanghai main board: 6xxxxx; Shanghai STAR: 688xxx
    // Shenzhen: 0xxxxx, 3xxxxx (ChiNext), 002xxx (SME)
    if (clean.startsWith('6')) {
      prefix = 'sh';
    } else {
      prefix = 'sz';
    }
    code = clean;
  } else {
    return `Invalid symbol format "${symbol}". Use sz/sh prefix or a 6-digit code, e.g. sz300308, sh600519, or 300308.`;
  }

  const secid = prefix === 'sz' ? `0.${code}` : `1.${code}`;
  return { secid, prefix, code };
}

const queryStockData = tool(
  async ({ symbol }: { symbol: string }) => {
    try {
      const parsed = parseSecid(symbol);
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
        volume: d.f47 as number,       // in lots (手)
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

const generateEchartsConfigToolSchema = z.object({
  title: z.object({ text: z.string().optional() }).optional(),
  tooltip: z.object({}).passthrough().optional(),
  legend: z.object({ data: z.array(z.string()).optional() }).passthrough().optional(),
  xAxis: z.any().optional(),
  yAxis: z.any().optional(),
  series: z.array(z.object({
    name: z.string().optional(),
    type: z.string(),
    data: z.array(z.any()),
  }).passthrough()),
}).passthrough();

const generateEchartsConfig = tool(
  async (config: z.infer<typeof generateEchartsConfigToolSchema>) => {
    // We just return the config stringified so the agent knows it successfully generated it,
    // while the client will parse the tool call arguments to render the chart.
    return JSON.stringify({ success: true, config });
  },
  {
    name: "generate_echarts_config",
    description: "Generate an ECharts configuration object to display a chart to the user. MUST provide a valid ECharts option object.",
    schema: generateEchartsConfigToolSchema,
  }
);

const queryStockKline = tool(
  async ({ symbol, period }: { symbol: string; period?: string }) => {
    try {
      const parsed = parseSecid(symbol);
      if (typeof parsed === 'string') return parsed;

      const { secid, prefix, code } = parsed;
      const kltMap: Record<string, string> = { daily: '101', weekly: '102', monthly: '103' };
      const klt = kltMap[period || 'daily'] || '101';

      const url = `http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=${klt}&fqt=1&end=20500101&lmt=30`;
      const response = await fetch(url);
      const json = await response.json() as {
        data?: {
          code?: string;
          name?: string;
          klines?: string[];
        };
      };

      if (!json.data || !json.data.klines || json.data.klines.length === 0) {
        return `No kline data found for symbol ${symbol}.`;
      }

      const klines = json.data.klines.map((line: string) => {
        const parts = line.split(',');
        return {
          date: parts[0],
          open: parseFloat(parts[1]),
          close: parseFloat(parts[2]),
          high: parseFloat(parts[3]),
          low: parseFloat(parts[4]),
          volume: parseInt(parts[5], 10),
          turnover: parseFloat(parts[6]),
          amplitude: parts[7],
        };
      });

      return JSON.stringify({
        symbol: `${prefix}${code}`,
        name: json.data.name || '',
        code: json.data.code || '',
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

export const createChatAgent = () => {
  const llm = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL_NAME || "anthropic/claude-3.7-sonnet",
    openAIApiKey: process.env.OPENAI_API_KEY,
    timeout: 120_000, // 120s timeout per LLM call
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1"
    }
  });

  const agent = createDeepAgent({
    name: "stock-mind-ai",
    model: llm,
    tools: [duckduckgoSearch, queryStockData, queryStockKline, generateEchartsConfig],
    systemPrompt: `你是一个专业的金融和股票市场AI助手。请始终使用中文回复用户。

工具使用指南：
- 使用 "query_stock_data" 查询A股实时行情（价格、成交量、市值、涨跌幅等）。代码格式：sz300308、sh600519，或纯6位数字如300308。深圳股票（0/3开头）和上海股票（6开头）会自动识别。
- 使用 "query_stock_kline" 查询历史K线/蜡烛图数据（日K、周K、月K）。代码格式同上。返回最近30条OHLCV数据。
- 使用 "internet_search" 搜索新闻、事件和金融相关信息。
- 使用 "generate_echarts_config" 在有数据需要展示时生成图表配置进行可视化。传入的必须是有效的ECharts option对象。

回复规范：
- 绝对不要在回复中直接输出或复读工具返回的原始JSON数据。
- 将工具返回的数据用自然语言进行总结和分析，以用户友好的方式呈现。
- 例如：不要输出 {"price":531,"changePercent":2.5}，而应该说"当前股价为531元，涨幅2.5%"。
- 在需要展示数据趋势或对比时，使用 generate_echarts_config 生成图表。

错误处理：
- 如果工具返回错误，请清楚地告知用户问题所在。同一个失败的工具不要重试超过2次。
- 如果搜索不可用，建议其他方法或直接使用股票数据工具。
- 即使工具失败，也要提供有用的上下文信息。

重要：所有回复必须使用中文。`,
    backend: (config) => new CompositeBackend(
      new StateBackend(config),
      { "/memories/": new StoreBackend(config) }
    ),
  });

  return agent;
};
