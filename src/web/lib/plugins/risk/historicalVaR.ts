/**
 * 风险插件: 历史VaR
 *
 * 封装 risk.ts 中已有的 calculateRiskMetrics 函数，
 * 支持历史模拟法和参数法两种 VaR 计算方式，
 * 返回 VaR、CVaR 及基础风险指标。
 *
 * Plugin ID: risk.historicalVaR
 */

import {
  calculateRiskMetrics,
  historicalVaR as histVaR,
  parametricVaR,
  cVaR,
  mean,
  stdDev,
  type RiskMetrics,
} from '../../risk';
import type { RiskPlugin as RiskPluginType } from '../types';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface HistoricalVaRParams {
  confidenceLevel: number;        // 置信度，默认 0.95
  method: 'historical' | 'parametric';  // VaR 计算方法
}

export interface HistoricalVaRResult {
  var: number;
  cvar: number;
  method: 'historical' | 'parametric';
  confidenceLevel: number;
  riskMetrics: RiskMetrics;
}

// ── Plugin 实现 ──────────────────────────────────────────────────────────────

/**
 * 分析函数: 根据所选方法计算 VaR/CVaR 并返回完整风险指标。
 *
 * @param returns 日收益率序列
 * @param params  参数 (可选)
 * @returns 历史VaR分析结果
 */
function analyze(
  returns: number[],
  params?: Partial<HistoricalVaRParams>,
): HistoricalVaRResult {
  const confidenceLevel = params?.confidenceLevel ?? 0.95;
  const method = params?.method ?? 'historical';

  // 计算 VaR
  const varValue = method === 'parametric'
    ? parametricVaR(returns, confidenceLevel)
    : histVaR(returns, confidenceLevel);

  // 计算 CVaR (Expected Shortfall)
  const cvarValue = cVaR(returns, confidenceLevel);

  // 计算完整风险指标
  const riskMetrics = calculateRiskMetrics(returns);

  return {
    var: +varValue.toFixed(6),
    cvar: +cvarValue.toFixed(6),
    method,
    confidenceLevel,
    riskMetrics: {
      dailyVaR95: +riskMetrics.dailyVaR95.toFixed(6),
      dailyVaR99: +riskMetrics.dailyVaR99.toFixed(6),
      cVaR95: +riskMetrics.cVaR95.toFixed(6),
      cVaR99: +riskMetrics.cVaR99.toFixed(6),
      annualizedVolatility: +riskMetrics.annualizedVolatility.toFixed(6),
      downsideDeviation: +riskMetrics.downsideDeviation.toFixed(6),
      skewness: +riskMetrics.skewness.toFixed(6),
      kurtosis: +riskMetrics.kurtosis.toFixed(6),
      calmarRatio: +riskMetrics.calmarRatio.toFixed(6),
      sortinoRatio: +riskMetrics.sortinoRatio.toFixed(6),
    },
  };
}

// ── Plugin 注册 ──────────────────────────────────────────────────────────────

const historicalVaRPlugin: RiskPluginType = {
  id: 'risk.historicalVaR',
  name: '历史VaR',
  category: 'risk',
  description: '基于历史模拟法或参数法的风险价值 (VaR) 分析。封装 calculateRiskMetrics，返回 VaR、CVaR 及完整风险指标。',
  params: [
    {
      key: 'confidenceLevel',
      label: '置信水平',
      type: 'number',
      default: 0.95,
      min: 0.9,
      max: 0.99,
      step: 0.01,
    },
    {
      key: 'method',
      label: '计算方法',
      type: 'select',
      default: 'historical',
      options: [
        { label: '历史模拟法', value: 'historical' },
        { label: '参数法', value: 'parametric' },
      ],
    },
  ],
  analyze,
};

export default historicalVaRPlugin;
