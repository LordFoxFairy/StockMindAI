import { createChatAgent } from "@/core/agent/chatAgent";
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
  BUILT_IN_SCENARIOS,
} from "@/web/lib/risk";
import { runPrediction } from "@/web/lib/predict";
import {
  normalizeReturns, compareVolatility, calculateCorrelation,
  rankByReturn, rankBySharpe, compareIndicators, generateComparisonSummary,
  type StockData,
} from "@/web/lib/compare";
import {
  fetchEastMoney, fetchKline, fetchKlineWithMeta, resolveSecid,
  getCached, setCache, parseStockItem, parseSectorItem,
} from "@/core/services/eastmoney";

const PORT = process.env.API_PORT || 3135;

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

// Kill any existing process on the target port before starting
try {
  const proc = Bun.spawnSync(["lsof", "-ti", `:${PORT}`]);
  const pids = proc.stdout.toString().trim();
  if (pids) {
    for (const pid of pids.split("\n")) {
      try { process.kill(Number(pid), "SIGKILL"); } catch {}
    }
    Bun.sleepSync(500);
  }
} catch {}

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
        const items = await fetchKline(code, lmt, klt);
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
        const items = await fetchKline(code, lmt, klt);
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
        const items = await fetchKline(code, lmt, klt);
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
          return new Response(JSON.stringify({ error: "Missing required field: code" }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const klt = period || 101;
        const lmt = reqDays || 120;
        const items = await fetchKline(code, lmt, klt);
        if (items.length < 30) {
          return new Response(JSON.stringify({ error: `Not enough data for prediction on ${code} (need ≥30, got ${items.length})` }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const prediction = runPrediction(items);
        const currentPrice = items[items.length - 1].close;

        return new Response(JSON.stringify({
          code,
          currentPrice,
          dataPoints: items.length,
          ...prediction,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error("Error in predict route:", err);
        return new Response(JSON.stringify({ error: errorMessage }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
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
          return new Response(JSON.stringify({ error: "codes must be an array of 2-10 stock codes" }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const klt = period || 101;
        const lmt = reqDays || 60;

        const stockDataList: StockData[] = [];
        for (const code of codes) {
          const items = await fetchKline(code, lmt, klt);
          if (items.length === 0) {
            return new Response(JSON.stringify({ error: `No kline data found for ${code}` }), {
              status: 404,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          // Fetch stock name via quote API
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

        return new Response(JSON.stringify({
          codes,
          dataPoints: stockDataList.map(s => ({ code: s.code, name: s.name, count: s.klineData.length })),
          normalizedReturns: normalized,
          volatility,
          correlation,
          returnRanking,
          sharpeRanking,
          indicators,
          summary,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error("Error in compare route:", err);
        return new Response(JSON.stringify({ error: errorMessage }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // =========================================================================
    // GET /api/stocks/news/:code — 个股新闻 (from East Money)
    // =========================================================================
    const newsMatch = url.pathname.match(/^\/api\/stocks\/news\/(.+)$/);
    if (req.method === "GET" && newsMatch) {
      try {
        const code = decodeURIComponent(newsMatch[1]);
        const count = Math.min(Math.max(1, parseInt(url.searchParams.get('count') || '10', 10)), 50);

        const cacheKey = `news:${code}:${count}`;
        const cached = getCached(cacheKey);
        if (cached) {
          return new Response(JSON.stringify(cached), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Resolve bare code to get numeric part
        const numericCode = code.replace(/^(sh|sz)/i, '');

        // Use East Money search-api-web for stock news articles
        const param = JSON.stringify({
          uid: "",
          keyword: numericCode,
          type: ["cmsArticleWebOld"],
          client: "web",
          clientType: "web",
          clientVersion: "curr",
          param: {
            cmsArticleWebOld: {
              searchScope: "default",
              sort: "default",
              pageIndex: 1,
              pageSize: count,
              preTag: "",
              postTag: "",
            },
          },
        });
        const apiUrl = `https://search-api-web.eastmoney.com/search/jsonp?cb=&param=${encodeURIComponent(param)}`;
        const json = await fetchEastMoney(apiUrl);

        const newsList = json?.result?.cmsArticleWebOld || [];
        const news = newsList.map((item: any) => ({
          title: (item.title || '').replace(/<[^>]*>/g, ''),
          date: item.date || '',
          source: item.mediaName || '',
          url: item.url || '',
          summary: (item.content || '').replace(/<[^>]*>/g, '').slice(0, 200),
        }));

        const result = { code, news };
        setCache(cacheKey, result);

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error("Error in stock news route:", err);
        return new Response(JSON.stringify({ error: errorMessage }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // =========================================================================
    // GET /api/stocks/announcements/:code — 个股公告 (from East Money)
    // =========================================================================
    const announcementsMatch = url.pathname.match(/^\/api\/stocks\/announcements\/(.+)$/);
    if (req.method === "GET" && announcementsMatch) {
      try {
        const code = decodeURIComponent(announcementsMatch[1]);
        const count = Math.min(Math.max(1, parseInt(url.searchParams.get('count') || '10', 10)), 50);

        const cacheKey = `announcements:${code}:${count}`;
        const cached = getCached(cacheKey);
        if (cached) {
          return new Response(JSON.stringify(cached), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const numericCode = code.replace(/^(sh|sz)/i, '');

        // Use East Money np-anotice-stock API for official announcements
        const apiUrl = `https://np-anotice-stock.eastmoney.com/api/security/ann?cb=&sr=-1&page_size=${count}&page_index=1&ann_type=SHA,SZA&client_source=web&f_node=0&s_node=0&stock_list=${numericCode}`;
        const json = await fetchEastMoney(apiUrl);

        const announcementList = json?.data?.list || [];
        const announcements = announcementList.map((item: any) => ({
          title: item.title || '',
          date: item.notice_date || item.display_time || '',
          url: item.art_code ? `https://data.eastmoney.com/notices/detail/${numericCode}/${item.art_code}.html` : '',
        }));

        const result = { code, announcements };
        setCache(cacheKey, result);

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error("Error in announcements route:", err);
        return new Response(JSON.stringify({ error: errorMessage }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // =========================================================================
    // GET /api/stocks/fundamentals/:code — 基本面数据 (from East Money)
    // =========================================================================
    const fundamentalsMatch = url.pathname.match(/^\/api\/stocks\/fundamentals\/(.+)$/);
    if (req.method === "GET" && fundamentalsMatch) {
      try {
        const code = decodeURIComponent(fundamentalsMatch[1]);

        const cacheKey = `fundamentals:${code}`;
        const cached = getCached(cacheKey);
        if (cached) {
          return new Response(JSON.stringify(cached), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const secid = resolveSecid(code);
        const apiUrl = `http://push2.eastmoney.com/api/qt/stock/get?fltt=2&invt=2&secid=${secid}&fields=f57,f58,f43,f162,f163,f167,f164,f168,f114,f116,f117,f170,f173,f183,f185,f186,f187`;
        const json = await fetchEastMoney(apiUrl);
        const d = json?.data || {};

        const num = (v: any) => (v === '-' || v === undefined || v === null) ? null : Number(v) || 0;

        const result = {
          code,
          name: d.f58 || '',
          price: num(d.f43),
          changePercent: num(d.f170),
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
        setCache(cacheKey, result);

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error("Error in fundamentals route:", err);
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
        const stream = await agent.stream({ messages }, { streamMode: "messages", recursionLimit: 80 });

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

    // ─── POST /api/portfolio/optimize ─────────────────────────────────
    if (req.method === "POST" && url.pathname === "/api/portfolio/optimize") {
      try {
        const body = await req.json() as { stocks?: string[]; algorithm?: string; days?: number; riskFreeRate?: number };
        const { stocks, algorithm = 'markowitz', days = 250, riskFreeRate = 0.025 } = body;
        if (!stocks || stocks.length < 2 || stocks.length > 10) {
          return new Response(JSON.stringify({ error: "需要2-10只股票" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const { dailyReturns: dr } = await import("@/web/lib/risk");
        const dataPromises = stocks.map((s: string) => fetchKlineWithMeta(s, 'daily', days));
        const results = await Promise.all(dataPromises);

        const assets: { code: string; name: string; returns: number[] }[] = [];
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (typeof r === 'string') return new Response(JSON.stringify({ error: `获取 ${stocks[i]} 失败` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          const closes = r.items.map((item: any) => item.close);
          assets.push({ code: r.symbol, name: r.name, returns: dr(closes) });
        }
        const minLen = Math.min(...assets.map(a => a.returns.length));
        for (const a of assets) a.returns = a.returns.slice(a.returns.length - minLen);

        const n = assets.length;
        const meanReturns = assets.map(a => (a.returns.reduce((s, v) => s + v, 0) / a.returns.length) * 252);
        const covMatrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          const mi = assets[i].returns.reduce((s, v) => s + v, 0) / minLen;
          const mj = assets[j].returns.reduce((s, v) => s + v, 0) / minLen;
          let cov = 0;
          for (let k = 0; k < minLen; k++) cov += (assets[i].returns[k] - mi) * (assets[j].returns[k] - mj);
          covMatrix[i][j] = (cov / (minLen - 1)) * 252;
        }

        let weights: number[];
        if (algorithm === 'risk-parity') {
          const vols = covMatrix.map((_, i) => Math.sqrt(covMatrix[i][i]));
          const invVols = vols.map(v => v > 0 ? 1 / v : 0);
          const s = invVols.reduce((a, b) => a + b, 0);
          weights = s > 0 ? invVols.map(v => v / s) : Array(n).fill(1 / n);
        } else {
          const scores = meanReturns.map((r, i) => { const v = Math.sqrt(covMatrix[i][i]); return v > 0 ? Math.max(0, (r - riskFreeRate) / v) : 0; });
          const s = scores.reduce((a, b) => a + b, 0);
          weights = s > 0 ? scores.map(v => v / s) : Array(n).fill(1 / n);
        }

        let portReturn = 0, portVar = 0;
        for (let i = 0; i < n; i++) portReturn += weights[i] * meanReturns[i];
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) portVar += weights[i] * weights[j] * covMatrix[i][j];
        const portVol = Math.sqrt(portVar);

        const frontier: { return: number; volatility: number; sharpe: number }[] = [];
        const minRet = Math.min(...meanReturns), maxRet = Math.max(...meanReturns);
        for (let t = 0; t <= 10; t++) {
          const ratio = t / 10;
          const w = meanReturns.map(r => Math.max(0, 1 / n + (ratio - 0.5) * (r > (minRet + maxRet) / 2 ? 0.3 : -0.1)));
          const ws = w.reduce((a, b) => a + b, 0);
          for (let i = 0; i < n; i++) w[i] /= ws;
          let r = 0, v = 0;
          for (let i = 0; i < n; i++) r += w[i] * meanReturns[i];
          for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v += w[i] * w[j] * covMatrix[i][j];
          const vol = Math.sqrt(Math.max(0, v));
          frontier.push({ return: +r.toFixed(4), volatility: +vol.toFixed(4), sharpe: vol > 0 ? +((r - riskFreeRate) / vol).toFixed(4) : 0 });
        }

        return new Response(JSON.stringify({
          weights: assets.map((a, i) => ({ code: a.code, name: a.name, weight: +weights[i].toFixed(4) })),
          metrics: { expectedReturn: +portReturn.toFixed(4), volatility: +portVol.toFixed(4), sharpeRatio: +(portVol > 0 ? (portReturn - riskFreeRate) / portVol : 0).toFixed(4) },
          frontier,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e: unknown) {
        return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ─── POST /api/factor/analyze ─────────────────────────────────────
    if (req.method === "POST" && url.pathname === "/api/factor/analyze") {
      try {
        const body = await req.json() as { stocks?: string[]; factors?: string[]; days?: number };
        const { stocks, factors = ['momentum', 'volatility', 'rsi', 'macd'], days = 120 } = body;
        if (!stocks || stocks.length < 2) {
          return new Response(JSON.stringify({ error: "需要至少2只股票" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const { macd: macdFn, rsi: rsiFn } = await import("@/web/lib/indicators");
        const dataPromises = stocks.map((s: string) => fetchKlineWithMeta(s, 'daily', days));
        const results = await Promise.all(dataPromises);

        const stockList: { code: string; name: string; closes: number[] }[] = [];
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (typeof r === 'string') continue;
          stockList.push({ code: r.symbol, name: r.name, closes: r.items.map((k: any) => k.close) });
        }

        const exposures: any[] = [];
        const scores: Record<string, Record<string, number>> = {};
        for (const stock of stockList) {
          scores[stock.code] = {};
          for (const f of factors) {
            let val = 0;
            if (f === 'momentum' && stock.closes.length >= 20) {
              val = (stock.closes[stock.closes.length - 1] - stock.closes[stock.closes.length - 20]) / stock.closes[stock.closes.length - 20];
            } else if (f === 'volatility' && stock.closes.length >= 20) {
              const rets: number[] = [];
              for (let i = stock.closes.length - 20; i < stock.closes.length; i++) if (i > 0) rets.push((stock.closes[i] - stock.closes[i - 1]) / stock.closes[i - 1]);
              const m = rets.reduce((s, v) => s + v, 0) / rets.length;
              val = -Math.sqrt(rets.reduce((s, v) => s + (v - m) ** 2, 0) / rets.length) * Math.sqrt(252);
            } else if (f === 'rsi') {
              const rsiVals = rsiFn(stock.closes, 14).filter((v: any): v is number => v !== null);
              if (rsiVals.length > 0) { const r = rsiVals[rsiVals.length - 1]; val = r < 50 ? (50 - r) / 50 : -(r - 50) / 50; }
            } else if (f === 'macd') {
              const hist = macdFn(stock.closes).histogram.filter((v: any): v is number => v !== null);
              if (hist.length > 0) val = hist[hist.length - 1];
            }
            scores[stock.code][f] = +val.toFixed(6);
            exposures.push({ stockCode: stock.code, factorName: f, exposure: +val.toFixed(6) });
          }
        }

        const rankings = stockList.map(stock => {
          const s = scores[stock.code];
          const vals = factors.map(f => s[f] || 0);
          return { code: stock.code, name: stock.name, scores: s, compositeScore: +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(6) };
        }).sort((a, b) => b.compositeScore - a.compositeScore);

        // Spearman IC: rank correlation between factor exposure and forward returns
        const icResults = factors.map(f => {
          if (stockList.length < 3) return { factorName: f, ic: 0, pValue: 1 };
          const n = stockList.length;
          // Factor values
          const fVals = stockList.map(s => scores[s.code][f] || 0);
          // Forward returns (latest 5-day return as proxy)
          const fwdRets = stockList.map(s => {
            const c = s.closes;
            if (c.length < 6) return 0;
            return (c[c.length - 1] - c[c.length - 6]) / c[c.length - 6];
          });
          // Rank arrays
          const rank = (arr: number[]) => {
            const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
            const ranks = new Array(n);
            for (let i = 0; i < n; i++) ranks[sorted[i].i] = i + 1;
            return ranks;
          };
          const rankF = rank(fVals);
          const rankR = rank(fwdRets);
          // Spearman rho = 1 - 6*sum(d^2) / (n*(n^2-1))
          let sumD2 = 0;
          for (let i = 0; i < n; i++) sumD2 += (rankF[i] - rankR[i]) ** 2;
          const ic = n > 1 ? 1 - (6 * sumD2) / (n * (n * n - 1)) : 0;
          // t-test for significance
          const t = n > 2 ? ic * Math.sqrt((n - 2) / (1 - ic * ic + 1e-10)) : 0;
          // Approximate p-value using normal approximation for |t|
          const pValue = n > 2 ? Math.max(0.001, Math.exp(-0.5 * t * t) * 0.8) : 1;
          return { factorName: f, ic: +ic.toFixed(4), pValue: +pValue.toFixed(4) };
        });

        return new Response(JSON.stringify({ rankings, exposures, icResults }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e: unknown) {
        return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ─── POST /api/stock/screen ───────────────────────────────────────
    if (req.method === "POST" && url.pathname === "/api/stock/screen") {
      try {
        const body = await req.json() as { conditions?: { field: string; operator: string; value: number }[]; limit?: number };
        const { conditions = [], limit = 20 } = body;
        const maxResults = Math.min(limit, 50);

        const screenUrl = `http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=200&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,0+t:80,m:1+t:2,m:1+t:23&fields=f2,f3,f5,f8,f9,f12,f14,f20,f23,f37,f55`;
        const json = await fetchEastMoney(screenUrl) as { data?: { diff?: any[] } };

        if (!json?.data?.diff) {
          return new Response(JSON.stringify({ totalMatched: 0, stocks: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

        return new Response(JSON.stringify({ totalMatched: list.length, stocks: list.slice(0, maxResults) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e: unknown) {
        return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // =========================================================================
    // POST /api/stocks/recommend — 智能选股推荐
    // =========================================================================
    if (req.method === "POST" && url.pathname === "/api/stocks/recommend") {
      try {
        const body = await req.json() as {
          style?: 'value' | 'growth' | 'momentum' | 'dividend';
          sector?: string;
          riskLevel?: 'low' | 'medium' | 'high';
          budget?: string;
          count?: number;
        };
        const { style = 'value', riskLevel, budget, count = 10 } = body;
        const maxCount = Math.min(count, 30);

        const fields = 'f2,f3,f5,f8,f9,f12,f14,f20,f23,f37,f55';
        const recommendApiUrl = `http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=500&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,0+t:80,m:1+t:2,m:1+t:23&fields=${fields}`;
        const json = await fetchEastMoney(recommendApiUrl) as { data?: { diff?: any[] } };

        if (!json?.data?.diff) {
          return new Response(JSON.stringify({ error: "未获取到股票数据" }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const num = (v: any) => {
          if (v === null || v === undefined || v === '-') return NaN;
          const n = Number(v);
          return isNaN(n) ? NaN : n;
        };
        const ok = (v: number) => !isNaN(v) && isFinite(v);

        let stocks = json.data.diff.map((d: any) => ({
          code: d.f12 as string, name: d.f14 as string,
          price: num(d.f2), changePercent: num(d.f3), turnover: num(d.f8),
          pe: num(d.f9), marketCap: num(d.f20), pb: num(d.f23), roe: num(d.f37), eps: num(d.f55),
        })).filter((s: any) => ok(s.price) && s.price > 0);

        if (riskLevel === 'low') stocks = stocks.filter((s: any) => ok(s.marketCap) && s.marketCap > 50_000_000_000);
        else if (riskLevel === 'medium') stocks = stocks.filter((s: any) => ok(s.marketCap) && s.marketCap > 10_000_000_000);

        if (budget) {
          const budgetNum = parseFloat(budget);
          if (ok(budgetNum) && budgetNum > 0) stocks = stocks.filter((s: any) => s.price * 100 <= budgetNum);
        }

        const styleLabels: Record<string, string> = { value: '价值型', growth: '成长型', momentum: '动量型', dividend: '红利型' };
        const scored: any[] = [];

        for (const s of stocks) {
          let pass = true, score = 0, reason = '';
          switch (style) {
            case 'value':
              if (!ok(s.pe) || s.pe <= 0 || s.pe >= 20) pass = false;
              if (!ok(s.pb) || s.pb <= 0 || s.pb >= 3) pass = false;
              if (!ok(s.roe) || s.roe <= 10) pass = false;
              if (pass) { score = (20 - s.pe) / 20 * 30 + (3 - s.pb) / 3 * 30 + (s.roe - 10) / 10 * 40; reason = `PE=${s.pe}, PB=${s.pb}, ROE=${s.roe}%`; }
              break;
            case 'growth':
              if (!ok(s.roe) || s.roe <= 15) pass = false;
              if (!ok(s.changePercent) || s.changePercent <= 0) pass = false;
              if (!ok(s.pe) || s.pe <= 0 || s.pe > 60) pass = false;
              if (pass) { score = (s.roe - 15) / 15 * 40 + s.changePercent / 5 * 30 + (60 - s.pe) / 60 * 30; reason = `ROE=${s.roe}%, 涨幅=${s.changePercent}%, PE=${s.pe}`; }
              break;
            case 'momentum':
              if (!ok(s.changePercent) || s.changePercent <= 1) pass = false;
              if (!ok(s.turnover) || s.turnover <= 3) pass = false;
              if (pass) { score = s.changePercent / 10 * 50 + s.turnover / 10 * 50; reason = `涨幅=${s.changePercent}%, 换手率=${s.turnover}%`; }
              break;
            case 'dividend':
              if (!ok(s.pe) || s.pe <= 0 || s.pe >= 25) pass = false;
              if (!ok(s.roe) || s.roe <= 12) pass = false;
              if (!ok(s.turnover) || s.turnover > 5) pass = false;
              if (pass) { score = (25 - s.pe) / 25 * 35 + (s.roe - 12) / 12 * 40 + (5 - s.turnover) / 5 * 25; reason = `PE=${s.pe}, ROE=${s.roe}%, 换手率=${s.turnover}%`; }
              break;
          }
          if (pass && score > 0) scored.push({ ...s, score: +score.toFixed(2), reason });
        }

        scored.sort((a: any, b: any) => b.score - a.score);
        const topN = scored.slice(0, maxCount);

        return new Response(JSON.stringify({
          style: styleLabels[style] || style,
          riskLevel: riskLevel || '不限',
          budget: budget || '不限',
          totalMatched: scored.length,
          recommendations: topN.map((s: any, i: number) => ({
            rank: i + 1, code: s.code, name: s.name, price: s.price,
            changePercent: s.changePercent, pe: s.pe, pb: s.pb, roe: s.roe,
            turnover: s.turnover, score: s.score, reason: s.reason,
          })),
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error("Error in recommend route:", err);
        return new Response(JSON.stringify({ error: errorMessage }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
