'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Terminal, Loader2, AlertCircle, ChevronRight, Hash } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content?: string;
  display?: React.ReactNode;
  timestamp: Date;
}

interface ChatProps {
  className?: string;
  messages: Message[];
  onSendMessage: (msg: string) => void;
  isLoading: boolean;
}

export default function Chat({ className = '', messages, onSendMessage, isLoading }: ChatProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const newMsg = input.trim();
    setInput('');
    onSendMessage(newMsg);
  };

  // Helper to format time
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className={`flex flex-col h-full bg-transparent ${className}`}>

      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/5 shrink-0 bg-[#0a0e17]/50 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Terminal className="w-5 h-5 text-cyan-400 opacity-80" />
          <div>
            <h2 className="text-xs font-mono text-slate-300 uppercase tracking-widest">Command_&_Control</h2>
             <div className="flex items-center gap-2 mt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <p className="text-[10px] text-slate-400 font-mono">AGENT THREAD: ONLINE</p>
            </div>
          </div>
        </div>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth">
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >

              {/* Message Header Info */}
              <div className="flex items-center gap-2 mb-1.5 px-1">
                {msg.role === 'system' && <AlertCircle className="w-3 h-3 text-emerald-500/70" />}
                {msg.role === 'user' && <span className="text-[10px] text-slate-500 font-mono">{formatTime(msg.timestamp)}</span>}
                <span className={`text-[10px] font-mono uppercase tracking-wider ${
                  msg.role === 'user' ? 'text-blue-400' :
                  msg.role === 'system' ? 'text-emerald-500/70' :
                  'text-cyan-400'
                }`}>
                  {msg.role === 'assistant' ? 'STOCKMIND_AI' : msg.role}
                </span>
                {(msg.role === 'assistant' || msg.role === 'system') && <span className="text-[10px] text-slate-500 font-mono">{formatTime(msg.timestamp)}</span>}
              </div>

              {/* Message Content Bubble */}
              <div className={`max-w-[90%] rounded-lg px-4 py-3 text-sm border font-mono ${
                msg.role === 'user'
                  ? 'bg-blue-900/10 text-slate-300 border-blue-500/20'
                  : msg.role === 'system'
                  ? 'bg-transparent text-slate-500 text-xs pl-0 border-transparent border-l-slate-800 rounded-none border-l-2'
                  : 'bg-[#0a0e17]/80 backdrop-blur-md text-slate-300 border-white/5 shadow-lg'
              }`}>

                {msg.role === 'user' ? (
                  <div className="flex items-start gap-2">
                    <ChevronRight className="w-4 h-4 shrink-0 text-blue-400 mt-0.5" />
                    <span>{msg.content}</span>
                  </div>
                ) : msg.role === 'system' ? (
                  <span>{msg.content}</span>
                ) : (
                  msg.display ? msg.display : (
                    <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-[#0B0E14] prose-pre:border prose-pre:border-slate-800">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content || ''}
                      </ReactMarkdown>
                    </div>
                  )
                )}
              </div>
            </motion.div>
          ))}

          {/* Pending server action UI could be inserted here natively if we pass it directly to messages list, or kept as a separate loading state */}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-white/5 shrink-0 bg-[#0a0e17]/80 backdrop-blur-md">
        <form onSubmit={handleSubmit} className="relative flex items-center group">
          <div className="absolute left-3 flex items-center justify-center p-1 bg-slate-900/50 rounded text-slate-500 group-focus-within:text-cyan-400 transition-colors">
            <Hash className="w-3.5 h-3.5" />
          </div>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter command or query..."
            className="w-full bg-[#0a0e17] border border-white/10 rounded-lg pl-10 pr-12 py-3 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50 text-sm text-slate-200 placeholder:text-slate-600 font-mono transition-all shadow-inner"
            autoComplete="off"
            spellCheck="false"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="absolute right-2 p-1.5 hover:bg-slate-800/80 disabled:hover:bg-transparent text-cyan-500 disabled:text-slate-600 rounded-md transition-colors"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </form>
        <div className="flex justify-between items-center mt-2 px-1">
          <span className="text-[9px] text-slate-500 font-mono uppercase tracking-wider">
            Natural language and compound queries supported
          </span>
          <span className="text-[9px] text-slate-600 font-mono uppercase tracking-wider">
            ↵ to Execute
          </span>
        </div>
      </div>
    </div>
  );
}