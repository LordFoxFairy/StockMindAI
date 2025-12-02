'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import { Search, Loader2, X, Plus } from 'lucide-react';
import { useTheme } from '@/web/components/ThemeProvider';
import type { OHLCVItem } from '@/web/lib/indicators';
import type { StockData } from '@/web/lib/compare';
import {
  normalizeReturns,
  compareVolatility,
  calculateCorrelation,
  compareIndicators,
  generateComparisonSummary,
} from '@/web/lib/compare';
import {
  buildNormalizedReturnChart,
  buildCorrelationHeatmap,
  buildVolatilityCompareChart,
  buildIndicatorCompareChart,
} from '@/web/lib/compareCharts';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3135';

const MAX_STOCKS = 5;

interface SearchResult {
  code: string;
  name: string;
}

const PERIOD_OPTIONS = [
  { klt: 101, label: '日' },
  { klt: 102, label: '周' },
  { klt: 103, label: '月' },
];

const DAY_OPTIONS_MAP: Record<number, { value: number; label: string }[]> = {
  101: [
    { value: 60, label: '60天' },
    { value: 120, label: '120天' },
    { value: 250, label: '250天' },
  ],
  102: [
    { value: 60, label: '60周' },
    { value: 120, label: '120周' },
    { value: 250, label: '250周' },
  ],
  103: [
    { value: 60, label: '60月' },
    { value: 120, label: '120月' },
    { value: 250, label: '250月' },
  ],
};

type ViewType = 'returns' | 'volatility' | 'correlation' | 'indicators';

const VIEW_TABS: { key: ViewType; label: string }[] = [
  { key: 'returns', label: '收益对比' },
  { key: 'volatility', label: '波动率' },
  { key: 'correlation', label: '相关性' },
  { key: 'indicators', label: '指标对比' },
];

interface ComparePanelProps {
  initialStock?: { code: string; name: string } | null;
}

export default function ComparePanel({ initialStock }: ComparePanelProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [stocks, setStocks] = useState<{ code: string; name: string }[]>(
    initialStock ? [initialStock] : [],
  );
  const [stocksData, setStocksData] = useState<Map<string, StockData>>(new Map());
  const [period, setPeriod] = useState(101);
  const [days, setDays] = useState(120);
  const [activeView, setActiveView] = useState<ViewType>('returns');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search state
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Close search dropdown on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `${API_URL}/api/stocks/search?q=${encodeURIComponent(query.trim())}`,
        );
        if (!res.ok) throw new Error();
        const data = await res.json();
        const raw: Record<string, string>[] = Array.isArray(data)
          ? data
          : data.results ?? data.stocks ?? [];
        const list: SearchResult[] = raw
          .map((item) => ({
            code: item.fullCode || item.code || item.ticker || '',
            name: item.name || '',
          }))
          .filter((item) => item.code);
        setSearchResults(list.slice(0, 8));
        setSearchOpen(list.length > 0);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  // Add stock to comparison list
  const addStock = useCallback(
    (s: SearchResult) => {
      if (stocks.length >= MAX_STOCKS) return;
      if (stocks.some((existing) => existing.code === s.code)) return;
      setStocks((prev) => [...prev, s]);
      setQuery('');
      setSearchOpen(false);
    },
    [stocks],
  );

  // Remove stock from comparison list
  const removeStock = useCallback((code: string) => {
    setStocks((prev) => prev.filter((s) => s.code !== code));
    setStocksData((prev) => {
      const next = new Map(prev);
      next.delete(code);
      return next;
    });
  }, []);

  // Fetch kline data for all stocks in parallel
  const fetchAllKlines = useCallback(async () => {
    if (stocks.length === 0) {
      setStocksData(new Map());
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(
        stocks.map(async (stock) => {
          const res = await fetch(
            `${API_URL}/api/stocks/kline/${encodeURIComponent(stock.code)}?days=${days}&klt=${period}`,
          );
          if (!res.ok) throw new Error(`获取 ${stock.name} 数据失败: HTTP ${res.status}`);
          const data = await res.json();
          return {
            code: stock.code,
            name: stock.name,
            klineData: (data.klines || []) as OHLCVItem[],
          };
        }),
      );
      const newMap = new Map<string, StockData>();
      for (const sd of results) {
        newMap.set(sd.code, sd);
      }
      setStocksData(newMap);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载数据失败');
    } finally {
      setLoading(false);
    }
  }, [stocks, days, period]);

  useEffect(() => {
    fetchAllKlines();
  }, [fetchAllKlines]);

  const handlePeriodChange = (klt: number) => {
    setPeriod(klt);
    const dayOpts = DAY_OPTIONS_MAP[klt];
    if (dayOpts && !dayOpts.some((o) => o.value === days)) {
      setDays(dayOpts[0].value);
    }
  };

  // Build stock data array from map
  const stockDataArray = useMemo(() => {
    return stocks
      .map((s) => stocksData.get(s.code))
      .filter((sd): sd is StockData => sd !== undefined && sd.klineData.length > 0);
  }, [stocks, stocksData]);

  // Compute chart options per tab
  const chartOption = useMemo(() => {
    if (stockDataArray.length < 2) return null;

    switch (activeView) {
      case 'returns':
        return buildNormalizedReturnChart(normalizeReturns(stockDataArray), isDark);
      case 'volatility':
        return buildVolatilityCompareChart(compareVolatility(stockDataArray), isDark);
      case 'correlation':
        return buildCorrelationHeatmap(calculateCorrelation(stockDataArray), isDark);
      case 'indicators':
        return buildIndicatorCompareChart(compareIndicators(stockDataArray), isDark);
    }
  }, [stockDataArray, activeView, isDark]);

  // Comparison summary
  const summary = useMemo(() => {
    if (stockDataArray.length < 2) return null;
    return generateComparisonSummary(stockDataArray);
  }, [stockDataArray]);

  const dayOptions = DAY_OPTIONS_MAP[period] || DAY_OPTIONS_MAP[101];

  return (
    <div className="w-full h-full flex flex-col bg-white/80 dark:bg-[#0a0e17]/50 backdrop-blur-xl border border-slate-200 dark:border-white/5 rounded-xl overflow-hidden shadow-lg dark:shadow-2xl dark:shadow-black/50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/5 bg-white/50 dark:bg-slate-900/30">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-mono font-bold text-slate-800 dark:text-slate-100">
            多股对比
          </h2>
        </div>

        {/* Search */}
        <div ref={searchRef} className="relative">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/40 focus-within:border-cyan-400 dark:focus-within:border-cyan-600 transition-colors">
            <Plus className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
              placeholder="添加股票..."
              disabled={stocks.length >= MAX_STOCKS}
              className="bg-transparent text-xs font-mono text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 outline-none w-36 disabled:opacity-50"
            />
            {searching && <Loader2 className="w-3 h-3 text-cyan-500 animate-spin" />}
          </div>
          {searchOpen && searchResults.length > 0 && (
            <div className="absolute right-0 top-full mt-1 w-60 max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-xl z-50">
              {searchResults.map((r, i) => {
                const alreadyAdded = stocks.some((s) => s.code === r.code);
                return (
                  <button
                    key={`${r.code}-${i}`}
                    onClick={() => !alreadyAdded && addStock(r)}
                    disabled={alreadyAdded}
                    className={`w-full flex items-center justify-between px-3 py-2 text-xs font-mono transition-colors ${
                      alreadyAdded
                        ? 'opacity-40 cursor-not-allowed'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="text-slate-700 dark:text-slate-200 font-semibold">
                      {r.name}
                    </span>
                    <span className="text-slate-400 dark:text-slate-500">{r.code}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Period & day selectors + stock chips */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-slate-100 dark:border-white/[0.03] flex-wrap">
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.klt}
            onClick={() => handlePeriodChange(opt.klt)}
            className={`px-2 py-1 text-[10px] font-mono rounded-md transition-colors ${
              period === opt.klt
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 font-semibold'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/40 border border-transparent'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <div className="w-px h-4 bg-slate-200 dark:bg-white/10 mx-1" />
        {dayOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setDays(opt.value)}
            className={`px-2 py-1 text-[10px] font-mono rounded-md transition-colors ${
              days === opt.value
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 font-semibold'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/40 border border-transparent'
            }`}
          >
            {opt.label}
          </button>
        ))}
        {stocks.length > 0 && (
          <>
            <div className="w-px h-4 bg-slate-200 dark:bg-white/10 mx-1" />
            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 mr-1">
              已选:
            </span>
            {stocks.map((s) => (
              <div
                key={s.code}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-cyan-50 dark:bg-cyan-900/30 border border-cyan-200 dark:border-cyan-800/40"
              >
                <span className="text-[10px] font-mono font-semibold text-cyan-700 dark:text-cyan-400">
                  {s.name}
                </span>
                <button
                  onClick={() => removeStock(s.code)}
                  className="text-cyan-400 hover:text-cyan-600 dark:hover:text-cyan-300"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-600">
              ({stocks.length}/{MAX_STOCKS})
            </span>
          </>
        )}
      </div>

      {/* View tabs */}
      {stocks.length >= 2 && (
        <div className="flex items-center gap-1 px-4 py-2 border-b border-slate-100 dark:border-white/[0.03]">
          {VIEW_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveView(tab.key)}
              className={`px-2.5 py-1 text-[10px] font-mono rounded-md transition-colors ${
                activeView === tab.key
                  ? 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-800/50 font-semibold'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/40 border border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Chart area */}
      <div className="flex-1 min-h-0 px-2 pt-2">
        {stocks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Search className="w-8 h-8 text-slate-300 dark:text-slate-600" />
            <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
              请添加至少2只股票开始对比分析
            </span>
          </div>
        ) : stocks.length === 1 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Plus className="w-8 h-8 text-slate-300 dark:text-slate-600" />
            <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
              请再添加至少1只股票
            </span>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <Loader2 className="w-6 h-6 text-cyan-500 animate-spin" />
            <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
              加载数据中...
            </span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <span className="text-xs font-mono text-red-500">{error}</span>
            <button
              onClick={fetchAllKlines}
              className="text-xs font-mono text-cyan-600 dark:text-cyan-400 hover:underline"
            >
              重试
            </button>
          </div>
        ) : chartOption ? (
          <ReactECharts
            option={chartOption}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge={true}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
              暂无K线数据
            </span>
          </div>
        )}
      </div>

      {/* Comparison summary */}
      {summary && (
        <div className="px-4 py-3 border-t border-slate-200 dark:border-white/5 bg-slate-50/50 dark:bg-slate-900/20">
          <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
            对比摘要
          </div>
          <ul className="space-y-1">
            <li className="text-xs font-mono text-slate-600 dark:text-slate-300 flex items-start gap-1.5">
              <span className="text-cyan-500 dark:text-cyan-400 mt-0.5">·</span>
              区间涨幅最高: {summary.bestReturn.name}{' '}
              {summary.bestReturn.value >= 0 ? '+' : ''}
              {(summary.bestReturn.value * 100).toFixed(2)}%
            </li>
            <li className="text-xs font-mono text-slate-600 dark:text-slate-300 flex items-start gap-1.5">
              <span className="text-cyan-500 dark:text-cyan-400 mt-0.5">·</span>
              波动率最低: {summary.lowestVolatility.name}{' '}
              {(summary.lowestVolatility.value * 100).toFixed(2)}%
            </li>
            <li className="text-xs font-mono text-slate-600 dark:text-slate-300 flex items-start gap-1.5">
              <span className="text-cyan-500 dark:text-cyan-400 mt-0.5">·</span>
              夏普比率最高: {summary.highestSharpe.name}{' '}
              {summary.highestSharpe.value.toFixed(2)}
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
