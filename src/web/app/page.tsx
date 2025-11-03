'use client';

import React, { useState } from 'react';
import Chat from '@/web/components/Chat';
import StockChart from '@/web/components/StockChart';
import { Activity, BarChart2, Bell, LayoutDashboard, Settings, User } from 'lucide-react';
import { generateId } from 'ai';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content?: string;
  display?: React.ReactNode;
  timestamp: Date;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<'chart' | 'data'>('chart');
  const [chartData, setChartData] = useState<Record<string, unknown> | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'system-1',
      role: 'system',
      content: 'StockMind Terminal v1.0.4. Connection established.',
      timestamp: new Date()
    },
    {
      id: '1',
      role: 'assistant',
      content: 'System initialized. Ready for technical analysis and market queries.\n\nType a command or natural language query, such as:\n* `Analyze TSLA momentum and RSI`\n* `Show MACD divergence on AAPL`\n* `What is the support level for BABA?`',
      timestamp: new Date()
    }
  ]);
  const [isLoading, setIsLoading] = useState(false);

  const handleSendMessage = async (msg: string) => {
    // Optimistically add user message
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
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const response = await fetch(`${apiUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: msg }], // The exact format will depend on what deepagents expects
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

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;

        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const dataStr = line.slice(6);
                const data = JSON.parse(dataStr);

                // Handle different types of messages according to LangChain/deepagents stream format

                // Assuming chunking logic:
                if (data.type === 'text' && data.content) {
                  // Standard content chunks from the model
                  if (typeof data.content === 'string') {
                    fullAssistantMessage += data.content;

                    setMessages(prev => prev.map(m =>
                      m.id === assistantMessageId
                        ? { ...m, content: fullAssistantMessage }
                        : m
                    ));
                  }
                } else if (data.type === 'tool_calls' && data.tool_calls) {
                  // The AI has made a tool call
                  for (const toolCall of data.tool_calls) {
                    if (toolCall.name === 'generate_echarts_config') {
                      try {
                        const config = toolCall.args;
                        if (config) {
                          setChartData(config);
                          setActiveTab('chart');
                        }
                      } catch (e) {
                        console.error("Error parsing tool call args", e);
                      }
                    }
                  }
                } else if (data.kwargs) {
                  // Fallback for older format if it somehow leaks through
                  if (data.kwargs.content) {
                    fullAssistantMessage += data.kwargs.content;
                    setMessages(prev => prev.map(m =>
                        m.id === assistantMessageId
                            ? { ...m, content: fullAssistantMessage }
                            : m
                    ));
                  } else if (data.kwargs.tool_calls) {
                     for (const toolCall of data.kwargs.tool_calls) {
                       if (toolCall.name === 'generate_echarts_config') {
                         try {
                           const config = toolCall.args;
                           if (config) {
                             setChartData(config);
                             setActiveTab('chart');
                           }
                         } catch (e) {
                           console.error("Error parsing tool call args", e);
                         }
                       }
                     }
                  }
                }
              } catch (e) {
                // Ignore parse errors on incomplete chunks or specific non-json lines
                console.error("Parse error on chunk:", e, line);
              }
            }
          }
        }
      }

    } catch (error) {
      console.error("Error submitting message:", error);
      setMessages((prev) => prev.map(m =>
        m.id === assistantMessageId
          ? { ...m, content: (m.content || '') + '\n\n**Error:** An error occurred while processing the request.' }
          : m
      ));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="flex h-screen overflow-hidden bg-[#0a0e17] font-sans selection:bg-cyan-900 selection:text-cyan-50">

      {/* Left Sidebar - Navigation */}
      <aside className="w-16 md:w-20 shrink-0 border-r border-white/5 bg-[#0a0e17]/90 backdrop-blur-xl flex flex-col items-center py-6 z-20">
        <div className="w-10 h-10 rounded-xl bg-cyan-900/50 border border-cyan-800/50 flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.15)] mb-8">
          <Activity className="w-6 h-6 text-cyan-400" />
        </div>

        <nav className="flex-1 flex flex-col gap-6 w-full items-center">
          <button className="p-3 text-cyan-400 bg-cyan-950/30 rounded-xl relative group">
            <LayoutDashboard className="w-5 h-5" />
            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-cyan-400 rounded-r-md"></span>
          </button>

          <button className="p-3 text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 rounded-xl transition-all">
            <BarChart2 className="w-5 h-5" />
          </button>

          <button className="p-3 text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 rounded-xl transition-all">
            <Bell className="w-5 h-5" />
          </button>
        </nav>

        <div className="flex flex-col gap-4 w-full items-center mt-auto">
          <button className="p-3 text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 rounded-xl transition-all">
            <Settings className="w-5 h-5" />
          </button>
          <button className="w-10 h-10 rounded-full bg-[#0a0e17] border m-2 border-white/10 flex items-center justify-center overflow-hidden hover:border-slate-500 transition-colors">
            <User className="w-5 h-5 text-slate-400" />
          </button>
        </div>
      </aside>

      {/* Main Content Area - Chart & Visualization */}
      <div className="flex-1 flex flex-col w-full h-full overflow-hidden relative">
        {/* Ambient background glow */}
        <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-cyan-900/10 rounded-full blur-[120px] pointer-events-none"></div>

        {/* Top Header Placeholder */}
        <header className="flex justify-between items-center h-16 px-6 border-b border-white/5 bg-[#0a0e17]/80 backdrop-blur-xl z-10 shrink-0">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-slate-100">
                StockMind AI
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono tracking-wider bg-cyan-900/30 text-cyan-400 border border-cyan-800/30">TERMINAL v1.0</span>
            </div>

            <div className="h-6 w-px bg-white/10"></div>

            <div className="flex bg-[#0a0e17] p-1 rounded-lg border border-white/5">
              <button
                onClick={() => setActiveTab('chart')}
                className={`px-4 py-1.5 text-xs font-mono rounded-md transition-colors ${activeTab === 'chart' ? 'bg-slate-800/80 text-cyan-400 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
              >
                CHART_VIEW
              </button>
              <button
                onClick={() => setActiveTab('data')}
                className={`px-4 py-1.5 text-xs font-mono rounded-md transition-colors ${activeTab === 'data' ? 'bg-slate-800/80 text-cyan-400 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
              >
                DATA_GRID
              </button>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono bg-[#0a0e17] border border-white/5 rounded-lg text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              MARKET OPEN
            </div>
          </div>
        </header>

        {/* Chart Area */}
        <div className="flex-1 p-4 overflow-hidden relative z-10 font-mono">
          <div className="w-full h-full bg-[#0a0e17]/50 backdrop-blur-xl border border-white/5 rounded-xl overflow-hidden relative flex flex-col items-center justify-center shadow-2xl shadow-black/50">
            {chartData ? (
              <StockChart data={chartData} className="w-full h-full p-4" />
            ) : (
              <>
                <div className="relative group">
                  <div className="absolute -inset-1 bg-cyan-900/30 rounded-2xl blur-md opacity-50 group-hover:opacity-100 transition duration-1000"></div>
                  <div className="relative w-20 h-20 mb-6 rounded-2xl bg-[#0a0e17] border border-white/10 flex items-center justify-center">
                    <Activity className="w-8 h-8 text-cyan-400 opacity-80" />
                  </div>
                </div>
                <h3 className="text-xl font-mono mb-3 text-slate-300 tracking-tight uppercase">System_Ready</h3>
                <p className="text-slate-500 text-center max-w-md text-xs font-mono">
                  &gt; Initialize visualization by entering a ticker symbol or natural language query in the command prompt.
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Right Sidebar - Chat Interface */}
      <div className="w-[500px] shrink-0 h-full border-l border-white/5 bg-[#0a0e17]/90 backdrop-blur-xl z-20 transition-all duration-300 transform shadow-[-20px_0_30px_-15px_rgba(0,0,0,0.5)] flex flex-col">
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