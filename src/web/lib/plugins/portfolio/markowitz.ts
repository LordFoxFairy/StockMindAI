/**
 * 组合优化插件: Markowitz 均值-方差优化
 *
 * 基于 Harry Markowitz 现代投资组合理论 (MPT)，
 * 通过最大化夏普比率寻找最优切线组合。
 *
 * 切线组合: w* = Σ⁻¹(μ - rf·1) / 1'Σ⁻¹(μ - rf·1)
 *
 * 同时计算有效前沿以供可视化。
 *
 * Plugin ID: portfolio.markowitz
 */

import {
  markowitzOptimize,
  computeEfficientFrontier,
  computeMeanReturns,
  computeCovarianceMatrix,
  type PortfolioAsset,
  type PortfolioResult,
  type EfficientFrontierPoint,
} from '../../portfolio';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface MarkowitzPluginParams {
  riskFreeRate: number;    // 无风险利率 (年化)，默认 0.025
  minWeight: number;       // 最小权重，默认 0
  maxWeight: number;       // 最大权重，默认 1
  frontierPoints: number;  // 有效前沿点数，默认 50
}

export interface MarkowitzPluginResult {
  optimal: PortfolioResult;
  frontier: EfficientFrontierPoint[];
  assetNames: string[];
  meanReturns: number[];
  correlationMatrix: number[][];
}

import type { PortfolioPlugin, ParamSchema } from '../types';

// ── 辅助函数 ────────────────────────────────────────────────────────────────

/**
 * 从协方差矩阵计算相关系数矩阵。
 */
function covToCorrelation(cov: number[][]): number[][] {
  const n = cov.length;
  const corr: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const vols: number[] = cov.map((_, i) => Math.sqrt(Math.max(cov[i][i], 0)));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (vols[i] > 0 && vols[j] > 0) {
        corr[i][j] = +(cov[i][j] / (vols[i] * vols[j])).toFixed(4);
      } else {
        corr[i][j] = i === j ? 1 : 0;
      }
    }
  }

  return corr;
}

// ── Plugin 实现 ──────────────────────────────────────────────────────────────

/**
 * 优化函数: 执行 Markowitz 优化并计算有效前沿。
 *
 * @param assets 资产列表
 * @param params 参数 (可选)
 * @returns 最优组合与有效前沿
 */
function optimize(
  assets: PortfolioAsset[],
  params?: Partial<MarkowitzPluginParams>,
): MarkowitzPluginResult {
  const riskFreeRate = params?.riskFreeRate ?? 0.025;
  const minWeight = params?.minWeight ?? 0;
  const maxWeight = params?.maxWeight ?? 1;
  const frontierPoints = params?.frontierPoints ?? 50;

  // 最优切线组合
  const optimal = markowitzOptimize(assets, riskFreeRate, { minWeight, maxWeight });

  // 有效前沿
  const frontier = computeEfficientFrontier(assets, frontierPoints, riskFreeRate);

  // 附加信息
  const assetNames = assets.map(a => a.name);
  const meanReturns = computeMeanReturns(assets).map(r => +r.toFixed(6));
  const cov = computeCovarianceMatrix(assets);
  const correlationMatrix = covToCorrelation(cov);

  return {
    optimal,
    frontier,
    assetNames,
    meanReturns,
    correlationMatrix,
  };
}

// ── Plugin 注册 ──────────────────────────────────────────────────────────────

const markowitzPlugin: PortfolioPlugin = {
  id: 'portfolio.markowitz',
  name: 'Markowitz 均值-方差优化',
  category: 'portfolio',
  description: '基于 Markowitz 现代投资组合理论的均值-方差优化。通过最大化夏普比率寻找最优切线组合，同时生成有效前沿供投资者选择不同风险-收益偏好的组合。A 股禁止做空，强制非负权重约束。',
  params: [
    { key: 'riskFreeRate', label: '无风险利率', type: 'number', default: 0.025, min: 0, max: 0.1, step: 0.005 },
    { key: 'minWeight', label: '最小权重', type: 'number', default: 0, min: 0, max: 0.5, step: 0.05 },
    { key: 'maxWeight', label: '最大权重', type: 'number', default: 1, min: 0.1, max: 1, step: 0.05 },
    { key: 'frontierPoints', label: '前沿点数', type: 'number', default: 50, min: 10, max: 100, step: 10 },
  ],
  optimize,
};

export default markowitzPlugin;
