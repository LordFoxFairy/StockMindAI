'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Search, Loader2, X, Send, FlaskConical, TrendingUp, Star } from 'lucide-react';
import { useTheme } from '@/web/components/ThemeProvider';
import type { BacktestResult, BacktestMetrics } from '@/web/lib/backtest';
import { buildEquityCurveChart } from '@/web/lib/backtestCharts';

import type { SearchResult } from '@/web/types/stock';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3135';

const PERIOD_OPTIONS = [
  { klt: 101, label: '日' },
  { klt: 102, label: '周' },
  { klt: 103, label: '月' },
];

interface LabMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  backtestResult?: BacktestResult;
}

interface StrategyIteration {
  id: number;
  name: string;
  description: string;
  metrics: BacktestMetrics;
  result: BacktestResult;
  timestamp: Date;
}

interface StrategyLabProps {
  initialStock?: { code: string; name: string } | null;
}

const INITIAL_SYSTEM_MESSAGE: LabMessage = {
  id: 'system-init',
  role: 'system',
  content: `AI 因子实验室已就绪。我可以帮你：
· 分析股票技术特征，选择最优策略
· 运行回测并展示详细绩效指标
· 优化策略参数（网格搜索）
· 对比多个策略的表现

请先选择一只股票，然后告诉我你想探索什么策略。`,
  timestamp: new Date(),
};

let nextIterationId = 1;

export default function StrategyLab({ initialStock }: StrategyLabProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [stock, setStock] = useState<{ code: string; name: string } | null>(initialStock ?? null);
  const [period, setPeriod] = useState(101);
  const [days] = useState(250);

  // Chat state
  const [messages, setMessages] = useState<LabMessage[]>([INITIAL_SYSTEM_MESSAGE]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  // Strategy evolution
  const [iterations, setIterations] = useState<StrategyIteration[]>([]);
  const [activeIteration, setActiveIteration] = useState<number | null>(null);

  // Search state
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Chat scroll ref
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

  const periodLabel = PERIOD_OPTIONS.find(p => p.klt === period)?.label ?? '日';

  // Best iteration by Sharpe
  const bestIteration = useMemo(() => {
    if (iterations.length === 0) return null;
    return iterations.reduce((best, cur) => cur.metrics.sharpeRatio > best.metrics.sharpeRatio ? cur : best);
  }, [iterations]);

  // Active iteration object
  const selectedIteration = useMemo(() => {
    if (activeIteration === null) return iterations.length > 0 ? iterations[iterations.length - 1] : null;
    return iterations.find(it => it.id === activeIteration) ?? null;
  }, [iterations, activeIteration]);

  // Equity curve comparison chart
  const comparisonChart = useMemo(() => {
    if (iterations.length < 2) return null;
    const colors = ['#38bdf8', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#fb923c'];
    const firstIter = iterations[0];
    const dates = firstIter.result.equityCurve.map(p => p.date);

    const series = iterations.map((iter, idx) => ({
      name: `v${iter.id} ${iter.name}`,
      type: 'line' as const,
      data: iter.result.equityCurve.map(p => p.equity),
      lineStyle: { width: 1.5, color: colors[idx % colors.length] },
      symbol: 'none' as const,
    }));

    return {
      backgroundColor: 'transparent',
      animation: false,
      tooltip: {
        trigger: 'axis' as const,
        backgroundColor: isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        borderColor: isDark ? '#1e293b' : '#e2e8f0',
        textStyle: { color: isDark ? '#e2e8f0' : '#334155', fontSize: 11, fontFamily: 'monospace' },
      },
      legend: {
        data: series.map(s => s.name),
        bottom: 0,
        textStyle: { color: isDark ? '#94a3b8' : '#64748b', fontSize: 10, fontFamily: 'monospace' },
      },
      grid: { left: '10%', right: '5%', top: '8%', bottom: '18%' },
      xAxis: {
        type: 'category' as const,
        data: dates,
        axisLine: { lineStyle: { color: isDark ? '#1e293b' : '#e2e8f0' } },
        axisLabel: {
          color: isDark ? '#94a3b8' : '#64748b',
          fontSize: 10,
          formatter: (v: string) => v.slice(5),
        },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value' as const,
        scale: true,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: true, lineStyle: { color: isDark ? '#1e293b' : '#f1f5f9', type: 'dashed' as const } },
        axisLabel: { color: isDark ? '#94a3b8' : '#64748b', fontSize: 10 },
      },
      series,
      dataZoom: [{ type: 'inside' as const, start: 0, end: 100 }],
    };
  }, [iterations, isDark]);

  // Clean tool output from text
  const cleanToolOutputFromText = (text: string): string => {
    let cleaned = text;
    cleaned = cleaned.replace(/```json\s*\{[\s\S]*?\}\s*```/g, '');
    cleaned = cleaned.replace(/^\{[\s\S]*?"(?:symbol|ticker|klines|kline_data|stock_data|market_cap|pe_ratio|current_price)"[\s\S]*?\}$/gm, '');
    return cleaned.trim();
  };

  // Send message handler
  async function handleSend() {
    if (!input.trim() || isStreaming) return;
    const userMsg = input.trim();
    setInput('');

    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `asst-${Date.now()}`;

    // Add user message + empty assistant placeholder
    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', content: userMsg, timestamp: new Date() },
      { id: assistantMsgId, role: 'assistant', content: '', timestamp: new Date() },
    ]);

    setIsStreaming(true);

    try {
      const systemContext = stock
        ? `当前分析股票: ${stock.name}(${stock.code}), 数据周期: ${periodLabel}, 数据范围: ${days}天。用户正在使用AI因子实验室进行量化策略研究。请积极使用backtest_strategy和optimize_strategy工具来验证策略想法。`
        : '用户正在使用AI因子实验室。请提醒用户先选择一只股票。';

      // Build chat history from messages (excluding system-init and placeholders)
      const chatHistory = messages
        .filter(m => m.id !== 'system-init' && m.content.trim() !== '')
        .map(m => ({ role: m.role, content: m.content }));

      const response = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemContext },
            ...chatHistory,
            { role: 'user', content: userMsg },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`Error: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let fullAssistantMessage = '';
      let sseBuffer = '';

      const processSSELines = (lines: string[]) => {
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const dataStr = line.slice(6);
              const data = JSON.parse(dataStr);

              if (data.type === 'text' && data.content) {
                if (typeof data.content === 'string') {
                  fullAssistantMessage += data.content;
                  setMessages(prev => prev.map(m =>
                    m.id === assistantMsgId
                      ? { ...m, content: cleanToolOutputFromText(fullAssistantMessage) }
                      : m
                  ));
                }
              }

              if (data.type === 'tool_calls' && data.tool_calls) {
                for (const toolCall of data.tool_calls) {
                  if (toolCall.name === 'backtest_strategy' || toolCall.name === 'optimize_strategy') {
                    try {
                      const raw = toolCall.args;
                      const args = typeof raw === 'string' ? JSON.parse(raw) : raw;
                      const strategyName = args?.strategy || args?.name || toolCall.name;
                      const description = args?.description || `${strategyName} 策略回测`;

                      // If there's a result in the toolCall, parse it
                      if (toolCall.result) {
                        const result = typeof toolCall.result === 'string' ? JSON.parse(toolCall.result) : toolCall.result;
                        if (result?.metrics) {
                          const iteration: StrategyIteration = {
                            id: nextIterationId++,
                            name: strategyName,
                            description,
                            metrics: result.metrics,
                            result,
                            timestamp: new Date(),
                          };
                          setIterations(prev => [...prev, iteration]);
                          setActiveIteration(iteration.id);
                        }
                      } else {
                        // Create a placeholder iteration from args
                        const placeholderMetrics: BacktestMetrics = {
                          totalReturn: 0,
                          annualizedReturn: 0,
                          sharpeRatio: 0,
                          maxDrawdown: 0,
                          maxDrawdownDuration: 0,
                          winRate: 0,
                          profitFactor: 0,
                          totalTrades: 0,
                          avgHoldDays: 0,
                          avgWinPnl: 0,
                          avgLossPnl: 0,
                          calmarRatio: 0,
                        };
                        const placeholderResult: BacktestResult = {
                          trades: [],
                          equityCurve: [],
                          metrics: placeholderMetrics,
                          signals: [],
                        };
                        const iteration: StrategyIteration = {
                          id: nextIterationId++,
                          name: strategyName,
                          description,
                          metrics: placeholderMetrics,
                          result: placeholderResult,
                          timestamp: new Date(),
                        };
                        setIterations(prev => [...prev, iteration]);
                        setActiveIteration(iteration.id);
                      }
                    } catch {
                      // ignore parse errors
                    }
                  }
                }
              }

              if (data.type === 'error' && data.content) {
                fullAssistantMessage += `\n\n**错误：** ${data.content}`;
                setMessages(prev => prev.map(m =>
                  m.id === assistantMsgId
                    ? { ...m, content: cleanToolOutputFromText(fullAssistantMessage) }
                    : m
                ));
              }
            } catch {
              // ignore parse errors on incomplete chunks
            }
          }
        }
      };

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;

        if (value) {
          sseBuffer += decoder.decode(value, { stream: true });
          const parts = sseBuffer.split('\n\n');
          sseBuffer = parts.pop() || '';
          const lines = parts.map(p => p.trim()).filter(Boolean);
          processSSELines(lines);
        }
      }

      // Process remaining buffer
      if (sseBuffer.trim()) {
        const remainingLines = sseBuffer.split('\n\n').map(p => p.trim()).filter(Boolean);
        processSSELines(remainingLines);
      }

      // Final cleanup
      const cleanedFinal = cleanToolOutputFromText(fullAssistantMessage);
      if (cleanedFinal !== fullAssistantMessage) {
        setMessages(prev => prev.map(m =>
          m.id === assistantMsgId
            ? { ...m, content: cleanedFinal }
            : m
        ));
      }
    } catch (error) {
      console.error('Strategy Lab send error:', error);
      setMessages(prev => prev.map(m =>
        m.id === assistantMsgId
          ? { ...m, content: (m.content || '') + '\n\n**错误：** 处理请求时发生错误。' }
          : m
      ));
    } finally {
      setIsStreaming(false);
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
  };

  const formatPercent = (val: number) => {
    const pct = (val * 100).toFixed(1);
    return val >= 0 ? `+${pct}%` : `${pct}%`;
  };

  // Current strategy description from latest iteration
  const currentStrategyDesc = useMemo(() => {
    if (iterations.length === 0) return null;
    const latest = iterations[iterations.length - 1];
    return `${latest.name} | ${latest.description}`;
  }, [iterations]);

  return (
    <div className="w-full h-full flex flex-col bg-white/80 dark:bg-[#0a0e17]/50 backdrop-blur-xl border border-slate-200 dark:border-white/5 rounded-xl overflow-hidden shadow-lg dark:shadow-2xl dark:shadow-black/50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/5 bg-white/50 dark:bg-slate-900/30 shrink-0">
        <div className="flex items-center gap-3">
          <FlaskConical className="w-4 h-4 text-violet-500 dark:text-violet-400" />
          <h2 className="text-base font-mono font-bold text-slate-800 dark:text-slate-100">
            AI 因子实验室
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
                onClick={() => setStock(null)}
                className="ml-1 text-cyan-400 hover:text-cyan-600 dark:hover:text-cyan-300"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Period selector */}
          <div className="flex items-center gap-1">
            {PERIOD_OPTIONS.map(opt => (
              <button
                key={opt.klt}
                onClick={() => setPeriod(opt.klt)}
                className={`px-2 py-1 text-[10px] font-mono rounded-md transition-colors ${
                  period === opt.klt
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 font-semibold'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/40 border border-transparent'
                }`}
              >
                {opt.label}
              </button>
            ))}
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
                className="bg-transparent text-xs font-mono text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 outline-none w-28"
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
      </div>

      {/* Main split panel */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left panel: Chat */}
        <div className="w-[40%] flex flex-col border-r border-slate-200 dark:border-white/5">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.map(msg => (
              <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : msg.role === 'system' ? 'items-center' : 'items-start'}`}>
                {msg.role === 'system' ? (
                  <div className="max-w-[90%] text-[11px] font-mono text-slate-400 dark:text-slate-500 whitespace-pre-line text-center px-3 py-2">
                    {msg.content}
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5 mb-1 px-1">
                      <span className={`text-[10px] font-mono ${
                        msg.role === 'user'
                          ? 'text-blue-500 dark:text-blue-400'
                          : 'text-violet-500 dark:text-violet-400'
                      }`}>
                        {msg.role === 'user' ? '用户' : 'AI Lab'}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 dark:text-slate-600" suppressHydrationWarning>
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>
                    <div className={`max-w-[90%] rounded-lg px-3 py-2 text-xs font-mono leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-blue-50 dark:bg-blue-900/20 text-slate-700 dark:text-slate-300 border border-blue-200 dark:border-blue-500/20'
                        : 'bg-slate-50 dark:bg-[#0a0e17]/80 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/5'
                    }`}>
                      {msg.content || (isStreaming && msg.role === 'assistant' ? (
                        <span className="flex items-center gap-1.5 text-slate-400">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          思考中...
                        </span>
                      ) : null)}
                    </div>
                  </>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className="p-3 border-t border-slate-200 dark:border-white/5 bg-slate-50/50 dark:bg-slate-900/20 shrink-0">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={stock ? '描述你想测试的策略...' : '请先选择一只股票...'}
                disabled={isStreaming}
                className="flex-1 bg-white dark:bg-[#0a0e17] border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 outline-none focus:border-violet-400 dark:focus:border-violet-600 transition-colors"
                autoComplete="off"
                spellCheck="false"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isStreaming}
                className="p-2 rounded-lg bg-violet-500 hover:bg-violet-600 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white disabled:text-slate-500 transition-colors"
              >
                {isStreaming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Right panel: Results */}
        <div className="w-[60%] flex flex-col overflow-y-auto p-4 gap-4">
          {iterations.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <FlaskConical className="w-10 h-10 text-slate-200 dark:text-slate-700" />
              <span className="text-xs font-mono text-slate-400 dark:text-slate-500 text-center">
                与 AI 对话来探索策略<br />回测结果将在这里展示
              </span>
            </div>
          ) : (
            <>
              {/* Latest/Selected Result Card */}
              {selectedIteration && (
                <div className="rounded-lg border border-slate-200 dark:border-white/5 bg-white/50 dark:bg-slate-900/30 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-violet-500" />
                      <span className="text-sm font-mono font-semibold text-slate-800 dark:text-slate-100">
                        {selectedIteration.name}
                      </span>
                      {bestIteration && selectedIteration.id === bestIteration.id && (
                        <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                      )}
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                      v{selectedIteration.id}
                    </span>
                  </div>

                  {/* Metrics grid */}
                  <div className="grid grid-cols-3 gap-2">
                    <MetricCard
                      label="总收益"
                      value={formatPercent(selectedIteration.metrics.totalReturn)}
                      positive={selectedIteration.metrics.totalReturn >= 0}
                      isDark={isDark}
                    />
                    <MetricCard
                      label="夏普比率"
                      value={selectedIteration.metrics.sharpeRatio.toFixed(2)}
                      positive={selectedIteration.metrics.sharpeRatio >= 1}
                      isDark={isDark}
                    />
                    <MetricCard
                      label="最大回撤"
                      value={formatPercent(selectedIteration.metrics.maxDrawdown)}
                      positive={false}
                      isDark={isDark}
                    />
                    <MetricCard
                      label="胜率"
                      value={`${(selectedIteration.metrics.winRate * 100).toFixed(1)}%`}
                      positive={selectedIteration.metrics.winRate >= 0.5}
                      isDark={isDark}
                    />
                    <MetricCard
                      label="交易次数"
                      value={`${selectedIteration.metrics.totalTrades}`}
                      neutral
                      isDark={isDark}
                    />
                    <MetricCard
                      label="盈亏比"
                      value={selectedIteration.metrics.profitFactor === Infinity ? 'Inf' : selectedIteration.metrics.profitFactor.toFixed(2)}
                      positive={selectedIteration.metrics.profitFactor >= 1.5}
                      isDark={isDark}
                    />
                  </div>
                </div>
              )}

              {/* Strategy Evolution History */}
              <div className="rounded-lg border border-slate-200 dark:border-white/5 bg-white/50 dark:bg-slate-900/30 p-3">
                <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                  策略进化历史
                </div>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {iterations.map(iter => (
                    <button
                      key={iter.id}
                      onClick={() => setActiveIteration(iter.id)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-mono transition-colors ${
                        (activeIteration === iter.id || (activeIteration === null && iter.id === iterations[iterations.length - 1].id))
                          ? 'bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700/40'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/30 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 dark:text-slate-400">v{iter.id}</span>
                        <span className="text-slate-700 dark:text-slate-200 font-semibold truncate max-w-[120px]">
                          {iter.name}
                        </span>
                        {bestIteration && iter.id === bestIteration.id && (
                          <Star className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[10px]">
                        <span className={`${iter.metrics.sharpeRatio >= 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                          S:{iter.metrics.sharpeRatio.toFixed(2)}
                        </span>
                        <span className={`${iter.metrics.totalReturn >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                          {formatPercent(iter.metrics.totalReturn)}
                        </span>
                        <span className="text-red-500 dark:text-red-400">
                          {formatPercent(iter.metrics.maxDrawdown)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Equity Curve Comparison */}
              {comparisonChart && (
                <div className="rounded-lg border border-slate-200 dark:border-white/5 bg-white/50 dark:bg-slate-900/30 p-3">
                  <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                    收益曲线对比
                  </div>
                  <div className="h-48">
                    <ReactECharts
                      option={comparisonChart}
                      style={{ height: '100%', width: '100%' }}
                      opts={{ renderer: 'canvas' }}
                      notMerge={true}
                    />
                  </div>
                </div>
              )}

              {/* Single iteration equity curve when no comparison */}
              {!comparisonChart && selectedIteration && selectedIteration.result.equityCurve.length > 0 && (
                <div className="rounded-lg border border-slate-200 dark:border-white/5 bg-white/50 dark:bg-slate-900/30 p-3">
                  <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                    收益曲线
                  </div>
                  <div className="h-48">
                    <ReactECharts
                      option={buildEquityCurveChart(selectedIteration.result, isDark)}
                      style={{ height: '100%', width: '100%' }}
                      opts={{ renderer: 'canvas' }}
                      notMerge={true}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Bottom bar */}
      {currentStrategyDesc && (
        <div className="px-4 py-2 border-t border-slate-200 dark:border-white/5 bg-slate-50/50 dark:bg-slate-900/20 shrink-0">
          <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500 dark:text-slate-400">
            <FlaskConical className="w-3 h-3 text-violet-400" />
            <span>当前策略: {currentStrategyDesc}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Metric card sub-component
function MetricCard({
  label,
  value,
  positive,
  neutral,
  isDark,
}: {
  label: string;
  value: string;
  positive?: boolean;
  neutral?: boolean;
  isDark: boolean;
}) {
  const valueColor = neutral
    ? 'text-slate-700 dark:text-slate-200'
    : positive
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-red-500 dark:text-red-400';

  return (
    <div className="rounded-md border border-slate-100 dark:border-white/[0.03] bg-slate-50/50 dark:bg-slate-800/20 px-3 py-2">
      <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 mb-0.5">
        {label}
      </div>
      <div className={`text-sm font-mono font-semibold ${valueColor}`}>
        {value}
      </div>
    </div>
  );
}
