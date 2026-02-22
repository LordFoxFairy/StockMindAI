import {
  fetchEastMoney, resolveSecid,
  getCached, setCache, parseStockItem, parseSectorItem,
} from "@/core/services/eastmoney";
import { jsonResponse, errorResponse } from "./shared";

export async function handleStocksRoute(req: Request, url: URL): Promise<Response | null> {
  // =========================================================================
  // GET /api/stocks/hot — 热门股票 (sorted by turnover, from East Money)
  // =========================================================================
  if (req.method === "GET" && url.pathname === "/api/stocks/hot") {
    try {
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
      const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20', 10)));

      const cacheKey = `hot:${page}:${pageSize}`;
      const cached = getCached(cacheKey);
      if (cached) return jsonResponse(cached);

      const apiUrl = `http://push2.eastmoney.com/api/qt/clist/get?pn=${page}&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f6&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f2,f3,f4,f5,f6,f12,f13,f14`;
      const json = await fetchEastMoney(apiUrl);

      const total = json?.data?.total || 0;
      const totalPages = Math.ceil(total / pageSize);
      const stocks = (json?.data?.diff || []).map(parseStockItem);

      const result = { page, pageSize, total, totalPages, stocks };
      setCache(cacheKey, result);
      return jsonResponse(result);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error("Error in stocks hot route:", err);
      return errorResponse(errorMessage);
    }
  }

  // =========================================================================
  // GET /api/stocks/sectors — 行业板块列表 (from East Money)
  // =========================================================================
  if (req.method === "GET" && url.pathname === "/api/stocks/sectors") {
    try {
      const cacheKey = 'sectors';
      const cached = getCached(cacheKey);
      if (cached) return jsonResponse(cached);

      const apiUrl = `http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=50&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=f2,f3,f4,f12,f14`;
      const json = await fetchEastMoney(apiUrl);

      const sectors = (json?.data?.diff || []).map(parseSectorItem);
      setCache(cacheKey, sectors);
      return jsonResponse(sectors);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error("Error in sectors route:", err);
      return errorResponse(errorMessage);
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
      if (cached) return jsonResponse(cached);

      const apiUrl = `http://push2.eastmoney.com/api/qt/clist/get?pn=${page}&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=b:${sectorCode}&fields=f2,f3,f4,f5,f6,f12,f13,f14`;
      const json = await fetchEastMoney(apiUrl);

      const total = json?.data?.total || 0;
      const totalPages = Math.ceil(total / pageSize);
      const stocks = (json?.data?.diff || []).map(parseStockItem);

      const result = { sector: sectorCode, page, pageSize, total, totalPages, stocks };
      setCache(cacheKey, result);
      return jsonResponse(result);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error("Error in sector stocks route:", err);
      return errorResponse(errorMessage);
    }
  }

  // =========================================================================
  // GET /api/stocks/search?q=keyword — 搜索 (from East Money search API)
  // =========================================================================
  if (req.method === "GET" && url.pathname === "/api/stocks/search") {
    try {
      const query = (url.searchParams.get('q') || '').trim();

      if (!query) return jsonResponse([]);

      const cacheKey = `search:${query}`;
      const cached = getCached(cacheKey);
      if (cached) return jsonResponse(cached);

      const apiUrl = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(query)}&type=14&count=20`;
      const json = await fetchEastMoney(apiUrl);

      const results: any[] = [];
      const suggestions = json?.QuotationCodeTable?.Data || [];
      for (const item of suggestions) {
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
      return jsonResponse(results);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error("Error in stocks search route:", err);
      return errorResponse(errorMessage);
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

      const ALLOWED_KLT = [1, 5, 15, 30, 60, 101, 102, 103];
      const rawKlt = parseInt(url.searchParams.get('klt') || '101', 10);
      const klt = ALLOWED_KLT.includes(rawKlt) ? rawKlt : 101;

      let lmt = days;
      if (klt === 1) lmt = days * 240;
      else if (klt === 5) lmt = days * 48;
      else if (klt === 15) lmt = days * 16;
      else if (klt === 30) lmt = days * 8;
      else if (klt === 60) lmt = days * 4;

      const cacheKey = `kline:${code}:${days}:${klt}`;
      const cached = getCached(cacheKey);
      if (cached) return jsonResponse(cached);

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
      return jsonResponse(result);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error("Error in kline route:", err);
      return errorResponse(errorMessage);
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
      if (cached) return jsonResponse(cached);

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
      return jsonResponse(result);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error("Error in quote route:", err);
      return errorResponse(errorMessage);
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
      if (cached) return jsonResponse(cached);

      const numericCode = code.replace(/^(sh|sz)/i, '');

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
      return jsonResponse(result);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error("Error in stock news route:", err);
      return errorResponse(errorMessage);
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
      if (cached) return jsonResponse(cached);

      const numericCode = code.replace(/^(sh|sz)/i, '');

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
      return jsonResponse(result);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error("Error in announcements route:", err);
      return errorResponse(errorMessage);
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
      if (cached) return jsonResponse(cached);

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
      return jsonResponse(result);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error("Error in fundamentals route:", err);
      return errorResponse(errorMessage);
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
        return errorResponse("未获取到股票数据");
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

      return jsonResponse({
        style: styleLabels[style] || style,
        riskLevel: riskLevel || '不限',
        budget: budget || '不限',
        totalMatched: scored.length,
        recommendations: topN.map((s: any, i: number) => ({
          rank: i + 1, code: s.code, name: s.name, price: s.price,
          changePercent: s.changePercent, pe: s.pe, pb: s.pb, roe: s.roe,
          turnover: s.turnover, score: s.score, reason: s.reason,
        })),
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error("Error in recommend route:", err);
      return errorResponse(errorMessage);
    }
  }

  return null;
}
