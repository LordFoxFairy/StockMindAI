import { createChatAgent } from "@/core/agent/chatAgent";
import {
  macd, rsi, bollingerBands, kdj, maCross,
  type OHLCVItem,
} from "@/web/lib/indicators";
import {
  runBacktest,
  macdToSignals, rsiToSignals, bollingerToSignals, kdjToSignals, maCrossToSignals,
  type BacktestConfig,
} from "@/web/lib/backtest";
import {
  calculateRiskMetrics, monteCarloSimulation, stressTest, dailyReturns,
  BUILT_IN_SCENARIOS,
} from "@/web/lib/risk";

const PORT = process.env.API_PORT || 3135;

// =========================================================================
// East Money (东方财富) API proxy — NO local stock data
// =========================================================================
const CACHE_TTL_MS = 3_000; // 3s cache for near real-time data
const apiCache = new Map<string, { data: any; timestamp: number }>();

function getCached(key: string): any | null {
  const entry = apiCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) return entry.data;
  return null;
}

function setCache(key: string, data: any): void {
  apiCache.set(key, { data, timestamp: Date.now() });
}

/**
 * Fetch from East Money API and parse JSON response.
 * East Money returns JSONP-like or plain JSON depending on endpoint.
 */
async function fetchEastMoney(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      'Referer': 'https://quote.eastmoney.com',
      'User-Agent': 'Mozilla/5.0',
    },
  });
  const text = await res.text();
  // Some endpoints return JSONP: callback(json); strip it
  const jsonMatch = text.match(/^\w+\(([\s\S]+)\);?\s*$/);
  if (jsonMatch) return JSON.parse(jsonMatch[1]);
  return JSON.parse(text);
}

/**
 * Infer exchange prefix from a bare numeric A-share code.
 * 6xx = Shanghai (sh), 0xx/3xx = Shenzhen (sz), 9xx = Shanghai B, 2xx = Shenzhen B
 */
function inferExchange(code: string): string {
  if (code.startsWith('6') || code.startsWith('9')) return 'sh';
  return 'sz';
}

/**
 * Resolve a stock code (possibly prefixed with sh/sz, or bare numeric) into
 * an East Money secid like "1.600519" or "0.000001".
 */
function resolveSecid(code: string): string {
  if (code.startsWith('sz')) return `0.${code.slice(2)}`;
  if (code.startsWith('sh')) return `1.${code.slice(2)}`;
  // Bare numeric code — infer exchange from leading digit
  const exchange = inferExchange(code);
  return exchange === 'sh' ? `1.${code}` : `0.${code}`;
}

/**
 * Parse East Money clist stock item (f2=price, f3=changePct, f4=change,
 * f5=volume, f6=turnover, f12=code, f13=market, f14=name) into our standard format.
 */
function parseStockItem(item: any): any {
  const numericCode = String(item.f12 || '');
  // f13: 0 = Shenzhen, 1 = Shanghai. Fall back to inference if missing.
  const market = item.f13 === 1 || item.f13 === '1' ? 'sh'
    : item.f13 === 0 || item.f13 === '0' ? 'sz'
    : inferExchange(numericCode);
  return {
    ticker: `${market}${numericCode}`,
    name: String(item.f14 || ''),
    price: item.f2 === '-' ? 0 : Number(item.f2) || 0,
    changePercent: item.f3 === '-' ? 0 : Number(item.f3) || 0,
    change: item.f4 === '-' ? 0 : Number(item.f4) || 0,
    volume: item.f5 === '-' ? 0 : Number(item.f5) || 0,
    turnover: item.f6 === '-' ? 0 : Number(item.f6) || 0,
  };
}

/**
 * Parse East Money sector item (f2=changePercent of sector, f3=changePct,
 * f4=change, f12=code like BK0475, f14=name).
 */
function parseSectorItem(item: any): any {
  return {
    code: String(item.f12 || ''),
    name: String(item.f14 || ''),
    changePercent: item.f3 === '-' ? 0 : Number(item.f3) || 0,
    change: item.f4 === '-' ? 0 : Number(item.f4) || 0,
    price: item.f2 === '-' ? 0 : Number(item.f2) || 0,
  };
}

/**
 * Fetch kline data from East Money and parse into OHLCVItem[].
 */
async function fetchKlineOHLCV(code: string, days: number, klt: number): Promise<OHLCVItem[]> {
  const secid = resolveSecid(code);
  const apiUrl = `http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=${klt}&fqt=1&end=20500101&lmt=${days}`;
  const json = await fetchEastMoney(apiUrl);
  return (json?.data?.klines || []).map((line: string) => {
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
}

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

console.log(`Starting Bun API server on port ${PORT}...`);

Bun.serve({
  port: PORT,
  idleTimeout: 255, // Max idle timeout (seconds) — agent tool calls can take a while
  async fetch(req: Request) {
    const url = new URL(req.url);

    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // CORS headers for all responses
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
    };

    // =========================================================================
    // GET /api/stocks/hot — 热门股票 (sorted by turnover, from East Money)
    // =========================================================================
    if (req.method === "GET" && url.pathname === "/api/stocks/hot") {
      try {
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
        const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20', 10)));

        const cacheKey = `hot:${page}:${pageSize}`;
        const cached = getCached(cacheKey);
        if (cached) {
          return new Response(JSON.stringify(cached), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // fs=m:0+t:6 (沪A主板), m:0+t:80 (沪A科创板), m:1+t:2 (深A主板), m:1+t:23 (深A创业板)
        // fid=f6 sort by turnover descending
        const apiUrl = `http://push2.eastmoney.com/api/qt/clist/get?pn=${page}&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f6&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f2,f3,f4,f5,f6,f12,f13,f14`;
        const json = await fetchEastMoney(apiUrl);

        const total = json?.data?.total || 0;
        const totalPages = Math.ceil(total / pageSize);
        const stocks = (json?.data?.diff || []).map(parseStockItem);

        const result = { page, pageSize, total, totalPages, stocks };
        setCache(cacheKey, result);

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error("Error in stocks hot route:", err);
        return new Response(JSON.stringify({ error: errorMessage }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // =========================================================================
    // GET /api/stocks/sectors — 行业板块列表 (from East Money)
    // =========================================================================
    if (req.method === "GET" && url.pathname === "/api/stocks/sectors") {
      try {
        const cacheKey = 'sectors';
        const cached = getCached(cacheKey);
        if (cached) {
          return new Response(JSON.stringify(cached), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // m:90+t:2 = 行业板块
        const apiUrl = `http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=50&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=f2,f3,f4,f12,f14`;
        const json = await fetchEastMoney(apiUrl);

        const sectors = (json?.data?.diff || []).map(parseSectorItem);

        setCache(cacheKey, sectors);

        return new Response(JSON.stringify(sectors), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error("Error in sectors route:", err);
        return new Response(JSON.stringify({ error: errorMessage }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // =========================================================================
    // GET /api/stocks/sector/:code — 板块内股票列表 (paginated, from East Money)
    // =========================================================================
    const sectorMatch = url.pathname.match(/^\/api\/stocks\/sector\/(.+)$/);
    if (req.method === "GET" && sectorMatch) {
      try {
        const sectorCode = decodeURIComponent(sectorMatch[1]);
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
        const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20', 10)));

        const cacheKey = `sector:${sectorCode}:${page}:${pageSize}`;
        const cached = getCached(cacheKey);
        if (cached) {
          return new Response(JSON.stringify(cached), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // b:BK0475 = specific sector by East Money sector code
        const apiUrl = `http://push2.eastmoney.com/api/qt/clist/get?pn=${page}&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=b:${sectorCode}&fields=f2,f3,f4,f5,f6,f12,f13,f14`;
        const json = await fetchEastMoney(apiUrl);

        const total = json?.data?.total || 0;
        const totalPages = Math.ceil(total / pageSize);
        const stocks = (json?.data?.diff || []).map(parseStockItem);

        const result = {
          sector: sectorCode,
          page,
          pageSize,
          total,
          totalPages,
          stocks,
        };
        setCache(cacheKey, result);

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error("Error in sector stocks route:", err);
        return new Response(JSON.stringify({ error: errorMessage }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // =========================================================================
    // GET /api/stocks/search?q=keyword — 搜索 (from East Money search API)
    // =========================================================================
    if (req.method === "GET" && url.pathname === "/api/stocks/search") {
      try {
        const query = (url.searchParams.get('q') || '').trim();

        if (!query) {
          return new Response(JSON.stringify([]), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const cacheKey = `search:${query}`;
        const cached = getCached(cacheKey);
        if (cached) {
          return new Response(JSON.stringify(cached), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const apiUrl = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(query)}&type=14&count=20`;
        const json = await fetchEastMoney(apiUrl);

        const results: any[] = [];
        const suggestions = json?.QuotationCodeTable?.Data || [];
        for (const item of suggestions) {
          // item: { Code, Name, MktNum, SecurityTypeName, ... }
          // MktNum: 0=深圳, 1=上海
          const market = item.MktNum === '0' ? 'sz' : item.MktNum === '1' ? 'sh' : '';
          results.push({
            ticker: item.Code || '',
            name: item.Name || '',
            market,
            fullCode: `${market}${item.Code}`,
            type: item.SecurityTypeName || '',
          });
        }

        setCache(cacheKey, results);

        return new Response(JSON.stringify(results), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error("Error in stocks search route:", err);
        return new Response(JSON.stringify({ error: errorMessage }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // =========================================================================
    // GET /api/stocks/kline/:code — K线数据 (from East Money kline API)
    // =========================================================================
    const klineMatch = url.pathname.match(/^\/api\/stocks\/kline\/(.+)$/);
    if (req.method === "GET" && klineMatch) {
      try {
        const code = decodeURIComponent(klineMatch[1]);
        const days = parseInt(url.searchParams.get('days') || '30', 10);

        // Parse klt (K-line period): 1/5/15/30/60 min, 101 daily, 102 weekly, 103 monthly
        const ALLOWED_KLT = [1, 5, 15, 30, 60, 101, 102, 103];
        const rawKlt = parseInt(url.searchParams.get('klt') || '101', 10);
        const klt = ALLOWED_KLT.includes(rawKlt) ? rawKlt : 101;

        // For intraday periods, each trading day has many more bars
        let lmt = days;
        if (klt === 1) lmt = days * 240;
        else if (klt === 5) lmt = days * 48;
        else if (klt === 15) lmt = days * 16;
        else if (klt === 30) lmt = days * 8;
        else if (klt === 60) lmt = days * 4;

        const cacheKey = `kline:${code}:${days}:${klt}`;
        const cached = getCached(cacheKey);
        if (cached) {
          return new Response(JSON.stringify(cached), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const secid = resolveSecid(code);

        const apiUrl = `http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=${klt}&fqt=1&end=20500101&lmt=${lmt}`;
        const json = await fetchEastMoney(apiUrl);

        const klines = (json?.data?.klines || []).map((line: string) => {
          const parts = line.split(',');
          return {
            date: parts[0],
            open: parseFloat(parts[1]),
            close: parseFloat(parts[2]),
            high: parseFloat(parts[3]),
            low: parseFloat(parts[4]),
            volume: parseFloat(parts[5]),
            turnover: parseFloat(parts[6]),
            amplitude: parseFloat(parts[7] || '0'),
          };
        });

        const result = { code, klines };
        setCache(cacheKey, result);

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error("Error in kline route:", err);
        return new Response(JSON.stringify({ error: errorMessage }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // =========================================================================
    // GET /api/stocks/quote/:code — 实时行情 (from East Money quote API)
    // =========================================================================
    const quoteMatch = url.pathname.match(/^\/api\/stocks\/quote\/(.+)$/);
    if (req.method === "GET" && quoteMatch) {
      try {
        const code = decodeURIComponent(quoteMatch[1]);

        const cacheKey = `quote:${code}`;
        const cached = getCached(cacheKey);
        if (cached) {
          return new Response(JSON.stringify(cached), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const secid = resolveSecid(code);

        const apiUrl = `http://push2.eastmoney.com/api/qt/stock/get?fltt=2&invt=2&secid=${secid}&fields=f43,f44,f45,f46,f47,f48,f50,f57,f58,f60,f116,f117,f170,f171`;
        const json = await fetchEastMoney(apiUrl);
        const d = json?.data || {};

        const num = (v: any) => (v === '-' || v === undefined || v === null) ? 0 : Number(v) || 0;

        const result = {
          code,
          name: d.f58 || '',
          price: num(d.f43),
          high: num(d.f44),
          low: num(d.f45),
          open: num(d.f46),
          volume: num(d.f47),
          turnover: num(d.f48),
          volumeRatio: num(d.f50),
          previousClose: num(d.f60),
          changePercent: num(d.f170),
          change: num(d.f171),
          totalMarketCap: num(d.f116),
          floatMarketCap: num(d.f117),
        };
        setCache(cacheKey, result);

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error("Error in quote route:", err);
        return new Response(JSON.stringify({ error: errorMessage }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

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
          return new Response(JSON.stringify({ error: "Missing required fields: code, strategy" }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const klt = period || 101;
        const lmt = days || 120;
        const items = await fetchKlineOHLCV(code, lmt, klt);
        if (items.length === 0) {
          return new Response(JSON.stringify({ error: `No kline data found for ${code}` }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const signals = computeSignalsServer(items, strategy, params);
        const result = runBacktest(items, signals, config);

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error("Error in backtest route:", err);
        return new Response(JSON.stringify({ error: errorMessage }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
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
          return new Response(JSON.stringify({ error: "Missing required field: code" }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const klt = period || 101;
        const lmt = days || 250;
        const items = await fetchKlineOHLCV(code, lmt, klt);
        if (items.length < 2) {
          return new Response(JSON.stringify({ error: `Not enough data for risk analysis on ${code}` }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const closes = items.map(i => i.close);
        const returns = dailyReturns(closes);
        const riskMetrics = calculateRiskMetrics(returns);
        const monteCarlo = monteCarloSimulation(returns, 60, 500, closes[closes.length - 1]);
        const stress = stressTest(closes[closes.length - 1], returns);

        return new Response(JSON.stringify({
          code,
          dataPoints: items.length,
          riskMetrics,
          monteCarlo,
          stressTest: stress,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error("Error in risk route:", err);
        return new Response(JSON.stringify({ error: errorMessage }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
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
          return new Response(JSON.stringify({ error: "Missing required fields: code, strategy, paramRanges" }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const klt = period || 101;
        const lmt = days || 120;
        const items = await fetchKlineOHLCV(code, lmt, klt);
        if (items.length === 0) {
          return new Response(JSON.stringify({ error: `No kline data found for ${code}` }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Generate parameter combinations with limit
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

        return new Response(JSON.stringify({
          code,
          strategy,
          totalCombinations: combos.length,
          topResults: results.slice(0, 10),
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error("Error in optimize route:", err);
        return new Response(JSON.stringify({ error: errorMessage }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      try {
        const { messages } = await req.json();

        // =========================================================================
        // STEP 1: INITIALIZE AGENT
        // =========================================================================
        const agent = createChatAgent();

        // =========================================================================
        // STEP 2: GENERATE STREAM
        // =========================================================================
        const stream = await agent.stream({ messages }, { streamMode: "messages", recursionLimit: 25 });

        // =========================================================================
        // STEP 3: FORMAT STREAM FOR CLIENT
        // =========================================================================
        const encoder = new TextEncoder();
        const readable = new ReadableStream({
          async start(controller) {
            // Accumulate tool_call_chunks (they arrive as partial fragments).
            // Key: "stepN-indexM" to handle multiple agent steps with reused indices.
            const toolCallAccum: Record<string, { name: string; args: string; id: string }> = {};
            let currentStep = 0;
            let lastSeenIndices = new Set<number>();
            let controllerClosed = false;

            const safeEnqueue = (data: Uint8Array) => {
              if (controllerClosed) return;
              try {
                controller.enqueue(data);
              } catch {
                controllerClosed = true;
              }
            };

            const safeClose = () => {
              if (controllerClosed) return;
              try {
                controller.close();
                controllerClosed = true;
              } catch {
                controllerClosed = true;
              }
            };

            try {
              for await (const chunk of stream) {
                if (controllerClosed) break;

                // With streamMode: "messages", LangGraph yields [AIMessageChunk, metadata]
                let message: any;
                if (Array.isArray(chunk)) {
                  message = chunk[0]; // AIMessageChunk is the first element
                } else {
                  message = chunk;
                }

                if (!message) continue;

                // Only stream AI assistant messages to the client.
                // Skip tool results (ToolMessage/ToolMessageChunk) and
                // human messages (HumanMessage/HumanMessageChunk) to prevent
                // raw JSON tool output from appearing in the chat.
                const msgType = message._getType?.();
                if (msgType && msgType !== 'ai') continue;

                // Extract text content from AIMessageChunk
                let content = '';
                if (typeof message.content === 'string') {
                  content = message.content;
                } else if (Array.isArray(message.content)) {
                  const textParts = message.content
                    .filter((c: any) => c.type === 'text' || typeof c === 'string')
                    .map((c: any) => (typeof c === 'string' ? c : c.text || ''));
                  content = textParts.join('');
                }

                // Stream text content immediately for real-time display
                if (content) {
                  safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content })}\n\n`));
                }

                // DO NOT emit message.tool_calls from intermediate chunks —
                // they arrive with empty args {} before accumulation is complete.
                // Instead, accumulate tool_call_chunks and emit once at stream end.

                // Accumulate partial tool_call_chunks for later emission.
                if (message.tool_call_chunks && message.tool_call_chunks.length > 0) {
                  for (const tc of message.tool_call_chunks) {
                    const idx = tc.index ?? 0;
                    // Detect new agent step: if we see an index we've already
                    // completed (has a name), it's a new step with reused indices.
                    if (tc.name && lastSeenIndices.has(idx)) {
                      currentStep++;
                      lastSeenIndices = new Set();
                    }
                    lastSeenIndices.add(idx);

                    const key = `s${currentStep}-i${idx}`;
                    if (!toolCallAccum[key]) {
                      toolCallAccum[key] = { name: '', args: '', id: '' };
                    }
                    if (tc.name) toolCallAccum[key].name += tc.name;
                    if (tc.args) toolCallAccum[key].args += tc.args;
                    if (tc.id) toolCallAccum[key].id = tc.id;
                  }
                }

                // Also check message.tool_calls — if they have non-empty args,
                // they may be fully-parsed calls we haven't seen via chunks.
                if (message.tool_calls && message.tool_calls.length > 0) {
                  for (const tc of message.tool_calls) {
                    if (tc.name && tc.args && Object.keys(tc.args).length > 0) {
                      const key = tc.id || `direct-${tc.name}-${currentStep}`;
                      if (!toolCallAccum[key]) {
                        toolCallAccum[key] = {
                          name: tc.name,
                          args: JSON.stringify(tc.args),
                          id: tc.id || '',
                        };
                      }
                    }
                  }
                }
              }

              // Emit accumulated tool calls at stream end (with complete args)
              const accumulated = Object.values(toolCallAccum).filter(tc => tc.name && tc.args);
              if (accumulated.length > 0) {
                const parsedCalls = accumulated.map(tc => {
                  let args: any;
                  try { args = JSON.parse(tc.args); } catch { args = tc.args; }
                  return { name: tc.name, args, id: tc.id };
                });
                safeEnqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'tool_calls',
                  content: '',
                  tool_calls: parsedCalls
                })}\n\n`));
              }

              safeEnqueue(encoder.encode('data: [DONE]\n\n'));
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              console.error("Stream error:", errMsg, err);
              safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', content: `智能体处理出错: ${errMsg}` })}\n\n`));
              // Still emit any accumulated tool calls before closing
              const accum = Object.values(toolCallAccum).filter(tc => tc.name && tc.args);
              if (accum.length > 0) {
                const calls = accum.map(tc => {
                  let args: any;
                  try { args = JSON.parse(tc.args); } catch { args = tc.args; }
                  return { name: tc.name, args, id: tc.id };
                });
                safeEnqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'tool_calls',
                  content: '',
                  tool_calls: calls
                })}\n\n`));
              }
              safeEnqueue(encoder.encode('data: [DONE]\n\n'));
            } finally {
              safeClose();
            }
          }
        });

        return new Response(readable, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });

      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error("Error in chat route:", err);
        return new Response(JSON.stringify({ error: errorMessage }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          },
        });
      }
    }

    // Handle 404
    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  },
});
