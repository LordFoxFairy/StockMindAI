/**
 * 组合优化插件: Black-Litterman 模型
 *
 * Black-Litterman 模型将市场均衡收益与投资者主观观点结合，
 * 产生更稳定、更直观的资产配置方案。
 *
 * 步骤:
 * 1. 逆向优化推导隐含均衡收益: Π = δΣw_mkt
 * 2. 融入投资者观点: μ_BL = [(τΣ)⁻¹ + P'Ω⁻¹P]⁻¹[(τΣ)⁻¹Π + P'Ω⁻¹Q]
 * 3. 使用合并收益进行均值-方差优化
 *
 * Plugin ID: portfolio.black-litterman
 */

import {
  blackLittermanOptimize,
  computeMeanReturns,
  computeCovarianceMatrix,
  matInverse,
  matMul,
  matTranspose,
  type PortfolioAsset,
  type PortfolioResult,
} from '../../portfolio';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface BLView {
  assets: number[];         // 资产权重向量 (N维)，如 [1, 0, -1, 0] 表示资产1相对资产3
  expectedReturn: number;   // 预期超额收益
  confidence: number;       // 信心度 (0~1)
}

export interface BlackLittermanPluginParams {
  tau: number;              // 不确定性参数，默认 0.05
  riskAversion: number;     // 风险厌恶系数，默认 2.5
  riskFreeRate: number;     // 无风险利率，默认 0.025
}

export interface ImpliedReturn {
  assetName: string;
  assetCode: string;
  impliedReturn: number;    // 隐含均衡收益
  blReturn: number;         // BL 合并后收益
  difference: number;       // 差异
}

export interface BlackLittermanPluginResult {
  optimal: PortfolioResult;
  impliedReturns: ImpliedReturn[];
  viewsImpact: {
    viewDescription: string;
    priorReturn: number;
    posteriorReturn: number;
    shift: number;
  }[];
  equilibriumWeights: number[];
  posteriorCov: number[][];
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
 * 矩阵加法
 */
function matAdd(A: number[][], B: number[][]): number[][] {
  return A.map((row, i) => row.map((val, j) => val + B[i][j]));
}

/**
 * 标量乘矩阵
 */
function scalarMul(s: number, A: number[][]): number[][] {
  return A.map(row => row.map(val => val * s));
}

/**
 * 权重归一化
 */
function normalizeWeights(w: number[]): number[] {
  const sum = w.reduce((a, b) => a + b, 0);
  if (Math.abs(sum) < 1e-15) return new Array(w.length).fill(1 / w.length);
  return w.map(x => x / sum);
}

// ── Plugin 实现 ──────────────────────────────────────────────────────────────

/**
 * 优化函数: 执行 Black-Litterman 优化。
 *
 * @param assets 资产列表
 * @param params 参数 - views/marketCap 通过 params 传递
 * @returns BL 最优组合与详细分析
 */
function optimize(
  assets: { code: string; name: string; returns: number[]; expectedReturn?: number }[],
  params?: Record<string, any>,
): BlackLittermanPluginResult {
  const n = assets.length;
  const tau = params?.tau ?? 0.05;
  const delta = params?.riskAversion ?? 2.5;
  const riskFreeRate = params?.riskFreeRate ?? 0.025;
  const views: BLView[] = params?.views ?? [];
  const marketCap: number[] | undefined = params?.marketCap;

  if (n === 0) {
    return {
      optimal: { weights: [], expectedReturn: 0, volatility: 0, sharpeRatio: 0 },
      impliedReturns: [],
      viewsImpact: [],
      equilibriumWeights: [],
      posteriorCov: [],
    };
  }

  const cov = computeCovarianceMatrix(assets);

  // 市场权重
  const wMkt = marketCap
    ? normalizeWeights(marketCap)
    : new Array(n).fill(1 / n);

  // 隐含均衡收益: Π = δΣw_mkt
  const pi = matVecMul(cov, wMkt).map(x => x * delta);

  // 调用核心 BL 优化
  const optimal = blackLittermanOptimize(
    assets,
    views.map(v => ({
      assets: v.assets,
      expectedReturn: v.expectedReturn,
      confidence: v.confidence,
    })),
    marketCap,
    riskFreeRate,
    tau,
  );

  // ── 计算 BL 合并收益 (用于详细分析) ────────────────────────────────
  let blReturns: number[];

  if (views.length === 0) {
    blReturns = [...pi];
  } else {
    const K = views.length;

    // P, Q, Omega
    const P: number[][] = views.map(v => v.assets);
    const Q: number[] = views.map(v => v.expectedReturn);
    const Omega: number[][] = Array.from({ length: K }, () => new Array(K).fill(0));

    for (let k = 0; k < K; k++) {
      const pk = P[k];
      const tauSigmaPk = matVecMul(cov, pk).map(x => x * tau);
      const pkVar = pk.reduce((sum, p, i) => sum + p * tauSigmaPk[i], 0);
      const confidenceScale = views[k].confidence > 0 ? (1 / views[k].confidence - 1) : 1;
      Omega[k][k] = Math.max(confidenceScale * pkVar, 1e-10);
    }

    const tauCov = scalarMul(tau, cov);
    const tauCovInv = matInverse(tauCov);
    const OmegaInv = matInverse(Omega);
    const Pt = matTranspose(P);
    const PtOmegaInv = matMul(Pt, OmegaInv);
    const PtOmegaInvP = matMul(PtOmegaInv, P);

    const M = matAdd(tauCovInv, PtOmegaInvP);
    const MInv = matInverse(M);

    const tauCovInvPi = matVecMul(tauCovInv, pi);
    const PtOmegaInvQ = matVecMul(PtOmegaInv, Q);

    const combinedVec = tauCovInvPi.map((v, i) => v + PtOmegaInvQ[i]);
    blReturns = matVecMul(MInv, combinedVec);
  }

  // ── 构建隐含收益对比 ──────────────────────────────────────────────
  const impliedReturns: ImpliedReturn[] = assets.map((asset, i) => ({
    assetName: asset.name,
    assetCode: asset.code,
    impliedReturn: +pi[i].toFixed(6),
    blReturn: +blReturns[i].toFixed(6),
    difference: +(blReturns[i] - pi[i]).toFixed(6),
  }));

  // ── 观点影响分析 ──────────────────────────────────────────────────
  const viewsImpact = views.map((view, k) => {
    // 描述生成
    const longAssets: string[] = [];
    const shortAssets: string[] = [];
    for (let i = 0; i < n; i++) {
      if (view.assets[i] > 0) longAssets.push(assets[i].name);
      if (view.assets[i] < 0) shortAssets.push(assets[i].name);
    }

    let desc: string;
    if (shortAssets.length === 0) {
      desc = `看好 ${longAssets.join('、')}，预期超额收益 ${(view.expectedReturn * 100).toFixed(2)}%`;
    } else {
      desc = `看好 ${longAssets.join('、')} 相对于 ${shortAssets.join('、')}，预期收益差 ${(view.expectedReturn * 100).toFixed(2)}%`;
    }

    // 观点所涉及资产的平均先验和后验收益
    const involvedIndices = view.assets.map((w, i) => ({ w, i })).filter(x => x.w !== 0);
    const priorReturn = involvedIndices.reduce((sum, x) => sum + x.w * pi[x.i], 0);
    const posteriorReturn = involvedIndices.reduce((sum, x) => sum + x.w * blReturns[x.i], 0);

    return {
      viewDescription: desc,
      priorReturn: +priorReturn.toFixed(6),
      posteriorReturn: +posteriorReturn.toFixed(6),
      shift: +(posteriorReturn - priorReturn).toFixed(6),
    };
  });

  // ── 后验协方差矩阵 ──────────────────────────────────────────────
  // Σ_BL = Σ + τΣ (简化：忽略 shrinkage 项)
  const posteriorCov = cov.map((row, i) =>
    row.map((val, j) => +(val * (1 + tau)).toFixed(8)),
  );

  return {
    optimal,
    impliedReturns,
    viewsImpact,
    equilibriumWeights: wMkt.map(w => +w.toFixed(6)),
    posteriorCov,
  };
}

// ── Plugin 注册 ──────────────────────────────────────────────────────────────

const blackLittermanPlugin: PortfolioPlugin = {
  id: 'portfolio.black-litterman',
  name: 'Black-Litterman 模型',
  category: 'portfolio',
  description: 'Black-Litterman 模型将市场均衡收益与投资者主观观点相结合。克服了传统均值-方差优化对收益率估计过度敏感的缺点，产生更稳定、更直观的资产配置方案。适合有明确市场观点的投资者。',
  params: [
    { key: 'tau', label: '不确定性参数 τ', type: 'number', default: 0.05, min: 0.01, max: 0.2, step: 0.01 },
    { key: 'riskAversion', label: '风险厌恶系数', type: 'number', default: 2.5, min: 1, max: 5, step: 0.5 },
    { key: 'riskFreeRate', label: '无风险利率', type: 'number', default: 0.025, min: 0, max: 0.1, step: 0.005 },
  ],
  optimize,
};

export default blackLittermanPlugin;
