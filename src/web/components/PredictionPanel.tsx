'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import { Search, Loader2, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useTheme } from '@/web/components/ThemeProvider';
import type { OHLCVItem } from '@/web/lib/indicators';
import { runPrediction } from '@/web/lib/predict';
import type { PredictionResult } from '@/web/lib/predict';
import {
  buildCompositeGaugeChart,
  buildRadarChart,
  buildPredictionChart,
} from '@/web/lib/predictCharts';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3135';

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
  ],
  103: [
    { value: 36, label: '36月' },
    { value: 60, label: '60月' },
  ],
};

type ViewType = 'overview' | 'signals' | 'kline';

const VIEW_TABS: { key: ViewType; label: string }[] = [
  { key: 'overview', label: '综合评分' },
  { key: 'signals', label: '指标信号' },
  { key: 'kline', label: 'K线分析' },
];

interface PredictionPanelProps {
  initialStock?: { code: string; name: string } | null;
}

export default function PredictionPanel({ initialStock }: PredictionPanelProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [selectedStock, setSelectedStock] = useState<{ code: string; name: string } | null>(
    initialStock || null,
  );
  const [klineData, setKlineData] = useState<OHLCVItem[]>([]);
  const [period, setPeriod] = useState(101);
  const [days, setDays] = useState(120);
  const [activeView, setActiveView] = useState<ViewType>('overview');
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

  // Select stock
  const selectStock = useCallback((s: SearchResult) => {
    setSelectedStock(s);
    setQuery('');
    setSearchOpen(false);
  }, []);

  // Fetch kline data
  const fetchKline = useCallback(async () => {
    if (!selectedStock) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_URL}/api/stocks/kline/${encodeURIComponent(selectedStock.code)}?days=${days}&klt=${period}`,
      );
      if (!res.ok) throw new Error(`获取K线数据失败: HTTP ${res.status}`);
      const data = await res.json();
      setKlineData((data.klines || []) as OHLCVItem[]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载数据失败');
      setKlineData([]);
    } finally {
      setLoading(false);
    }
  }, [selectedStock, days, period]);

  useEffect(() => {
    fetchKline();
  }, [fetchKline]);

  const handlePeriodChange = (klt: number) => {
    setPeriod(klt);
    const dayOpts = DAY_OPTIONS_MAP[klt];
    if (dayOpts && !dayOpts.some((o) => o.value === days)) {
      setDays(dayOpts[0].value);
    }
  };

  // Compute prediction
  const prediction: PredictionResult | null = useMemo(() => {
    if (klineData.length < 30) return null;
    return runPrediction(klineData);
  }, [klineData]);

  // Chart options
  const chartOption = useMemo(() => {
    if (!prediction) return null;

    switch (activeView) {
      case 'overview':
        return buildCompositeGaugeChart(prediction.compositeScore, isDark);
      case 'signals':
        return buildRadarChart(prediction.signals, isDark);
      case 'kline':
        return buildPredictionChart(klineData, prediction.supportResistance, prediction.trend, isDark);
    }
  }, [prediction, activeView, isDark, klineData]);

  const dayOptions = DAY_OPTIONS_MAP[period] || DAY_OPTIONS_MAP[101];

  const TrendIcon = prediction?.trend.direction === 'up'
    ? TrendingUp
    : prediction?.trend.direction === 'down'
      ? TrendingDown
      : Minus;

  const scoreColor = prediction
    ? prediction.compositeScore > 20
      ? 'text-green-500'
      : prediction.compositeScore < -20
        ? 'text-red-500'
        : 'text-yellow-500'
    : 'text-slate-500';

  return (
    <div className="w-full h-full flex flex-col bg-white/80 dark:bg-[#0a0e17]/50 backdrop-blur-xl border border-slate-200 dark:border-white/5 rounded-xl overflow-hidden shadow-lg dark:shadow-2xl dark:shadow-black/50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/5 bg-white/50 dark:bg-slate-900/30">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-mono font-bold text-slate-800 dark:text-slate-100">
            AI 预测分析
          </h2>
          {selectedStock && prediction && (
            <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-bold ${scoreColor}`}>
              <TrendIcon className="w-3.5 h-3.5" />
              <span>{prediction.compositeScore}</span>
            </div>
          )}
        </div>

        {/* Search */}
        <div ref={searchRef} className="relative">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/40 focus-within:border-cyan-400 dark:focus-within:border-cyan-600 transition-colors">
            <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
              placeholder={selectedStock ? selectedStock.name : '搜索股票...'}
              className="bg-transparent text-xs font-mono text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 outline-none w-36"
            />
            {searching && <Loader2 className="w-3 h-3 text-cyan-500 animate-spin" />}
          </div>
          {searchOpen && searchResults.length > 0 && (
            <div className="absolute right-0 top-full mt-1 w-60 max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-xl z-50">
              {searchResults.map((r, i) => (
                <button
                  key={`${r.code}-${i}`}
                  onClick={() => selectStock(r)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs font-mono hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <span className="text-slate-700 dark:text-slate-200 font-semibold">
                    {r.name}
                  </span>
                  <span className="text-slate-400 dark:text-slate-500">{r.code}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Period & day selectors */}
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
        {selectedStock && (
          <>
            <div className="w-px h-4 bg-slate-200 dark:bg-white/10 mx-1" />
            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
              当前: <span className="text-cyan-600 dark:text-cyan-400 font-semibold">{selectedStock.name}</span> ({selectedStock.code})
            </span>
          </>
        )}
      </div>

      {/* View tabs */}
      {prediction && (
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
        {!selectedStock ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Search className="w-8 h-8 text-slate-300 dark:text-slate-600" />
            <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
              请搜索并选择一只股票开始预测分析
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
              onClick={fetchKline}
              className="text-xs font-mono text-cyan-600 dark:text-cyan-400 hover:underline"
            >
              重试
            </button>
          </div>
        ) : !prediction ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
              需要至少30条K线数据进行预测分析
            </span>
          </div>
        ) : chartOption ? (
          <ReactECharts
            option={chartOption}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge={true}
          />
        ) : null}
      </div>

      {/* Prediction summary */}
      {prediction && (
        <div className="px-4 py-3 border-t border-slate-200 dark:border-white/5 bg-slate-50/50 dark:bg-slate-900/20">
          <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
            预测摘要
          </div>
          <ul className="space-y-1">
            {prediction.signals.map((s) => (
              <li
                key={s.name}
                className="text-xs font-mono text-slate-600 dark:text-slate-300 flex items-start gap-1.5"
              >
                <span
                  className={`mt-0.5 ${
                    s.signal === 'bullish'
                      ? 'text-green-500'
                      : s.signal === 'bearish'
                        ? 'text-red-500'
                        : 'text-yellow-500'
                  }`}
                >
                  {s.signal === 'bullish' ? '▲' : s.signal === 'bearish' ? '▼' : '─'}
                </span>
                <span className="font-semibold w-16 shrink-0">{s.name}</span>
                <span>{s.description}</span>
              </li>
            ))}
            <li className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-2 pt-1.5 border-t border-slate-200 dark:border-white/5">
              {prediction.summary}
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
