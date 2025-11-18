'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import { Search, Loader2, X } from 'lucide-react';
import { useTheme } from '@/web/components/ThemeProvider';
import type { OHLCVItem } from '@/web/lib/indicators';
import { macd, rsi, bollingerBands, kdj, maCross } from '@/web/lib/indicators';
import {
  buildMACDChart,
  buildRSIChart,
  buildBollingerChart,
  buildKDJChart,
  buildMACrossChart,
} from '@/web/lib/indicatorCharts';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3135';

type StrategyType = 'macd' | 'rsi' | 'bollinger' | 'kdj' | 'maCross';

interface SearchResult {
  code: string;
  name: string;
}

const STRATEGIES: { key: StrategyType; label: string }[] = [
  { key: 'macd', label: 'MACD' },
  { key: 'rsi', label: 'RSI' },
  { key: 'bollinger', label: '布林带' },
  { key: 'kdj', label: 'KDJ' },
  { key: 'maCross', label: '均线交叉' },
];

const PERIOD_OPTIONS = [
  { klt: 101, label: '日' },
  { klt: 102, label: '周' },
  { klt: 103, label: '月' },
];

const DAY_OPTIONS_MAP: Record<number, { value: number; label: string }[]> = {
  101: [
    { value: 30, label: '30天' },
    { value: 60, label: '60天' },
    { value: 120, label: '120天' },
  ],
  102: [
    { value: 30, label: '30周' },
    { value: 60, label: '60周' },
    { value: 120, label: '120周' },
  ],
  103: [
    { value: 60, label: '60月' },
    { value: 120, label: '120月' },
    { value: 250, label: '250月' },
  ],
};

interface QuantStrategyProps {
  initialStock?: { code: string; name: string } | null;
}

export default function QuantStrategy({ initialStock }: QuantStrategyProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [stock, setStock] = useState<{ code: string; name: string } | null>(initialStock ?? null);
  const [strategy, setStrategy] = useState<StrategyType>('macd');
  const [period, setPeriod] = useState(101);
  const [days, setDays] = useState(60);
  const [klineData, setKlineData] = useState<OHLCVItem[]>([]);
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
        const res = await fetch(`${API_URL}/api/stocks/search?q=${encodeURIComponent(query.trim())}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        const raw: Record<string, string>[] = Array.isArray(data) ? data : data.results ?? data.stocks ?? [];
        const list: SearchResult[] = raw.map(item => ({
          code: item.fullCode || item.code || item.ticker || '',
          name: item.name || '',
        })).filter(item => item.code);
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

  // Fetch kline data
  const fetchKline = useCallback(async () => {
    if (!stock) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_URL}/api/stocks/kline/${encodeURIComponent(stock.code)}?days=${days}&klt=${period}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setKlineData(data.klines || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载K线数据失败');
    } finally {
      setLoading(false);
    }
  }, [stock, days, period]);

  useEffect(() => {
    fetchKline();
  }, [fetchKline]);

  const handlePeriodChange = (klt: number) => {
    setPeriod(klt);
    const dayOpts = DAY_OPTIONS_MAP[klt];
    if (dayOpts && !dayOpts.some(o => o.value === days)) {
      setDays(dayOpts[0].value);
    }
  };

  const selectStock = (s: SearchResult) => {
    setStock(s);
    setQuery('');
    setSearchOpen(false);
  };

  // Compute chart option
  const chartOption = useMemo(() => {
    if (klineData.length === 0) return null;
    const closes = klineData.map(k => k.close);

    switch (strategy) {
      case 'macd': {
        const data = macd(closes);
        return buildMACDChart(klineData, data, isDark);
      }
      case 'rsi': {
        const data = rsi(closes, 14);
        return buildRSIChart(klineData, data, isDark);
      }
      case 'bollinger': {
        const data = bollingerBands(closes, 20, 2);
        return buildBollingerChart(klineData, data, isDark);
      }
      case 'kdj': {
        const data = kdj(klineData, 9, 3, 3);
        return buildKDJChart(klineData, data, isDark);
      }
      case 'maCross': {
        const data = maCross(klineData, 5, 20);
        return buildMACrossChart(klineData, data, 5, 20, isDark);
      }
    }
  }, [klineData, strategy, isDark]);

  // Generate signal summary text
  const signalSummary = useMemo((): string[] => {
    if (klineData.length === 0) return [];
    const closes = klineData.map(k => k.close);
    const signals: string[] = [];

    switch (strategy) {
      case 'macd': {
        const data = macd(closes);
        const lastDif = data.dif.filter((v): v is number => v !== null);
        const lastDea = data.dea.filter((v): v is number => v !== null);
        const lastHist = data.histogram.filter((v): v is number => v !== null);
        if (lastDif.length > 0 && lastDea.length > 0) {
          const dif = lastDif[lastDif.length - 1];
          const dea = lastDea[lastDea.length - 1];
          signals.push(dif > dea ? 'DIF 在 DEA 上方，趋势看涨' : 'DIF 在 DEA 下方，趋势偏空');
        }
        if (lastHist.length >= 2) {
          const cur = lastHist[lastHist.length - 1];
          const prev = lastHist[lastHist.length - 2];
          if (cur > 0 && cur > prev) signals.push('MACD 红柱放大，多头动能增强');
          else if (cur > 0 && cur < prev) signals.push('MACD 红柱缩短，多头动能减弱');
          else if (cur < 0 && cur < prev) signals.push('MACD 绿柱放大，空头动能增强');
          else if (cur < 0 && cur > prev) signals.push('MACD 绿柱缩短，空头动能减弱');
        }
        break;
      }
      case 'rsi': {
        const data = rsi(closes, 14);
        const lastRsi = data.filter((v): v is number => v !== null);
        if (lastRsi.length > 0) {
          const val = lastRsi[lastRsi.length - 1];
          signals.push(`当前 RSI(14) = ${val.toFixed(1)}`);
          if (val > 70) signals.push('RSI 超过 70，处于超买区域，注意回调风险');
          else if (val < 30) signals.push('RSI 低于 30，处于超卖区域，可能存在反弹机会');
          else signals.push('RSI 在 30-70 之间，处于中性区域');
        }
        break;
      }
      case 'bollinger': {
        const data = bollingerBands(closes, 20, 2);
        const lastUpper = data.upper.filter((v): v is number => v !== null);
        const lastLower = data.lower.filter((v): v is number => v !== null);
        const lastMiddle = data.middle.filter((v): v is number => v !== null);
        if (lastUpper.length > 0 && lastLower.length > 0 && lastMiddle.length > 0) {
          const price = closes[closes.length - 1];
          const upper = lastUpper[lastUpper.length - 1];
          const lower = lastLower[lastLower.length - 1];
          const middle = lastMiddle[lastMiddle.length - 1];
          signals.push(`当前价格 ${price.toFixed(2)}，布林中轨 ${middle.toFixed(2)}`);
          if (price > upper) signals.push('价格突破上轨，短期可能超涨');
          else if (price < lower) signals.push('价格跌破下轨，短期可能超跌');
          else if (price > middle) signals.push('价格在中轨上方运行，偏多');
          else signals.push('价格在中轨下方运行，偏空');
          const bandwidth = ((upper - lower) / middle * 100);
          signals.push(`布林带宽 ${bandwidth.toFixed(1)}%${bandwidth < 5 ? '，带宽收窄，可能即将突破' : ''}`);
        }
        break;
      }
      case 'kdj': {
        const data = kdj(klineData, 9, 3, 3);
        const lastK = data.k.filter((v): v is number => v !== null);
        const lastD = data.d.filter((v): v is number => v !== null);
        const lastJ = data.j.filter((v): v is number => v !== null);
        if (lastK.length > 0 && lastD.length > 0 && lastJ.length > 0) {
          const k = lastK[lastK.length - 1];
          const d = lastD[lastD.length - 1];
          const j = lastJ[lastJ.length - 1];
          signals.push(`K=${k.toFixed(1)} D=${d.toFixed(1)} J=${j.toFixed(1)}`);
          if (j > 100) signals.push('J 值超过 100，严重超买，注意回调');
          else if (j < 0) signals.push('J 值低于 0，严重超卖，关注反弹');
          if (k > d) signals.push('K 线在 D 线上方，短期偏多');
          else signals.push('K 线在 D 线下方，短期偏空');
        }
        break;
      }
      case 'maCross': {
        const data = maCross(klineData, 5, 20);
        const recent = data.signals.slice(-3);
        if (recent.length === 0) {
          signals.push('近期无均线交叉信号');
        } else {
          for (const sig of recent) {
            signals.push(
              sig.type === 'golden'
                ? `${sig.date} 出现金叉（MA5 上穿 MA20），看涨信号`
                : `${sig.date} 出现死叉（MA5 下穿 MA20），看跌信号`,
            );
          }
        }
        const lastShort = data.shortMA.filter((v): v is number => v !== null);
        const lastLong = data.longMA.filter((v): v is number => v !== null);
        if (lastShort.length > 0 && lastLong.length > 0) {
          const s = lastShort[lastShort.length - 1];
          const l = lastLong[lastLong.length - 1];
          signals.push(s > l ? '当前 MA5 在 MA20 上方，多头排列' : '当前 MA5 在 MA20 下方，空头排列');
        }
        break;
      }
    }

    return signals;
  }, [klineData, strategy]);

  const dayOptions = DAY_OPTIONS_MAP[period] || DAY_OPTIONS_MAP[101];

  return (
    <div className="w-full h-full flex flex-col bg-white/80 dark:bg-[#0a0e17]/50 backdrop-blur-xl border border-slate-200 dark:border-white/5 rounded-xl overflow-hidden shadow-lg dark:shadow-2xl dark:shadow-black/50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/5 bg-white/50 dark:bg-slate-900/30">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-mono font-bold text-slate-800 dark:text-slate-100">
            量化策略分析
          </h2>
          {stock && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-cyan-50 dark:bg-cyan-900/30 border border-cyan-200 dark:border-cyan-800/40">
              <span className="text-xs font-mono font-semibold text-cyan-700 dark:text-cyan-400">
                {stock.name}
              </span>
              <span className="text-[10px] font-mono text-cyan-500 dark:text-cyan-600">
                {stock.code}
              </span>
              <button
                onClick={() => { setStock(null); setKlineData([]); }}
                className="ml-1 text-cyan-400 hover:text-cyan-600 dark:hover:text-cyan-300"
              >
                <X className="w-3 h-3" />
              </button>
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
              onChange={e => setQuery(e.target.value)}
              onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
              placeholder="搜索股票..."
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
                  <span className="text-slate-700 dark:text-slate-200 font-semibold">{r.name}</span>
                  <span className="text-slate-400 dark:text-slate-500">{r.code}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Strategy & period selectors */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-slate-100 dark:border-white/[0.03] flex-wrap">
        {STRATEGIES.map(s => (
          <button
            key={s.key}
            onClick={() => setStrategy(s.key)}
            className={`px-2.5 py-1 text-[10px] font-mono rounded-md transition-colors ${
              strategy === s.key
                ? 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-800/50 font-semibold'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/40 border border-transparent'
            }`}
          >
            {s.label}
          </button>
        ))}
        <div className="w-px h-4 bg-slate-200 dark:bg-white/10 mx-1" />
        {PERIOD_OPTIONS.map(opt => (
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
        {dayOptions.map(opt => (
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
      </div>

      {/* Chart area */}
      <div className="flex-1 min-h-0 px-2 pt-2">
        {!stock ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Search className="w-8 h-8 text-slate-300 dark:text-slate-600" />
            <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
              请搜索并选择一只股票开始分析
            </span>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <Loader2 className="w-6 h-6 text-cyan-500 animate-spin" />
            <span className="text-xs font-mono text-slate-400 dark:text-slate-500">加载数据中...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <span className="text-xs font-mono text-red-500">{error}</span>
            <button onClick={fetchKline} className="text-xs font-mono text-cyan-600 dark:text-cyan-400 hover:underline">
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
            <span className="text-xs font-mono text-slate-400 dark:text-slate-500">暂无K线数据</span>
          </div>
        )}
      </div>

      {/* Signal summary */}
      {signalSummary.length > 0 && (
        <div className="px-4 py-3 border-t border-slate-200 dark:border-white/5 bg-slate-50/50 dark:bg-slate-900/20">
          <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
            信号摘要
          </div>
          <ul className="space-y-1">
            {signalSummary.map((sig, i) => (
              <li key={i} className="text-xs font-mono text-slate-600 dark:text-slate-300 flex items-start gap-1.5">
                <span className="text-cyan-500 dark:text-cyan-400 mt-0.5">·</span>
                {sig}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
