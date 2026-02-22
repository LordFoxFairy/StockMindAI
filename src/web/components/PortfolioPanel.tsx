'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Search, Loader2, X, Plus, Play, Briefcase } from 'lucide-react';
import { useTheme } from '@/web/components/ThemeProvider';

import type { SearchResult } from '@/web/types/stock';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3135';

const MAX_STOCKS = 10;
const MIN_STOCKS = 2;

type AlgorithmType = 'markowitz' | 'risk-parity' | 'black-litterman';

const ALGORITHMS: { key: AlgorithmType; label: string }[] = [
  { key: 'markowitz', label: 'Markowitz' },
  { key: 'risk-parity', label: '风险平价' },
  { key: 'black-litterman', label: 'Black-Litterman' },
];

const DAY_OPTIONS: { value: number; label: string }[] = [
  { value: 120, label: '120天' },
  { value: 250, label: '250天' },
  { value: 500, label: '500天' },
];

interface WeightItem {
  code: string;
  name: string;
  weight: number;
}

interface PortfolioMetrics {
  expectedReturn: number;
  volatility: number;
  sharpeRatio: number;
}

interface FrontierPoint {
  return: number;
  volatility: number;
  sharpe: number;
}

interface OptimizeResult {
  weights: WeightItem[];
  metrics: PortfolioMetrics;
  frontier?: FrontierPoint[];
}

type ViewType = 'weights' | 'frontier' | 'metrics';

const VIEW_TABS: { key: ViewType; label: string }[] = [
  { key: 'weights', label: '最优权重' },
  { key: 'frontier', label: '有效前沿' },
  { key: 'metrics', label: '组合指标' },
];

// Color palette for pie chart
const PIE_COLORS = [
  '#06b6d4', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444',
  '#3b82f6', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
];

interface PortfolioPanelProps {
  initialStock?: { code: string; name: string } | null;
}

export default function PortfolioPanel({ initialStock }: PortfolioPanelProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // Stock list
  const [stocks, setStocks] = useState<{ code: string; name: string }[]>(
    initialStock ? [initialStock] : [],
  );
  // Algorithm & params
  const [algorithm, setAlgorithm] = useState<AlgorithmType>('markowitz');
  const [days, setDays] = useState(250);
  const [riskFreeRate, setRiskFreeRate] = useState(0.025);
  // Result
  const [result, setResult] = useState<OptimizeResult | null>(null);
  const [activeView, setActiveView] = useState<ViewType>('weights');
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

  // Run optimization
  const runOptimize = useCallback(async () => {
    if (stocks.length < MIN_STOCKS) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${API_URL}/api/portfolio/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stocks: stocks.map((s) => s.code),
          algorithm,
          days,
          riskFreeRate,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.message || errData?.error || `HTTP ${res.status}`);
      }
      const data: OptimizeResult = await res.json();
      setResult(data);
      setActiveView('weights');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '组合优化失败');
    } finally {
      setLoading(false);
    }
  }, [stocks, algorithm, days, riskFreeRate]);

  // Format helpers
  const formatPercent = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;

  // Pie chart option for weights
  const weightChartOption = useMemo(() => {
    if (!result) return null;
    const textColor = isDark ? '#94a3b8' : '#64748b';

    return {
      backgroundColor: 'transparent',
      title: {
        text: '最优权重分配',
        left: 'center',
        top: 12,
        textStyle: {
          color: isDark ? '#e2e8f0' : '#1e293b',
          fontSize: 14,
          fontFamily: 'ui-monospace, monospace',
          fontWeight: 'bold',
        },
      },
      tooltip: {
        trigger: 'item',
        backgroundColor: isDark ? '#1e293b' : '#fff',
        borderColor: isDark ? 'rgba(255,255,255,0.1)' : '#e2e8f0',
        textStyle: {
          color: isDark ? '#e2e8f0' : '#334155',
          fontFamily: 'ui-monospace, monospace',
          fontSize: 12,
        },
        formatter: (params: { name: string; value: number; percent: number; marker: string }) => {
          return `${params.marker} ${params.name}<br/>权重: <b>${(params.value * 100).toFixed(2)}%</b>`;
        },
      },
      legend: {
        orient: 'vertical',
        right: 16,
        top: 'middle',
        textStyle: {
          color: textColor,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 11,
        },
        itemWidth: 12,
        itemHeight: 12,
        itemGap: 8,
      },
      series: [
        {
          type: 'pie',
          radius: ['35%', '65%'],
          center: ['40%', '55%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 6,
            borderColor: isDark ? '#0a0e17' : '#fff',
            borderWidth: 2,
          },
          label: {
            show: true,
            formatter: (params: { name: string; value: number }) => {
              return `${params.name}\n${(params.value * 100).toFixed(1)}%`;
            },
            color: textColor,
            fontFamily: 'ui-monospace, monospace',
            fontSize: 10,
            lineHeight: 14,
          },
          labelLine: {
            show: true,
            length: 12,
            length2: 8,
            lineStyle: {
              color: isDark ? 'rgba(255,255,255,0.15)' : '#cbd5e1',
            },
          },
          emphasis: {
            label: {
              fontSize: 12,
              fontWeight: 'bold',
            },
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowColor: 'rgba(0, 0, 0, 0.2)',
            },
          },
          data: result.weights.map((w, i) => ({
            value: w.weight,
            name: w.name || w.code,
            itemStyle: { color: PIE_COLORS[i % PIE_COLORS.length] },
          })),
        },
      ],
    };
  }, [result, isDark]);

  // Frontier chart option
  const frontierChartOption = useMemo(() => {
    if (!result?.frontier || result.frontier.length === 0) return null;
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const axisLineColor = isDark ? 'rgba(255,255,255,0.08)' : '#e2e8f0';

    // Find the optimal point (highest sharpe)
    const optimalIdx = result.frontier.reduce(
      (best, pt, idx) => (pt.sharpe > result.frontier![best].sharpe ? idx : best),
      0,
    );

    // Frontier scatter data
    const frontierData = result.frontier.map((pt, idx) => ({
      value: [pt.volatility * 100, pt.return * 100],
      itemStyle: {
        color: idx === optimalIdx ? '#f59e0b' : isDark ? '#06b6d4' : '#0891b2',
        borderColor: idx === optimalIdx ? '#f59e0b' : 'transparent',
        borderWidth: idx === optimalIdx ? 2 : 0,
      },
      symbolSize: idx === optimalIdx ? 14 : 6,
    }));

    // Current portfolio point
    const portfolioPoint = {
      value: [result.metrics.volatility * 100, result.metrics.expectedReturn * 100],
      itemStyle: {
        color: '#ef4444',
        borderColor: isDark ? '#1e293b' : '#fff',
        borderWidth: 2,
      },
      symbolSize: 16,
    };

    return {
      backgroundColor: 'transparent',
      title: {
        text: '有效前沿',
        left: 'center',
        top: 12,
        textStyle: {
          color: isDark ? '#e2e8f0' : '#1e293b',
          fontSize: 14,
          fontFamily: 'ui-monospace, monospace',
          fontWeight: 'bold',
        },
      },
      tooltip: {
        trigger: 'item',
        backgroundColor: isDark ? '#1e293b' : '#fff',
        borderColor: isDark ? 'rgba(255,255,255,0.1)' : '#e2e8f0',
        textStyle: {
          color: isDark ? '#e2e8f0' : '#334155',
          fontFamily: 'ui-monospace, monospace',
          fontSize: 12,
        },
        formatter: (params: { seriesName: string; value: number[] }) => {
          return `${params.seriesName}<br/>波动率: ${params.value[0].toFixed(2)}%<br/>预期收益: ${params.value[1].toFixed(2)}%`;
        },
      },
      legend: {
        bottom: 8,
        textStyle: {
          color: textColor,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 10,
        },
        itemWidth: 10,
        itemHeight: 10,
      },
      grid: {
        left: 60,
        right: 30,
        top: 50,
        bottom: 50,
      },
      xAxis: {
        type: 'value',
        name: '波动率 (%)',
        nameTextStyle: {
          color: textColor,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 10,
        },
        axisLabel: {
          color: textColor,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 10,
          formatter: '{value}%',
        },
        axisLine: { lineStyle: { color: axisLineColor } },
        splitLine: { lineStyle: { color: axisLineColor, type: 'dashed' } },
      },
      yAxis: {
        type: 'value',
        name: '预期收益 (%)',
        nameTextStyle: {
          color: textColor,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 10,
        },
        axisLabel: {
          color: textColor,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 10,
          formatter: '{value}%',
        },
        axisLine: { lineStyle: { color: axisLineColor } },
        splitLine: { lineStyle: { color: axisLineColor, type: 'dashed' } },
      },
      series: [
        {
          name: '有效前沿',
          type: 'scatter',
          data: frontierData,
          symbol: 'circle',
        },
        {
          name: '当前组合',
          type: 'scatter',
          data: [portfolioPoint],
          symbol: 'diamond',
          symbolSize: 16,
          itemStyle: {
            color: '#ef4444',
            borderColor: isDark ? '#1e293b' : '#fff',
            borderWidth: 2,
          },
          z: 10,
        },
        {
          name: '最高夏普点',
          type: 'scatter',
          data: [frontierData[optimalIdx]],
          symbol: 'pin',
          symbolSize: 20,
          itemStyle: {
            color: '#f59e0b',
            borderColor: isDark ? '#1e293b' : '#fff',
            borderWidth: 2,
          },
          z: 10,
        },
      ],
    };
  }, [result, isDark]);

  const canRun = stocks.length >= MIN_STOCKS;

  return (
    <div className="w-full h-full flex flex-col bg-white/80 dark:bg-[#0a0e17]/50 backdrop-blur-xl border border-slate-200 dark:border-white/5 rounded-xl overflow-hidden shadow-lg dark:shadow-2xl dark:shadow-black/50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/5 bg-white/50 dark:bg-slate-900/30">
        <div className="flex items-center gap-3">
          <Briefcase className="w-4 h-4 text-cyan-500 dark:text-cyan-400" />
          <h2 className="text-base font-mono font-bold text-slate-800 dark:text-slate-100">
            组合优化
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

          {/* Algorithm selector */}
          <select
            value={algorithm}
            onChange={(e) => setAlgorithm(e.target.value as AlgorithmType)}
            className="px-2 py-1.5 text-[10px] font-mono rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-200 outline-none cursor-pointer"
          >
            {ALGORITHMS.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>

          {/* Run button */}
          <button
            onClick={runOptimize}
            disabled={!canRun || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold rounded-lg bg-cyan-500 hover:bg-cyan-600 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white disabled:text-slate-500 transition-colors"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            运行优化
          </button>
        </div>
      </div>

      {/* Config bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 dark:border-white/[0.03] flex-wrap text-[10px] font-mono">
        {/* Risk-free rate */}
        <label className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
          无风险利率:
          <input
            type="number"
            step="0.005"
            min="0"
            max="0.2"
            value={riskFreeRate}
            onChange={(e) => setRiskFreeRate(Number(e.target.value))}
            className="w-16 px-1.5 py-0.5 rounded border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-200 outline-none"
          />
        </label>
        <div className="w-px h-4 bg-slate-200 dark:bg-white/10" />
        {/* Days */}
        {DAY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setDays(opt.value)}
            className={`px-2 py-1 rounded-md transition-colors ${
              days === opt.value
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 font-semibold'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/40 border border-transparent'
            }`}
          >
            {opt.label}
          </button>
        ))}

        {/* Stock chips */}
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

      {/* Main content area */}
      {stocks.length < MIN_STOCKS && !result ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Search className="w-8 h-8 text-slate-300 dark:text-slate-600" />
          <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
            请添加至少{MIN_STOCKS}只股票开始组合优化
          </span>
          <span className="text-[10px] font-mono text-slate-300 dark:text-slate-600">
            支持 {MIN_STOCKS}-{MAX_STOCKS} 只股票
          </span>
        </div>
      ) : !result && !loading && !error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Play className="w-8 h-8 text-slate-300 dark:text-slate-600" />
          <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
            点击"运行优化"开始组合分析
          </span>
        </div>
      ) : loading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <Loader2 className="w-6 h-6 text-cyan-500 animate-spin" />
          <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
            组合优化中...
          </span>
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <span className="text-xs font-mono text-red-500">{error}</span>
          <button
            onClick={runOptimize}
            className="text-xs font-mono text-cyan-600 dark:text-cyan-400 hover:underline"
          >
            重试
          </button>
        </div>
      ) : result ? (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Metrics cards */}
          <div className="px-4 py-3 border-b border-slate-100 dark:border-white/[0.03]">
            <div className="grid grid-cols-3 gap-2">
              {/* Expected return */}
              <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-white/5">
                <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                  预期年化收益
                </div>
                <div
                  className={`text-sm font-mono font-bold ${
                    result.metrics.expectedReturn >= 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-500 dark:text-red-400'
                  }`}
                >
                  {formatPercent(result.metrics.expectedReturn)}
                </div>
              </div>
              {/* Volatility */}
              <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-white/5">
                <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                  年化波动率
                </div>
                <div className="text-sm font-mono font-bold text-amber-600 dark:text-amber-400">
                  {(result.metrics.volatility * 100).toFixed(2)}%
                </div>
              </div>
              {/* Sharpe ratio */}
              <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-white/5">
                <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                  夏普比率
                </div>
                <div
                  className={`text-sm font-mono font-bold ${
                    result.metrics.sharpeRatio > 1
                      ? 'text-green-600 dark:text-green-400'
                      : result.metrics.sharpeRatio >= 0
                        ? 'text-yellow-600 dark:text-yellow-400'
                        : 'text-red-500 dark:text-red-400'
                  }`}
                >
                  {result.metrics.sharpeRatio.toFixed(3)}
                </div>
              </div>
            </div>
            {/* Secondary info */}
            <div className="flex items-center gap-4 mt-2 text-[10px] font-mono text-slate-400 dark:text-slate-500">
              <span>算法: {ALGORITHMS.find((a) => a.key === algorithm)?.label}</span>
              <span>历史数据: {days}天</span>
              <span>无风险利率: {(riskFreeRate * 100).toFixed(1)}%</span>
              <span>股票数: {result.weights.length}</span>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex items-center gap-1 px-4 py-2 border-b border-slate-100 dark:border-white/[0.03]">
            {VIEW_TABS.map((tab) => {
              const disabled =
                tab.key === 'frontier' && (!result.frontier || result.frontier.length === 0);
              return (
                <button
                  key={tab.key}
                  onClick={() => !disabled && setActiveView(tab.key)}
                  disabled={disabled}
                  className={`px-2.5 py-1 text-[10px] font-mono rounded-md transition-colors ${
                    disabled
                      ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed border border-transparent'
                      : activeView === tab.key
                        ? 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-800/50 font-semibold'
                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/40 border border-transparent'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div className="flex-1 min-h-0 px-2 pt-2 pb-2">
            {/* Weights pie chart + table */}
            {activeView === 'weights' && weightChartOption && (
              <div className="h-full flex flex-col">
                <div className="flex-1 min-h-0">
                  <ReactECharts
                    option={weightChartOption}
                    style={{ height: '100%', width: '100%' }}
                    opts={{ renderer: 'canvas' }}
                    notMerge={true}
                  />
                </div>
                {/* Weight table */}
                <div className="max-h-36 overflow-auto mt-1 mx-1">
                  <table className="w-full text-xs font-mono">
                    <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900/80 backdrop-blur-sm z-10">
                      <tr className="border-b border-slate-200 dark:border-white/10">
                        <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                          股票
                        </th>
                        <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                          代码
                        </th>
                        <th className="px-2 py-1.5 text-right text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                          权重
                        </th>
                        <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                          占比
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.weights
                        .slice()
                        .sort((a, b) => b.weight - a.weight)
                        .map((w) => (
                          <tr
                            key={w.code}
                            className="border-b border-slate-100 dark:border-white/[0.03]"
                          >
                            <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200 font-semibold">
                              <span className="flex items-center gap-1.5">
                                <span
                                  className="w-2 h-2 rounded-full inline-block"
                                  style={{
                                    backgroundColor:
                                      PIE_COLORS[
                                        result.weights.findIndex((rw) => rw.code === w.code) %
                                          PIE_COLORS.length
                                      ],
                                  }}
                                />
                                {w.name}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-slate-400 dark:text-slate-500">
                              {w.code}
                            </td>
                            <td className="px-2 py-1.5 text-right text-slate-700 dark:text-slate-200">
                              {(w.weight * 100).toFixed(2)}%
                            </td>
                            <td className="px-2 py-1.5 w-32">
                              <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${Math.min(w.weight * 100, 100)}%`,
                                    backgroundColor:
                                      PIE_COLORS[
                                        result.weights.findIndex((rw) => rw.code === w.code) %
                                          PIE_COLORS.length
                                      ],
                                  }}
                                />
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Frontier scatter */}
            {activeView === 'frontier' && frontierChartOption && (
              <ReactECharts
                option={frontierChartOption}
                style={{ height: '100%', width: '100%' }}
                opts={{ renderer: 'canvas' }}
                notMerge={true}
              />
            )}

            {activeView === 'frontier' && !frontierChartOption && (
              <div className="flex items-center justify-center h-full">
                <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
                  暂无有效前沿数据
                </span>
              </div>
            )}

            {/* Metrics detail view */}
            {activeView === 'metrics' && (
              <div className="h-full overflow-auto px-2">
                <div className="grid grid-cols-2 gap-3 py-2">
                  {/* Portfolio overview card */}
                  <div className="col-span-2 px-4 py-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-white/5">
                    <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                      组合总览
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                          预期年化收益
                        </div>
                        <div
                          className={`text-lg font-mono font-bold ${
                            result.metrics.expectedReturn >= 0
                              ? 'text-green-600 dark:text-green-400'
                              : 'text-red-500 dark:text-red-400'
                          }`}
                        >
                          {formatPercent(result.metrics.expectedReturn)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                          年化波动率
                        </div>
                        <div className="text-lg font-mono font-bold text-amber-600 dark:text-amber-400">
                          {(result.metrics.volatility * 100).toFixed(2)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                          夏普比率
                        </div>
                        <div
                          className={`text-lg font-mono font-bold ${
                            result.metrics.sharpeRatio > 1
                              ? 'text-green-600 dark:text-green-400'
                              : result.metrics.sharpeRatio >= 0
                                ? 'text-yellow-600 dark:text-yellow-400'
                                : 'text-red-500 dark:text-red-400'
                          }`}
                        >
                          {result.metrics.sharpeRatio.toFixed(3)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Optimization params card */}
                  <div className="px-4 py-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-white/5">
                    <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                      优化参数
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                          优化算法
                        </span>
                        <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200">
                          {ALGORITHMS.find((a) => a.key === algorithm)?.label}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                          历史数据天数
                        </span>
                        <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200">
                          {days}天
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                          无风险利率
                        </span>
                        <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200">
                          {(riskFreeRate * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                          组合股票数
                        </span>
                        <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200">
                          {result.weights.length}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Weight distribution card */}
                  <div className="px-4 py-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-white/5">
                    <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                      权重分布
                    </div>
                    <div className="space-y-2">
                      {(() => {
                        const sorted = result.weights
                          .slice()
                          .sort((a, b) => b.weight - a.weight);
                        const maxWeight = sorted[0]?.weight ?? 0;
                        const minWeight = sorted[sorted.length - 1]?.weight ?? 0;
                        const effectiveCount = sorted.filter((w) => w.weight > 0.01).length;
                        const hhi = sorted.reduce((sum, w) => sum + w.weight * w.weight, 0);
                        return (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                                最大权重
                              </span>
                              <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200">
                                {sorted[0]?.name} ({(maxWeight * 100).toFixed(2)}%)
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                                最小权重
                              </span>
                              <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200">
                                {sorted[sorted.length - 1]?.name} (
                                {(minWeight * 100).toFixed(2)}%)
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                                有效持仓数
                              </span>
                              <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200">
                                {effectiveCount} / {sorted.length}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                                集中度(HHI)
                              </span>
                              <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200">
                                {(hhi * 10000).toFixed(0)}
                              </span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Performance evaluation card */}
                  <div className="col-span-2 px-4 py-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-white/5">
                    <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                      组合评价
                    </div>
                    <div className="space-y-1.5">
                      {/* Sharpe evaluation */}
                      <div className="flex items-start gap-1.5 text-xs font-mono text-slate-600 dark:text-slate-300">
                        <span className="text-cyan-500 dark:text-cyan-400 mt-0.5">·</span>
                        <span>
                          夏普比率为 {result.metrics.sharpeRatio.toFixed(3)}，
                          {result.metrics.sharpeRatio > 2
                            ? '表现优秀，每承受一单位风险可获得较高超额收益'
                            : result.metrics.sharpeRatio > 1
                              ? '表现良好，风险调整后收益较为理想'
                              : result.metrics.sharpeRatio > 0
                                ? '表现一般，风险调整后收益为正但不突出'
                                : '表现欠佳，组合风险收益比不理想'}
                        </span>
                      </div>
                      {/* Return-Risk evaluation */}
                      <div className="flex items-start gap-1.5 text-xs font-mono text-slate-600 dark:text-slate-300">
                        <span className="text-cyan-500 dark:text-cyan-400 mt-0.5">·</span>
                        <span>
                          预期年化收益 {formatPercent(result.metrics.expectedReturn)}，年化波动率{' '}
                          {(result.metrics.volatility * 100).toFixed(2)}%，收益风险比为{' '}
                          {result.metrics.volatility > 0
                            ? (
                                result.metrics.expectedReturn / result.metrics.volatility
                              ).toFixed(2)
                            : 'N/A'}
                        </span>
                      </div>
                      {/* Diversification evaluation */}
                      <div className="flex items-start gap-1.5 text-xs font-mono text-slate-600 dark:text-slate-300">
                        <span className="text-cyan-500 dark:text-cyan-400 mt-0.5">·</span>
                        <span>
                          {(() => {
                            const sorted = result.weights
                              .slice()
                              .sort((a, b) => b.weight - a.weight);
                            const top = sorted[0]?.weight ?? 0;
                            if (top > 0.5)
                              return `集中度较高，${sorted[0]?.name}占比${(top * 100).toFixed(1)}%，建议关注集中风险`;
                            if (top > 0.3)
                              return `权重分配较均衡，最大持仓${sorted[0]?.name}占${(top * 100).toFixed(1)}%`;
                            return '权重分散度良好，组合分散化程度较高';
                          })()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
