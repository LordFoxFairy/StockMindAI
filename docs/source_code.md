# Source Code Dump

## `src/index.ts`
```typescript
console.log('Happy developing ✨')
```

## `src/app/layout.tsx`
```typescript
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StockMind AI - A股分析辅助工具",
  description: "基于大语言模型的中国A股市场可视化分析辅助工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-50">
        {children}
      </body>
    </html>
  );
}
```

## `src/components/StockChart.tsx`
```typescript
import React, { useState } from 'react';
import ReactECharts from 'echarts-for-react';

interface StockChartProps {
  data?: any;
  title?: string;
  className?: string;
}

export default function StockChart({ data, title = 'Stock Chart', className = '' }: StockChartProps) {
  // Demo mock data for empty state
  const mockOption = {
    title: {
      text: title,
      left: 0,
      textStyle: {
        color: '#ccc',
        fontSize: 14
      }
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross'
      }
    },
    grid: [
      {
        left: '10%',
        right: '8%',
        height: '50%'
      },
      {
        left: '10%',
        right: '8%',
        top: '63%',
        height: '16%'
      }
    ],
    xAxis: [
      {
        type: 'category',
        data: ['2023-01', '2023-02', '2023-03', '2023-04', '2023-05', '2023-06', '2023-07'],
        boundaryGap: false,
        axisLine: { onZero: false },
        splitLine: { show: false },
        min: 'dataMin',
        max: 'dataMax',
        axisPointer: {
          z: 100
        }
      },
      {
        type: 'category',
        gridIndex: 1,
        data: ['2023-01', '2023-02', '2023-03', '2023-04', '2023-05', '2023-06', '2023-07'],
        boundaryGap: false,
        axisLine: { onZero: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        min: 'dataMin',
        max: 'dataMax'
      }
    ],
    yAxis: [
      {
        scale: true,
        splitArea: {
          show: true
        }
      },
      {
        scale: true,
        gridIndex: 1,
        splitNumber: 2,
        axisLabel: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false }
      }
    ],
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: [0, 1],
        start: 10,
        end: 100
      },
      {
        show: true,
        xAxisIndex: [0, 1],
        type: 'slider',
        top: '85%',
        start: 10,
        end: 100
      }
    ],
    series: [
      {
        name: 'Candlestick',
        type: 'candlestick',
        data: [
          [20, 34, 10, 38],
          [40, 35, 30, 50],
          [31, 38, 33, 44],
          [38, 15, 5, 42],
          [20, 34, 10, 38],
          [40, 35, 30, 50],
          [31, 38, 33, 44]
        ],
        itemStyle: {
          color: '#ef232a', // Up in Red (China market style)
          color0: '#14b143', // Down in Green
          borderColor: '#ef232a',
          borderColor0: '#14b143'
        }
      },
      {
        name: 'Volume',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: [1000, 2000, 1500, 3000, 1200, 2500, 1800],
        itemStyle: {
          color: '#7fbe9e'
        }
      }
    ]
  };

  const option = data || mockOption;

  return (
    <div className={`w-full h-full bg-white dark:bg-slate-900 rounded-lg p-4 shadow border border-slate-200 dark:border-slate-800 ${className}`}>
      <ReactECharts
        option={option}
        style={{ height: '100%', width: '100%', minHeight: '400px' }}
        opts={{ renderer: 'canvas' }}
        theme="dark" // You can create a custom theme later
      />
    </div>
  );
}
```

## `src/components/Chat.tsx`
```typescript
import React, { useState, useRef, useEffect } from 'react';
import { Send, User, Bot, Loader2, Maximize2, X, PlusCircle } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  chartData?: any;
}

interface ChatProps {
  className?: string;
  onSendMessage?: (msg: string) => void;
  onSelectAction?: (action: string) => void;
}

export default function Chat({ className = '', onSendMessage, onSelectAction }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: '你好！我是 StockMind AI，一个专注大A股市场的投资分析助手。请问你想看哪只股票的信息，或者有什么市场分析需求？\n\n你可以这样问：\n- "查看贵州茅台最近半年的日线及MACD"\n- "帮我分析一下招商银行现在的支撑位在多少"'
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const newMsg = input.trim();
    setInput('');

    // Add user message
    const userMsgId = Date.now().toString();
    setMessages(prev => [...prev, { id: userMsgId, role: 'user', content: newMsg }]);

    setIsLoading(true);

    if (onSendMessage) {
      onSendMessage(newMsg);
    } else {
      // Mock response for testing UI
      setTimeout(() => {
        setMessages(prev => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `我正在查询【${newMsg}】的相关信息... 这是一份示例回复。\n在这个界面中，你将在左侧看到动态渲染的图表，在右侧这里看到详细的文字分析，比如支撑位、压力位、或者指标金叉分析。`,
            chartData: { type: 'Candlestick', symbol: 'mock' }
          }
        ]);
        setIsLoading(false);
      }, 1500);
    }
  };

  const quickActions = [
    "查看贵州茅台走势", "比亚迪近1月分析", "上证指数近期支撑"
  ];

  return (
    <div className={`flex flex-col h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 ${className}`}>

      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Bot className="w-5 h-5 text-blue-500" />
            AI 分析助手
          </h2>
          <p className="text-xs text-slate-500 mt-1">基于 Claude Agent SDK</p>
        </div>
        <button className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors" title="New Chat">
          <PlusCircle className="w-5 h-5 text-slate-500" />
        </button>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
              msg.role === 'user' ? 'bg-blue-100 text-blue-600' : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
            }`}>
              {msg.role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
            </div>
            <div className={`max-w-[85%] rounded-2xl p-4 ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white rounded-tr-sm'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-sm'
            }`}>
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</div>

              {/* Optional Chart Action inside message */}
              {msg.chartData && (
                <div className="mt-3 p-2 bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    📊 图表已生成并在左侧显示
                  </span>
                  <button className="text-blue-500 hover:text-blue-600" title="View Chart">
                    <Maximize2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-3">
            <div className="shrink-0 w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 flex items-center justify-center">
              <Bot className="w-5 h-5" />
            </div>
            <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl rounded-tl-sm p-4 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
              <span className="text-sm text-slate-500">Agent 思考中...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-slate-200 dark:border-slate-800 shrink-0 bg-slate-50 dark:bg-slate-900">
        {/* Quick Actions */}
        {messages.length === 1 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {quickActions.map(action => (
              <button
                key={action}
                onClick={() => setInput(action)}
                className="text-xs px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full hover:border-blue-500 dark:hover:border-blue-500 transition-colors text-slate-600 dark:text-slate-300"
              >
                {action}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="relative flex items-center">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="输入股票代码、名称或分析需求..."
            className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl pl-4 pr-12 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none overflow-hidden max-h-32 text-sm"
            rows={1}
            style={{ minHeight: '44px' }}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="absolute right-2 p-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:dark:bg-slate-700 text-white rounded-lg transition-colors"
          >
            <Send className="w-4 h-4 font-bold" />
          </button>
        </form>
        <div className="text-[10px] text-center text-slate-400 mt-2">
          Shift + Enter 换行，Enter 发送。AI提供的信息仅供参考，不构成投资建议。
        </div>
      </div>
    </div>
  );
}
```

## `src/app/page.tsx`
```typescript
'use client';

import React, { useState } from 'react';
import StockChart from '@/components/StockChart';
import Chat from '@/components/Chat';

export default function Home() {
  const [chartData, setChartData] = useState<any>(null); // Pass config here from Chat

  return (
    <main className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950">

      {/* Main Content Area - Chart & Visualization */}
      <div className="flex-1 flex flex-col p-4 w-full h-full overflow-hidden">

        {/* Top Header Placeholder */}
        <header className="flex justify-between items-center mb-4">
          <div>
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600">
              StockMind AI
            </h1>
            <p className="text-sm text-slate-500 mt-1 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              A股走势分析与预测
            </p>
          </div>

          <div className="flex gap-2">
            <button className="px-3 py-1.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition">
              历史记录
            </button>
            <button className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded shadow-sm hover:bg-blue-700 transition font-medium">
              模型设置
            </button>
          </div>
        </header>

        {/* Chart Area */}
        <div className="flex-1 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden relative">

          {/* Optional Overlay when no chart is active */}
          {!chartData && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-8 bg-slate-50/50 dark:bg-slate-900/50 backdrop-blur-sm z-10">
              <div className="w-16 h-16 mb-4 rounded-xl bg-gradient-to-tr from-blue-500 to-indigo-500 flex items-center justify-center shadow-lg">
                <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold mb-2 text-slate-800 dark:text-slate-100">随时开始分析</h3>
              <p className="text-slate-500 text-center max-w-md">在右侧对话框输入你想查看的A股代码或简称（如：平安银行、sh.600036），AI 将自动提取数据并渲染K线图。</p>
            </div>
          )}

          <StockChart data={chartData} title="A股K线图分析示例" className="h-full border-none shadow-none" />
        </div>
      </div>

      {/* Right Sidebar - Chat Interface */}
      <div className="w-[400px] shrink-0 h-full border-l border-slate-200 dark:border-slate-800 shadow-xl bg-white dark:bg-slate-900 z-20 transition-all duration-300 transform">
        <Chat
          onSendMessage={(msg) => {
            console.log('Sending message to Agent:', msg);
          }}
          className="h-full rounded-none border-none border-l-0 shadow-none"
        />
      </div>

    </main>
  );
}
```

## `src/app/api/chat/route.ts`
```typescript
import { NextResponse } from 'next/server';
import { createDeepAgent, CompositeBackend, StateBackend, StoreBackend } from 'deepagents';
import { InMemoryStore, MemorySaver } from '@langchain/langgraph';
import { ChatAnthropic } from '@langchain/anthropic';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const store = new InMemoryStore();
const checkpointer = new MemorySaver();

const queryStockData = tool(
  async ({ symbol }) => {
    try {
      const response = await fetch(`http://qt.gtimg.cn/q=${symbol}`);
      const text = await response.text();
      return text;
    } catch (e) {
      return `Error fetching stock data: ${e}`;
    }
  },
  {
    name: 'query_stock_data',
    description: 'Fetch real-time stock data for a given Chinese stock symbol (e.g. sh600000 or sz000001)',
    schema: z.object({
      symbol: z.string().describe('The stock symbol to query, e.g. sh600000'),
    })
  }
);

const generateEchartsConfig = tool(
  async ({ title, xAxisData, seriesData, chartType }) => {
    const config = {
      title: { text: title },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: xAxisData },
      yAxis: { type: 'value' },
      series: [{ data: seriesData, type: chartType || 'line' }]
    };
    return JSON.stringify(config);
  },
  {
    name: 'generate_echarts_config',
    description: 'Generate an Apache ECharts configuration object to visualize data and yield it to the frontend.',
    schema: z.object({
      title: z.string().describe('The title of the chart'),
      xAxisData: z.array(z.string()).describe('Labels for the x-axis'),
      seriesData: z.array(z.number()).describe('Data points for the series'),
      chartType: z.enum(['line', 'bar', 'pie']).optional().describe('Type of chart to generate (default: line)'),
    })
  }
);

// We define the agent factory to ensure we create or retrieve one per user session if needed,
// but for stateless API route we can just build one and invoke it. 
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messages, threadId = 'default-thread' } = body;
    
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Messages array is required' }, { status: 400 });
    }

    const agent = await createDeepAgent({
      name: "StockMindAI Analyst",
      model: new ChatAnthropic({
        modelName: "claude-3-7-sonnet-20250219",
        temperature: 0,
      }),
      tools: [queryStockData, generateEchartsConfig],
      systemPrompt: "You are a specialized stock market analyst AI. Your goal is to analyze stock data and generate ECharts configurations to visualize it. When you generate an ECharts configuration, return it via the generate_echarts_config tool.",
      store,
      checkpointer,
      backend: (config) => new CompositeBackend(
        new StateBackend(config),
        { "/memories/": new StoreBackend(config) }
      ),
    });

    // Invoke the agent
    // @ts-ignore - Let's see if this works
    const result = await agent.invoke({
      messages,
    }, {
      configurable: { thread_id: threadId }
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Agent invocation error:', error);
    return NextResponse.json(
      { error: 'An error occurred processing your request', details: error instanceof Error ? error.message : String(error) }, 
      { status: 500 }
    );
  }
}
```

