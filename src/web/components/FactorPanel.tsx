'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import { Search, Loader2, X, Plus, Play, FlaskConical } from 'lucide-react';
import { useTheme } from '@/web/components/ThemeProvider';

import type { SearchResult } from '@/web/types/stock';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3135';

const MIN_STOCKS = 3;
const MAX_STOCKS = 15;

interface FactorDef {
  key: string;
  label: string;
  description: string;
}

const FACTORS: FactorDef[] = [
  { key: 'momentum', label: '动量', description: 'N日收益率' },
  { key: 'volatility', label: '波动率', description: '年化波动率' },
  { key: 'rsi', label: 'RSI技术因子', description: '相对强弱指标' },
  { key: 'macd', label: 'MACD技术因子', description: 'MACD信号差值' },
];

const DAY_OPTIONS: { value: number; label: string }[] = [
  { value: 60, label: '60天' },
  { value: 120, label: '120天' },
  { value: 250, label: '250天' },
];

interface RankingItem {
  code: string;
  name: string;
  scores: Record<string, number>;
  compositeScore: number;
}

interface ExposureItem {
  stockCode: string;
  factorName: string;
  exposure: number;
}

interface ICResultItem {
  factorName: string;
  ic: number;
  pValue: number;
}

interface AnalysisResult {
  rankings: RankingItem[];
  exposures: ExposureItem[];
  icResults: ICResultItem[];
}

type ResultView = 'exposure' | 'ic' | 'ranking';

const RESULT_TABS: { key: ResultView; label: string }[] = [
  { key: 'exposure', label: '因子暴露' },
  { key: 'ic', label: 'IC分析' },
  { key: 'ranking', label: '综合排名' },
];

interface FactorPanelProps {
  initialStock?: { code: string; name: string } | null;
}

export default function FactorPanel({ initialStock }: FactorPanelProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // Stock list
  const [stocks, setStocks] = useState<{ code: string; name: string }[]>(
    initialStock ? [initialStock] : [],
  );

  // Factor selection & weights
  const [selectedFactors, setSelectedFactors] = useState<Set<string>>(
    new Set(FACTORS.map((f) => f.key)),
  );
  const [weights, setWeights] = useState<Record<string, number>>(() => {
    const w: Record<string, number> = {};
    for (const f of FACTORS) w[f.key] = 25;
    return w;
  });

  // Analysis config
  const [days, setDays] = useState(120);

  // Results
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [activeView, setActiveView] = useState<ResultView>('exposure');
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

  // Add stock
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

  // Remove stock
  const removeStock = useCallback((code: string) => {
    setStocks((prev) => prev.filter((s) => s.code !== code));
  }, []);

  // Toggle factor selection
  const toggleFactor = useCallback((key: string) => {
    setSelectedFactors((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size <= 1) return prev; // keep at least 1 factor
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Update weight for a factor
  const updateWeight = useCallback((key: string, value: number) => {
    setWeights((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Normalized weights (so they sum to 1.0)
  const normalizedWeights = useMemo(() => {
    const activeFKeys = FACTORS.filter((f) => selectedFactors.has(f.key)).map((f) => f.key);
    const total = activeFKeys.reduce((sum, k) => sum + (weights[k] || 0), 0);
    if (total === 0) return {};
    const norm: Record<string, number> = {};
    for (const k of activeFKeys) {
      norm[k] = (weights[k] || 0) / total;
    }
    return norm;
  }, [selectedFactors, weights]);

  // Run analysis
  const runAnalysis = useCallback(async () => {
    if (stocks.length < MIN_STOCKS) return;
    if (selectedFactors.size === 0) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`${API_URL}/api/factor/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stocks: stocks.map((s) => s.code),
          factors: Array.from(selectedFactors),
          weights: normalizedWeights,
          days,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `HTTP ${res.status}`);
      }

      const data: AnalysisResult = await res.json();
      setResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '因子分析运行失败');
    } finally {
      setLoading(false);
    }
  }, [stocks, selectedFactors, normalizedWeights, days]);

  // ── Chart builders ──────────────────────────────────────────────────────────

  // Heatmap: factor exposure
  const heatmapOption = useMemo(() => {
    if (!result || result.exposures.length === 0) return null;

    const stockCodes = [...new Set(result.exposures.map((e) => e.stockCode))];
    const factorNames = [...new Set(result.exposures.map((e) => e.factorName))];

    // Map stock codes to display names via rankings
    const codeToName: Record<string, string> = {};
    for (const r of result.rankings) {
      codeToName[r.code] = r.name;
    }
    const yLabels = stockCodes.map((c) => codeToName[c] || c);

    // Build data: [xIndex, yIndex, value]
    const heatData: [number, number, number][] = [];
    let minVal = Infinity;
    let maxVal = -Infinity;

    for (const exp of result.exposures) {
      const xi = factorNames.indexOf(exp.factorName);
      const yi = stockCodes.indexOf(exp.stockCode);
      if (xi >= 0 && yi >= 0) {
        heatData.push([xi, yi, exp.exposure]);
        if (exp.exposure < minVal) minVal = exp.exposure;
        if (exp.exposure > maxVal) maxVal = exp.exposure;
      }
    }

    const absMax = Math.max(Math.abs(minVal), Math.abs(maxVal), 0.01);

    return {
      backgroundColor: 'transparent',
      animation: false,
      tooltip: {
        position: 'top' as const,
        backgroundColor: isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        borderColor: isDark ? '#1e293b' : '#e2e8f0',
        textStyle: {
          color: isDark ? '#e2e8f0' : '#334155',
          fontSize: 11,
          fontFamily: 'monospace',
        },
        formatter: (params: { data: [number, number, number] }) => {
          const [xi, yi, val] = params.data;
          return `${yLabels[yi]}<br/>${factorNames[xi]}: <b>${val.toFixed(4)}</b>`;
        },
      },
      grid: {
        left: '15%',
        right: '12%',
        top: '8%',
        bottom: '20%',
        containLabel: false,
      },
      xAxis: {
        type: 'category' as const,
        data: factorNames,
        axisLine: { lineStyle: { color: isDark ? '#1e293b' : '#e2e8f0' } },
        axisLabel: {
          color: isDark ? '#94a3b8' : '#64748b',
          fontSize: 10,
          fontFamily: 'monospace',
          interval: 0,
        },
        axisTick: { show: false },
        splitArea: { show: false },
      },
      yAxis: {
        type: 'category' as const,
        data: yLabels,
        axisLine: { lineStyle: { color: isDark ? '#1e293b' : '#e2e8f0' } },
        axisLabel: {
          color: isDark ? '#94a3b8' : '#64748b',
          fontSize: 10,
          fontFamily: 'monospace',
        },
        axisTick: { show: false },
        splitArea: { show: false },
      },
      visualMap: {
        min: -absMax,
        max: absMax,
        calculable: true,
        orient: 'vertical' as const,
        right: '2%',
        top: 'center',
        inRange: {
          color: ['#3b82f6', '#60a5fa', '#93c5fd', '#e2e8f0', '#fca5a5', '#f87171', '#ef4444'],
        },
        textStyle: {
          color: isDark ? '#94a3b8' : '#64748b',
          fontSize: 10,
          fontFamily: 'monospace',
        },
        itemWidth: 12,
        itemHeight: 100,
      },
      series: [
        {
          name: '因子暴露',
          type: 'heatmap',
          data: heatData,
          label: {
            show: heatData.length <= 60,
            fontSize: 9,
            fontFamily: 'monospace',
            color: isDark ? '#e2e8f0' : '#334155',
            formatter: (params: { data: [number, number, number] }) =>
              params.data[2].toFixed(2),
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: 'rgba(0, 0, 0, 0.3)',
            },
          },
          itemStyle: {
            borderWidth: 1,
            borderColor: isDark ? '#0f172a' : '#ffffff',
          },
        },
      ],
    };
  }, [result, isDark]);

  // IC bar chart
  const icChartOption = useMemo(() => {
    if (!result || result.icResults.length === 0) return null;

    const names = result.icResults.map((r) => r.factorName);
    const icValues = result.icResults.map((r) => r.ic);
    const colors = icValues.map((v) => (v >= 0 ? '#22c55e' : '#ef4444'));

    return {
      backgroundColor: 'transparent',
      animation: false,
      tooltip: {
        trigger: 'axis' as const,
        axisPointer: { type: 'shadow' as const },
        backgroundColor: isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        borderColor: isDark ? '#1e293b' : '#e2e8f0',
        textStyle: {
          color: isDark ? '#e2e8f0' : '#334155',
          fontSize: 11,
          fontFamily: 'monospace',
        },
        formatter: (params: { name: string; value: number }[]) => {
          const p = params[0];
          const icItem = result.icResults.find((r) => r.factorName === p.name);
          return `${p.name}<br/>IC: <b>${p.value.toFixed(4)}</b>${
            icItem ? `<br/>p-value: ${icItem.pValue.toFixed(4)}` : ''
          }`;
        },
      },
      grid: {
        left: '10%',
        right: '5%',
        top: '12%',
        bottom: '15%',
      },
      xAxis: {
        type: 'category' as const,
        data: names,
        axisLine: { lineStyle: { color: isDark ? '#1e293b' : '#e2e8f0' } },
        axisLabel: {
          color: isDark ? '#94a3b8' : '#64748b',
          fontSize: 10,
          fontFamily: 'monospace',
          interval: 0,
        },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value' as const,
        name: 'IC',
        nameTextStyle: {
          color: isDark ? '#94a3b8' : '#64748b',
          fontSize: 10,
          fontFamily: 'monospace',
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: {
          show: true,
          lineStyle: {
            color: isDark ? '#1e293b' : '#f1f5f9',
            type: 'dashed' as const,
          },
        },
        axisLabel: {
          color: isDark ? '#94a3b8' : '#64748b',
          fontSize: 10,
          fontFamily: 'monospace',
        },
      },
      series: [
        {
          name: 'IC',
          type: 'bar',
          data: icValues.map((v, i) => ({
            value: v,
            itemStyle: { color: colors[i] },
          })),
          barWidth: '40%',
          label: {
            show: true,
            position: 'top' as const,
            fontSize: 10,
            fontFamily: 'monospace',
            color: isDark ? '#94a3b8' : '#64748b',
            formatter: (params: { value: number }) => params.value.toFixed(3),
          },
        },
      ],
    };
  }, [result, isDark]);

  // Sorted rankings for table
  const sortedRankings = useMemo(() => {
    if (!result) return [];
    return [...result.rankings].sort((a, b) => b.compositeScore - a.compositeScore);
  }, [result]);

  // Factor keys present in results for table columns
  const resultFactorKeys = useMemo(() => {
    if (!result || result.rankings.length === 0) return [];
    return Object.keys(result.rankings[0].scores);
  }, [result]);

  const canRun = stocks.length >= MIN_STOCKS && selectedFactors.size > 0;

  return (
    <div className="w-full h-full flex flex-col bg-white/80 dark:bg-[#0a0e17]/50 backdrop-blur-xl border border-slate-200 dark:border-white/5 rounded-xl overflow-hidden shadow-lg dark:shadow-2xl dark:shadow-black/50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/5 bg-white/50 dark:bg-slate-900/30 shrink-0">
        <div className="flex items-center gap-3">
          <FlaskConical className="w-4 h-4 text-violet-500 dark:text-violet-400" />
          <h2 className="text-base font-mono font-bold text-slate-800 dark:text-slate-100">
            多因子分析
          </h2>
        </div>

        <div className="flex items-center gap-2">
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

          {/* Run button */}
          <button
            onClick={runAnalysis}
            disabled={!canRun || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold rounded-lg bg-cyan-500 hover:bg-cyan-600 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white disabled:text-slate-500 transition-colors"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            运行分析
          </button>
        </div>
      </div>

      {/* Stock chips + day selector */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-slate-100 dark:border-white/[0.03] flex-wrap shrink-0">
        {/* Day options */}
        {DAY_OPTIONS.map((opt) => (
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

      {/* Factor selector with weights */}
      <div className="px-4 py-2 border-b border-slate-100 dark:border-white/[0.03] shrink-0">
        <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
          因子配置
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {FACTORS.map((f) => {
            const active = selectedFactors.has(f.key);
            return (
              <div
                key={f.key}
                className={`rounded-lg border px-3 py-2 transition-colors ${
                  active
                    ? 'border-cyan-200 dark:border-cyan-800/50 bg-cyan-50/50 dark:bg-cyan-900/20'
                    : 'border-slate-200 dark:border-white/5 bg-slate-50/50 dark:bg-slate-800/20 opacity-50'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <button
                    onClick={() => toggleFactor(f.key)}
                    className="flex items-center gap-1.5"
                  >
                    <div
                      className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                        active
                          ? 'bg-cyan-500 border-cyan-500'
                          : 'bg-transparent border-slate-300 dark:border-slate-600'
                      }`}
                    >
                      {active && (
                        <svg
                          className="w-2.5 h-2.5 text-white"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={3}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}
                    </div>
                    <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200">
                      {f.label}
                    </span>
                  </button>
                  <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                    {f.description}
                  </span>
                </div>
                {active && (
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={1}
                      max={100}
                      value={weights[f.key]}
                      onChange={(e) => updateWeight(f.key, Number(e.target.value))}
                      className="flex-1 h-1 accent-cyan-500 cursor-pointer"
                    />
                    <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 w-8 text-right tabular-nums">
                      {((normalizedWeights[f.key] || 0) * 100).toFixed(0)}%
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Main content area */}
      {stocks.length < MIN_STOCKS && !result ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Search className="w-8 h-8 text-slate-300 dark:text-slate-600" />
          <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
            请添加至少 {MIN_STOCKS} 只股票开始因子分析
          </span>
          <span className="text-[10px] font-mono text-slate-400 dark:text-slate-600">
            已添加 {stocks.length} / {MIN_STOCKS} 只 (最多 {MAX_STOCKS} 只)
          </span>
        </div>
      ) : loading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <Loader2 className="w-6 h-6 text-cyan-500 animate-spin" />
          <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
            因子分析运行中...
          </span>
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <span className="text-xs font-mono text-red-500">{error}</span>
          <button
            onClick={runAnalysis}
            className="text-xs font-mono text-cyan-600 dark:text-cyan-400 hover:underline"
          >
            重试
          </button>
        </div>
      ) : result ? (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Result tabs */}
          <div className="flex items-center gap-1 px-4 py-2 border-b border-slate-100 dark:border-white/[0.03] shrink-0">
            {RESULT_TABS.map((tab) => (
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

          {/* Tab content */}
          <div className="flex-1 min-h-0 px-2 pt-2 pb-2">
            {/* Exposure heatmap */}
            {activeView === 'exposure' &&
              (heatmapOption ? (
                <ReactECharts
                  option={heatmapOption}
                  style={{ height: '100%', width: '100%' }}
                  opts={{ renderer: 'canvas' }}
                  notMerge={true}
                />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
                    暂无因子暴露数据
                  </span>
                </div>
              ))}

            {/* IC bar chart */}
            {activeView === 'ic' &&
              (icChartOption ? (
                <ReactECharts
                  option={icChartOption}
                  style={{ height: '100%', width: '100%' }}
                  opts={{ renderer: 'canvas' }}
                  notMerge={true}
                />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
                    暂无IC分析数据
                  </span>
                </div>
              ))}

            {/* Ranking table */}
            {activeView === 'ranking' && (
              <div className="h-full overflow-auto">
                {sortedRankings.length > 0 ? (
                  <table className="w-full text-xs font-mono">
                    <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900/80 backdrop-blur-sm z-10">
                      <tr className="border-b border-slate-200 dark:border-white/10">
                        <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                          排名
                        </th>
                        <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                          名称
                        </th>
                        <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                          代码
                        </th>
                        {resultFactorKeys.map((fk) => (
                          <th
                            key={fk}
                            className="px-2 py-1.5 text-right text-[10px] font-semibold text-slate-500 dark:text-slate-400"
                          >
                            {FACTORS.find((f) => f.key === fk)?.label || fk}
                          </th>
                        ))}
                        <th className="px-2 py-1.5 text-right text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                          综合得分
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRankings.map((item, idx) => (
                        <tr
                          key={item.code}
                          className={`border-b border-slate-100 dark:border-white/[0.03] ${
                            idx === 0
                              ? 'bg-amber-50/50 dark:bg-amber-900/10'
                              : idx === 1
                                ? 'bg-slate-50/50 dark:bg-slate-800/10'
                                : idx === 2
                                  ? 'bg-orange-50/30 dark:bg-orange-900/5'
                                  : ''
                          }`}
                        >
                          <td className="px-2 py-1.5 text-slate-500 dark:text-slate-400">
                            <span
                              className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                                idx === 0
                                  ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
                                  : idx === 1
                                    ? 'bg-slate-200 dark:bg-slate-700/40 text-slate-600 dark:text-slate-300'
                                    : idx === 2
                                      ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400'
                                      : 'text-slate-400 dark:text-slate-500'
                              }`}
                            >
                              {idx + 1}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200 font-semibold">
                            {item.name}
                          </td>
                          <td className="px-2 py-1.5 text-slate-400 dark:text-slate-500">
                            {item.code}
                          </td>
                          {resultFactorKeys.map((fk) => {
                            const score = item.scores[fk] ?? 0;
                            return (
                              <td
                                key={fk}
                                className={`px-2 py-1.5 text-right tabular-nums ${
                                  score > 0
                                    ? 'text-green-600 dark:text-green-400'
                                    : score < 0
                                      ? 'text-red-500 dark:text-red-400'
                                      : 'text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                {score >= 0 ? '+' : ''}
                                {score.toFixed(3)}
                              </td>
                            );
                          })}
                          <td
                            className={`px-2 py-1.5 text-right font-bold tabular-nums ${
                              item.compositeScore > 0
                                ? 'text-green-600 dark:text-green-400'
                                : item.compositeScore < 0
                                  ? 'text-red-500 dark:text-red-400'
                                  : 'text-slate-700 dark:text-slate-200'
                            }`}
                          >
                            {item.compositeScore >= 0 ? '+' : ''}
                            {item.compositeScore.toFixed(3)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
                      暂无排名数据
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Play className="w-8 h-8 text-slate-300 dark:text-slate-600" />
          <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
            点击"运行分析"开始多因子分析
          </span>
        </div>
      )}
    </div>
  );
}
