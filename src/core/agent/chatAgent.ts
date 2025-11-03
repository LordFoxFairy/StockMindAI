import { createDeepAgent, CompositeBackend, StateBackend, StoreBackend } from "deepagents";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { search } from "duckduckgo-search";

const duckduckgoSearch = tool(
  async ({ query }: { query: string }) => {
    try {
      const results = await search(query, { maxResults: 5 });
      return JSON.stringify(results);
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      return `Error searching: ${errorMessage}`;
    }
  },
  {
    name: "internet_search",
    description: "Search the internet using DuckDuckGo for current events and real-time information.",
    schema: z.object({
      query: z.string().describe("The search query"),
    }),
  }
);

const queryStockData = tool(
  async ({ symbol }: { symbol: string }) => {
    try {
      // Using a free Chinese stock data API example (Sina Finance)
      // Note: this is a simple implementation, you might want to use a more robust API in production
      const cleanSymbol = symbol.toLowerCase().replace(/[^a-z0-9]/g, '');
      const response = await fetch(`https://hq.sinajs.cn/list=${cleanSymbol}`);
      const buffer = await response.arrayBuffer();
      const decoder = new TextDecoder('gbk');
      const text = decoder.decode(buffer);

      // Parse and format the data before returning it to the agent
      // Format: var hq_str_sh600000="浦发银行,10.640,10.660,10.590,10.700,10.530,10.530,10.540,65251648,692992323.000,..."
      const match = text.match(/="(.*?)"/);
      if (match && match[1]) {
        const data = match[1].split(',');
        if (data.length > 30) {
          const parsedData = {
            name: data[0],
            open: parseFloat(data[1]),
            previousClose: parseFloat(data[2]),
            price: parseFloat(data[3]),
            high: parseFloat(data[4]),
            low: parseFloat(data[5]),
            buy: parseFloat(data[6]),
            sell: parseFloat(data[7]),
            volume: parseInt(data[8], 10),
            turnover: parseFloat(data[9]),
            date: data[30],
            time: data[31],
          };

          return JSON.stringify({
            symbol: cleanSymbol,
            ...parsedData,
            _raw: text // Include raw data just in case the model needs fields we didn't parse
          });
        }
      }

      return text;
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      return `Error fetching stock data: ${errorMessage}`;
    }
  },
  {
    name: "query_stock_data",
    description: "Query real-time stock data from Chinese data providers. Use symbol format like 'sh600000' or 'sz000001'.",
    schema: z.object({
      symbol: z.string().describe("The stock symbol to query (e.g., sh600000 or sz000001)"),
    }),
  }
);

const generateEchartsConfigToolSchema = z.object({
  title: z.object({ text: z.string().optional() }).optional(),
  tooltip: z.object({}).passthrough().optional(),
  legend: z.object({ data: z.array(z.string()).optional() }).passthrough().optional(),
  xAxis: z.any().optional(),
  yAxis: z.any().optional(),
  series: z.array(z.object({
    name: z.string().optional(),
    type: z.string(),
    data: z.array(z.any()),
  }).passthrough()),
}).passthrough();

const generateEchartsConfig = tool(
  async (config: z.infer<typeof generateEchartsConfigToolSchema>) => {
    // We just return the config stringified so the agent knows it successfully generated it,
    // while the client will parse the tool call arguments to render the chart.
    return JSON.stringify({ success: true, config });
  },
  {
    name: "generate_echarts_config",
    description: "Generate an ECharts configuration object to display a chart to the user. MUST provide a valid ECharts option object.",
    schema: generateEchartsConfigToolSchema,
  }
);

export const createChatAgent = () => {
  const llm = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL_NAME || "anthropic/claude-3.7-sonnet",
    openAIApiKey: process.env.OPENAI_API_KEY,
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1"
    }
  });

  const agent = createDeepAgent({
    name: "stock-mind-ai",
    model: llm,
    tools: [duckduckgoSearch, queryStockData, generateEchartsConfig],
    systemPrompt: "You are an expert financial and stock market AI assistant. Use tools to find real-time data and always try to visualize your data using the generate_echarts_config tool when appropriate.",
    backend: (config) => new CompositeBackend(
      new StateBackend(config),
      { "/memories/": new StoreBackend(config) }
    ),
  });

  return agent;
};
