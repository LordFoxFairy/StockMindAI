import type {
  OHLCVItem,
  MACDResult,
  BollingerResult,
  KDJResult,
  MACrossResult,
  CrossSignal,
} from './indicators';
import { fixedFractionalSize, kellySize, atrSize } from './positionSizing';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface TradeSignal {
  date: string;
  action: 'buy' | 'sell' | 'hold';
  price: number;
  reason?: string;
}

export interface Trade {
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
  holdDays: number;
  side: 'long' | 'short';
  exitReason?: string;
}

export interface BacktestMetrics {
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  maxDrawdownDuration: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  avgHoldDays: number;
  avgWinPnl: number;
  avgLossPnl: number;
  calmarRatio: number;
}

export interface EquityPoint {
  date: string;
  equity: number;
  drawdown: number;
  benchmark: number;
}

export interface BacktestResult {
  trades: Trade[];
  equityCurve: EquityPoint[];
  metrics: BacktestMetrics;
  signals: TradeSignal[];
}

export interface StopLossConfig {
  type: 'percent' | 'atr' | 'trailing';
  value: number;
}

export interface TakeProfitConfig {
  type: 'percent';
  value: number;
}

export interface PositionSizingConfig {
  type: 'full' | 'fixed_fraction' | 'kelly' | 'atr';
  riskPercent?: number;
  kellyFraction?: number;
}

export interface BacktestConfig {
  initialCapital?: number;
  commission?: number;
  slippage?: number;
  stampDuty?: number;
  stopLoss?: StopLossConfig;
  takeProfit?: TakeProfitConfig;
  maxHoldDays?: number;
  positionSizing?: PositionSizingConfig;
}

// ─── Core backtest engine ─────────────────────────────────────────────────────

export function runBacktest(
  klineData: OHLCVItem[],
  signals: TradeSignal[],
  config?: BacktestConfig,
): BacktestResult {
  const initialCapital = config?.initialCapital ?? 100000;
  const commission = config?.commission ?? 0.0003;
  const slippage = config?.slippage ?? 0.001;
  const stampDuty = config?.stampDuty ?? 0.001;
  const stopLoss = config?.stopLoss;
  const takeProfit = config?.takeProfit;
  const maxHoldDays = config?.maxHoldDays;

  // Build a signal lookup by date for O(1) access
  const signalMap = new Map<string, TradeSignal>();
  for (const s of signals) {
    if (s.action !== 'hold') {
      signalMap.set(s.date, s);
    }
  }

  let cash = initialCapital;
  let shares = 0;
  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [];

  // Track open position
  let entryDate = '';
  let entryPrice = 0;
  let entryIdx = -1;
  let trailingStopPrice = 0; // for trailing stop

  // Benchmark: buy-and-hold from first day
  const firstClose = klineData[0]?.close ?? 1;

  // For max drawdown duration tracking
  let peak = initialCapital;
  let maxDD = 0;
  let maxDDDuration = 0;
  let ddStartIdx = -1; // cached index for O(1) drawdown duration

  // Helper: compute ATR at bar index (14-period)
  function computeATR(idx: number, period = 14): number {
    if (idx < 1) return 0;
    let sum = 0;
    let count = 0;
    for (let j = Math.max(1, idx - period + 1); j <= idx; j++) {
      const h = klineData[j].high;
      const l = klineData[j].low;
      const cp = klineData[j - 1].close;
      const tr = Math.max(h - l, Math.abs(h - cp), Math.abs(l - cp));
      sum += tr;
      count++;
    }
    return count > 0 ? sum / count : 0;
  }

  // Helper: calculate shares based on position sizing (delegates to positionSizing module)
  function calcShares(price: number, barIdx: number): number {
    const sizing = config?.positionSizing;
    // Account for commission in effective price
    const effectivePrice = price * (1 + commission);

    if (!sizing || sizing.type === 'full') {
      return Math.floor(cash / effectivePrice);
    }

    const riskPct = sizing.riskPercent ?? 0.02;

    if (sizing.type === 'fixed_fraction') {
      const slPct = stopLoss?.type === 'percent' ? stopLoss.value : 0.05;
      const result = fixedFractionalSize(
        { capital: cash, price: effectivePrice, stopLossPercent: slPct },
        riskPct,
      );
      return result.shares;
    }

    if (sizing.type === 'kelly') {
      const frac = sizing.kellyFraction ?? 0.5;
      if (trades.length < 5) {
        // Not enough data for Kelly, use 10% of capital
        return Math.floor((cash * 0.1) / effectivePrice);
      }
      const wins = trades.filter(t => t.pnl > 0);
      const losses = trades.filter(t => t.pnl <= 0);
      const winRate = wins.length / trades.length;
      const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + Math.abs(t.pnlPercent), 0) / wins.length : 0;
      const avgLoss = losses.length > 0 ? -(losses.reduce((s, t) => s + Math.abs(t.pnlPercent), 0) / losses.length) : -0.01;
      const result = kellySize(
        { capital: cash, price: effectivePrice, winRate, avgWin, avgLoss },
        frac,
      );
      // Cap at 25% of capital
      const maxShares = Math.floor((cash * 0.25) / effectivePrice);
      return Math.min(result.shares, maxShares);
    }

    if (sizing.type === 'atr') {
      const atr = computeATR(barIdx);
      if (atr <= 0) return Math.floor((cash * 0.1) / effectivePrice);
      const result = atrSize(
        { capital: cash, price: effectivePrice, atr },
        riskPct,
        2,
      );
      return result.shares;
    }

    return Math.floor(cash / effectivePrice);
  }

  // Helper: close position
  function closePosition(i: number, exitPrice: number, exitReason: string) {
    const proceeds = shares * exitPrice;
    const commissionCost = proceeds * commission;
    const stampCost = proceeds * stampDuty;
    cash += proceeds - commissionCost - stampCost;

    const entryCost = shares * entryPrice * (1 + commission);
    const exitProceeds = proceeds - commissionCost - stampCost;
    const tradePnl = exitProceeds - entryCost;
    const tradePnlPercent = entryCost > 0 ? tradePnl / entryCost : 0;

    const holdDays = entryIdx >= 0 ? i - entryIdx : 0;

    trades.push({
      entryDate,
      entryPrice,
      exitDate: klineData[i].date,
      exitPrice,
      pnl: +tradePnl.toFixed(2),
      pnlPercent: +tradePnlPercent.toFixed(6),
      holdDays,
      side: 'long',
      exitReason,
    });

    shares = 0;
    entryDate = '';
    entryPrice = 0;
    entryIdx = -1;
    trailingStopPrice = 0;
  }

  for (let i = 0; i < klineData.length; i++) {
    const bar = klineData[i];

    // ── Check stop-loss / take-profit / max hold BEFORE strategy signals ──
    if (shares > 0) {
      const currentPrice = bar.close;
      const unrealizedPct = (currentPrice - entryPrice) / entryPrice;

      // Stop-loss check
      if (stopLoss) {
        let stopTriggered = false;
        let stopPrice = 0;

        if (stopLoss.type === 'percent') {
          stopPrice = entryPrice * (1 - stopLoss.value);
          if (bar.low <= stopPrice) {
            stopTriggered = true;
            stopPrice = Math.max(bar.low, stopPrice) * (1 - slippage);
          }
        } else if (stopLoss.type === 'atr') {
          const atr = computeATR(i);
          stopPrice = entryPrice - stopLoss.value * atr;
          if (bar.low <= stopPrice) {
            stopTriggered = true;
            stopPrice = Math.max(bar.low, stopPrice) * (1 - slippage);
          }
        } else if (stopLoss.type === 'trailing') {
          // Trailing stop: tracks the highest price since entry
          const highSinceEntry = bar.high;
          if (highSinceEntry > trailingStopPrice / (1 - stopLoss.value) || trailingStopPrice === 0) {
            trailingStopPrice = highSinceEntry * (1 - stopLoss.value);
          }
          if (bar.low <= trailingStopPrice) {
            stopTriggered = true;
            stopPrice = Math.max(bar.low, trailingStopPrice) * (1 - slippage);
          }
        }

        if (stopTriggered) {
          closePosition(i, stopPrice, `止损 (${stopLoss.type})`);
          // Update equity and continue
          const equity = cash + shares * bar.close;
          const benchmarkEquity = initialCapital * (bar.close / firstClose);
          if (equity > peak) { peak = equity; ddStartIdx = -1; }
          const dd = peak > 0 ? (equity - peak) / peak : 0;
          if (dd < 0 && ddStartIdx === -1) ddStartIdx = i;
          if (dd < maxDD) maxDD = dd;
          if (ddStartIdx >= 0 && (i - ddStartIdx) > maxDDDuration) maxDDDuration = i - ddStartIdx;
          equityCurve.push({ date: bar.date, equity: +equity.toFixed(2), drawdown: +dd.toFixed(6), benchmark: +benchmarkEquity.toFixed(2) });
          continue;
        }
      }

      // Take-profit check
      if (takeProfit && takeProfit.type === 'percent') {
        const tpPrice = entryPrice * (1 + takeProfit.value);
        if (bar.high >= tpPrice) {
          const execPrice = Math.min(bar.high, tpPrice) * (1 - slippage);
          closePosition(i, execPrice, '止盈');
          const equity = cash + shares * bar.close;
          const benchmarkEquity = initialCapital * (bar.close / firstClose);
          if (equity > peak) { peak = equity; ddStartIdx = -1; }
          const dd = peak > 0 ? (equity - peak) / peak : 0;
          if (dd < 0 && ddStartIdx === -1) ddStartIdx = i;
          if (dd < maxDD) maxDD = dd;
          if (ddStartIdx >= 0 && (i - ddStartIdx) > maxDDDuration) maxDDDuration = i - ddStartIdx;
          equityCurve.push({ date: bar.date, equity: +equity.toFixed(2), drawdown: +dd.toFixed(6), benchmark: +benchmarkEquity.toFixed(2) });
          continue;
        }
      }

      // Max hold days check
      if (maxHoldDays && entryIdx >= 0 && (i - entryIdx) >= maxHoldDays) {
        const execPrice = bar.close * (1 - slippage);
        closePosition(i, execPrice, `最大持有天数 (${maxHoldDays}天)`);
        const equity = cash + shares * bar.close;
        const benchmarkEquity = initialCapital * (bar.close / firstClose);
        if (equity > peak) { peak = equity; ddStartIdx = -1; }
        const dd = peak > 0 ? (equity - peak) / peak : 0;
        if (dd < 0 && ddStartIdx === -1) ddStartIdx = i;
        if (dd < maxDD) maxDD = dd;
        if (ddStartIdx >= 0 && (i - ddStartIdx) > maxDDDuration) maxDDDuration = i - ddStartIdx;
        equityCurve.push({ date: bar.date, equity: +equity.toFixed(2), drawdown: +dd.toFixed(6), benchmark: +benchmarkEquity.toFixed(2) });
        continue;
      }

      // Update trailing stop with today's high
      if (stopLoss?.type === 'trailing') {
        const newTrailing = bar.high * (1 - stopLoss.value);
        if (newTrailing > trailingStopPrice) {
          trailingStopPrice = newTrailing;
        }
      }
    }

    // ── Process strategy signals ──
    const signal = signalMap.get(bar.date);

    if (signal && signal.action === 'buy' && shares === 0) {
      const execPrice = signal.price * (1 + slippage);
      const maxShares = calcShares(execPrice, i);
      if (maxShares > 0) {
        const cost = maxShares * execPrice;
        const commissionCost = cost * commission;
        cash -= cost + commissionCost;
        shares = maxShares;
        entryDate = bar.date;
        entryPrice = execPrice;
        entryIdx = i;
        trailingStopPrice = stopLoss?.type === 'trailing' ? bar.close * (1 - stopLoss.value) : 0;
      }
    } else if (signal && signal.action === 'sell' && shares > 0) {
      const execPrice = signal.price * (1 - slippage);
      closePosition(i, execPrice, '策略信号');
    }

    // ── Daily equity ──
    const equity = cash + shares * bar.close;
    const benchmarkEquity = initialCapital * (bar.close / firstClose);

    // Drawdown (O(1) — cached ddStartIdx)
    if (equity > peak) {
      peak = equity;
      ddStartIdx = -1;
    }
    const dd = peak > 0 ? (equity - peak) / peak : 0;
    if (dd < 0 && ddStartIdx === -1) {
      ddStartIdx = i;
    }
    if (dd < maxDD) {
      maxDD = dd;
    }
    if (ddStartIdx >= 0) {
      const duration = i - ddStartIdx;
      if (duration > maxDDDuration) {
        maxDDDuration = duration;
      }
    }

    equityCurve.push({
      date: bar.date,
      equity: +equity.toFixed(2),
      drawdown: +dd.toFixed(6),
      benchmark: +benchmarkEquity.toFixed(2),
    });
  }

  // ─── Compute metrics ────────────────────────────────────────────────

  const finalEquity = equityCurve.length > 0
    ? equityCurve[equityCurve.length - 1].equity
    : initialCapital;
  const tradingDays = equityCurve.length;

  const totalReturn = (finalEquity - initialCapital) / initialCapital;
  const annualizedReturn = tradingDays > 0
    ? Math.pow(finalEquity / initialCapital, 252 / tradingDays) - 1
    : 0;

  // Daily returns for Sharpe
  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev > 0) {
      dailyReturns.push((equityCurve[i].equity - prev) / prev);
    }
  }

  const dailyMean = dailyReturns.length > 0
    ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
    : 0;
  const dailyVariance = dailyReturns.length > 1
    ? dailyReturns.reduce((sum, r) => sum + (r - dailyMean) ** 2, 0) / (dailyReturns.length - 1)
    : 0;
  const dailyStd = Math.sqrt(dailyVariance);

  const riskFreeRate = 0.025;
  const sharpeRatio = dailyStd > 0
    ? (annualizedReturn - riskFreeRate) / (dailyStd * Math.sqrt(252))
    : 0;

  // Win/loss stats
  const winningTrades = trades.filter(t => t.pnl > 0);
  const losingTrades = trades.filter(t => t.pnl <= 0);
  const winRate = trades.length > 0 ? winningTrades.length / trades.length : 0;

  const grossProfit = winningTrades.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losingTrades.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

  const avgHoldDays = trades.length > 0
    ? trades.reduce((s, t) => s + t.holdDays, 0) / trades.length
    : 0;
  const avgWinPnl = winningTrades.length > 0
    ? winningTrades.reduce((s, t) => s + t.pnlPercent, 0) / winningTrades.length
    : 0;
  const avgLossPnl = losingTrades.length > 0
    ? losingTrades.reduce((s, t) => s + t.pnlPercent, 0) / losingTrades.length
    : 0;

  const calmarRatio = maxDD < 0
    ? annualizedReturn / Math.abs(maxDD)
    : (annualizedReturn > 0 ? Infinity : 0);

  const metrics: BacktestMetrics = {
    totalReturn: +totalReturn.toFixed(6),
    annualizedReturn: +annualizedReturn.toFixed(6),
    sharpeRatio: +sharpeRatio.toFixed(4),
    maxDrawdown: +maxDD.toFixed(6),
    maxDrawdownDuration: maxDDDuration,
    winRate: +winRate.toFixed(4),
    profitFactor: profitFactor === Infinity ? Infinity : +profitFactor.toFixed(4),
    totalTrades: trades.length,
    avgHoldDays: +avgHoldDays.toFixed(1),
    avgWinPnl: +avgWinPnl.toFixed(6),
    avgLossPnl: +avgLossPnl.toFixed(6),
    calmarRatio: calmarRatio === Infinity ? Infinity : +calmarRatio.toFixed(4),
  };

  return { trades, equityCurve, metrics, signals };
}

// ─── Strategy signal adapters ─────────────────────────────────────────────────

export function macdToSignals(macdResult: MACDResult, klineData: OHLCVItem[]): TradeSignal[] {
  const signals: TradeSignal[] = [];
  const { histogram } = macdResult;

  for (let i = 0; i < klineData.length; i++) {
    const prev = i > 0 ? histogram[i - 1] : null;
    const cur = histogram[i];

    if (cur !== null && cur > 0 && (prev === null || prev <= 0)) {
      signals.push({
        date: klineData[i].date,
        action: 'buy',
        price: klineData[i].close,
        reason: 'MACD柱状图由负转正，金叉买入信号',
      });
    } else if (cur !== null && cur < 0 && (prev !== null && prev >= 0)) {
      signals.push({
        date: klineData[i].date,
        action: 'sell',
        price: klineData[i].close,
        reason: 'MACD柱状图由正转负，死叉卖出信号',
      });
    } else {
      signals.push({
        date: klineData[i].date,
        action: 'hold',
        price: klineData[i].close,
      });
    }
  }

  return signals;
}

export function rsiToSignals(
  rsiData: (number | null)[],
  klineData: OHLCVItem[],
  oversold = 30,
  overbought = 70,
): TradeSignal[] {
  const signals: TradeSignal[] = [];

  for (let i = 0; i < klineData.length; i++) {
    const prev = i > 0 ? rsiData[i - 1] : null;
    const cur = rsiData[i];

    if (prev !== null && cur !== null && prev < oversold && cur >= oversold) {
      signals.push({
        date: klineData[i].date,
        action: 'buy',
        price: klineData[i].close,
        reason: `RSI从超卖区上穿${oversold}，买入信号`,
      });
    } else if (prev !== null && cur !== null && prev > overbought && cur <= overbought) {
      signals.push({
        date: klineData[i].date,
        action: 'sell',
        price: klineData[i].close,
        reason: `RSI从超买区下穿${overbought}，卖出信号`,
      });
    } else {
      signals.push({
        date: klineData[i].date,
        action: 'hold',
        price: klineData[i].close,
      });
    }
  }

  return signals;
}

export function bollingerToSignals(
  bollResult: BollingerResult,
  klineData: OHLCVItem[],
): TradeSignal[] {
  const signals: TradeSignal[] = [];
  const { upper, lower } = bollResult;

  for (let i = 0; i < klineData.length; i++) {
    const curClose = klineData[i].close;
    const prevClose = i > 0 ? klineData[i - 1].close : null;
    const curLower = lower[i];
    const prevLower = i > 0 ? lower[i - 1] : null;
    const curUpper = upper[i];
    const prevUpper = i > 0 ? upper[i - 1] : null;

    if (
      prevClose !== null && prevLower !== null && curLower !== null &&
      prevClose < prevLower && curClose >= curLower
    ) {
      signals.push({
        date: klineData[i].date,
        action: 'buy',
        price: curClose,
        reason: '价格从下方突破布林带下轨，买入信号',
      });
    } else if (
      prevClose !== null && prevUpper !== null && curUpper !== null &&
      prevClose > prevUpper && curClose <= curUpper
    ) {
      signals.push({
        date: klineData[i].date,
        action: 'sell',
        price: curClose,
        reason: '价格从上方跌破布林带上轨，卖出信号',
      });
    } else {
      signals.push({
        date: klineData[i].date,
        action: 'hold',
        price: curClose,
      });
    }
  }

  return signals;
}

export function kdjToSignals(kdjResult: KDJResult, klineData: OHLCVItem[]): TradeSignal[] {
  const signals: TradeSignal[] = [];
  const { k, d } = kdjResult;

  for (let i = 0; i < klineData.length; i++) {
    const prevK = i > 0 ? k[i - 1] : null;
    const prevD = i > 0 ? d[i - 1] : null;
    const curK = k[i];
    const curD = d[i];

    if (
      prevK !== null && prevD !== null && curK !== null && curD !== null &&
      prevK <= prevD && curK > curD && curK < 20
    ) {
      signals.push({
        date: klineData[i].date,
        action: 'buy',
        price: klineData[i].close,
        reason: 'KDJ超卖区金叉（K上穿D且K<20），买入信号',
      });
    } else if (
      prevK !== null && prevD !== null && curK !== null && curD !== null &&
      prevK >= prevD && curK < curD && curK > 80
    ) {
      signals.push({
        date: klineData[i].date,
        action: 'sell',
        price: klineData[i].close,
        reason: 'KDJ超买区死叉（K下穿D且K>80），卖出信号',
      });
    } else {
      signals.push({
        date: klineData[i].date,
        action: 'hold',
        price: klineData[i].close,
      });
    }
  }

  return signals;
}

export function maCrossToSignals(
  crossResult: MACrossResult,
  klineData: OHLCVItem[],
): TradeSignal[] {
  // Build a lookup of CrossSignal by date
  const crossMap = new Map<string, CrossSignal>();
  for (const cs of crossResult.signals) {
    crossMap.set(cs.date, cs);
  }

  const signals: TradeSignal[] = [];

  for (let i = 0; i < klineData.length; i++) {
    const bar = klineData[i];
    const cross = crossMap.get(bar.date);

    if (cross) {
      signals.push({
        date: bar.date,
        action: cross.type === 'golden' ? 'buy' : 'sell',
        price: bar.close,
        reason: cross.type === 'golden'
          ? '均线金叉（短期均线上穿长期均线），买入信号'
          : '均线死叉（短期均线下穿长期均线），卖出信号',
      });
    } else {
      signals.push({
        date: bar.date,
        action: 'hold',
        price: bar.close,
      });
    }
  }

  return signals;
}
