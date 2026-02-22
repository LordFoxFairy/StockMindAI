'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Search, Loader2, X, Play } from 'lucide-react';
import { useTheme } from '@/web/components/ThemeProvider';
import type { OHLCVItem } from '@/web/lib/indicators';
import { runBacktest } from '@/web/lib/backtest';
import type { BacktestResult, BacktestConfig } from '@/web/lib/backtest';
import { pluginRegistry } from '@/web/lib/plugins';
import type { StrategyPlugin, ParamSchema } from '@/web/lib/plugins';
import {
  buildEquityCurveChart,
  buildMonthlyReturnsChart,
} from '@/web/lib/backtestCharts';
import {
  dailyReturns,
  calculateRiskMetrics,
  monteCarloSimulation,
  stressTest,
} from '@/web/lib/risk';
import {
  buildVaRChart,
  buildMonteCarloChart,
  buildStressTestChart,
  buildRiskGaugeChart,
  calculateRiskScore,
} from '@/web/lib/riskCharts';
import type { SearchResult } from '@/web/types/stock';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3135';

/** Build the default param values from a plugin's param schema */
function buildDefaultParams(params: ParamSchema[]): Record<string, number | string> {
  const defaults: Record<string, number | string> = {};
  for (const p of params) {
    defaults[p.key] = p.default;
  }
  return defaults;
}

const PERIOD_OPTIONS = [
  { klt: 101, label: '日' },
  { klt: 102, label: '周' },
  { klt: 103, label: '月' },
];

const DAY_OPTIONS: { value: number; label: string }[] = [
  { value: 120, label: '120天' },
  { value: 250, label: '250天' },
  { value: 500, label: '500天' },
];

interface BacktestPanelProps {
  initialStock?: { code: string; name: string } | null;
}

export default function BacktestPanel({ initialStock }: BacktestPanelProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // Get all strategy plugins from the registry
  const strategyPlugins = useMemo(() => pluginRegistry.getByCategory<StrategyPlugin>('strategy'), []);
  const defaultStrategyId = strategyPlugins.length > 0 ? strategyPlugins[0].id : '';

  const [stock, setStock] = useState<{ code: string; name: string } | null>(initialStock ?? null);
  const [strategyId, setStrategyId] = useState<string>(defaultStrategyId);
  const [period, setPeriod] = useState(101);
  const [days, setDays] = useState(120);

  // Stop-loss / take-profit state
  const [stopLossEnabled, setStopLossEnabled] = useState(false);
  const [stopLossPercent, setStopLossPercent] = useState(5);
  const [takeProfitEnabled, setTakeProfitEnabled] = useState(false);
  const [takeProfitPercent, setTakeProfitPercent] = useState(10);

  const [config, setConfig] = useState<BacktestConfig>({
    initialCapital: 100000,
    commission: 0.0003,
    slippage: 0.001,
    stampDuty: 0.001,
  });

  // Dynamic strategy params keyed by plugin id
  const [pluginParams, setPluginParams] = useState<Record<string, Record<string, number | string>>>(() => {
    const allPlugins = pluginRegistry.getByCategory<StrategyPlugin>('strategy');
    const initial: Record<string, Record<string, number | string>> = {};
    for (const p of allPlugins) {
      initial[p.id] = buildDefaultParams(p.params);
    }
    return initial;
  });

  // Current selected strategy plugin
  const activePlugin = useMemo(() => strategyPlugins.find(p => p.id === strategyId), [strategyPlugins, strategyId]);
  const activeParams = pluginParams[strategyId] ?? {};
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'equity' | 'trades' | 'monthly' | 'risk'>('equity');

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

  const selectStock = (s: SearchResult) => {
    setStock(s);
    setQuery('');
    setSearchOpen(false);
  };

  const runBacktestHandler = useCallback(async () => {
    if (!stock || !activePlugin) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(
        `${API_URL}/api/stocks/kline/${encodeURIComponent(stock.code)}?days=${days}&klt=${period}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const klineData: OHLCVItem[] = data.klines || [];
      if (klineData.length === 0) {
        setError('无K线数据');
        return;
      }

      // Generate signals via the selected strategy plugin
      const signals = activePlugin.generateSignals(klineData, activeParams);

      // Build config with optional stop-loss / take-profit
      const btConfig: BacktestConfig = {
        ...config,
        stopLoss: stopLossEnabled ? { type: 'percent', value: stopLossPercent / 100 } : undefined,
        takeProfit: takeProfitEnabled ? { type: 'percent', value: takeProfitPercent / 100 } : undefined,
      };

      const btResult = runBacktest(klineData, signals, btConfig);
      setResult(btResult);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '回测运行失败');
    } finally {
      setLoading(false);
    }
  }, [stock, days, period, activePlugin, activeParams, config, stopLossEnabled, stopLossPercent, takeProfitEnabled, takeProfitPercent]);

  const updatePluginParam = (pluginId: string, key: string, value: number | string) => {
    setPluginParams(prev => ({
      ...prev,
      [pluginId]: { ...prev[pluginId], [key]: value },
    }));
  };

  // Risk analysis data (computed lazily when risk tab is active)
  const riskData = useMemo(() => {
    if (!result || activeView !== 'risk') return null;
    const returns = dailyReturns(result.equityCurve.map(e => e.equity));
    if (returns.length === 0) return null;
    const riskMetrics = calculateRiskMetrics(returns, result.metrics.annualizedReturn, result.metrics.maxDrawdown);
    const lastEquity = result.equityCurve[result.equityCurve.length - 1].equity;
    const mcResult = monteCarloSimulation(returns, 60, 500, lastEquity);
    const stressResults = stressTest(lastEquity, returns);
    const riskScore = calculateRiskScore(riskMetrics);
    return { returns, riskMetrics, mcResult, stressResults, riskScore, lastEquity };
  }, [result, activeView]);

  const formatPercent = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;

  const TABS: { key: typeof activeView; label: string }[] = [
    { key: 'equity', label: '收益曲线' },
    { key: 'trades', label: '交易明细' },
    { key: 'monthly', label: '月度收益' },
    { key: 'risk', label: '风险分析' },
  ];

  return (
    <div className="w-full h-full flex flex-col bg-white/80 dark:bg-[#0a0e17]/50 backdrop-blur-xl border border-slate-200 dark:border-white/5 rounded-xl overflow-hidden shadow-lg dark:shadow-2xl dark:shadow-black/50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/5 bg-white/50 dark:bg-slate-900/30">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-mono font-bold text-slate-800 dark:text-slate-100">
            回测分析
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
                onClick={() => { setStock(null); setResult(null); }}
                className="ml-1 text-cyan-400 hover:text-cyan-600 dark:hover:text-cyan-300"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
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

          {/* Strategy selector */}
          <select
            value={strategyId}
            onChange={e => setStrategyId(e.target.value)}
            className="px-2 py-1.5 text-[10px] font-mono rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-200 outline-none cursor-pointer"
          >
            {strategyPlugins.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {/* Run button */}
          <button
            onClick={runBacktestHandler}
            disabled={!stock || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold rounded-lg bg-cyan-500 hover:bg-cyan-600 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white disabled:text-slate-500 transition-colors"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            运行回测
          </button>
        </div>
      </div>

      {/* Config bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 dark:border-white/[0.03] flex-wrap text-[10px] font-mono">
        {/* Initial capital */}
        <label className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
          资金:
          <input
            type="number"
            value={config.initialCapital}
            onChange={e => setConfig(c => ({ ...c, initialCapital: Number(e.target.value) }))}
            className="w-20 px-1.5 py-0.5 rounded border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-200 outline-none"
          />
        </label>
        {/* Commission */}
        <label className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
          手续费:
          <input
            type="number"
            step="0.0001"
            value={config.commission}
            onChange={e => setConfig(c => ({ ...c, commission: Number(e.target.value) }))}
            className="w-16 px-1.5 py-0.5 rounded border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-200 outline-none"
          />
        </label>
        <div className="w-px h-4 bg-slate-200 dark:bg-white/10" />
        {/* Period */}
        {PERIOD_OPTIONS.map(opt => (
          <button
            key={opt.klt}
            onClick={() => setPeriod(opt.klt)}
            className={`px-2 py-1 rounded-md transition-colors ${
              period === opt.klt
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 font-semibold'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/40 border border-transparent'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <div className="w-px h-4 bg-slate-200 dark:bg-white/10" />
        {/* Days */}
        {DAY_OPTIONS.map(opt => (
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
        <div className="w-px h-4 bg-slate-200 dark:bg-white/10" />
        {/* Dynamic strategy params from plugin schema */}
        {activePlugin && activePlugin.params.map(param => (
          <label key={param.key} className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
            {param.label}:
            <input
              type="number"
              step={param.step ?? 1}
              min={param.min}
              max={param.max}
              value={activeParams[param.key] ?? param.default}
              onChange={e => updatePluginParam(strategyId, param.key, Number(e.target.value))}
              className="w-14 px-1 py-0.5 rounded border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-200 outline-none"
            />
          </label>
        ))}
      </div>

      {/* Stop-loss / Take-profit controls */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-100 dark:border-white/[0.03] flex-wrap text-[10px] font-mono">
        {/* Stop Loss */}
        <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={stopLossEnabled}
            onChange={e => setStopLossEnabled(e.target.checked)}
            className="rounded border-slate-300 dark:border-slate-600 text-cyan-500 focus:ring-cyan-500 w-3 h-3"
          />
          止损
        </label>
        {stopLossEnabled && (
          <label className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
            <input
              type="number"
              step={0.5}
              min={0.1}
              max={50}
              value={stopLossPercent}
              onChange={e => setStopLossPercent(Number(e.target.value))}
              className="w-12 px-1 py-0.5 rounded border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-200 outline-none"
            />
            %
          </label>
        )}
        <div className="w-px h-4 bg-slate-200 dark:bg-white/10" />
        {/* Take Profit */}
        <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={takeProfitEnabled}
            onChange={e => setTakeProfitEnabled(e.target.checked)}
            className="rounded border-slate-300 dark:border-slate-600 text-cyan-500 focus:ring-cyan-500 w-3 h-3"
          />
          止盈
        </label>
        {takeProfitEnabled && (
          <label className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
            <input
              type="number"
              step={0.5}
              min={0.1}
              max={100}
              value={takeProfitPercent}
              onChange={e => setTakeProfitPercent(Number(e.target.value))}
              className="w-12 px-1 py-0.5 rounded border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-200 outline-none"
            />
            %
          </label>
        )}
      </div>

      {/* Main content area */}
      {!stock ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Search className="w-8 h-8 text-slate-300 dark:text-slate-600" />
          <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
            请搜索并选择一只股票开始回测
          </span>
        </div>
      ) : !result && !loading && !error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Play className="w-8 h-8 text-slate-300 dark:text-slate-600" />
          <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
            点击"运行回测"开始分析
          </span>
        </div>
      ) : loading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <Loader2 className="w-6 h-6 text-cyan-500 animate-spin" />
          <span className="text-xs font-mono text-slate-400 dark:text-slate-500">回测运行中...</span>
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <span className="text-xs font-mono text-red-500">{error}</span>
          <button onClick={runBacktestHandler} className="text-xs font-mono text-cyan-600 dark:text-cyan-400 hover:underline">
            重试
          </button>
        </div>
      ) : result ? (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Metrics cards */}
          <div className="px-4 py-3 border-b border-slate-100 dark:border-white/[0.03]">
            <div className="grid grid-cols-6 gap-2">
              {/* Total return */}
              <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-white/5">
                <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500">总收益率</div>
                <div className={`text-sm font-mono font-bold ${result.metrics.totalReturn >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                  {formatPercent(result.metrics.totalReturn)}
                </div>
              </div>
              {/* Annualized return */}
              <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-white/5">
                <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500">年化收益</div>
                <div className={`text-sm font-mono font-bold ${result.metrics.annualizedReturn >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                  {formatPercent(result.metrics.annualizedReturn)}
                </div>
              </div>
              {/* Sharpe ratio */}
              <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-white/5">
                <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500">夏普比率</div>
                <div className={`text-sm font-mono font-bold ${
                  result.metrics.sharpeRatio > 1 ? 'text-green-600 dark:text-green-400'
                  : result.metrics.sharpeRatio >= 0 ? 'text-yellow-600 dark:text-yellow-400'
                  : 'text-red-500 dark:text-red-400'
                }`}>
                  {result.metrics.sharpeRatio.toFixed(2)}
                </div>
              </div>
              {/* Max drawdown */}
              <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-white/5">
                <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500">最大回撤</div>
                <div className="text-sm font-mono font-bold text-red-500 dark:text-red-400">
                  {(result.metrics.maxDrawdown * 100).toFixed(2)}%
                </div>
              </div>
              {/* Win rate */}
              <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-white/5">
                <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500">胜率</div>
                <div className="text-sm font-mono font-bold text-slate-700 dark:text-slate-200">
                  {(result.metrics.winRate * 100).toFixed(1)}%
                </div>
              </div>
              {/* Total trades */}
              <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-white/5">
                <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500">总交易数</div>
                <div className="text-sm font-mono font-bold text-slate-700 dark:text-slate-200">
                  {result.metrics.totalTrades}
                </div>
              </div>
            </div>
            {/* Secondary metrics */}
            <div className="flex items-center gap-4 mt-2 text-[10px] font-mono text-slate-400 dark:text-slate-500">
              <span>盈亏比: {result.metrics.profitFactor === Infinity ? '∞' : result.metrics.profitFactor.toFixed(2)}</span>
              <span>平均持仓: {result.metrics.avgHoldDays}天</span>
              <span>卡尔马比率: {result.metrics.calmarRatio === Infinity ? '∞' : result.metrics.calmarRatio.toFixed(2)}</span>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex items-center gap-1 px-4 py-2 border-b border-slate-100 dark:border-white/[0.03]">
            {TABS.map(tab => (
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
            {activeView === 'equity' && (
              <ReactECharts
                option={buildEquityCurveChart(result, isDark)}
                style={{ height: '100%', width: '100%' }}
                opts={{ renderer: 'canvas' }}
                notMerge={true}
              />
            )}

            {activeView === 'trades' && (
              <div className="h-full overflow-auto">
                <table className="w-full text-xs font-mono">
                  <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900/80 backdrop-blur-sm z-10">
                    <tr className="border-b border-slate-200 dark:border-white/10">
                      <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-slate-500 dark:text-slate-400">#</th>
                      <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-slate-500 dark:text-slate-400">买入日期</th>
                      <th className="px-2 py-1.5 text-right text-[10px] font-semibold text-slate-500 dark:text-slate-400">买入价</th>
                      <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-slate-500 dark:text-slate-400">卖出日期</th>
                      <th className="px-2 py-1.5 text-right text-[10px] font-semibold text-slate-500 dark:text-slate-400">卖出价</th>
                      <th className="px-2 py-1.5 text-right text-[10px] font-semibold text-slate-500 dark:text-slate-400">收益</th>
                      <th className="px-2 py-1.5 text-right text-[10px] font-semibold text-slate-500 dark:text-slate-400">收益率</th>
                      <th className="px-2 py-1.5 text-right text-[10px] font-semibold text-slate-500 dark:text-slate-400">持有天数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((trade, i) => (
                      <tr
                        key={i}
                        className={`border-b border-slate-100 dark:border-white/[0.03] ${
                          trade.pnl > 0
                            ? 'bg-green-50/50 dark:bg-green-900/10'
                            : trade.pnl < 0
                              ? 'bg-red-50/50 dark:bg-red-900/10'
                              : ''
                        }`}
                      >
                        <td className="px-2 py-1.5 text-slate-500 dark:text-slate-400">{i + 1}</td>
                        <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">{trade.entryDate}</td>
                        <td className="px-2 py-1.5 text-right text-slate-700 dark:text-slate-200">{trade.entryPrice.toFixed(2)}</td>
                        <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">{trade.exitDate}</td>
                        <td className="px-2 py-1.5 text-right text-slate-700 dark:text-slate-200">{trade.exitPrice.toFixed(2)}</td>
                        <td className={`px-2 py-1.5 text-right ${trade.pnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                          {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)}
                        </td>
                        <td className={`px-2 py-1.5 text-right ${trade.pnlPercent >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                          {formatPercent(trade.pnlPercent)}
                        </td>
                        <td className="px-2 py-1.5 text-right text-slate-500 dark:text-slate-400">{trade.holdDays}</td>
                      </tr>
                    ))}
                    {result.trades.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-2 py-8 text-center text-slate-400 dark:text-slate-500">
                          无交易记录
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {activeView === 'monthly' && (
              <ReactECharts
                option={buildMonthlyReturnsChart(result.equityCurve, isDark)}
                style={{ height: '100%', width: '100%' }}
                opts={{ renderer: 'canvas' }}
                notMerge={true}
              />
            )}

            {activeView === 'risk' && riskData && (
              <div className="h-full grid grid-cols-2 grid-rows-2 gap-2">
                <div className="min-h-0">
                  <ReactECharts
                    option={buildVaRChart(riskData.returns, riskData.riskMetrics.dailyVaR95, riskData.riskMetrics.cVaR95, isDark)}
                    style={{ height: '100%', width: '100%' }}
                    opts={{ renderer: 'canvas' }}
                    notMerge={true}
                  />
                </div>
                <div className="min-h-0">
                  <ReactECharts
                    option={buildRiskGaugeChart(riskData.riskScore, isDark)}
                    style={{ height: '100%', width: '100%' }}
                    opts={{ renderer: 'canvas' }}
                    notMerge={true}
                  />
                </div>
                <div className="min-h-0">
                  <ReactECharts
                    option={buildMonteCarloChart(riskData.mcResult, riskData.lastEquity, isDark)}
                    style={{ height: '100%', width: '100%' }}
                    opts={{ renderer: 'canvas' }}
                    notMerge={true}
                  />
                </div>
                <div className="min-h-0">
                  <ReactECharts
                    option={buildStressTestChart(riskData.stressResults, isDark)}
                    style={{ height: '100%', width: '100%' }}
                    opts={{ renderer: 'canvas' }}
                    notMerge={true}
                  />
                </div>
              </div>
            )}

            {activeView === 'risk' && !riskData && (
              <div className="flex items-center justify-center h-full">
                <span className="text-xs font-mono text-slate-400 dark:text-slate-500">数据不足，无法进行风险分析</span>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
