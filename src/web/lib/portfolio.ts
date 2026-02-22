/**
 * 投资组合优化库
 *
 * - Markowitz 均值-方差优化 (切线组合)
 * - 有效前沿计算
 * - 风险平价 (Risk Parity)
 * - Black-Litterman 模型
 *
 * 无外部依赖，纯 TypeScript 实现。
 */

import { mean, stdDev } from './risk';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface PortfolioAsset {
  code: string;
  name: string;
  returns: number[];   // 日收益率序列
}

export interface PortfolioResult {
  weights: number[];
  expectedReturn: number;
  volatility: number;
  sharpeRatio: number;
}

export interface EfficientFrontierPoint {
  weights: number[];
  expectedReturn: number;
  volatility: number;
  sharpeRatio: number;
}

// ── 基础统计函数 ─────────────────────────────────────────────────────────────

/**
 * 计算各资产的年化平均收益率。
 */
export function computeMeanReturns(assets: PortfolioAsset[]): number[] {
  return assets.map(a => mean(a.returns) * 252);
}

/**
 * 计算资产收益率的年化协方差矩阵。
 *
 * Cov(i,j) = (1/(T-1)) * sum[(r_it - μ_i)(r_jt - μ_j)] * 252
 */
export function computeCovarianceMatrix(assets: PortfolioAsset[]): number[][] {
  const n = assets.length;
  const means = assets.map(a => mean(a.returns));
  const T = Math.min(...assets.map(a => a.returns.length));
  const cov: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let sum = 0;
      for (let t = 0; t < T; t++) {
        sum += (assets[i].returns[t] - means[i]) * (assets[j].returns[t] - means[j]);
      }
      const covVal = T > 1 ? (sum / (T - 1)) * 252 : 0;
      cov[i][j] = covVal;
      cov[j][i] = covVal;
    }
  }

  return cov;
}

// ── 矩阵运算辅助函数 ────────────────────────────────────────────────────────

/**
 * 矩阵乘法: A (m x p) * B (p x n) -> C (m x n)
 */
export function matMul(A: number[][], B: number[][]): number[][] {
  const m = A.length;
  const p = A[0].length;
  const n = B[0].length;
  const C: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));

  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let k = 0; k < p; k++) {
        sum += A[i][k] * B[k][j];
      }
      C[i][j] = sum;
    }
  }
  return C;
}

/**
 * 矩阵转置
 */
export function matTranspose(A: number[][]): number[][] {
  const m = A.length;
  const n = A[0].length;
  const T: number[][] = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      T[j][i] = A[i][j];
    }
  }
  return T;
}

/**
 * 矩阵求逆 (Gauss-Jordan 消元法)。
 * 适用于小矩阵 (最多 ~10x10)。
 *
 * 如果矩阵不可逆，返回近似单位矩阵的正则化结果。
 */
export function matInverse(A: number[][]): number[][] {
  const n = A.length;

  // 构建增广矩阵 [A | I]
  const aug: number[][] = Array.from({ length: n }, (_, i) => {
    const row = new Array(2 * n).fill(0);
    for (let j = 0; j < n; j++) row[j] = A[i][j];
    row[n + i] = 1;
    return row;
  });

  for (let col = 0; col < n; col++) {
    // 部分主元选取
    let maxVal = Math.abs(aug[col][col]);
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]);
        maxRow = row;
      }
    }

    // 交换行
    if (maxRow !== col) {
      const tmp = aug[col];
      aug[col] = aug[maxRow];
      aug[maxRow] = tmp;
    }

    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) {
      // 近似奇异，添加正则化
      aug[col][col] += 1e-8;
    }

    // 归一化主元行
    const pivotVal = aug[col][col];
    for (let j = 0; j < 2 * n; j++) {
      aug[col][j] /= pivotVal;
    }

    // 消元
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = 0; j < 2 * n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // 提取逆矩阵
  const inv: number[][] = Array.from({ length: n }, (_, i) => {
    return aug[i].slice(n, 2 * n);
  });

  return inv;
}

/**
 * 矩阵与向量的乘法: A (m x n) * v (n x 1) -> result (m x 1)
 */
function matVecMul(A: number[][], v: number[]): number[] {
  const m = A.length;
  const n = A[0].length;
  const result: number[] = new Array(m).fill(0);
  for (let i = 0; i < m; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      sum += A[i][j] * v[j];
    }
    result[i] = sum;
  }
  return result;
}

/**
 * 向量点积
 */
function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * 向量归一化 (使元素之和为 1)
 */
function normalizeWeights(w: number[]): number[] {
  const sum = w.reduce((a, b) => a + b, 0);
  if (Math.abs(sum) < 1e-15) {
    // 等权重
    return new Array(w.length).fill(1 / w.length);
  }
  return w.map(x => x / sum);
}

/**
 * 将权重投影到非负约束 (A 股禁止做空) 并归一化
 */
function projectToConstraints(
  w: number[],
  minWeight: number,
  maxWeight: number,
): number[] {
  const clamped = w.map(x => Math.max(minWeight, Math.min(maxWeight, x)));
  return normalizeWeights(clamped);
}

/**
 * 计算组合波动率: sqrt(w' * Σ * w)
 */
function portfolioVolatility(weights: number[], covMatrix: number[][]): number {
  const Sw = matVecMul(covMatrix, weights);
  const variance = dot(weights, Sw);
  return Math.sqrt(Math.max(variance, 0));
}

/**
 * 计算组合预期收益: w' * μ
 */
function portfolioReturn(weights: number[], meanReturns: number[]): number {
  return dot(weights, meanReturns);
}

// ── Markowitz 均值-方差优化 ─────────────────────────────────────────────────

/**
 * Markowitz 最优切线组合 (最大化夏普比率)。
 *
 * 解析解: w* = Σ⁻¹(μ - rf·1) / 1'Σ⁻¹(μ - rf·1)
 *
 * 对于 A 股市场，强制 w_i >= 0 (禁止做空)，使用迭代投影法。
 *
 * @param assets 资产列表
 * @param riskFreeRate 无风险利率 (年化，默认 2.5%)
 * @param constraints 权重约束
 */
export function markowitzOptimize(
  assets: PortfolioAsset[],
  riskFreeRate = 0.025,
  constraints?: { minWeight?: number; maxWeight?: number },
): PortfolioResult {
  const n = assets.length;
  if (n === 0) {
    return { weights: [], expectedReturn: 0, volatility: 0, sharpeRatio: 0 };
  }
  if (n === 1) {
    const mu = mean(assets[0].returns) * 252;
    const vol = stdDev(assets[0].returns) * Math.sqrt(252);
    const sharpe = vol > 0 ? (mu - riskFreeRate) / vol : 0;
    return { weights: [1], expectedReturn: mu, volatility: vol, sharpeRatio: sharpe };
  }

  const minW = constraints?.minWeight ?? 0;
  const maxW = constraints?.maxWeight ?? 1;

  const mu = computeMeanReturns(assets);
  const cov = computeCovarianceMatrix(assets);

  // 超额收益向量
  const excessReturn = mu.map(m => m - riskFreeRate);

  // 解析切线组合: w_raw = Σ⁻¹ * (μ - rf)
  const covInv = matInverse(cov);
  const wRaw = matVecMul(covInv, excessReturn);

  // 归一化使 sum(w) = 1
  let weights = normalizeWeights(wRaw);

  // 如果存在负权重，使用迭代投影法
  if (weights.some(w => w < minW) || weights.some(w => w > maxW)) {
    weights = iterativeProjection(mu, cov, riskFreeRate, minW, maxW, 200);
  }

  const expRet = portfolioReturn(weights, mu);
  const vol = portfolioVolatility(weights, cov);
  const sharpe = vol > 0 ? (expRet - riskFreeRate) / vol : 0;

  return {
    weights: weights.map(w => +w.toFixed(6)),
    expectedReturn: +expRet.toFixed(6),
    volatility: +vol.toFixed(6),
    sharpeRatio: +sharpe.toFixed(4),
  };
}

/**
 * 迭代投影法求解带约束的最大夏普比率组合。
 *
 * 在每次迭代中:
 * 1. 计算无约束梯度方向
 * 2. 沿梯度方向更新权重
 * 3. 投影到约束集合 [minW, maxW] 并归一化
 * 4. 重复直到收敛
 */
function iterativeProjection(
  mu: number[],
  cov: number[][],
  riskFreeRate: number,
  minW: number,
  maxW: number,
  maxIter: number,
): number[] {
  const n = mu.length;

  // 初始化等权重
  let weights = new Array(n).fill(1 / n);
  let bestSharpe = -Infinity;
  let bestWeights = [...weights];

  for (let iter = 0; iter < maxIter; iter++) {
    const vol = portfolioVolatility(weights, cov);
    if (vol < 1e-15) break;

    // 计算梯度 d(Sharpe)/dw
    // Sharpe = (w'μ - rf) / sqrt(w'Σw)
    // ∂Sharpe/∂w = (μ * vol - (w'μ - rf) * Σw / vol) / vol²
    const ret = portfolioReturn(weights, mu);
    const Sw = matVecMul(cov, weights);
    const sharpe = (ret - riskFreeRate) / vol;

    if (sharpe > bestSharpe) {
      bestSharpe = sharpe;
      bestWeights = [...weights];
    }

    const gradient: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      gradient[i] = (mu[i] * vol - (ret - riskFreeRate) * Sw[i] / vol) / (vol * vol);
    }

    // 自适应步长
    const gradNorm = Math.sqrt(gradient.reduce((s, g) => s + g * g, 0));
    if (gradNorm < 1e-12) break;

    const stepSize = 0.01 / (1 + iter * 0.01);

    // 更新权重
    const newW: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      newW[i] = weights[i] + stepSize * gradient[i];
    }

    // 投影到约束
    weights = projectToConstraints(newW, minW, maxW);
  }

  return bestWeights;
}

// ── 有效前沿 ────────────────────────────────────────────────────────────────

/**
 * 给定目标收益率，求解最小方差组合。
 *
 * min  w'Σw
 * s.t. w'μ = targetReturn
 *      w'1 = 1
 *      w_i ∈ [minW, maxW]
 *
 * 使用二次优化的迭代梯度投影法。
 */
function minVarianceForTarget(
  mu: number[],
  cov: number[][],
  targetReturn: number,
  minW: number,
  maxW: number,
  maxIter = 300,
): number[] {
  const n = mu.length;
  let weights = new Array(n).fill(1 / n);

  // 使用拉格朗日乘子法的梯度投影
  let lambda = 0; // 收益率约束的拉格朗日乘子

  for (let iter = 0; iter < maxIter; iter++) {
    // 梯度: ∂L/∂w = 2Σw - λμ
    const Sw = matVecMul(cov, weights);
    const currentReturn = dot(weights, mu);

    // 更新 lambda 使得收益率约束满足
    lambda += 0.5 * (targetReturn - currentReturn);

    const gradient: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      gradient[i] = 2 * Sw[i] - lambda * mu[i];
    }

    const gradNorm = Math.sqrt(gradient.reduce((s, g) => s + g * g, 0));
    if (gradNorm < 1e-12) break;

    const stepSize = 0.001 / (1 + iter * 0.005);

    const newW: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      newW[i] = weights[i] - stepSize * gradient[i];
    }

    weights = projectToConstraints(newW, minW, maxW);
  }

  return weights;
}

/**
 * 计算有效前沿。
 *
 * 在最小收益率到最大收益率之间均匀取 `points` 个目标收益率，
 * 对每个目标求解最小方差组合。
 *
 * @param assets 资产列表
 * @param points 前沿点数 (默认 50)
 * @param riskFreeRate 无风险利率 (年化)
 */
export function computeEfficientFrontier(
  assets: PortfolioAsset[],
  points = 50,
  riskFreeRate = 0.025,
): EfficientFrontierPoint[] {
  const n = assets.length;
  if (n === 0) return [];

  const mu = computeMeanReturns(assets);
  const cov = computeCovarianceMatrix(assets);

  // 单资产收益率范围
  const minReturn = Math.min(...mu);
  const maxReturn = Math.max(...mu);

  // 扩展范围
  const range = maxReturn - minReturn;
  const startReturn = minReturn - range * 0.05;
  const endReturn = maxReturn + range * 0.05;
  const step = (endReturn - startReturn) / (points - 1);

  const frontier: EfficientFrontierPoint[] = [];

  for (let i = 0; i < points; i++) {
    const targetReturn = startReturn + step * i;
    const weights = minVarianceForTarget(mu, cov, targetReturn, 0, 1);
    const expRet = portfolioReturn(weights, mu);
    const vol = portfolioVolatility(weights, cov);
    const sharpe = vol > 0 ? (expRet - riskFreeRate) / vol : 0;

    frontier.push({
      weights: weights.map(w => +w.toFixed(6)),
      expectedReturn: +expRet.toFixed(6),
      volatility: +vol.toFixed(6),
      sharpeRatio: +sharpe.toFixed(4),
    });
  }

  return frontier;
}

// ── 风险平价 (Risk Parity) ──────────────────────────────────────────────────

/**
 * 风险平价优化。
 *
 * 目标: 使每个资产的风险贡献相等。
 *
 * RC_i = w_i * (Σw)_i / σ_p
 * 目标: RC_i = RC_j for all i,j
 *
 * 使用 Newton-Raphson 迭代求解:
 * 最小化 f(w) = Σ_i Σ_j (RC_i - RC_j)²
 *
 * 等价形式: 最小化 Σ_i (w_i * (Σw)_i - σ²_p / n)²
 */
export function riskParityOptimize(assets: PortfolioAsset[]): PortfolioResult {
  const n = assets.length;
  if (n === 0) {
    return { weights: [], expectedReturn: 0, volatility: 0, sharpeRatio: 0 };
  }
  if (n === 1) {
    const mu = mean(assets[0].returns) * 252;
    const vol = stdDev(assets[0].returns) * Math.sqrt(252);
    return { weights: [1], expectedReturn: mu, volatility: vol, sharpeRatio: vol > 0 ? (mu - 0.025) / vol : 0 };
  }

  const mu = computeMeanReturns(assets);
  const cov = computeCovarianceMatrix(assets);

  // 初始化: 按波动率的倒数分配权重
  const vols = assets.map(a => stdDev(a.returns) * Math.sqrt(252));
  let weights: number[] = vols.map(v => v > 0 ? 1 / v : 1);
  weights = normalizeWeights(weights);

  const targetRC = 1 / n; // 每个资产的目标风险贡献比例

  // Newton-Raphson 迭代
  for (let iter = 0; iter < 500; iter++) {
    const Sw = matVecMul(cov, weights);
    const totalVar = dot(weights, Sw);
    if (totalVar < 1e-15) break;

    const totalVol = Math.sqrt(totalVar);

    // 计算风险贡献
    const rc: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      rc[i] = weights[i] * Sw[i] / totalVar; // 比例风险贡献
    }

    // 检查收敛
    let maxDiff = 0;
    for (let i = 0; i < n; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(rc[i] - targetRC));
    }
    if (maxDiff < 1e-8) break;

    // 梯度: ∂f/∂w_i 的近似
    // 使用简化的 Newton 方法:
    // 新权重与目标风险贡献的关系: w_i_new = w_i * (targetRC / rc[i])
    const newW: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      if (rc[i] > 1e-15) {
        // 混合更新: 部分使用 Newton 步长
        const ratio = targetRC / rc[i];
        newW[i] = weights[i] * (1 + 0.5 * (ratio - 1));
      } else {
        newW[i] = weights[i] + 1e-6;
      }
      newW[i] = Math.max(newW[i], 1e-10);
    }

    weights = normalizeWeights(newW);
  }

  const expRet = portfolioReturn(weights, mu);
  const vol = portfolioVolatility(weights, cov);
  const riskFreeRate = 0.025;
  const sharpe = vol > 0 ? (expRet - riskFreeRate) / vol : 0;

  return {
    weights: weights.map(w => +w.toFixed(6)),
    expectedReturn: +expRet.toFixed(6),
    volatility: +vol.toFixed(6),
    sharpeRatio: +sharpe.toFixed(4),
  };
}

// ── Black-Litterman ──────────────────────────────────────────────────────────

/**
 * Black-Litterman 模型优化。
 *
 * 步骤:
 * 1. 从市场组合推导隐含均衡收益: Π = δΣw_mkt
 * 2. 投资者观点矩阵: P (K x N), 观点向量: Q (K x 1), 不确定性: Ω (K x K)
 * 3. 合并: μ_BL = [(τΣ)⁻¹ + P'Ω⁻¹P]⁻¹ [(τΣ)⁻¹Π + P'Ω⁻¹Q]
 * 4. 使用 μ_BL 进行均值-方差优化
 *
 * @param assets 资产列表
 * @param views 投资者观点 {assets: 参与观点的资产权重, expectedReturn: 预期收益, confidence: 信心度}
 * @param marketCap 市值权重 (默认等权)
 * @param riskFreeRate 无风险利率
 * @param tau 标量参数 (控制先验不确定性，默认 0.05)
 */
export function blackLittermanOptimize(
  assets: PortfolioAsset[],
  views: { assets: number[]; expectedReturn: number; confidence: number }[],
  marketCap?: number[],
  riskFreeRate = 0.025,
  tau = 0.05,
): PortfolioResult {
  const n = assets.length;
  if (n === 0) {
    return { weights: [], expectedReturn: 0, volatility: 0, sharpeRatio: 0 };
  }

  const cov = computeCovarianceMatrix(assets);
  const delta = 2.5; // 风险厌恶系数

  // 市场权重 (默认等权)
  const wMkt = marketCap
    ? normalizeWeights(marketCap)
    : new Array(n).fill(1 / n);

  // 步骤 1: 隐含均衡收益 Π = δΣw_mkt
  const pi = matVecMul(cov, wMkt).map(x => x * delta);

  if (views.length === 0) {
    // 无观点，直接使用均衡收益优化
    return optimizeWithReturns(pi, cov, riskFreeRate);
  }

  // 步骤 2: 构建观点矩阵
  const K = views.length; // 观点数量

  // P: K x N 观点选择矩阵
  const P: number[][] = views.map(v => v.assets);

  // Q: K x 1 观点预期收益
  const Q: number[] = views.map(v => v.expectedReturn);

  // Ω: K x K 观点不确定性对角矩阵
  // Ω_k = (1/confidence_k - 1) * P_k' * τΣ * P_k
  const Omega: number[][] = Array.from({ length: K }, () => new Array(K).fill(0));
  for (let k = 0; k < K; k++) {
    const pk = P[k];
    // P_k' * τΣ * P_k = τ * Σ中P_k对应的二次形式
    const tauSigmaPk = matVecMul(cov, pk).map(x => x * tau);
    const pkVar = dot(pk, tauSigmaPk);
    const confidenceScale = views[k].confidence > 0 ? (1 / views[k].confidence - 1) : 1;
    Omega[k][k] = Math.max(confidenceScale * pkVar, 1e-10);
  }

  // 步骤 3: 计算 BL 合并收益
  // μ_BL = [(τΣ)⁻¹ + P'Ω⁻¹P]⁻¹ [(τΣ)⁻¹Π + P'Ω⁻¹Q]

  // τΣ
  const tauCov: number[][] = cov.map(row => row.map(x => x * tau));

  // (τΣ)⁻¹
  const tauCovInv = matInverse(tauCov);

  // Ω⁻¹
  const OmegaInv = matInverse(Omega);

  // P' (N x K)
  const Pt = matTranspose(P);

  // P'Ω⁻¹ (N x K)
  const PtOmegaInv = matMul(Pt, OmegaInv);

  // P'Ω⁻¹P (N x N)
  const PtOmegaInvP = matMul(PtOmegaInv, P);

  // (τΣ)⁻¹ + P'Ω⁻¹P (N x N)
  const M: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => tauCovInv[i][j] + PtOmegaInvP[i][j]),
  );
  const MInv = matInverse(M);

  // (τΣ)⁻¹Π (N x 1)
  const tauCovInvPi = matVecMul(tauCovInv, pi);

  // P'Ω⁻¹Q (N x 1)
  const PtOmegaInvQ = matVecMul(PtOmegaInv, Q);

  // 合并向量
  const combinedVec: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    combinedVec[i] = tauCovInvPi[i] + PtOmegaInvQ[i];
  }

  // μ_BL
  const muBL = matVecMul(MInv, combinedVec);

  // 步骤 4: 使用 BL 收益进行优化
  return optimizeWithReturns(muBL, cov, riskFreeRate);
}

/**
 * 给定收益率向量和协方差矩阵，求解最大夏普比率组合 (带非负约束)。
 */
function optimizeWithReturns(
  mu: number[],
  cov: number[][],
  riskFreeRate: number,
): PortfolioResult {
  const n = mu.length;

  // 解析切线组合
  const excessReturn = mu.map(m => m - riskFreeRate);
  const covInv = matInverse(cov);
  const wRaw = matVecMul(covInv, excessReturn);
  let weights = normalizeWeights(wRaw);

  // 投影到非负约束
  if (weights.some(w => w < 0)) {
    weights = iterativeProjection(mu, cov, riskFreeRate, 0, 1, 200);
  }

  const expRet = portfolioReturn(weights, mu);
  const vol = portfolioVolatility(weights, cov);
  const sharpe = vol > 0 ? (expRet - riskFreeRate) / vol : 0;

  return {
    weights: weights.map(w => +w.toFixed(6)),
    expectedReturn: +expRet.toFixed(6),
    volatility: +vol.toFixed(6),
    sharpeRatio: +sharpe.toFixed(4),
  };
}
