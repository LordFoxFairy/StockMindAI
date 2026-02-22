/**
 * 组合优化插件: 风险平价 (Risk Parity)
 *
 * 目标: 使每个资产的风险贡献 (Risk Contribution) 相等。
 *
 * RC_i = w_i * (Σw)_i / σ_p
 * 约束: RC_i = RC_j for all i, j
 *
 * 风险平价策略在不确定资产预期收益时特别有用，
 * 避免了均值估计误差对组合权重的过大影响。
 *
 * Plugin ID: portfolio.risk-parity
 */

import {
  riskParityOptimize,
  computeMeanReturns,
  computeCovarianceMatrix,
  type PortfolioAsset,
  type PortfolioResult,
} from '../../portfolio';
import { stdDev } from '../../risk';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface RiskParityPluginParams {
  // 风险平价不需要额外参数
}

export interface RiskContribution {
  assetName: string;
  assetCode: string;
  weight: number;
  marginalContribution: number;      // 边际风险贡献
  riskContribution: number;          // 绝对风险贡献
  riskContributionPercent: number;   // 百分比风险贡献
}

export interface RiskParityPluginResult {
  optimal: PortfolioResult;
  riskContributions: RiskContribution[];
  totalRisk: number;
  maxRCDiff: number;                 // 最大风险贡献差异 (衡量平价程度)
  diversificationRatio: number;      // 分散化比率
}

import type { PortfolioPlugin, ParamSchema } from '../types';

// ── 辅助函数 ────────────────────────────────────────────────────────────────

/**
 * 矩阵与向量的乘法
 */
function matVecMul(A: number[][], v: number[]): number[] {
  return A.map(row => row.reduce((sum, aij, j) => sum + aij * v[j], 0));
}

/**
 * 向量点积
 */
function dot(a: number[], b: number[]): number {
  return a.reduce((sum, ai, i) => sum + ai * b[i], 0);
}

// ── Plugin 实现 ──────────────────────────────────────────────────────────────

/**
 * 优化函数: 执行风险平价优化。
 *
 * @param assets 资产列表
 * @param _params 参数 (当前无额外参数)
 * @returns 风险平价组合与风险贡献分析
 */
function optimize(
  assets: PortfolioAsset[],
  _params?: Partial<RiskParityPluginParams>,
): RiskParityPluginResult {
  const n = assets.length;

  if (n === 0) {
    return {
      optimal: { weights: [], expectedReturn: 0, volatility: 0, sharpeRatio: 0 },
      riskContributions: [],
      totalRisk: 0,
      maxRCDiff: 0,
      diversificationRatio: 0,
    };
  }

  // 风险平价优化
  const optimal = riskParityOptimize(assets);

  // 计算风险贡献
  const cov = computeCovarianceMatrix(assets);
  const weights = optimal.weights;
  const Sw = matVecMul(cov, weights);
  const totalVar = dot(weights, Sw);
  const totalVol = Math.sqrt(Math.max(totalVar, 0));

  const riskContributions: RiskContribution[] = [];

  for (let i = 0; i < n; i++) {
    // 边际风险贡献: (Σw)_i / σ_p
    const marginalContribution = totalVol > 0 ? Sw[i] / totalVol : 0;

    // 绝对风险贡献: w_i * (Σw)_i / σ_p
    const riskContribution = weights[i] * marginalContribution;

    // 百分比风险贡献
    const riskContributionPercent = totalVol > 0 ? riskContribution / totalVol : 0;

    riskContributions.push({
      assetName: assets[i].name,
      assetCode: assets[i].code,
      weight: +weights[i].toFixed(6),
      marginalContribution: +marginalContribution.toFixed(6),
      riskContribution: +riskContribution.toFixed(6),
      riskContributionPercent: +riskContributionPercent.toFixed(6),
    });
  }

  // 最大风险贡献差异
  const rcPercents = riskContributions.map(rc => rc.riskContributionPercent);
  const maxRC = Math.max(...rcPercents);
  const minRC = Math.min(...rcPercents);
  const maxRCDiff = maxRC - minRC;

  // 分散化比率: 各资产独立波动率加权之和 / 组合波动率
  const individualVols = assets.map(a => stdDev(a.returns) * Math.sqrt(252));
  const weightedVolSum = weights.reduce((sum, w, i) => sum + w * individualVols[i], 0);
  const diversificationRatio = totalVol > 0 ? weightedVolSum / totalVol : 1;

  return {
    optimal,
    riskContributions,
    totalRisk: +totalVol.toFixed(6),
    maxRCDiff: +maxRCDiff.toFixed(6),
    diversificationRatio: +diversificationRatio.toFixed(4),
  };
}

// ── Plugin 注册 ──────────────────────────────────────────────────────────────

const riskParityPlugin: PortfolioPlugin = {
  id: 'portfolio.risk-parity',
  name: '风险平价',
  category: 'portfolio',
  description: '风险平价策略使每个资产的风险贡献相等。不依赖于预期收益估计，避免了收益率预测误差对组合配置的过大影响。适合长期配置和不确定市场环境。',
  params: [],
  optimize,
};

export default riskParityPlugin;
