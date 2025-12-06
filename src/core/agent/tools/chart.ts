import { tool } from "@langchain/core/tools";
import { z } from "zod";

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

export const generateEchartsConfig = tool(
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
