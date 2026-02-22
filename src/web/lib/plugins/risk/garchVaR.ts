/**
 * 风险插件: GARCH(1,1) VaR
 *
 * 使用 GARCH(1,1) 条件波动率模型计算时变 VaR。
 * 相比传统的历史 VaR，GARCH VaR 能够捕捉波动率聚集效应，
 * 在市场剧烈波动时提供更准确的风险估计。
 *
 * Plugin ID: risk.garch-var
 */

import { garchFit, type GarchResult } from '../../volatility';
import { garchVaR, type GarchVaRResult } from '../../advancedVaR';
import { mean, stdDev, dailyReturns } from '../../risk';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface GarchVaRPluginParams {
  confidence: number;  // 置信度，默认 0.95
}

export interface GarchVaRPluginResult {
  garchParams: {
    omega: number;
    alpha: number;
    beta: number;
  };
  conditionalVol: number[];
  var: number;
  currentVol: number;
  annualizedVol: number;
  persistence: number;
  halfLife: number;
}

import type { RiskPlugin, ParamSchema } from '../types';

// ── Plugin 实现 ──────────────────────────────────────────────────────────────

/**
 * 分析函数: 执行 GARCH(1,1) 拟合并计算 VaR。
 *
 * @param returns 日收益率序列
 * @param params 参数 (可选)
 * @returns GARCH VaR 分析结果
 */
function analyze(
  returns: number[],
  params?: Partial<GarchVaRPluginParams>,
): GarchVaRPluginResult {
  const confidence = params?.confidence ?? 0.95;

  if (returns.length < 10) {
    const vol = stdDev(returns);
    return {
      garchParams: { omega: 0, alpha: 0.1, beta: 0.85 },
      conditionalVol: returns.map(() => vol),
      var: 0,
      currentVol: vol,
      annualizedVol: vol * Math.sqrt(252),
      persistence: 0.95,
      halfLife: 0,
    };
  }

  // 拟合 GARCH(1,1)
  const garchResult: GarchResult = garchFit(returns);

  // 计算 GARCH VaR
  const varResult: GarchVaRResult = garchVaR(returns, confidence);

  // 计算持续性和半衰期
  const persistence = garchResult.alpha + garchResult.beta;
  const halfLife = persistence < 1 && persistence > 0
    ? Math.log(0.5) / Math.log(persistence)
    : Infinity;

  // 当前条件波动率
  const currentVol = garchResult.conditionalVol[garchResult.conditionalVol.length - 1];

  return {
    garchParams: {
      omega: +garchResult.omega.toFixed(10),
      alpha: +garchResult.alpha.toFixed(6),
      beta: +garchResult.beta.toFixed(6),
    },
    conditionalVol: garchResult.conditionalVol.map(v => +v.toFixed(6)),
    var: +varResult.var.toFixed(6),
    currentVol: +currentVol.toFixed(6),
    annualizedVol: +(currentVol * Math.sqrt(252)).toFixed(6),
    persistence: +persistence.toFixed(6),
    halfLife: halfLife === Infinity ? Infinity : +halfLife.toFixed(2),
  };
}

// ── Plugin 注册 ──────────────────────────────────────────────────────────────

const garchVaRPlugin: RiskPlugin = {
  id: 'risk.garch-var',
  name: 'GARCH(1,1) VaR',
  category: 'risk',
  description: '基于 GARCH(1,1) 条件波动率模型的时变风险价值 (VaR)。捕捉波动率聚集效应，在市场剧烈波动期间提供更准确的风险估计。',
  params: [
    { key: 'confidence', label: '置信度', type: 'number', default: 0.95, min: 0.9, max: 0.99, step: 0.01 },
  ],
  analyze,
};

export default garchVaRPlugin;
