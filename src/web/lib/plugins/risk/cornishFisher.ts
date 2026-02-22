/**
 * 风险插件: Cornish-Fisher VaR
 *
 * 使用 Cornish-Fisher 展开对标准正态分位数进行偏度和峰度修正，
 * 计算更准确的非正态 VaR。
 *
 * 修正公式:
 * z_CF = z + (z²-1)/6·S + (z³-3z)/24·K - (2z³-5z)/36·S²
 *
 * 其中 S = 偏度, K = 超额峰度, z = 标准正态分位数
 *
 * Plugin ID: risk.cornish-fisher
 */

import { cornishFisherVaR, type CornishFisherResult } from '../../advancedVaR';
import { mean, stdDev } from '../../risk';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface CornishFisherPluginParams {
  confidence: number;  // 置信度，默认 0.95
}

export interface CornishFisherPluginResult {
  var: number;
  adjustedZ: number;
  skewness: number;
  kurtosis: number;
  normalVaR: number;
  varImprovement: number;
  distributionType: '正态' | '左偏厚尾' | '右偏' | '厚尾' | '近似正态';
}

import type { RiskPlugin, ParamSchema } from '../types';

// ── 辅助函数 ────────────────────────────────────────────────────────────────

const Z_SCORES: Record<number, number> = {
  0.90: 1.2816,
  0.95: 1.6449,
  0.99: 2.3263,
};

/**
 * 计算样本偏度。
 */
function computeSkewness(data: number[]): number {
  const n = data.length;
  if (n < 3) return 0;
  const m = mean(data);
  const s = stdDev(data);
  if (s === 0) return 0;

  let m3 = 0;
  for (let i = 0; i < n; i++) {
    m3 += ((data[i] - m) / s) ** 3;
  }
  return m3 / n;
}

/**
 * 计算样本超额峰度。
 */
function computeExcessKurtosis(data: number[]): number {
  const n = data.length;
  if (n < 4) return 0;
  const m = mean(data);
  const s = stdDev(data);
  if (s === 0) return 0;

  let m4 = 0;
  for (let i = 0; i < n; i++) {
    m4 += ((data[i] - m) / s) ** 4;
  }
  return m4 / n - 3;
}

/**
 * 判断收益率分布类型。
 */
function classifyDistribution(
  skewness: number,
  kurtosis: number,
): '正态' | '左偏厚尾' | '右偏' | '厚尾' | '近似正态' {
  const absSkew = Math.abs(skewness);
  const isThickTail = kurtosis > 1;
  const isSkewed = absSkew > 0.5;

  if (!isSkewed && !isThickTail) return '近似正态';
  if (skewness < -0.5 && isThickTail) return '左偏厚尾';
  if (skewness > 0.5) return '右偏';
  if (isThickTail) return '厚尾';
  return '近似正态';
}

// ── Plugin 实现 ──────────────────────────────────────────────────────────────

/**
 * 分析函数: 计算 Cornish-Fisher VaR。
 *
 * @param returns 日收益率序列
 * @param params 参数 (可选)
 * @returns Cornish-Fisher VaR 分析结果
 */
function analyze(
  returns: number[],
  params?: Partial<CornishFisherPluginParams>,
): CornishFisherPluginResult {
  const confidence = params?.confidence ?? 0.95;

  if (returns.length < 10) {
    return {
      var: 0,
      adjustedZ: 0,
      skewness: 0,
      kurtosis: 0,
      normalVaR: 0,
      varImprovement: 0,
      distributionType: '近似正态',
    };
  }

  // Cornish-Fisher VaR
  const cfResult: CornishFisherResult = cornishFisherVaR(returns, confidence);

  // 计算偏度和峰度
  const skewness = computeSkewness(returns);
  const kurtosis = computeExcessKurtosis(returns);

  // 标准正态 VaR (用于对比)
  const m = mean(returns);
  const s = stdDev(returns);
  const z = Z_SCORES[confidence] ?? 1.6449;
  const normalVaR = -(m - z * s);

  // CF VaR (取绝对值作为损失)
  const cfVaR = -cfResult.var; // advancedVaR 返回的是收益 (负值表示损失)

  // 改进幅度
  const varImprovement = normalVaR > 0 ? (cfVaR - normalVaR) / normalVaR : 0;

  // 分布类型
  const distributionType = classifyDistribution(skewness, kurtosis);

  return {
    var: +cfVaR.toFixed(6),
    adjustedZ: +cfResult.adjustedZ.toFixed(4),
    skewness: +skewness.toFixed(4),
    kurtosis: +kurtosis.toFixed(4),
    normalVaR: +normalVaR.toFixed(6),
    varImprovement: +varImprovement.toFixed(4),
    distributionType,
  };
}

// ── Plugin 注册 ──────────────────────────────────────────────────────────────

const cornishFisherPlugin: RiskPlugin = {
  id: 'risk.cornish-fisher',
  name: 'Cornish-Fisher VaR',
  category: 'risk',
  description: '基于 Cornish-Fisher 展开的非正态 VaR。通过偏度和峰度修正标准正态分位数，适用于收益率分布存在偏斜和厚尾的情况（A 股市场常见）。',
  params: [
    { key: 'confidence', label: '置信度', type: 'number', default: 0.95, min: 0.9, max: 0.99, step: 0.01 },
  ],
  analyze,
};

export default cornishFisherPlugin;
