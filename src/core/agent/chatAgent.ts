import { createDeepAgent, CompositeBackend, StateBackend, StoreBackend } from "deepagents";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { search, searchNews, SafeSearchType, SearchTimeType } from "duck-duck-scrape";
import {
  macd, rsi, bollingerBands, kdj, maCross,
  type OHLCVItem,
} from "@/web/lib/indicators";
import {
  runBacktest,
  macdToSignals, rsiToSignals, bollingerToSignals, kdjToSignals, maCrossToSignals,
  type BacktestConfig,
} from "@/web/lib/backtest";
import { runPrediction } from "@/web/lib/predict";

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

/**
 * Fetch kline data from East Money and parse into OHLCVItem[].
 * Reusable helper for queryStockKline, backtestStrategy, etc.
 */
async function fetchKlineData(
  symbol: string,
  period: 'daily' | 'weekly' | 'monthly' = 'daily',
  days = 30,
): Promise<{ items: OHLCVItem[]; name: string; symbol: string; code: string } | string> {
  const parsed = parseSecid(symbol);
  if (typeof parsed === 'string') return parsed;

  const { secid, prefix, code } = parsed;
  const kltMap: Record<string, string> = { daily: '101', weekly: '102', monthly: '103' };
  const klt = kltMap[period] || '101';

  const url = `http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=${klt}&fqt=1&end=20500101&lmt=${days}`;
  const response = await fetch(url, {
    headers: { 'Referer': 'https://quote.eastmoney.com' },
  });
  const json = await response.json() as {
    data?: { code?: string; name?: string; klines?: string[] };
  };

  if (!json.data || !json.data.klines || json.data.klines.length === 0) {
    return `No kline data found for symbol ${symbol}.`;
  }

  const items: OHLCVItem[] = json.data.klines.map((line: string) => {
    const parts = line.split(',');
    return {
      date: parts[0],
      open: parseFloat(parts[1]),
      close: parseFloat(parts[2]),
      high: parseFloat(parts[3]),
      low: parseFloat(parts[4]),
      volume: parseFloat(parts[5]),
    };
  });

  return {
    items,
    name: json.data.name || '',
    symbol: `${prefix}${code}`,
    code: json.data.code || '',
  };
}

const queryStockKline = tool(
  async ({ symbol, period }: { symbol: string; period?: string }) => {
    try {
      const result = await fetchKlineData(symbol, (period as 'daily' | 'weekly' | 'monthly') || 'daily', 30);
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

const backtestStrategy = tool(
  async ({ symbol, strategy, params, period, days }: {
    symbol: string;
    strategy: 'macd' | 'rsi' | 'bollinger' | 'kdj' | 'maCross';
    params?: Record<string, number>;
    period?: 'daily' | 'weekly' | 'monthly';
    days?: number;
  }) => {
    try {
      const result = await fetchKlineData(symbol, period || 'daily', days || 120);
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

const optimizeStrategy = tool(
  async ({ symbol, strategy, paramRanges, period, days }: {
    symbol: string;
    strategy: 'macd' | 'rsi' | 'bollinger' | 'kdj' | 'maCross';
    paramRanges: Record<string, { min: number; max: number; step: number }>;
    period?: 'daily' | 'weekly' | 'monthly';
    days?: number;
  }) => {
    try {
      const result = await fetchKlineData(symbol, period || 'daily', days || 120);
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

const predictStock = tool(
  async ({ symbol, timeframe }: {
    symbol: string;
    timeframe?: 'short' | 'medium' | 'long';
  }) => {
    try {
      // Map timeframe to data range
      const daysMap: Record<string, number> = { short: 120, medium: 250, long: 500 };
      const days = daysMap[timeframe || 'medium'] || 250;

      const result = await fetchKlineData(symbol, 'daily', days);
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
    description: "对指定股票进行多维度技术分析预测。综合MACD/RSI/布林带/KDJ/均线五大指标，输出综合评分(-100到+100)、趋势方向、支撑阻力位和各指标信号。",
    schema: z.object({
      symbol: z.string().describe("Stock symbol"),
      timeframe: z.enum(['short', 'medium', 'long']).optional().describe("Analysis timeframe"),
    }),
  }
);

const searchNewsTool = tool(
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
    description: "搜索财经新闻和资讯，支持按时间范围筛选。适合搜索行业动态、宏观经济新闻、政策变化等。",
    schema: z.object({
      query: z.string().describe("搜索关键词"),
      timeRange: z.enum(['day', 'week', 'month']).optional().describe("时间范围：day(一天内)、week(一周内)、month(一月内)"),
    }),
  }
);

const searchStockInfo = tool(
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
          market: market === 'sh' ? '上海' : '深圳',
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
    description: "按名称、代码或关键词搜索股票信息。返回匹配股票的代码、名称、市场、价格、涨跌幅、成交量和市值。",
    schema: z.object({
      keyword: z.string().describe("股票名称、代码或关键词（如：茅台、银行、新能源）"),
    }),
  }
);

const queryStockNews = tool(
  async ({ symbol, count }: { symbol: string; count?: number }) => {
    try {
      const parsed = parseSecid(symbol);
      if (typeof parsed === 'string') return parsed;

      const { code } = parsed;
      const limit = Math.min(count || 10, 20);

      const apiUrl = `https://np-listapi.eastmoney.com/comm/wap/getListInfo?cb=&client=wap&type=1&mession=&fc=${code}&count=${limit}`;
      const response = await fetch(apiUrl, {
        headers: {
          'Referer': 'https://wap.eastmoney.com',
          'User-Agent': 'Mozilla/5.0',
        },
      });
      const json = await response.json() as {
        data?: { list?: Array<{
          title?: string;
          showtime?: string;
          mediaName?: string;
          url?: string;
          digest?: string;
        }> };
      };

      const newsList = json?.data?.list || [];
      const results = newsList.map(item => ({
        title: item.title || '',
        date: item.showtime || '',
        source: item.mediaName || '',
        url: item.url || '',
        summary: item.digest || '',
      }));

      return JSON.stringify(results);
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      return `Error fetching stock news: ${errorMessage}`;
    }
  },
  {
    name: "query_stock_news",
    description: "查询指定股票的最新新闻和公告。输入股票代码，返回最新的新闻标题、日期、来源和摘要。",
    schema: z.object({
      symbol: z.string().describe("股票代码（如：sh600519、sz300308、或 600519）"),
      count: z.number().optional().describe("返回条数，默认10条，最多20条"),
    }),
  }
);

const queryStockFundamentals = tool(
  async ({ symbol }: { symbol: string }) => {
    try {
      const parsed = parseSecid(symbol);
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
    description: "查询股票基本面数据，包括PE(市盈率)、PB(市净率)、ROE(净资产收益率)、ROA、EPS(每股收益)、每股净资产、市销率、每股现金流、总市值、流通市值等指标。",
    schema: z.object({
      symbol: z.string().describe("股票代码（如：sh600519、sz300308、或 600519）"),
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
    tools: [duckduckgoSearch, queryStockData, queryStockKline, generateEchartsConfig, backtestStrategy, optimizeStrategy, predictStock, searchNewsTool, searchStockInfo, queryStockNews, queryStockFundamentals],
    systemPrompt: `你是一个专业的金融和股票市场AI助手。请始终使用中文回复用户。

工具使用指南：
- 使用 "query_stock_data" 查询A股实时行情（价格、成交量、市值、涨跌幅等）。代码格式：sz300308、sh600519，或纯6位数字如300308。深圳股票（0/3开头）和上海股票（6开头）会自动识别。
- 使用 "query_stock_kline" 查询历史K线/蜡烛图数据（日K、周K、月K）。代码格式同上。返回最近30条OHLCV数据。
- 使用 "internet_search" 搜索新闻、事件和金融相关信息。
- 使用 "generate_echarts_config" 在有数据需要展示时生成图表配置进行可视化。传入的必须是有效的ECharts option对象。
- 使用 "backtest_strategy" 对指定股票运行策略回测，获取夏普比率、最大回撤、胜率等指标。可选策略：macd/rsi/bollinger/kdj/maCross。
- 使用 "optimize_strategy" 对策略参数进行网格搜索优化，找到最优参数组合。
- 使用 "predict_stock" 对股票进行多指标综合预测分析，返回综合评分、趋势方向、支撑/阻力位和20日价格区间预测。
- 使用 "search_news" 搜索财经新闻和行业资讯，支持按时间范围（day/week/month）筛选。
- 使用 "search_stock_info" 按名称、代码或关键词搜索股票，获取匹配股票的基础信息和实时价格。
- 使用 "query_stock_news" 查询指定股票的最新新闻和公告。
- 使用 "query_stock_fundamentals" 查询股票基本面数据（PE/PB/ROE/EPS等核心指标）。

搜索策略建议：
当用户询问某只股票时，建议先用 query_stock_data 获取实时行情，再结合 query_stock_fundamentals 获取基本面，如需要可用 query_stock_news 查看最新新闻。综合分析时使用 search_news 搜索相关行业或宏观新闻。使用 search_stock_info 可以按关键词模糊搜索股票。

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
