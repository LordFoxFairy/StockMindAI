'use client';

import React, { useState, useEffect, useCallback } from 'react';
import ReactECharts from 'echarts-for-react';
import {
  ArrowLeft, TrendingUp, TrendingDown, Loader2, Bot, RefreshCw,
} from 'lucide-react';
import { useTheme } from '@/web/components/ThemeProvider';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3135';

interface KlineItem {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  turnover: number;
  amplitude: number;
}

interface QuoteData {
  code: string;
  name: string;
  price: number;
  high: number;
  low: number;
  open: number;
  volume: number;
  turnover: number;
  volumeRatio: number;
  previousClose: number;
  changePercent: number;
  change: number;
  totalMarketCap: number;
  floatMarketCap: number;
}

interface StockDetailProps {
  code: string;
  name: string;
  onClose: () => void;
  onAnalyze: (code: string) => void;
}

function formatPrice(price: number): string {
  if (!price || isNaN(price)) return '--';
  return price.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function formatMarketCap(cap: number): string {
  if (!cap || isNaN(cap)) return '--';
  if (cap >= 1e12) return `${(cap / 1e12).toFixed(2)}万亿`;
  if (cap >= 1e8) return `${(cap / 1e8).toFixed(2)}亿`;
  return cap.toLocaleString();
}

function priceColor(change: number): string {
  if (change > 0) return 'text-red-600 dark:text-red-500';
  if (change < 0) return 'text-green-600 dark:text-green-500';
  return 'text-slate-500 dark:text-slate-400';
}

function priceColorBg(change: number): string {
  if (change > 0) return 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/50';
  if (change < 0) return 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900/50';
  return 'bg-slate-50 dark:bg-slate-800/30 border-slate-200 dark:border-white/10';
}

export default function StockDetail({ code, name, onClose, onAnalyze }: StockDetailProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [klineData, setKlineData] = useState<KlineItem[]>([]);
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [klineLoading, setKlineLoading] = useState(true);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(60);
  const [period, setPeriod] = useState<number>(101);

  const periodOptions = [
    { klt: 1, label: '1分' },
    { klt: 5, label: '5分' },
    { klt: 15, label: '15分' },
    { klt: 30, label: '30分' },
    { klt: 60, label: '时' },
    { klt: 101, label: '日' },
    { klt: 102, label: '周' },
    { klt: 103, label: '月' },
  ];

  const dayRangeOptions = period < 101
    ? [{ value: 1, label: '1天' }, { value: 3, label: '3天' }, { value: 5, label: '5天' }, { value: 10, label: '10天' }]
    : period === 102
      ? [{ value: 30, label: '30周' }, { value: 60, label: '60周' }, { value: 120, label: '120周' }, { value: 250, label: '250周' }]
      : period === 103
        ? [{ value: 60, label: '60月' }, { value: 120, label: '120月' }, { value: 250, label: '250月' }]
        : [{ value: 30, label: '30日' }, { value: 60, label: '60日' }, { value: 120, label: '120日' }, { value: 250, label: '250日' }];

  const handlePeriodChange = (klt: number) => {
    setPeriod(klt);
    if (klt < 101) setDays(3);
    else if (klt === 101) setDays(60);
    else if (klt === 102) setDays(120);
    else setDays(250);
  };

  const fetchKline = useCallback(async (showLoading = true) => {
    if (showLoading) setKlineLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/stocks/kline/${encodeURIComponent(code)}?days=${days}&klt=${period}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setKlineData(data.klines || []);
    } catch (err: unknown) {
      if (showLoading) setError(err instanceof Error ? err.message : '加载K线数据失败');
    } finally {
      if (showLoading) setKlineLoading(false);
    }
  }, [code, days, period]);

  const fetchQuote = useCallback(async (showLoading = true) => {
    if (showLoading) setQuoteLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/stocks/quote/${encodeURIComponent(code)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setQuote(data);
    } catch {
      // Silent fail on polling
    } finally {
      if (showLoading) setQuoteLoading(false);
    }
  }, [code]);

  useEffect(() => {
    fetchKline();
    fetchQuote();
  }, [fetchKline, fetchQuote]);

  // Real-time polling: refresh quote every 5s, kline every 10s (silent, no loading spinner)
  useEffect(() => {
    const quoteTimer = setInterval(() => fetchQuote(false), 5000);
    const klineTimer = setInterval(() => fetchKline(false), 10000);
    return () => {
      clearInterval(quoteTimer);
      clearInterval(klineTimer);
    };
  }, [fetchQuote, fetchKline]);

  const displayName = quote?.name || name;
  const changeVal = quote?.change ?? 0;
  const changePct = quote?.changePercent ?? 0;

  const chartOption = React.useMemo(() => {
    if (klineData.length === 0) return null;

    const dates = klineData.map(k => k.date);
    const candleData = klineData.map(k => [k.open, k.close, k.low, k.high]);
    const volumes = klineData.map(k => k.volume);
    const volumeColors = klineData.map(k =>
      k.close >= k.open
        ? (isDark ? 'rgba(239, 68, 68, 0.6)' : 'rgba(239, 68, 68, 0.5)')
        : (isDark ? 'rgba(34, 197, 94, 0.6)' : 'rgba(34, 197, 94, 0.5)')
    );

    // Compute MA5, MA10
    const ma5: (number | null)[] = [];
    const ma10: (number | null)[] = [];
    for (let i = 0; i < klineData.length; i++) {
      if (i >= 4) {
        let sum = 0;
        for (let j = i - 4; j <= i; j++) sum += klineData[j].close;
        ma5.push(+(sum / 5).toFixed(2));
      } else {
        ma5.push(null);
      }
      if (i >= 9) {
        let sum = 0;
        for (let j = i - 9; j <= i; j++) sum += klineData[j].close;
        ma10.push(+(sum / 10).toFixed(2));
      } else {
        ma10.push(null);
      }
    }

    const textColor = isDark ? '#94a3b8' : '#64748b';
    const borderColor = isDark ? '#1e293b' : '#e2e8f0';
    const gridLineColor = isDark ? '#1e293b' : '#f1f5f9';

    return {
      backgroundColor: 'transparent',
      animation: false,
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          crossStyle: { color: isDark ? '#475569' : '#cbd5e1', type: 'dashed' as const },
          label: {
            backgroundColor: isDark ? '#1e293b' : '#f8fafc',
            color: isDark ? '#e2e8f0' : '#334155',
            borderColor: borderColor,
            borderWidth: 1,
          },
        },
        backgroundColor: isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        borderColor: borderColor,
        textStyle: { color: isDark ? '#e2e8f0' : '#334155', fontSize: 11, fontFamily: 'monospace' },
        padding: [8, 12],
      },
      grid: [
        { left: '8%', right: '3%', top: '8%', height: '55%' },
        { left: '8%', right: '3%', top: '70%', height: '18%' },
      ],
      xAxis: [
        {
          type: 'category' as const,
          data: dates,
          boundaryGap: true,
          axisLine: { lineStyle: { color: borderColor } },
          splitLine: { show: false },
          axisLabel: {
            color: textColor, fontSize: 10, margin: 10,
            formatter: (value: string) => {
              if (period < 101) {
                const timePart = value.split(' ')[1];
                return timePart || value;
              }
              return value.slice(5);
            }
          },
          axisTick: { show: false },
        },
        {
          type: 'category' as const,
          gridIndex: 1,
          data: dates,
          boundaryGap: true,
          axisLine: { lineStyle: { color: borderColor } },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
        },
      ],
      yAxis: [
        {
          scale: true,
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: true, lineStyle: { color: gridLineColor, type: 'dashed' as const } },
          axisLabel: { color: textColor, fontSize: 10 },
        },
        {
          scale: true,
          gridIndex: 1,
          splitNumber: 2,
          axisLabel: { show: false },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
        },
      ],
      dataZoom: [
        { type: 'inside' as const, xAxisIndex: [0, 1], start: 0, end: 100 },
      ],
      series: [
        {
          name: 'K线',
          type: 'candlestick',
          data: candleData,
          itemStyle: {
            color: '#ef4444',
            color0: '#22c55e',
            borderColor: '#ef4444',
            borderColor0: '#22c55e',
            borderWidth: 1,
          },
        },
        {
          name: 'MA5',
          type: 'line',
          data: ma5,
          smooth: true,
          lineStyle: { width: 1.5, color: '#38bdf8' },
          symbol: 'none',
        },
        {
          name: 'MA10',
          type: 'line',
          data: ma10,
          smooth: true,
          lineStyle: { width: 1.5, color: '#c084fc' },
          symbol: 'none',
        },
        {
          name: '成交量',
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: volumes.map((v, i) => ({
            value: v,
            itemStyle: { color: volumeColors[i] },
          })),
        },
      ],
    };
  }, [klineData, isDark, period]);

  return (
    <div className="w-full h-full flex flex-col bg-white/80 dark:bg-[#0a0e17]/50 backdrop-blur-xl border border-slate-200 dark:border-white/5 rounded-xl overflow-hidden shadow-lg dark:shadow-2xl dark:shadow-black/50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/5 bg-white/50 dark:bg-slate-900/30">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors"
            title="返回"
          >
            <ArrowLeft className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-mono font-bold text-slate-800 dark:text-slate-100">
                {displayName}
              </h2>
              <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
                {code}
              </span>
            </div>
            {quote && (
              <div className="flex items-center gap-3 mt-0.5">
                <span className={`text-lg font-mono font-bold tabular-nums ${priceColor(changeVal)}`}>
                  {formatPrice(quote.price)}
                </span>
                <div className={`flex items-center gap-1 text-sm font-mono font-semibold tabular-nums ${priceColor(changeVal)}`}>
                  {changeVal > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : changeVal < 0 ? <TrendingDown className="w-3.5 h-3.5" /> : null}
                  <span>{formatChange(changeVal)}</span>
                  <span>({formatPercent(changePct)})</span>
                </div>
              </div>
            )}
            {quoteLoading && !quote && (
              <div className="flex items-center gap-1.5 mt-0.5">
                <Loader2 className="w-3 h-3 text-cyan-500 animate-spin" />
                <span className="text-[10px] font-mono text-slate-400">加载行情中...</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { fetchKline(); fetchQuote(); }}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors"
            title="刷新"
          >
            <RefreshCw className={`w-4 h-4 text-slate-400 dark:text-slate-500 ${(klineLoading || quoteLoading) ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => onAnalyze(code)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold rounded-lg
              bg-cyan-600 hover:bg-cyan-700 dark:bg-cyan-700 dark:hover:bg-cyan-600
              text-white transition-colors shadow-sm"
          >
            <Bot className="w-3.5 h-3.5" />
            AI 分析
          </button>
        </div>
      </div>

      {/* Period & range selector — single row */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-slate-100 dark:border-white/[0.03] flex-wrap">
        {periodOptions.map(opt => (
          <button
            key={opt.klt}
            onClick={() => handlePeriodChange(opt.klt)}
            className={`px-2 py-1 text-[10px] font-mono rounded-md transition-colors ${
              period === opt.klt
                ? 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-800/50 font-semibold'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/40 border border-transparent'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <div className="w-px h-4 bg-slate-200 dark:bg-white/10 mx-1" />
        {dayRangeOptions.map(opt => (
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
        {klineLoading ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <Loader2 className="w-6 h-6 text-cyan-500 animate-spin" />
            <span className="text-xs font-mono text-slate-400 dark:text-slate-500">加载K线数据中...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <span className="text-xs font-mono text-red-500">{error}</span>
            <button onClick={() => fetchKline()} className="text-xs font-mono text-cyan-600 dark:text-cyan-400 hover:underline">
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
            <button onClick={() => fetchKline()} className="text-xs font-mono text-cyan-600 dark:text-cyan-400 hover:underline">
              重新加载
            </button>
          </div>
        )}
      </div>

      {/* Stats grid */}
      {quote && (
        <div className="px-4 py-3 border-t border-slate-200 dark:border-white/5">
          <div className="grid grid-cols-4 gap-2">
            <StatItem label="开盘" value={formatPrice(quote.open)} change={quote.open - quote.previousClose} />
            <StatItem label="最高" value={formatPrice(quote.high)} change={quote.high - quote.previousClose} />
            <StatItem label="最低" value={formatPrice(quote.low)} change={quote.low - quote.previousClose} />
            <StatItem label="昨收" value={formatPrice(quote.previousClose)} change={0} />
            <StatItem label="成交量" value={formatVolume(quote.volume)} />
            <StatItem label="成交额" value={formatTurnover(quote.turnover)} />
            <StatItem label="总市值" value={formatMarketCap(quote.totalMarketCap)} />
            <StatItem label="流通市值" value={formatMarketCap(quote.floatMarketCap)} />
          </div>
        </div>
      )}
    </div>
  );
}

function StatItem({ label, value, change }: { label: string; value: string; change?: number }) {
  const color = change !== undefined && change !== 0
    ? priceColor(change)
    : 'text-slate-700 dark:text-slate-200';

  return (
    <div className="flex flex-col gap-0.5 px-2 py-1.5 rounded-md bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-white/5">
      <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider">
        {label}
      </span>
      <span className={`text-xs font-mono font-semibold tabular-nums ${color}`}>
        {value}
      </span>
    </div>
  );
}
