'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search, TrendingUp, ArrowUpRight, ArrowDownRight,
  Loader2, RefreshCw, Star, ChevronLeft,
  Flame, LayoutGrid, Heart,
} from 'lucide-react';

// =========================================================================
// Types — matches East Money API proxy response formats
// =========================================================================
interface StockData {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  turnover: number;
}

interface PaginatedStocks {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  stocks: StockData[];
}

interface SectorInfo {
  code: string;   // e.g. "BK0475"
  name: string;   // e.g. "银行"
  changePercent: number;
  change: number;
  price: number;
}

interface SectorStocksResponse {
  sector: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  stocks: StockData[];
}

interface SearchResult {
  ticker: string;
  name: string;
  market: string;
  fullCode: string;
  type: string;
}

type MainTab = '热门' | '板块' | '自选';

const MAIN_TABS: { key: MainTab; icon: React.ReactNode; label: string }[] = [
  { key: '热门', icon: <Flame className="w-3.5 h-3.5" />, label: '热门' },
  { key: '板块', icon: <LayoutGrid className="w-3.5 h-3.5" />, label: '板块' },
  { key: '自选', icon: <Heart className="w-3.5 h-3.5" />, label: '自选' },
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3135';
const FAVORITES_KEY = 'stockmind_favorites';

// =========================================================================
// Helpers
// =========================================================================
function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveFavorites(codes: string[]) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(codes));
}

function formatPrice(price: number): string {
  if (!price || isNaN(price)) return '--';
  return price.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatChange(change: number): string {
  if (isNaN(change)) return '--';
  const sign = change > 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}`;
}

function formatPercent(pct: number): string {
  if (isNaN(pct)) return '--';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

function formatVolume(vol: number): string {
  if (!vol || isNaN(vol)) return '--';
  if (vol >= 1e8) return `${(vol / 1e8).toFixed(2)}亿`;
  if (vol >= 1e4) return `${(vol / 1e4).toFixed(0)}万`;
  return vol.toLocaleString();
}

function formatTurnover(t: number): string {
  if (!t || isNaN(t)) return '--';
  if (t >= 1e8) return `${(t / 1e8).toFixed(2)}亿`;
  if (t >= 1e4) return `${(t / 1e4).toFixed(0)}万`;
  return t.toLocaleString();
}

// A-share convention: RED = up, GREEN = down
function priceColor(change: number): string {
  if (change > 0) return 'text-red-600 dark:text-red-500';
  if (change < 0) return 'text-green-600 dark:text-green-500';
  return 'text-slate-500 dark:text-slate-400';
}

// =========================================================================
// Component
// =========================================================================
interface StockWatchlistProps {
  onSelectStock: (ticker: string, name: string) => void;
}

export default function StockWatchlist({ onSelectStock }: StockWatchlistProps) {
  // Main state
  const [activeTab, setActiveTab] = useState<MainTab>('热门');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  // Hot stocks (paginated)
  const [hotStocks, setHotStocks] = useState<StockData[]>([]);
  const [hotPage, setHotPage] = useState(1);
  const [hotTotalPages, setHotTotalPages] = useState(0);
  const [hotTotal, setHotTotal] = useState(0);
  const [hotLoading, setHotLoading] = useState(false);

  // Sectors
  const [sectors, setSectors] = useState<SectorInfo[]>([]);
  const [sectorsLoading, setSectorsLoading] = useState(false);
  const [activeSector, setActiveSector] = useState<SectorInfo | null>(null);
  const [sectorStocks, setSectorStocks] = useState<StockData[]>([]);
  const [sectorPage, setSectorPage] = useState(1);
  const [sectorTotal, setSectorTotal] = useState(0);
  const [sectorTotalPages, setSectorTotalPages] = useState(0);
  const [sectorLoading, setSectorLoading] = useState(false);

  // Favorites — stored as fullCode like "sh600519"
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favStocks, setFavStocks] = useState<StockData[]>([]);
  const [favLoading, setFavLoading] = useState(false);

  // Error
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load favorites from localStorage on mount
  useEffect(() => {
    setFavorites(loadFavorites());
  }, []);

  // ── Data fetching ────────────────────────────────────────

  const fetchHotStocks = useCallback(async (page = 1, silent = false) => {
    if (!silent) { setHotLoading(true); setError(null); }
    try {
      const res = await fetch(`${API_URL}/api/stocks/hot?page=${page}&pageSize=20`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: PaginatedStocks = await res.json();
      setHotStocks(data.stocks || []);
      setHotPage(data.page);
      setHotTotalPages(data.totalPages);
      setHotTotal(data.total);
    } catch (err: unknown) {
      if (!silent) setError(err instanceof Error ? err.message : 'Failed to load hot stocks');
    } finally {
      if (!silent) setHotLoading(false);
    }
  }, []);

  const fetchSectors = useCallback(async () => {
    setSectorsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/stocks/sectors`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data)) setSectors(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load sectors');
    } finally {
      setSectorsLoading(false);
    }
  }, []);

  const fetchSectorStocks = useCallback(async (sectorCode: string, page: number, silent = false) => {
    if (!silent) { setSectorLoading(true); setError(null); }
    try {
      const res = await fetch(`${API_URL}/api/stocks/sector/${encodeURIComponent(sectorCode)}?page=${page}&pageSize=20`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SectorStocksResponse = await res.json();
      setSectorStocks(data.stocks || []);
      setSectorPage(data.page);
      setSectorTotal(data.total);
      setSectorTotalPages(data.totalPages);
    } catch (err: unknown) {
      if (!silent) setError(err instanceof Error ? err.message : 'Failed to load sector stocks');
    } finally {
      if (!silent) setSectorLoading(false);
    }
  }, []);

  const fetchFavorites = useCallback(async (codes: string[]) => {
    if (codes.length === 0) {
      setFavStocks([]);
      return;
    }
    setFavLoading(true);
    setError(null);
    try {
      // Search each favorite code to get its current price
      const results: StockData[] = [];
      const promises = codes.map(async (code) => {
        try {
          const res = await fetch(`${API_URL}/api/stocks/search?q=${encodeURIComponent(code)}`);
          if (!res.ok) return null;
          const data = await res.json();
          // Search returns suggestions; find exact match
          if (Array.isArray(data) && data.length > 0) {
            const match = data.find((s: SearchResult) => s.ticker === code || s.fullCode === code) || data[0];
            return {
              ticker: match.fullCode || match.ticker,
              name: match.name,
              price: 0, change: 0, changePercent: 0, volume: 0, turnover: 0,
            } as StockData;
          }
          return null;
        } catch { return null; }
      });
      const resolved = await Promise.all(promises);
      for (const r of resolved) {
        if (r) results.push(r);
      }
      setFavStocks(results);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load favorites');
    } finally {
      setFavLoading(false);
    }
  }, []);

  const searchStocks = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/stocks/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSearchResults(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  }, []);

  // ── Effects ──────────────────────────────────────────────

  useEffect(() => {
    if (activeTab === '热门' && hotStocks.length === 0) {
      fetchHotStocks(1);
    }
  }, [activeTab, hotStocks.length, fetchHotStocks]);

  useEffect(() => {
    if (activeTab === '板块' && sectors.length === 0) {
      fetchSectors();
    }
  }, [activeTab, sectors.length, fetchSectors]);

  useEffect(() => {
    if (activeTab === '自选') {
      const codes = loadFavorites();
      setFavorites(codes);
      fetchFavorites(codes);
    }
  }, [activeTab, fetchFavorites]);

  // Real-time polling: refresh current tab data every 5s (silent, no loading flicker)
  useEffect(() => {
    const timer = setInterval(() => {
      if (activeTab === '热门') fetchHotStocks(hotPage, true);
      else if (activeTab === '板块' && activeSector) fetchSectorStocks(activeSector.code, sectorPage, true);
    }, 5000);
    return () => clearInterval(timer);
  }, [activeTab, hotPage, activeSector, sectorPage, fetchHotStocks, fetchSectorStocks]);

  // Debounced search
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setSearchResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      searchStocks(value);
    }, 350);
  }, [searchStocks]);

  // ── Favorite toggle ──────────────────────────────────────

  const toggleFavorite = useCallback((code: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites(prev => {
      const next = prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code];
      saveFavorites(next);
      return next;
    });
  }, []);

  const isFavorite = (code: string) => favorites.includes(code);

  // ── Render helpers ───────────────────────────────────────

  const renderStockRow = (stock: StockData, index: number) => {
    const color = priceColor(stock.change);
    return (
      <div
        key={`${stock.ticker}-${index}`}
        role="button"
        tabIndex={0}
        onClick={() => onSelectStock(stock.ticker, stock.name)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectStock(stock.ticker, stock.name); }}
        className="w-full grid grid-cols-[1fr_72px_72px_64px] gap-1 items-center px-3 py-2
          hover:bg-slate-50 dark:hover:bg-slate-800/30 border-b border-slate-100 dark:border-white/[0.03]
          transition-colors cursor-pointer group text-left"
      >
        {/* Star + Name + Code */}
        <div className="min-w-0 flex items-center gap-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); toggleFavorite(stock.ticker, e); }}
            className="shrink-0 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            <Star className={`w-3 h-3 ${
              isFavorite(stock.ticker)
                ? 'fill-amber-400 text-amber-400'
                : 'text-slate-300 dark:text-slate-600'
            }`} />
          </button>
          <div className="min-w-0">
            <div className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200 group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors truncate">
              {stock.name}
            </div>
            <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate">
              {stock.ticker}
            </div>
          </div>
        </div>

        {/* Price */}
        <span className={`text-xs font-mono font-medium text-right tabular-nums ${color}`}>
          {formatPrice(stock.price)}
        </span>

        {/* Change % */}
        <div className={`flex items-center justify-end gap-0.5 text-[11px] font-mono font-semibold tabular-nums ${color}`}>
          {stock.change > 0
            ? <ArrowUpRight className="w-3 h-3" />
            : stock.change < 0
              ? <ArrowDownRight className="w-3 h-3" />
              : null
          }
          {formatPercent(stock.changePercent)}
        </div>

        {/* Volume */}
        <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 text-right tabular-nums">
          {formatVolume(stock.volume)}
        </span>
      </div>
    );
  };

  const renderSearchRow = (item: SearchResult, index: number) => (
    <div
      key={`${item.fullCode}-${index}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelectStock(item.fullCode || item.ticker, item.name)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectStock(item.fullCode || item.ticker, item.name); }}
      className="w-full grid grid-cols-[1fr_auto] gap-2 items-center px-3 py-2.5
        hover:bg-slate-50 dark:hover:bg-slate-800/30 border-b border-slate-100 dark:border-white/[0.03]
        transition-colors cursor-pointer group text-left"
    >
      <div className="min-w-0 flex items-center gap-1.5">
        <button
          onClick={(e) => { e.stopPropagation(); toggleFavorite(item.fullCode || item.ticker, e); }}
          className="shrink-0 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
        >
          <Star className={`w-3 h-3 ${
            isFavorite(item.fullCode || item.ticker)
              ? 'fill-amber-400 text-amber-400'
              : 'text-slate-300 dark:text-slate-600'
          }`} />
        </button>
        <div className="min-w-0">
          <div className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200 group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors truncate">
            {item.name}
          </div>
          <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate">
            {item.fullCode || item.ticker}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
          {item.type || (item.market === 'sh' ? '沪' : item.market === 'sz' ? '深' : item.market)}
        </span>
      </div>
    </div>
  );

  const renderLoading = () => (
    <div className="flex flex-col items-center justify-center h-32 gap-2">
      <Loader2 className="w-5 h-5 text-cyan-500 dark:text-cyan-400 animate-spin" />
      <span className="text-[11px] font-mono text-slate-400 dark:text-slate-600">Loading...</span>
    </div>
  );

  const renderError = (retryFn?: () => void) => (
    <div className="flex flex-col items-center justify-center h-32 gap-2 px-4">
      <span className="text-[11px] font-mono text-red-500 dark:text-red-400 text-center">{error}</span>
      {retryFn && (
        <button onClick={retryFn} className="text-[10px] font-mono text-cyan-600 dark:text-cyan-400 hover:underline">
          Retry
        </button>
      )}
    </div>
  );

  const renderEmpty = (msg: string) => (
    <div className="flex items-center justify-center h-32 text-[11px] font-mono text-slate-400 dark:text-slate-600">
      {msg}
    </div>
  );

  const renderTableHeader = () => (
    <div className="grid grid-cols-[1fr_72px_72px_64px] gap-1 px-3 py-1.5 text-[9px] font-mono uppercase tracking-wider text-slate-400 dark:text-slate-600 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-slate-900/30">
      <span className="pl-6">名称/代码</span>
      <span className="text-right">现价</span>
      <span className="text-right">涨跌幅</span>
      <span className="text-right">成交量</span>
    </div>
  );

  const renderPagination = (
    currentPage: number,
    totalPages: number,
    onPageChange: (page: number) => void,
  ) => {
    if (totalPages <= 1) return null;
    return (
      <div className="flex items-center justify-center gap-3 px-3 py-2 border-t border-slate-100 dark:border-white/5">
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          className="px-2 py-1 text-[10px] font-mono rounded border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          上一页
        </button>
        <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 tabular-nums">
          {currentPage} / {totalPages}
        </span>
        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
          className="px-2 py-1 text-[10px] font-mono rounded border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          下一页
        </button>
      </div>
    );
  };

  // ── Search results overlay ───────────────────────────────

  const showSearchResults = searchQuery.trim().length > 0;

  // ── Tab content ──────────────────────────────────────────

  const renderHotTab = () => (
    <>
      {renderTableHeader()}
      <div className="flex-1 overflow-y-auto">
        {hotLoading && hotStocks.length === 0
          ? renderLoading()
          : error && hotStocks.length === 0
            ? renderError(() => fetchHotStocks(hotPage))
            : hotStocks.length === 0
              ? renderEmpty('暂无数据')
              : hotStocks.map(renderStockRow)
        }
      </div>
      {renderPagination(hotPage, hotTotalPages, (p) => {
        setHotPage(p);
        fetchHotStocks(p);
      })}
    </>
  );

  const renderSectorsTab = () => {
    if (activeSector) {
      return (
        <>
          {/* Sector header with back button */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-slate-900/30">
            <button
              onClick={() => { setActiveSector(null); setSectorStocks([]); }}
              className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              <ChevronLeft className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            </button>
            <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200">
              {activeSector.name}
            </span>
            <span className={`text-[10px] font-mono ml-1 ${priceColor(activeSector.changePercent)}`}>
              {formatPercent(activeSector.changePercent)}
            </span>
            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 ml-auto">
              {sectorTotal} stocks
            </span>
          </div>
          {renderTableHeader()}
          <div className="flex-1 overflow-y-auto">
            {sectorLoading
              ? renderLoading()
              : error
                ? renderError(() => fetchSectorStocks(activeSector.code, sectorPage))
                : sectorStocks.length === 0
                  ? renderEmpty('暂无数据')
                  : sectorStocks.map(renderStockRow)
            }
          </div>
          {renderPagination(sectorPage, sectorTotalPages, (p) => {
            setSectorPage(p);
            fetchSectorStocks(activeSector.code, p);
          })}
        </>
      );
    }

    // Show sector grid
    return (
      <div className="flex-1 overflow-y-auto p-3">
        {sectorsLoading
          ? renderLoading()
          : error
            ? renderError(fetchSectors)
            : sectors.length === 0
              ? renderEmpty('暂无板块数据')
              : (
                <div className="grid grid-cols-2 gap-2">
                  {sectors.map(s => {
                    const color = priceColor(s.changePercent);
                    return (
                      <button
                        key={s.code}
                        onClick={() => {
                          setActiveSector(s);
                          setSectorPage(1);
                          fetchSectorStocks(s.code, 1);
                        }}
                        className="flex flex-col items-start p-3 rounded-lg border border-slate-200 dark:border-white/10
                          bg-white dark:bg-slate-800/40 hover:bg-slate-50 dark:hover:bg-slate-700/40
                          hover:border-cyan-300 dark:hover:border-cyan-800 transition-all group text-left"
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200 group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors truncate">
                            {s.name}
                          </span>
                          <span className={`text-[10px] font-mono font-semibold tabular-nums ${color}`}>
                            {formatPercent(s.changePercent)}
                          </span>
                        </div>
                        <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500 mt-0.5">
                          {s.code}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )
        }
      </div>
    );
  };

  const renderFavoritesTab = () => (
    <>
      <div className="grid grid-cols-[1fr_auto] gap-2 px-3 py-1.5 text-[9px] font-mono uppercase tracking-wider text-slate-400 dark:text-slate-600 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-slate-900/30">
        <span className="pl-6">名称/代码</span>
        <span className="text-right pr-2">操作</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {favLoading
          ? renderLoading()
          : error
            ? renderError(() => fetchFavorites(favorites))
            : favorites.length === 0
              ? renderEmpty('暂无自选股 - 点击星标添加')
              : favStocks.length === 0 && !favLoading
                ? renderEmpty('暂无自选股数据')
                : favStocks.map((stock, i) => (
                    <div
                      key={`fav-${stock.ticker}-${i}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectStock(stock.ticker, stock.name)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectStock(stock.ticker, stock.name); }}
                      className="w-full grid grid-cols-[1fr_auto] gap-2 items-center px-3 py-2.5
                        hover:bg-slate-50 dark:hover:bg-slate-800/30 border-b border-slate-100 dark:border-white/[0.03]
                        transition-colors cursor-pointer group text-left"
                    >
                      <div className="min-w-0 flex items-center gap-1.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleFavorite(stock.ticker, e); }}
                          className="shrink-0 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                        >
                          <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                        </button>
                        <div className="min-w-0">
                          <div className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200 group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors truncate">
                            {stock.name}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate">
                            {stock.ticker}
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-cyan-500 dark:text-cyan-400 group-hover:underline pr-2">
                        分析
                      </span>
                    </div>
                  ))
        }
      </div>
    </>
  );

  // ── Main render ──────────────────────────────────────────

  return (
    <div className="w-full h-full flex flex-col bg-white dark:bg-[#0a0e17]/50 backdrop-blur-xl border border-slate-200 dark:border-white/5 rounded-xl overflow-hidden shadow-lg dark:shadow-2xl dark:shadow-black/50">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-slate-200 dark:border-white/5">
        {/* Title bar */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
            <h2 className="text-xs font-mono font-semibold text-slate-800 dark:text-slate-200 tracking-wider">
              A股行情终端
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setError(null);
                if (activeTab === '热门') fetchHotStocks(hotPage);
                else if (activeTab === '自选') fetchFavorites(favorites);
                else if (activeSector) fetchSectorStocks(activeSector.code, sectorPage);
                else fetchSectors();
              }}
              className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800/40 transition-colors"
              title="刷新"
            >
              <RefreshCw className={`w-3 h-3 text-slate-400 dark:text-slate-500 ${
                (hotLoading || sectorLoading || favLoading || sectorsLoading) ? 'animate-spin' : ''
              }`} />
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
          <input
            type="text"
            placeholder="搜索代码或名称..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-[11px] font-mono rounded-md
              bg-slate-100 dark:bg-[#0a0e17] border border-slate-200 dark:border-white/10
              text-slate-700 dark:text-slate-300 placeholder-slate-400 dark:placeholder-slate-600
              focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50
              transition-colors"
          />
          {isSearching && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cyan-500 animate-spin" />
          )}
        </div>

        {/* Main tabs */}
        <div className="flex gap-1">
          {MAIN_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
                setSearchQuery('');
                setSearchResults([]);
                setError(null);
                if (tab.key === '板块') setActiveSector(null);
              }}
              className={`flex items-center gap-1 px-3 py-1 text-[10px] font-mono rounded-md transition-colors ${
                activeTab === tab.key
                  ? 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-800/50'
                  : 'text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/40 border border-transparent'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {showSearchResults ? (
          <>
            <div className="px-3 py-1.5 text-[9px] font-mono text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-slate-900/30">
              搜索结果: {searchResults.length} 条
            </div>
            <div className="flex-1 overflow-y-auto">
              {isSearching
                ? renderLoading()
                : searchResults.length === 0
                  ? renderEmpty('未找到匹配的股票')
                  : searchResults.map(renderSearchRow)
              }
            </div>
          </>
        ) : (
          <>
            {activeTab === '热门' && renderHotTab()}
            {activeTab === '板块' && renderSectorsTab()}
            {activeTab === '自选' && renderFavoritesTab()}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-slate-200 dark:border-white/5 flex items-center justify-between">
        <span className="text-[9px] font-mono text-slate-400 dark:text-slate-600">
          Click to analyze
        </span>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-[9px] font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
            <span className="text-red-500 dark:text-red-400">涨</span>
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 ml-1"></span>
            <span className="text-green-500 dark:text-green-400">跌</span>
          </span>
          <span className="text-[9px] font-mono text-slate-400 dark:text-slate-600">
            东方财富
          </span>
        </div>
      </div>
    </div>
  );
}
