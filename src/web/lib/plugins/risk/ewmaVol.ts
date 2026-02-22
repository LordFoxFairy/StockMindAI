/**
 * 风险插件: EWMA 波动率分析
 *
 * 使用指数加权移动平均 (EWMA) 模型估计条件波动率。
 * EWMA 模型是 RiskMetrics 推荐的风险管理工具，
 * 对近期市场变化反应灵敏，计算高效。
 *
 * σ²_t = λ·σ²_{t-1} + (1-λ)·r²_{t-1}
 *
 * Plugin ID: risk.ewma-vol
 */

import { ewmaVolatility } from '../../volatility';
import { mean, stdDev } from '../../risk';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface EWMAVolPluginParams {
  lambda: number;  // 衰减因子，默认 0.94 (RiskMetrics 标准)
}

export interface EWMAVolPluginResult {
  conditionalVariance: number[];
  currentVol: number;
  annualizedVol: number;
  lambda: number;
  halfLife: number;
  volOfVol: number;
  volTrend: '上升' | '下降' | '平稳';
}

import type { RiskPlugin, ParamSchema } from '../types';

// ── Plugin 实现 ──────────────────────────────────────────────────────────────

/**
 * 分析函数: 计算 EWMA 条件波动率。
 *
 * @param returns 日收益率序列
 * @param params 参数 (可选)
 * @returns EWMA 波动率分析结果
 */
function analyze(
  returns: number[],
  params?: Partial<EWMAVolPluginParams>,
): EWMAVolPluginResult {
  const lambda = params?.lambda ?? 0.94;

  if (returns.length === 0) {
    return {
      conditionalVariance: [],
      currentVol: 0,
      annualizedVol: 0,
      lambda,
      halfLife: 0,
      volOfVol: 0,
      volTrend: '平稳',
    };
  }

  // 计算 EWMA 条件方差
  const variances = ewmaVolatility(returns, lambda);

  // 当前条件波动率
  const currentVariance = variances[variances.length - 1];
  const currentVol = Math.sqrt(currentVariance);
  const annualizedVol = currentVol * Math.sqrt(252);

  // 半衰期: 使旧信息权重降至 50% 所需的天数
  // λ^h = 0.5 => h = ln(0.5) / ln(λ)
  const halfLife = lambda > 0 && lambda < 1
    ? Math.log(0.5) / Math.log(lambda)
    : Infinity;

  // 波动率的波动率 (vol-of-vol)
  const volSeries = variances.map(v => Math.sqrt(v));
  const volOfVol = volSeries.length > 1 ? stdDev(volSeries) : 0;

  // 波动率趋势判断 (近 20 日 vs 之前 20 日)
  let volTrend: '上升' | '下降' | '平稳' = '平稳';
  if (volSeries.length >= 40) {
    const recentVol = mean(volSeries.slice(-20));
    const prevVol = mean(volSeries.slice(-40, -20));
    const changeRate = prevVol > 0 ? (recentVol - prevVol) / prevVol : 0;
    if (changeRate > 0.1) {
      volTrend = '上升';
    } else if (changeRate < -0.1) {
      volTrend = '下降';
    }
  }

  return {
    conditionalVariance: variances.map(v => +v.toFixed(10)),
    currentVol: +currentVol.toFixed(6),
    annualizedVol: +annualizedVol.toFixed(6),
    lambda,
    halfLife: halfLife === Infinity ? Infinity : +halfLife.toFixed(2),
    volOfVol: +volOfVol.toFixed(6),
    volTrend,
  };
}

// ── Plugin 注册 ──────────────────────────────────────────────────────────────

const ewmaVolPlugin: RiskPlugin = {
  id: 'risk.ewma-vol',
  name: 'EWMA 波动率',
  category: 'risk',
  description: '基于指数加权移动平均 (EWMA) 的条件波动率估计。采用 RiskMetrics 标准方法，对近期市场变化反应灵敏，适用于短期风险监控。',
  params: [
    { key: 'lambda', label: '衰减因子 λ', type: 'number', default: 0.94, min: 0.8, max: 0.99, step: 0.01 },
  ],
  analyze,
};

export default ewmaVolPlugin;
