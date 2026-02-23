'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity,
  ShieldAlert,
  Lightbulb,
  PieChart,
  RefreshCw,
  Loader2,
  Search,
  TrendingUp,
  TrendingDown,
  Minus,
  Sparkles,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Stethoscope,
} from 'lucide-react';
import { useTheme } from '@/web/components/ThemeProvider';
import type { AgentCard, CardType } from '@/web/lib/agentCards';
import { createDefaultCards, fetchCardInsightDirect, CARD_CONFIGS } from '@/web/lib/agentCards';
import type { SearchResult } from '@/web/types/stock';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3135';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Activity,
  Stethoscope,
  ShieldAlert,
  Lightbulb,
  PieChart,
};

interface AgentInsightPanelProps {
  initialStock?: { code: string; name: string } | null;
}

export default function AgentInsightPanel({ initialStock }: AgentInsightPanelProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [stockCode, setStockCode] = useState(initialStock?.code || '');
  const [stockName, setStockName] = useState(initialStock?.name || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [cards, setCards] = useState<AgentCard[]>(() => createDefaultCards(initialStock?.code, initialStock?.name));
  const [autoRefresh, setAutoRefresh] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Update cards when initialStock changes
  useEffect(() => {
    if (initialStock) {
      setStockCode(initialStock.code);
      setStockName(initialStock.name);
      setCards(prev =>
        prev.map(card =>
          CARD_CONFIGS.find(c => c.type === card.type)?.needsStock
            ? { ...card, stockCode: initialStock.code, stockName: initialStock.name, data: null, error: null }
            : card,
        ),
      );
    }
  }, [initialStock]);

  // Close search dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Auto-refresh interval
  useEffect(() => {
    if (autoRefresh) {
      autoRefreshRef.current = setInterval(() => {
        fetchAllCards();
      }, 5 * 60 * 1000);
    } else if (autoRefreshRef.current) {
      clearInterval(autoRefreshRef.current);
      autoRefreshRef.current = null;
    }
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [autoRefresh]);

  // Search stocks
  const handleSearch = useCallback(async (q: string) => {
    setSearchQuery(q);
    if (q.length < 1) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/stocks/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(Array.isArray(data) ? data.slice(0, 8) : []);
        setSearchOpen(true);
      }
    } catch {
      setSearchResults([]);
    }
  }, []);

  const selectStock = useCallback((result: SearchResult) => {
    setStockCode(result.code);
    setStockName(result.name);
    setSearchQuery(`${result.name}(${result.code})`);
    setSearchOpen(false);
    setCards(prev =>
      prev.map(card =>
        CARD_CONFIGS.find(c => c.type === card.type)?.needsStock
          ? { ...card, stockCode: result.code, stockName: result.name, data: null, error: null }
          : card,
      ),
    );
  }, []);

  // Fetch a single card
  const fetchCard = useCallback(async (type: CardType) => {
    setCards(prev =>
      prev.map(c => (c.type === type ? { ...c, loading: true, error: null } : c)),
    );
    try {
      const cfg = CARD_CONFIGS.find(c => c.type === type);
      const code = cfg?.needsStock ? stockCode : undefined;
      const name = cfg?.needsStock ? stockName : undefined;

      if (cfg?.needsStock && !code) {
        setCards(prev =>
          prev.map(c =>
            c.type === type ? { ...c, loading: false, error: '请先选择股票' } : c,
          ),
        );
        return;
      }

      const data = await fetchCardInsightDirect(type, code, name);
      setCards(prev =>
        prev.map(c =>
          c.type === type ? { ...c, loading: false, data, updatedAt: new Date() } : c,
        ),
      );
    } catch (err) {
      setCards(prev =>
        prev.map(c =>
          c.type === type
            ? { ...c, loading: false, error: err instanceof Error ? err.message : '请求失败' }
            : c,
        ),
      );
    }
  }, [stockCode, stockName]);

  // Fetch all cards in parallel
  const fetchAllCards = useCallback(() => {
    for (const cfg of CARD_CONFIGS) {
      fetchCard(cfg.type);
    }
  }, [fetchCard]);

  const anyLoading = cards.some(c => c.loading);

  // Score gauge SVG
  const renderGauge = (score: number) => {
    const radius = 36;
    const circumference = 2 * Math.PI * radius;
    const progress = (score / 100) * circumference * 0.75; // 270 degree arc
    const color =
      score >= 70
        ? isDark ? '#22c55e' : '#16a34a'
        : score >= 40
          ? isDark ? '#eab308' : '#ca8a04'
          : isDark ? '#ef4444' : '#dc2626';

    return (
      <svg width="88" height="88" viewBox="0 0 88 88" className="shrink-0">
        <circle
          cx="44"
          cy="44"
          r={radius}
          fill="none"
          stroke={isDark ? '#1e293b' : '#e2e8f0'}
          strokeWidth="6"
          strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
          strokeLinecap="round"
          transform="rotate(135 44 44)"
        />
        <circle
          cx="44"
          cy="44"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeDasharray={`${progress} ${circumference - progress}`}
          strokeLinecap="round"
          transform="rotate(135 44 44)"
          className="transition-all duration-700"
        />
        <text
          x="44"
          y="42"
          textAnchor="middle"
          dominantBaseline="middle"
          className="font-mono font-bold"
          fontSize="18"
          fill={color}
        >
          {score}
        </text>
        <text
          x="44"
          y="58"
          textAnchor="middle"
          dominantBaseline="middle"
          className="font-mono"
          fontSize="9"
          fill={isDark ? '#94a3b8' : '#64748b'}
        >
          / 100
        </text>
      </svg>
    );
  };

  const renderTrend = (trend: 'bullish' | 'bearish' | 'neutral') => {
    switch (trend) {
      case 'bullish':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-mono text-emerald-500">
            <TrendingUp className="w-3.5 h-3.5" /> 看多
          </span>
        );
      case 'bearish':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-mono text-red-500">
            <TrendingDown className="w-3.5 h-3.5" /> 看空
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-xs font-mono text-slate-400">
            <Minus className="w-3.5 h-3.5" /> 中性
          </span>
        );
    }
  };

  const itemTypeIcon = (type?: string) => {
    switch (type) {
      case 'positive':
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
      case 'negative':
        return <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />;
      case 'warning':
        return <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />;
      default:
        return <Minus className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
    }
  };

  const renderCard = (card: AgentCard) => {
    const IconComp = ICON_MAP[card.icon] || Activity;

    return (
      <div
        key={card.id}
        className="bg-white/80 dark:bg-[#0f1724]/60 backdrop-blur-xl border border-slate-200 dark:border-white/[0.06] rounded-xl shadow-lg dark:shadow-2xl dark:shadow-black/40 flex flex-col overflow-hidden transition-all hover:border-slate-300 dark:hover:border-white/10"
      >
        {/* Card Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-white/5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-cyan-950/40 border border-blue-100 dark:border-cyan-900/30 flex items-center justify-center">
              <IconComp className="w-3.5 h-3.5 text-blue-600 dark:text-cyan-400" />
            </div>
            <span className="text-sm font-mono font-medium text-slate-700 dark:text-slate-200">
              {card.title}
            </span>
            {card.stockName && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-white/5">
                {card.stockName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {card.updatedAt && (
              <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {card.updatedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button
              onClick={() => fetchCard(card.type)}
              disabled={card.loading}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800/50 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors disabled:opacity-50"
              title="刷新"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${card.loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Card Body */}
        <div className="flex-1 p-4 min-h-[180px]">
          {card.loading && (
            <div className="space-y-3 animate-pulse">
              <div className="h-4 bg-slate-200 dark:bg-slate-700/50 rounded w-3/4" />
              <div className="h-3 bg-slate-200 dark:bg-slate-700/50 rounded w-full" />
              <div className="h-3 bg-slate-200 dark:bg-slate-700/50 rounded w-5/6" />
              <div className="flex gap-3 mt-4">
                <div className="w-20 h-20 rounded-full bg-slate-200 dark:bg-slate-700/50" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-slate-200 dark:bg-slate-700/50 rounded w-2/3" />
                  <div className="h-3 bg-slate-200 dark:bg-slate-700/50 rounded w-1/2" />
                </div>
              </div>
              <div className="h-3 bg-slate-200 dark:bg-slate-700/50 rounded w-full mt-2" />
              <div className="h-3 bg-slate-200 dark:bg-slate-700/50 rounded w-4/5" />
            </div>
          )}

          {card.error && !card.loading && (
            <div className="flex flex-col items-center justify-center h-full gap-3 py-6">
              <AlertTriangle className="w-8 h-8 text-red-400 dark:text-red-500/70" />
              <p className="text-xs font-mono text-red-500 dark:text-red-400 text-center max-w-[200px]">
                {card.error}
              </p>
              <button
                onClick={() => fetchCard(card.type)}
                className="px-3 py-1.5 text-[11px] font-mono rounded-lg bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/30 hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors"
              >
                重试
              </button>
            </div>
          )}

          {card.data && !card.loading && (
            <div className="space-y-3">
              {/* Summary */}
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300 font-mono">
                {card.data.summary}
              </p>

              {/* Score & Trend */}
              {(card.data.score !== undefined || card.data.trend) && (
                <div className="flex items-center gap-4">
                  {card.data.score !== undefined && renderGauge(card.data.score)}
                  <div className="space-y-1.5">
                    {card.data.score !== undefined && (
                      <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                        综合评分:{' '}
                        <span
                          className={`font-bold ${
                            card.data.score >= 70
                              ? 'text-emerald-500'
                              : card.data.score >= 40
                                ? 'text-amber-500'
                                : 'text-red-500'
                          }`}
                        >
                          {card.data.score}
                        </span>{' '}
                        / 100
                      </div>
                    )}
                    {card.data.trend && (
                      <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                        趋势: {renderTrend(card.data.trend)}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Items */}
              {card.data.items.length > 0 && (
                <div className="space-y-1.5 mt-2">
                  {card.data.items.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 text-[11px] font-mono py-1 px-2 rounded-lg bg-slate-50/80 dark:bg-slate-800/30 border border-slate-100 dark:border-white/[0.03]"
                    >
                      {itemTypeIcon(item.type)}
                      <span className="text-slate-500 dark:text-slate-400 shrink-0">
                        {item.label}:
                      </span>
                      <span className="text-slate-700 dark:text-slate-200 break-all">
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Tags */}
              {card.data.tags && card.data.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {card.data.tags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 text-[10px] font-mono rounded-md bg-blue-50 dark:bg-cyan-950/30 text-blue-600 dark:text-cyan-400 border border-blue-100 dark:border-cyan-900/30"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!card.data && !card.loading && !card.error && (
            <div className="flex flex-col items-center justify-center h-full gap-2 py-6 text-slate-400 dark:text-slate-500">
              <IconComp className="w-8 h-8 opacity-30" />
              <p className="text-[11px] font-mono">点击生成或刷新获取洞察</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full h-full bg-white/80 dark:bg-[#0a0e17]/50 backdrop-blur-xl border border-slate-200 dark:border-white/5 rounded-xl overflow-hidden shadow-lg dark:shadow-2xl dark:shadow-black/50 flex flex-col">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-white/5 bg-white/50 dark:bg-[#0a0e17]/60 backdrop-blur-xl relative z-30">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 dark:from-cyan-500 dark:to-blue-600 flex items-center justify-center shadow-md">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-mono font-bold text-slate-800 dark:text-slate-100 tracking-tight">
              AI 洞察卡片
            </h2>
            <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
              Agent-powered market intelligence
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Stock search */}
          <div ref={searchRef} className="relative z-50">
            <div className="flex items-center bg-slate-100 dark:bg-[#0a0e17] border border-slate-200 dark:border-white/5 rounded-lg px-3 py-1.5 focus-within:border-cyan-400 dark:focus-within:border-cyan-600 transition-colors">
              <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 mr-2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
                placeholder="搜索股票..."
                className="bg-transparent text-xs font-mono text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 outline-none w-36"
              />
            </div>
            {searchOpen && searchResults.length > 0 && (
              <div className="absolute top-full mt-1 right-0 w-64 bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-white/10 rounded-lg shadow-xl dark:shadow-2xl dark:shadow-black/60 z-[100] max-h-60 overflow-y-auto">
                {searchResults.map((r, i) => (
                  <button
                    key={`${r.code}-${i}`}
                    onClick={() => selectStock(r)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs font-mono hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-white/5 last:border-0 transition-colors"
                  >
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{r.name}</span>
                    <span className="text-blue-600 dark:text-cyan-400">{r.code}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-2.5 py-1.5 text-[10px] font-mono rounded-lg border transition-colors ${
              autoRefresh
                ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/30'
                : 'bg-slate-100 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-white/5'
            }`}
            title={autoRefresh ? '关闭自动刷新' : '开启自动刷新(5分钟)'}
          >
            <RefreshCw className={`w-3 h-3 inline mr-1 ${autoRefresh ? 'animate-spin' : ''}`} />
            {autoRefresh ? 'ON' : 'OFF'}
          </button>

          {/* Generate All */}
          <button
            onClick={fetchAllCards}
            disabled={anyLoading}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-mono rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 dark:from-cyan-600 dark:to-blue-600 text-white shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {anyLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            生成全部洞察
          </button>
        </div>
      </div>

      {/* Cards Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {cards.map(renderCard)}
        </div>
      </div>
    </div>
  );
}
