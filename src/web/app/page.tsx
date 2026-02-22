'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Chat from '@/web/components/Chat';
import StockChart from '@/web/components/StockChart';
import StockWatchlist from '@/web/components/StockWatchlist';
import StockDetail from '@/web/components/StockDetail';
import QuantStrategy from '@/web/components/QuantStrategy';
import BacktestPanel from '@/web/components/BacktestPanel';
import StrategyLab from '@/web/components/StrategyLab';
import PredictionPanel from '@/web/components/PredictionPanel';
import ComparePanel from '@/web/components/ComparePanel';
import PortfolioPanel from '@/web/components/PortfolioPanel';
import FactorPanel from '@/web/components/FactorPanel';
import { Activity, BarChart2, Briefcase, GitCompareArrows, LayoutDashboard, Settings, Target, User, Sun, Moon } from 'lucide-react';
import { generateId } from 'ai';
import { useTheme } from '@/web/components/ThemeProvider';

// --- Module-based navigation types & config ---

type ModuleId = 'market' | 'quant' | 'predict' | 'compare' | 'portfolio';

interface ModuleConfig {
  id: ModuleId;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tabs: { id: string; label: string }[];
  defaultTab: string;
}

const MODULES: ModuleConfig[] = [
  {
    id: 'market',
    icon: LayoutDashboard,
    label: '行情中心',
    tabs: [
      { id: 'chart', label: '图表' },
      { id: 'detail', label: '数据' },
      { id: 'watchlist', label: '行情' },
    ],
    defaultTab: 'chart',
  },
  {
    id: 'quant',
    icon: BarChart2,
    label: '量化分析',
    tabs: [
      { id: 'quant', label: '量化' },
      { id: 'backtest', label: '回测' },
      { id: 'lab', label: '实验室' },
    ],
    defaultTab: 'quant',
  },
  {
    id: 'predict',
    icon: Target,
    label: 'AI预测',
    tabs: [
      { id: 'predict', label: '预测' },
    ],
    defaultTab: 'predict',
  },
  {
    id: 'compare',
    icon: GitCompareArrows,
    label: '多股对比',
    tabs: [
      { id: 'compare', label: '对比' },
    ],
    defaultTab: 'compare',
  },
  {
    id: 'portfolio',
    icon: Briefcase,
    label: '组合优化',
    tabs: [
      { id: 'portfolio', label: '组合优化' },
      { id: 'factor', label: '因子分析' },
    ],
    defaultTab: 'portfolio',
  },
];

// --- Message types ---

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content?: string;
  display?: React.ReactNode;
  timestamp: Date;
}

interface SerializedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content?: string;
  timestamp: string;
}

// --- Storage ---

const STORAGE_KEYS = {
  messages: 'stockmind-messages',
  chartData: 'stockmind-chart-data',
  selectedStock: 'stockmind-selected-stock',
  activeTab: 'stockmind-active-tab',
  activeModule: 'stockmind-active-module',
};

const DEFAULT_MESSAGES: Message[] = [
  {
    id: 'system-1',
    role: 'system',
    content: 'StockMind 终端 v1.0.4 连接已建立。',
    timestamp: new Date()
  },
  {
    id: '1',
    role: 'assistant',
    content: '系统已初始化，可以进行技术分析和市场查询。\n\n请输入命令或自然语言查询，例如：\n* `分析贵州茅台的动量和RSI指标`\n* `显示比亚迪的MACD背离`\n* `宁德时代的支撑位在哪里？`',
    timestamp: new Date()
  }
];

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return fallback;
    return JSON.parse(stored) as T;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or unavailable
  }
}

// --- Valid module IDs ---
const ALL_MODULE_IDS: ModuleId[] = MODULES.map(m => m.id);

export default function Home() {
  const [activeModule, setActiveModule] = useState<ModuleId>('market');
  const [activeTab, setActiveTab] = useState<string>('chart');
  const [chartData, setChartData] = useState<Record<string, unknown> | null>(null);
  const [messages, setMessages] = useState<Message[]>(DEFAULT_MESSAGES);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedStock, setSelectedStock] = useState<{ code: string; name: string } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const { theme, toggleTheme } = useTheme();

  // Current module config (derived)
  const currentModule = MODULES.find(m => m.id === activeModule) || MODULES[0];

  // Switch module handler: also sets default tab
  const handleModuleChange = useCallback((moduleId: ModuleId) => {
    const mod = MODULES.find(m => m.id === moduleId);
    if (!mod) return;
    setActiveModule(moduleId);
    setActiveTab(mod.defaultTab);
  }, []);

  // Switch tab handler (within current module)
  const handleTabChange = useCallback((tabId: string) => {
    setActiveTab(tabId);
  }, []);

  // Restore state from localStorage after hydration
  useEffect(() => {
    const savedModule = loadFromStorage<string>(STORAGE_KEYS.activeModule, 'market');
    const savedTab = loadFromStorage<string>(STORAGE_KEYS.activeTab, 'chart');

    // Validate saved module
    const validModule = ALL_MODULE_IDS.includes(savedModule as ModuleId) ? (savedModule as ModuleId) : 'market';
    setActiveModule(validModule);

    // Validate saved tab belongs to the saved module
    const mod = MODULES.find(m => m.id === validModule);
    if (mod && mod.tabs.some(t => t.id === savedTab)) {
      setActiveTab(savedTab);
    } else if (mod) {
      setActiveTab(mod.defaultTab);
    }

    setChartData(loadFromStorage(STORAGE_KEYS.chartData, null));
    setSelectedStock(loadFromStorage(STORAGE_KEYS.selectedStock, null));

    const savedMessages = loadFromStorage<SerializedMessage[] | null>(STORAGE_KEYS.messages, null);
    if (savedMessages && savedMessages.length > 0) {
      setMessages(savedMessages.map(m => ({ ...m, timestamp: new Date(m.timestamp) })));
    }

    setHydrated(true);
  }, []);

  // Persist state changes to localStorage
  useEffect(() => {
    if (!hydrated) return;
    saveToStorage(STORAGE_KEYS.activeModule, activeModule);
  }, [activeModule, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveToStorage(STORAGE_KEYS.activeTab, activeTab);
  }, [activeTab, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveToStorage(STORAGE_KEYS.chartData, chartData);
  }, [chartData, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveToStorage(STORAGE_KEYS.selectedStock, selectedStock);
  }, [selectedStock, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const serializable: SerializedMessage[] = messages.map(({ id, role, content, timestamp }) => ({
      id, role, content, timestamp: timestamp.toISOString(),
    }));
    saveToStorage(STORAGE_KEYS.messages, serializable);
  }, [messages, hydrated]);

  // Remove leaked tool result JSON from assistant text
  const cleanToolOutputFromText = (text: string): string => {
    let cleaned = text;
    const toolOutputPatterns = [
      /```json\s*\{[\s\S]*?\}\s*```/g,
    ];
    for (const pattern of toolOutputPatterns) {
      cleaned = cleaned.replace(pattern, '');
    }
    cleaned = cleaned.replace(/^\{[\s\S]*?"(?:symbol|ticker|klines|kline_data|stock_data|market_cap|pe_ratio|current_price)"[\s\S]*?\}$/gm, '');
    return cleaned.trim();
  };

  const handleSendMessage = async (msg: string) => {
    const userMessageId = generateId();
    const assistantMessageId = generateId();

    setMessages((prev) => [
      ...prev,
      {
        id: userMessageId,
        role: 'user',
        content: msg,
        timestamp: new Date(),
      },
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      }
    ]);

    setIsLoading(true);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3135';
      const response = await fetch(`${apiUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: msg }],
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

              // Handle text content chunks
              if (data.type === 'text' && data.content) {
                if (typeof data.content === 'string') {
                  fullAssistantMessage += data.content;
                  setMessages(prev => prev.map(m =>
                    m.id === assistantMessageId
                      ? { ...m, content: cleanToolOutputFromText(fullAssistantMessage) }
                      : m
                  ));
                }
              }

              // Handle tool calls (complete calls from the server)
              if (data.type === 'tool_calls' && data.tool_calls) {
                for (const toolCall of data.tool_calls) {
                  if (toolCall.name === 'generate_echarts_config') {
                    try {
                      const raw = toolCall.args;
                      const config = typeof raw === 'string' ? JSON.parse(raw) : raw;
                      if (config && Object.keys(config).length > 0) {
                        setChartData(config);
                        setActiveModule('market');
                        setActiveTab('chart');

                        if (!fullAssistantMessage.includes('[图表已生成]')) {
                          fullAssistantMessage += '\n\n*[图表已生成]*';
                          setMessages(prev => prev.map(m =>
                            m.id === assistantMessageId
                              ? { ...m, content: cleanToolOutputFromText(fullAssistantMessage) }
                              : m
                          ));
                        }
                      }
                    } catch (e) {
                      console.error("图表配置解析失败", e);
                    }
                  }
                  // Auto-show stock detail when AI queries stock data
                  if (toolCall.name === 'query_stock_data' || toolCall.name === 'query_stock_kline') {
                    try {
                      const raw = toolCall.args;
                      const args = typeof raw === 'string' ? JSON.parse(raw) : raw;
                      if (args?.symbol) {
                        const symbol = args.symbol as string;
                        setSelectedStock({ code: symbol, name: symbol });
                        setActiveModule('market');
                        setActiveTab('detail');
                      }
                    } catch {
                      // ignore
                    }
                  }
                }
              }

              // Handle error events from server
              if (data.type === 'error' && data.content) {
                fullAssistantMessage += `\n\n**错误：** ${data.content}`;
                setMessages(prev => prev.map(m =>
                  m.id === assistantMessageId
                    ? { ...m, content: cleanToolOutputFromText(fullAssistantMessage) }
                    : m
                ));
              }
            } catch (e) {
              console.error("Parse error on chunk:", e, line);
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

      // Process any remaining data in the buffer after stream ends
      if (sseBuffer.trim()) {
        const remainingLines = sseBuffer.split('\n\n').map(p => p.trim()).filter(Boolean);
        processSSELines(remainingLines);
      }

      // Final cleanup: remove any tool output JSON that leaked across chunks
      const cleanedFinal = cleanToolOutputFromText(fullAssistantMessage);
      if (cleanedFinal !== fullAssistantMessage) {
        fullAssistantMessage = cleanedFinal;
        setMessages(prev => prev.map(m =>
          m.id === assistantMessageId
            ? { ...m, content: fullAssistantMessage }
            : m
        ));
      }

    } catch (error) {
      console.error("Error submitting message:", error);
      setMessages((prev) => prev.map(m =>
        m.id === assistantMessageId
          ? { ...m, content: (m.content || '') + '\n\n**错误：** 处理请求时发生错误。' }
          : m
      ));
    } finally {
      setIsLoading(false);
    }
  };

  // --- Render the content area based on activeTab ---
  const renderContent = () => {
    switch (activeTab) {
      case 'chart':
        return (
          <div className="w-full h-full bg-white/80 dark:bg-[#0a0e17]/50 backdrop-blur-xl border border-slate-200 dark:border-white/5 rounded-xl overflow-hidden relative flex flex-col items-center justify-center shadow-lg dark:shadow-2xl dark:shadow-black/50">
            {chartData ? (
              <StockChart data={chartData} className="w-full h-full p-4" />
            ) : (
              <>
                <div className="relative group">
                  <div className="absolute -inset-1 bg-blue-100 dark:bg-cyan-900/30 rounded-2xl blur-md opacity-50 group-hover:opacity-100 transition duration-1000"></div>
                  <div className="relative w-20 h-20 mb-6 rounded-2xl bg-white dark:bg-[#0a0e17] border border-slate-200 dark:border-white/10 flex items-center justify-center">
                    <Activity className="w-8 h-8 text-blue-500 dark:text-cyan-400 opacity-80" />
                  </div>
                </div>
                <h3 className="text-xl font-mono mb-3 text-slate-700 dark:text-slate-300 tracking-tight uppercase">系统就绪</h3>
                <p className="text-slate-400 dark:text-slate-500 text-center max-w-md text-xs font-mono">
                  &gt; 输入股票代码或自然语言查询以初始化可视化
                </p>
              </>
            )}
          </div>
        );

      case 'detail':
        if (selectedStock) {
          return (
            <StockDetail
              code={selectedStock.code}
              name={selectedStock.name}
              onClose={() => {
                setSelectedStock(null);
                setActiveTab('chart');
              }}
              onAnalyze={(code) => {
                handleSendMessage(`分析 ${selectedStock.name}(${code}) 的股票表现，包括技术面和基本面`);
              }}
            />
          );
        }
        // No stock selected, show placeholder
        return (
          <div className="w-full h-full bg-white/80 dark:bg-[#0a0e17]/50 backdrop-blur-xl border border-slate-200 dark:border-white/5 rounded-xl overflow-hidden relative flex flex-col items-center justify-center shadow-lg dark:shadow-2xl dark:shadow-black/50">
            <div className="relative group">
              <div className="absolute -inset-1 bg-blue-100 dark:bg-cyan-900/30 rounded-2xl blur-md opacity-50 group-hover:opacity-100 transition duration-1000"></div>
              <div className="relative w-20 h-20 mb-6 rounded-2xl bg-white dark:bg-[#0a0e17] border border-slate-200 dark:border-white/10 flex items-center justify-center">
                <Activity className="w-8 h-8 text-blue-500 dark:text-cyan-400 opacity-80" />
              </div>
            </div>
            <h3 className="text-xl font-mono mb-3 text-slate-700 dark:text-slate-300 tracking-tight uppercase">未选择股票</h3>
            <p className="text-slate-400 dark:text-slate-500 text-center max-w-md text-xs font-mono">
              &gt; 请先从行情列表中选择一只股票，或通过AI对话查询
            </p>
          </div>
        );

      case 'watchlist':
        return (
          <StockWatchlist
            onSelectStock={(ticker, name) => {
              setSelectedStock({ code: ticker, name });
              setActiveTab('detail');
            }}
          />
        );

      case 'quant':
        return <QuantStrategy initialStock={selectedStock} />;

      case 'backtest':
        return <BacktestPanel initialStock={selectedStock} />;

      case 'lab':
        return <StrategyLab initialStock={selectedStock} />;

      case 'predict':
        return <PredictionPanel initialStock={selectedStock} />;

      case 'compare':
        return <ComparePanel initialStock={selectedStock} />;

      case 'portfolio':
        return <PortfolioPanel initialStock={selectedStock} />;

      case 'factor':
        return <FactorPanel initialStock={selectedStock} />;

      default:
        return null;
    }
  };

  return (
    <main className="flex h-screen overflow-hidden bg-slate-50 dark:bg-[#0a0e17] font-sans selection:bg-cyan-200 dark:selection:bg-cyan-900 selection:text-cyan-900 dark:selection:text-cyan-50">

      {/* Left Sidebar - Module Navigation */}
      <aside className="w-16 md:w-20 shrink-0 border-r border-slate-200 dark:border-white/5 bg-white dark:bg-[#0a0e17]/90 backdrop-blur-xl flex flex-col items-center py-6 z-20">
        {/* Logo */}
        <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-cyan-900/50 border border-blue-200 dark:border-cyan-800/50 flex items-center justify-center shadow-sm dark:shadow-[0_0_15px_rgba(6,182,212,0.15)] mb-8">
          <Activity className="w-6 h-6 text-blue-600 dark:text-cyan-400" />
        </div>

        {/* Module Icons */}
        <nav className="flex-1 flex flex-col gap-4 w-full items-center">
          {MODULES.map((mod) => {
            const Icon = mod.icon;
            const isActive = activeModule === mod.id;
            return (
              <button
                key={mod.id}
                onClick={() => handleModuleChange(mod.id)}
                title={mod.label}
                className={`p-3 rounded-xl relative group transition-all ${
                  isActive
                    ? 'text-blue-600 dark:text-cyan-400 bg-blue-50 dark:bg-cyan-950/30'
                    : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/50'
                }`}
              >
                <Icon className="w-5 h-5" />
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-blue-600 dark:bg-cyan-400 rounded-r-md"></span>
                )}
                {/* Tooltip */}
                <span className="absolute left-full ml-2 px-2 py-1 text-[10px] font-mono whitespace-nowrap bg-slate-800 dark:bg-slate-700 text-white rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                  {mod.label}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Bottom: theme toggle, settings, user */}
        <div className="flex flex-col gap-4 w-full items-center mt-auto">
          <button
            onClick={toggleTheme}
            className="p-3 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/50 rounded-xl transition-all"
            aria-label="Toggle theme"
          >
            {theme === 'light' ? (
              <Moon className="w-5 h-5" />
            ) : (
              <Sun className="w-5 h-5" />
            )}
          </button>
          <button className="p-3 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/50 rounded-xl transition-all">
            <Settings className="w-5 h-5" />
          </button>
          <button className="w-10 h-10 rounded-full bg-slate-100 dark:bg-[#0a0e17] border m-2 border-slate-200 dark:border-white/10 flex items-center justify-center overflow-hidden hover:border-slate-400 dark:hover:border-slate-500 transition-colors">
            <User className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
        {/* Ambient background glow */}
        <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-blue-100/50 dark:bg-cyan-900/10 rounded-full blur-[120px] pointer-events-none"></div>

        {/* Top Header with Module Label + Tab Bar */}
        <header className="flex justify-between items-center h-16 px-6 border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-[#0a0e17]/80 backdrop-blur-xl z-10 shrink-0">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                StockMind AI
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono tracking-wider bg-blue-100 dark:bg-cyan-900/30 text-blue-600 dark:text-cyan-400 border border-blue-200 dark:border-cyan-800/30">TERMINAL v1.0</span>
            </div>

            <div className="h-6 w-px bg-slate-200 dark:bg-white/10"></div>

            {/* Current module label */}
            <span className="text-sm font-mono text-slate-500 dark:text-slate-400 tracking-wide">
              {currentModule.label}
            </span>

            <div className="h-6 w-px bg-slate-200 dark:bg-white/10"></div>

            {/* Tab bar for current module */}
            <div className="flex bg-slate-100 dark:bg-[#0a0e17] p-1 rounded-lg border border-slate-200 dark:border-white/5">
              {currentModule.tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={`px-4 py-1.5 text-xs font-mono rounded-md transition-colors ${
                    activeTab === tab.id
                      ? 'bg-white dark:bg-slate-800/80 text-blue-600 dark:text-cyan-400 shadow-sm'
                      : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3 items-center">
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono bg-slate-100 dark:bg-[#0a0e17] border border-slate-200 dark:border-white/5 rounded-lg text-emerald-600 dark:text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              市场开盘
            </div>

            {/* Theme Toggle Button (header) */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-slate-800/50 hover:bg-slate-200 dark:hover:bg-slate-700/50 transition-colors"
              aria-label="Toggle theme"
            >
              {theme === 'light' ? (
                <Moon className="w-4 h-4 text-slate-600" />
              ) : (
                <Sun className="w-4 h-4 text-slate-300" />
              )}
            </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 p-4 overflow-hidden relative z-10 font-mono">
          {renderContent()}
        </div>
      </div>

      {/* Right Sidebar - Chat Interface */}
      <div className="w-[500px] shrink-0 h-full border-l border-slate-200 dark:border-white/5 bg-white/90 dark:bg-[#0a0e17]/90 backdrop-blur-xl z-20 transition-all duration-300 transform shadow-lg dark:shadow-[-20px_0_30px_-15px_rgba(0,0,0,0.5)] flex flex-col">
        <Chat
          messages={messages}
          onSendMessage={handleSendMessage}
          isLoading={isLoading}
          className="h-full rounded-none border-none bg-transparent shadow-none"
        />
      </div>

    </main>
  );
}
