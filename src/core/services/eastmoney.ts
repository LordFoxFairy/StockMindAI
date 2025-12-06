import type { OHLCVItem } from "@/web/lib/indicators";

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 3_000;
const apiCache = new Map<string, { data: any; timestamp: number }>();

export function getCached(key: string): any | null {
  const entry = apiCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) return entry.data;
  return null;
}

export function setCache(key: string, data: any): void {
  apiCache.set(key, { data, timestamp: Date.now() });
}

// ---------------------------------------------------------------------------
// Core fetcher — handles both JSON and JSONP responses
// ---------------------------------------------------------------------------
export async function fetchEastMoney(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      "Referer": "https://quote.eastmoney.com",
      "User-Agent": "Mozilla/5.0",
    },
  });
  const text = await res.text();
  if (!text || text.trim() === "") return {};
  // JSONP: callbackName({...}); or ({...}) when cb= is empty — strip wrapper
  const jsonpMatch = text.match(/^\w*\(([\s\S]+)\);?\s*$/);
  if (jsonpMatch) return JSON.parse(jsonpMatch[1]);
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Stock code parsing
// ---------------------------------------------------------------------------

/** Infer exchange from a bare 6-digit A-share code. */
function inferExchange(code: string): "sh" | "sz" {
  if (code.startsWith("6") || code.startsWith("9")) return "sh";
  return "sz";
}

/**
 * Parse a stock symbol into its components.
 * Accepts: "sh600519", "sz300308", "600519", "300308", etc.
 */
export function parseStockCode(
  symbol: string,
): { secid: string; prefix: "sh" | "sz"; code: string } | string {
  const clean = symbol.toLowerCase().replace(/[^a-z0-9]/g, "");
  let prefix: "sh" | "sz";
  let code: string;

  if (clean.startsWith("sz")) {
    prefix = "sz";
    code = clean.slice(2);
  } else if (clean.startsWith("sh")) {
    prefix = "sh";
    code = clean.slice(2);
  } else if (/^\d{6}$/.test(clean)) {
    prefix = inferExchange(clean);
    code = clean;
  } else {
    return `Invalid symbol "${symbol}". Use sh/sz prefix or 6-digit code.`;
  }

  const secid = prefix === "sz" ? `0.${code}` : `1.${code}`;
  return { secid, prefix, code };
}

/**
 * Shorthand — resolve symbol string directly to secid.
 * Throws on invalid input (use in server routes where we control validation).
 */
export function resolveSecid(code: string): string {
  if (code.startsWith("sz")) return `0.${code.slice(2)}`;
  if (code.startsWith("sh")) return `1.${code.slice(2)}`;
  const ex = inferExchange(code);
  return ex === "sh" ? `1.${code}` : `0.${code}`;
}

// ---------------------------------------------------------------------------
// List item parsers
// ---------------------------------------------------------------------------

export function parseStockItem(item: any) {
  const numericCode = String(item.f12 || "");
  const market =
    item.f13 === 1 || item.f13 === "1"
      ? "sh"
      : item.f13 === 0 || item.f13 === "0"
        ? "sz"
        : inferExchange(numericCode);
  return {
    ticker: `${market}${numericCode}`,
    name: String(item.f14 || ""),
    price: item.f2 === "-" ? 0 : Number(item.f2) || 0,
    changePercent: item.f3 === "-" ? 0 : Number(item.f3) || 0,
    change: item.f4 === "-" ? 0 : Number(item.f4) || 0,
    volume: item.f5 === "-" ? 0 : Number(item.f5) || 0,
    turnover: item.f6 === "-" ? 0 : Number(item.f6) || 0,
  };
}

export function parseSectorItem(item: any) {
  return {
    code: String(item.f12 || ""),
    name: String(item.f14 || ""),
    changePercent: item.f3 === "-" ? 0 : Number(item.f3) || 0,
    change: item.f4 === "-" ? 0 : Number(item.f4) || 0,
    price: item.f2 === "-" ? 0 : Number(item.f2) || 0,
  };
}

// ---------------------------------------------------------------------------
// K-line / OHLCV data
// ---------------------------------------------------------------------------

/** Fetch kline data as OHLCVItem[]. */
export async function fetchKline(
  code: string,
  days: number,
  klt = 101,
): Promise<OHLCVItem[]> {
  const secid = resolveSecid(code);
  const url = `http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=${klt}&fqt=1&end=20500101&lmt=${days}`;
  const json = await fetchEastMoney(url);
  return (json?.data?.klines || []).map((line: string) => {
    const p = line.split(",");
    return {
      date: p[0],
      open: parseFloat(p[1]),
      close: parseFloat(p[2]),
      high: parseFloat(p[3]),
      low: parseFloat(p[4]),
      volume: parseFloat(p[5]),
    };
  });
}

/**
 * High-level helper for agent tools — fetches kline + stock name.
 * Returns error string on failure.
 */
export async function fetchKlineWithMeta(
  symbol: string,
  period: "daily" | "weekly" | "monthly" = "daily",
  days = 30,
): Promise<
  { items: OHLCVItem[]; name: string; symbol: string; code: string } | string
> {
  const parsed = parseStockCode(symbol);
  if (typeof parsed === "string") return parsed;

  const { secid, prefix, code } = parsed;
  const kltMap: Record<string, string> = {
    daily: "101",
    weekly: "102",
    monthly: "103",
  };
  const klt = kltMap[period] || "101";

  const url = `http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=${klt}&fqt=1&end=20500101&lmt=${days}`;
  const response = await fetch(url, {
    headers: { Referer: "https://quote.eastmoney.com" },
  });
  const json = (await response.json()) as {
    data?: { code?: string; name?: string; klines?: string[] };
  };

  if (!json.data?.klines?.length) {
    return `No kline data found for symbol ${symbol}.`;
  }

  const items: OHLCVItem[] = json.data.klines.map((line: string) => {
    const p = line.split(",");
    return {
      date: p[0],
      open: parseFloat(p[1]),
      close: parseFloat(p[2]),
      high: parseFloat(p[3]),
      low: parseFloat(p[4]),
      volume: parseFloat(p[5]),
    };
  });

  return {
    items,
    name: json.data.name || "",
    symbol: `${prefix}${code}`,
    code: json.data.code || "",
  };
}
