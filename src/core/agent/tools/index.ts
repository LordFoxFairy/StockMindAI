import { duckduckgoSearch, searchNewsTool, searchStockInfo } from "./search";
import { queryStockData, queryStockKline, queryStockNews, queryStockFundamentals } from "./market";
import { backtestStrategy, optimizeStrategy, predictStock } from "./analysis";
import { compareStocks, riskAnalysis } from "./compare";
import { generateEchartsConfig } from "./chart";

export const allTools = [
  duckduckgoSearch, queryStockData, queryStockKline, generateEchartsConfig,
  backtestStrategy, optimizeStrategy, predictStock,
  searchNewsTool, searchStockInfo, queryStockNews, queryStockFundamentals,
  compareStocks, riskAnalysis,
];
