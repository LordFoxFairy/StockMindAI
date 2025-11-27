// ── Interfaces ──────────────────────────────────────────────────────────────

export interface RiskMetrics {
  dailyVaR95: number;
  dailyVaR99: number;
  cVaR95: number;
  cVaR99: number;
  annualizedVolatility: number;
  downsideDeviation: number;
  skewness: number;
  kurtosis: number;
  calmarRatio: number;
  sortinoRatio: number;
}

export interface MonteCarloResult {
  paths: number[][];
  finalPrices: number[];
  percentiles: {
    p5: number[];
    p25: number[];
    p50: number[];
    p75: number[];
    p95: number[];
  };
  varFromMC: number;
  cVarFromMC: number;
}

export interface StressScenario {
  name: string;
  description: string;
  shockPercent: number;
}

export interface StressTestResult {
  scenario: StressScenario;
  projectedLoss: number;
  projectedLossPercent: number;
  recoveryDaysEstimate: number;
}

// ── Basic statistics ────────────────────────────────────────────────────────

export function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
}

export function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let sumSq = 0;
  for (let i = 0; i < arr.length; i++) {
    sumSq += (arr[i] - m) ** 2;
  }
  return Math.sqrt(sumSq / arr.length);
}

export function dailyReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  return returns;
}

// ── VaR ─────────────────────────────────────────────────────────────────────

export function historicalVaR(returns: number[], confidence: number): number {
  if (returns.length === 0) return 0;
  const sorted = [...returns].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * (1 - confidence));
  return sorted[Math.max(idx, 0)];
}

const Z_SCORES: Record<number, number> = {
  0.95: 1.645,
  0.99: 2.326,
};

export function parametricVaR(returns: number[], confidence: number): number {
  if (returns.length === 0) return 0;
  const m = mean(returns);
  const s = stdDev(returns);
  const z = Z_SCORES[confidence] ?? 1.645;
  return m - z * s;
}

// ── CVaR (Expected Shortfall) ───────────────────────────────────────────────

export function cVaR(returns: number[], confidence: number): number {
  if (returns.length === 0) return 0;
  const varThreshold = historicalVaR(returns, confidence);
  const tail = returns.filter((r) => r <= varThreshold);
  if (tail.length === 0) return varThreshold;
  return mean(tail);
}

// ── Random normal (Box-Muller) ──────────────────────────────────────────────

function randomNormal(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ── Percentile helper ───────────────────────────────────────────────────────

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

// ── Monte Carlo simulation ─────────────────────────────────────────────────

export function monteCarloSimulation(
  returns: number[],
  days: number,
  simulations: number,
  initialPrice: number,
): MonteCarloResult {
  const mu = mean(returns);
  const sigma = stdDev(returns);
  const dt = 1;
  const drift = (mu - (sigma * sigma) / 2) * dt;
  const diffusion = sigma * Math.sqrt(dt);

  const paths: number[][] = [];
  const finalPrices: number[] = [];

  for (let s = 0; s < simulations; s++) {
    const path: number[] = [initialPrice];
    let price = initialPrice;
    for (let d = 1; d <= days; d++) {
      const z = randomNormal();
      price = price * Math.exp(drift + diffusion * z);
      path.push(price);
    }
    paths.push(path);
    finalPrices.push(price);
  }

  // Build percentile paths
  const p5: number[] = [];
  const p25: number[] = [];
  const p50: number[] = [];
  const p75: number[] = [];
  const p95: number[] = [];

  for (let d = 0; d <= days; d++) {
    const pricesAtDay: number[] = [];
    for (let s = 0; s < simulations; s++) {
      pricesAtDay.push(paths[s][d]);
    }
    p5.push(percentile(pricesAtDay, 5));
    p25.push(percentile(pricesAtDay, 25));
    p50.push(percentile(pricesAtDay, 50));
    p75.push(percentile(pricesAtDay, 75));
    p95.push(percentile(pricesAtDay, 95));
  }

  // VaR and CVaR from MC final distribution (as returns from initial price)
  const mcReturns = finalPrices.map((fp) => (fp - initialPrice) / initialPrice);
  const varFromMC = historicalVaR(mcReturns, 0.95);
  const cVarFromMC = cVaR(mcReturns, 0.95);

  return {
    paths,
    finalPrices,
    percentiles: { p5, p25, p50, p75, p95 },
    varFromMC,
    cVarFromMC,
  };
}

// ── Risk Metrics ────────────────────────────────────────────────────────────

export function calculateRiskMetrics(
  returns: number[],
  annualizedReturn?: number,
  maxDrawdown?: number,
): RiskMetrics {
  const m = mean(returns);
  const s = stdDev(returns);

  // VaR & CVaR
  const dailyVaR95 = historicalVaR(returns, 0.95);
  const dailyVaR99 = historicalVaR(returns, 0.99);
  const cVaR95 = cVaR(returns, 0.95);
  const cVaR99 = cVaR(returns, 0.99);

  // Annualized volatility
  const annualizedVolatility = s * Math.sqrt(252);

  // Downside deviation
  let downsideSumSq = 0;
  let downsideCount = 0;
  for (let i = 0; i < returns.length; i++) {
    if (returns[i] < 0) {
      downsideSumSq += returns[i] * returns[i];
      downsideCount++;
    }
  }
  const downsideDeviation = returns.length > 0
    ? Math.sqrt(downsideSumSq / returns.length)
    : 0;

  // Skewness
  let m3 = 0;
  for (let i = 0; i < returns.length; i++) {
    m3 += (returns[i] - m) ** 3;
  }
  const skewness = returns.length > 0 && s > 0
    ? (m3 / returns.length) / (s ** 3)
    : 0;

  // Excess Kurtosis
  let m4 = 0;
  for (let i = 0; i < returns.length; i++) {
    m4 += (returns[i] - m) ** 4;
  }
  const kurtosis = returns.length > 0 && s > 0
    ? (m4 / returns.length) / (s ** 4) - 3
    : 0;

  // Sortino ratio
  const annRet = annualizedReturn ?? m * 252;
  const riskFreeRate = 0.025;
  const annualizedDownside = downsideDeviation * Math.sqrt(252);
  const sortinoRatio = annualizedDownside > 0
    ? (annRet - riskFreeRate) / annualizedDownside
    : 0;

  // Calmar ratio
  const mdd = maxDrawdown ?? 0;
  const calmarRatio = Math.abs(mdd) > 0
    ? annRet / Math.abs(mdd)
    : 0;

  return {
    dailyVaR95,
    dailyVaR99,
    cVaR95,
    cVaR99,
    annualizedVolatility,
    downsideDeviation,
    skewness,
    kurtosis,
    calmarRatio,
    sortinoRatio,
  };
}

// ── Stress Test ─────────────────────────────────────────────────────────────

export const BUILT_IN_SCENARIOS: StressScenario[] = [
  { name: '2008金融危机', description: '全球金融危机，A股从6124跌至1664', shockPercent: -0.65 },
  { name: '2015股灾', description: '杠杆牛市崩盘，千股跌停', shockPercent: -0.45 },
  { name: '2020疫情冲击', description: 'COVID-19初期市场恐慌', shockPercent: -0.15 },
  { name: '极端黑天鹅', description: '史无前例的极端市场事件', shockPercent: -0.60 },
  { name: '温和调整', description: '正常市场回调周期', shockPercent: -0.10 },
];

export function stressTest(
  currentEquity: number,
  dailyRets: number[],
  scenarios?: StressScenario[],
): StressTestResult[] {
  const scenarioList = scenarios ?? BUILT_IN_SCENARIOS;
  const avgDailyReturn = mean(dailyRets);

  return scenarioList.map((scenario) => {
    const projectedLossPercent = scenario.shockPercent;
    const projectedLoss = currentEquity * projectedLossPercent;

    // Estimate recovery days: how many days at the average daily return
    // to recover from the shock. If avgDailyReturn <= 0, recovery is unlikely.
    let recoveryDaysEstimate: number;
    if (avgDailyReturn <= 0) {
      recoveryDaysEstimate = Infinity;
    } else {
      recoveryDaysEstimate = Math.ceil(
        Math.abs(projectedLossPercent) / avgDailyReturn,
      );
    }

    return {
      scenario,
      projectedLoss,
      projectedLossPercent,
      recoveryDaysEstimate,
    };
  });
}
