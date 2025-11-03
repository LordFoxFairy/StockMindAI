# DeepAgents Backend Configuration

This document demonstrates how to build a multi-agent backend using `deepagents` and `@langchain/anthropic` in a Next.js App Router API endpoint.

## Setup

First, ensure you have the required dependencies installed:

```bash
npm install deepagents @langchain/anthropic @langchain/core @langchain/langgraph @langchain/langgraph-checkpoint zod
```

## API Route Implementation (`src/app/api/chat/route.ts`)

Here is an example setup using `createDeepAgent` with LangChain `tool` functions for HTTP fetching and ECharts configuration, along with a `CompositeBackend` for memory management.

```typescript
import { NextResponse } from 'next/server';
import { createDeepAgent, CompositeBackend, StateBackend, StoreBackend } from 'deepagents';
import { InMemoryStore, MemorySaver } from '@langchain/langgraph';
import { ChatAnthropic } from '@langchain/anthropic';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const store = new InMemoryStore();
const checkpointer = new MemorySaver();

// Tool to fetch stock data from a free Chinese public endpoint
const queryStockData = tool(
  async ({ symbol }) => {
    try {
      // e.g. http://qt.gtimg.cn/q=sh600000
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

// Tool to generate ECharts configurations for the frontend
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

// POST route handler
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messages, threadId = 'default-thread' } = body;
    
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Messages array is required' }, { status: 400 });
    }

    // Configure memory via CompositeBackend per LangChain deepagents docs
    const backendFactory = (config: any) => new CompositeBackend(
      new StateBackend(config),
      { "/memories/": new StoreBackend(config) }
    );

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
      backend: backendFactory,
    });

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
