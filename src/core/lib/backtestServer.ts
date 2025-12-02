// Server-side backtest helpers — reuse frontend modules
export { runBacktest, macdToSignals, rsiToSignals, bollingerToSignals, kdjToSignals, maCrossToSignals } from '../../web/lib/backtest';
export type { BacktestResult, BacktestConfig, BacktestMetrics, TradeSignal, Trade } from '../../web/lib/backtest';
export { macd, rsi, bollingerBands, kdj, maCross } from '../../web/lib/indicators';
export type { OHLCVItem, MACDResult, BollingerResult, KDJResult, MACrossResult } from '../../web/lib/indicators';
export { calculateRiskMetrics, historicalVaR, cVaR, monteCarloSimulation, stressTest, dailyReturns, BUILT_IN_SCENARIOS } from '../../web/lib/risk';
export type { RiskMetrics, MonteCarloResult, StressTestResult } from '../../web/lib/risk';
export { runPrediction, detectTrend, findSupportResistance, calculateIndicatorSignals, calculateCompositeScore, generatePredictionSummary } from '../../web/lib/predict';
export type { PredictionResult, TrendResult, SupportResistance, IndicatorSignal } from '../../web/lib/predict';
