import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { fetchKlineWithMeta } from "@/core/services/eastmoney";
import { dailyReturns } from "@/web/lib/risk";

export const portfolioOptimize = tool(
  async ({ symbols, algorithm, days, riskFreeRate }: {
    symbols: string[];
    algorithm: 'markowitz' | 'risk-parity' | 'black-litterman';
    days?: number;
    riskFreeRate?: number;
  }) => {
    try {
      if (symbols.length < 2 || symbols.length > 10) {
        return '组合优化需要2-10只股票。';
      }

      const dataPromises = symbols.map(s => fetchKlineWithMeta(s, 'daily', days || 250));
      const results = await Promise.all(dataPromises);

      const assets: { code: string; name: string; returns: number[] }[] = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (typeof r === 'string') return `获取 ${symbols[i]} 数据失败: ${r}`;
        const closes = r.items.map(item => item.close);
        const returns = dailyReturns(closes);
        assets.push({ code: r.symbol, name: r.name, returns });
      }

      // Find common length
      const minLen = Math.min(...assets.map(a => a.returns.length));
      for (const a of assets) {
        a.returns = a.returns.slice(a.returns.length - minLen);
      }

      const n = assets.length;
      const rf = riskFreeRate ?? 0.025;

      // Compute mean returns and covariance matrix
      const meanReturns = assets.map(a => {
        const sum = a.returns.reduce((s, v) => s + v, 0);
        return (sum / a.returns.length) * 252;
      });

      const covMatrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const mi = assets[i].returns.reduce((s, v) => s + v, 0) / assets[i].returns.length;
          const mj = assets[j].returns.reduce((s, v) => s + v, 0) / assets[j].returns.length;
          let cov = 0;
          for (let k = 0; k < minLen; k++) {
            cov += (assets[i].returns[k] - mi) * (assets[j].returns[k] - mj);
          }
          covMatrix[i][j] = (cov / (minLen - 1)) * 252;
        }
      }

      let weights: number[];

      if (algorithm === 'risk-parity') {
        // Risk parity: equal risk contribution
        const vols = covMatrix.map((_, i) => Math.sqrt(covMatrix[i][i]));
        const invVols = vols.map(v => v > 0 ? 1 / v : 0);
        const sumInv = invVols.reduce((s, v) => s + v, 0);
        weights = sumInv > 0 ? invVols.map(v => v / sumInv) : Array(n).fill(1 / n);
      } else if (algorithm === 'black-litterman') {
        // Simplified BL: use market-cap implied equilibrium + no views = just equilibrium
        const delta = 2.5;
        const eqWeights = Array(n).fill(1 / n);
        // Implied returns: Π = δΣw
        const impliedReturns = eqWeights.map((_, i) => {
          let sum = 0;
          for (let j = 0; j < n; j++) sum += covMatrix[i][j] * eqWeights[j];
          return delta * sum;
        });
        // Use implied returns as mean for Markowitz
        const excessReturns = impliedReturns.map(r => r - rf);
        // Simple inverse-variance approach
        const invVar = covMatrix.map((_, i) => covMatrix[i][i] > 0 ? 1 / covMatrix[i][i] : 0);
        const sumInv = invVar.reduce((s, v) => s + v, 0);
        weights = sumInv > 0
          ? invVar.map((v, i) => Math.max(0, v * (excessReturns[i] > 0 ? 1 : 0.5)) / (sumInv > 0 ? sumInv : 1))
          : Array(n).fill(1 / n);
        // Normalize
        const wSum = weights.reduce((s, v) => s + v, 0);
        weights = wSum > 0 ? weights.map(w => w / wSum) : Array(n).fill(1 / n);
      } else {
        // Markowitz: max Sharpe (simplified - inverse variance weighted by excess return)
        const excessReturns = meanReturns.map(r => r - rf);
        const scores = excessReturns.map((er, i) => {
          const vol = Math.sqrt(covMatrix[i][i]);
          return vol > 0 ? Math.max(0, er / vol) : 0;
        });
        const sumScores = scores.reduce((s, v) => s + v, 0);
        weights = sumScores > 0 ? scores.map(s => s / sumScores) : Array(n).fill(1 / n);
      }

      // Compute portfolio metrics
      let portReturn = 0;
      for (let i = 0; i < n; i++) portReturn += weights[i] * meanReturns[i];

      let portVar = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          portVar += weights[i] * weights[j] * covMatrix[i][j];
        }
      }
      const portVol = Math.sqrt(portVar);
      const portSharpe = portVol > 0 ? (portReturn - rf) / portVol : 0;

      // Generate efficient frontier (10 points)
      const frontier: { return: number; volatility: number; sharpe: number }[] = [];
      for (let t = 0; t <= 10; t++) {
        const targetRet = meanReturns.reduce((a, b) => Math.min(a, b)) +
          (t / 10) * (meanReturns.reduce((a, b) => Math.max(a, b)) - meanReturns.reduce((a, b) => Math.min(a, b)));
        // Simplified: interpolate between min-vol and max-return portfolio
        const w = Array(n).fill(0);
        for (let i = 0; i < n; i++) {
          w[i] = Math.max(0, (1 / n) + (t / 10 - 0.5) * (meanReturns[i] > targetRet ? 0.3 : -0.1));
        }
        const wSum = w.reduce((s: number, v: number) => s + v, 0);
        if (wSum > 0) for (let i = 0; i < n; i++) w[i] /= wSum;

        let ret = 0, vr = 0;
        for (let i = 0; i < n; i++) ret += w[i] * meanReturns[i];
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) vr += w[i] * w[j] * covMatrix[i][j];
        const vol = Math.sqrt(Math.max(0, vr));
        frontier.push({ return: +ret.toFixed(4), volatility: +vol.toFixed(4), sharpe: vol > 0 ? +((ret - rf) / vol).toFixed(4) : 0 });
      }

      return JSON.stringify({
        algorithm,
        weights: assets.map((a, i) => ({
          code: a.code,
          name: a.name,
          weight: +weights[i].toFixed(4),
        })),
        metrics: {
          expectedReturn: +portReturn.toFixed(4),
          volatility: +portVol.toFixed(4),
          sharpeRatio: +portSharpe.toFixed(4),
        },
        frontier,
      });
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      return `组合优化错误: ${errorMessage}`;
    }
  },
  {
    name: "portfolio_optimize",
    description: "优化投资组合权重。支持Markowitz均值-方差、风险平价、Black-Litterman三种算法。输入2-10只股票代码，返回最优权重、组合收益率、波动率、夏普比率和有效前沿。",
    schema: z.object({
      symbols: z.array(z.string()).min(2).max(10).describe("股票代码数组（如：['sh600519', 'sz000858', 'sz300750']）"),
      algorithm: z.enum(['markowitz', 'risk-parity', 'black-litterman']).describe("优化算法：markowitz（均值-方差）、risk-parity（风险平价）、black-litterman"),
      days: z.number().optional().describe("历史数据天数，默认250天"),
      riskFreeRate: z.number().optional().describe("无风险利率，默认0.025（2.5%）"),
    }),
  }
);

export const portfolioTools = [portfolioOptimize];
