import { duckduckgoSearch, searchNewsTool, searchStockInfo } from "./search";
import { queryStockData, queryStockKline, queryStockNews, queryStockFundamentals } from "./market";
import { backtestStrategy, optimizeStrategy, predictStock } from "./analysis";
import { compareStocks, riskAnalysis } from "./compare";
import { generateEchartsConfig } from "./chart";
import { portfolioTools } from "./portfolio";
import { factorTools } from "./factor";
import { screeningTools } from "./screening";
import { recommendTools } from "./recommend";

// Grouped tool exports
export const searchTools = [duckduckgoSearch, searchNewsTool, searchStockInfo];
export const marketTools = [queryStockData, queryStockKline, queryStockNews, queryStockFundamentals];
export const analysisTools = [backtestStrategy, optimizeStrategy, predictStock];
export const compareTools = [compareStocks, riskAnalysis];
export const chartTools = [generateEchartsConfig];

export const allTools = [
  ...searchTools,
  ...marketTools,
  ...analysisTools,
  ...compareTools,
  ...chartTools,
  ...portfolioTools,
  ...factorTools,
  ...screeningTools,
  ...recommendTools,
];
