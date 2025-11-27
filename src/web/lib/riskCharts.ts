import type { RiskMetrics, MonteCarloResult, StressTestResult } from './risk';

// ── Theme (duplicated from indicatorCharts.ts since it's not exported) ──────

interface ThemeColors {
  textColor: string;
  borderColor: string;
  gridLineColor: string;
  tooltipBg: string;
  tooltipText: string;
  upColor: string;
  downColor: string;
  upColorAlpha: string;
  downColorAlpha: string;
}

function getThemeColors(isDark: boolean): ThemeColors {
  return isDark
    ? {
        textColor: '#94a3b8',
        borderColor: '#1e293b',
        gridLineColor: '#1e293b',
        tooltipBg: 'rgba(15, 23, 42, 0.95)',
        tooltipText: '#e2e8f0',
        upColor: '#ef4444',
        downColor: '#22c55e',
        upColorAlpha: 'rgba(239, 68, 68, 0.6)',
        downColorAlpha: 'rgba(34, 197, 94, 0.6)',
      }
    : {
        textColor: '#64748b',
        borderColor: '#e2e8f0',
        gridLineColor: '#f1f5f9',
        tooltipBg: 'rgba(255, 255, 255, 0.95)',
        tooltipText: '#334155',
        upColor: '#ef4444',
        downColor: '#22c55e',
        upColorAlpha: 'rgba(239, 68, 68, 0.5)',
        downColorAlpha: 'rgba(34, 197, 94, 0.5)',
      };
}

// ── VaR Distribution Chart ──────────────────────────────────────────────────

export function buildVaRChart(
  returns: number[],
  varValue: number,
  cVarValue: number,
  isDark: boolean,
) {
  const c = getThemeColors(isDark);
  const binCount = 30;

  const min = Math.min(...returns);
  const max = Math.max(...returns);
  const binWidth = (max - min) / binCount;

  const bins: number[] = new Array(binCount).fill(0);
  const binEdges: number[] = [];
  for (let i = 0; i < binCount; i++) {
    binEdges.push(min + i * binWidth);
  }

  for (const r of returns) {
    let idx = Math.floor((r - min) / binWidth);
    if (idx >= binCount) idx = binCount - 1;
    if (idx < 0) idx = 0;
    bins[idx]++;
  }

  const labels = binEdges.map((e) => (e * 100).toFixed(2));
  const maxFreq = Math.max(...bins);

  const barData = bins.map((freq, i) => {
    const mid = binEdges[i] + binWidth / 2;
    const isBelow = mid <= varValue;
    return {
      value: freq,
      itemStyle: {
        color: isBelow
          ? 'rgba(239, 68, 68, 0.7)'
          : mid >= 0
            ? 'rgba(34, 197, 94, 0.7)'
            : 'rgba(239, 68, 68, 0.4)',
      },
    };
  });

  // Find VaR / CVaR positions on x-axis
  const varLabel = (varValue * 100).toFixed(2);
  const cVarLabel = (cVarValue * 100).toFixed(2);

  return {
    backgroundColor: 'transparent',
    animation: false,
    title: {
      text: '收益分布与VaR',
      left: 'center',
      textStyle: { color: c.textColor, fontSize: 14, fontFamily: 'monospace', fontWeight: 'normal' as const },
    },
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: c.tooltipBg,
      borderColor: c.borderColor,
      textStyle: { color: c.tooltipText, fontSize: 11, fontFamily: 'monospace' },
      padding: [8, 12],
      formatter: (params: any) => {
        const p = Array.isArray(params) ? params[0] : params;
        return `收益率: ${p.name}%<br/>频次: ${p.value}`;
      },
    },
    grid: { left: '10%', right: '5%', top: '15%', bottom: '15%' },
    xAxis: {
      type: 'category' as const,
      data: labels,
      axisLine: { lineStyle: { color: c.borderColor } },
      axisLabel: {
        color: c.textColor,
        fontSize: 9,
        fontFamily: 'monospace',
        interval: Math.floor(binCount / 6),
        rotate: 30,
      },
      axisTick: { show: false },
      name: '日收益率 (%)',
      nameLocation: 'middle' as const,
      nameGap: 35,
      nameTextStyle: { color: c.textColor, fontSize: 11, fontFamily: 'monospace' },
    },
    yAxis: {
      type: 'value' as const,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: true, lineStyle: { color: c.gridLineColor, type: 'dashed' as const } },
      axisLabel: { color: c.textColor, fontSize: 10, fontFamily: 'monospace' },
      name: '频次',
      nameTextStyle: { color: c.textColor, fontSize: 11, fontFamily: 'monospace' },
    },
    series: [
      {
        name: '收益分布',
        type: 'bar',
        data: barData,
        barWidth: '90%',
      },
      // VaR marker line
      {
        name: 'VaR 95%',
        type: 'line',
        markLine: {
          silent: true,
          symbol: ['none', 'none'],
          lineStyle: { color: '#f59e0b', type: 'dashed' as const, width: 2 },
          label: {
            formatter: `VaR 95%: ${varLabel}%`,
            color: '#f59e0b',
            fontSize: 10,
            fontFamily: 'monospace',
            position: 'insideEndTop' as const,
          },
          data: [{ xAxis: labels.reduce((closest, l, i) => {
            const diff = Math.abs(parseFloat(l) - varValue * 100);
            const prevDiff = Math.abs(parseFloat(labels[closest]) - varValue * 100);
            return diff < prevDiff ? i : closest;
          }, 0) }],
        },
        data: [],
      },
      // CVaR marker line
      {
        name: 'CVaR 95%',
        type: 'line',
        markLine: {
          silent: true,
          symbol: ['none', 'none'],
          lineStyle: { color: '#ef4444', type: 'dotted' as const, width: 2 },
          label: {
            formatter: `CVaR 95%: ${cVarLabel}%`,
            color: '#ef4444',
            fontSize: 10,
            fontFamily: 'monospace',
            position: 'insideEndTop' as const,
          },
          data: [{ xAxis: labels.reduce((closest, l, i) => {
            const diff = Math.abs(parseFloat(l) - cVarValue * 100);
            const prevDiff = Math.abs(parseFloat(labels[closest]) - cVarValue * 100);
            return diff < prevDiff ? i : closest;
          }, 0) }],
        },
        data: [],
      },
    ],
  };
}

// ── Monte Carlo Fan Chart ───────────────────────────────────────────────────

export function buildMonteCarloChart(
  mcResult: MonteCarloResult,
  currentPrice: number,
  isDark: boolean,
) {
  const c = getThemeColors(isDark);
  const { paths, percentiles } = mcResult;
  const days = percentiles.p50.length;
  const xData = Array.from({ length: days }, (_, i) => i);

  // Select up to 50 random sample paths
  const sampleCount = Math.min(50, paths.length);
  const indices = new Set<number>();
  while (indices.size < sampleCount) {
    indices.add(Math.floor(Math.random() * paths.length));
  }

  const sampleSeries = Array.from(indices).map((idx, i) => ({
    name: `path${i}`,
    type: 'line' as const,
    data: paths[idx],
    lineStyle: { width: 1, opacity: 0.05, color: isDark ? '#94a3b8' : '#64748b' },
    symbol: 'none' as const,
    silent: true,
    showSymbol: false,
    z: 1,
  }));

  // Band: p5-p95 using stacked approach
  const p95MinusP5 = percentiles.p95.map((v, i) => v - percentiles.p5[i]);
  const p75MinusP25 = percentiles.p75.map((v, i) => v - percentiles.p25[i]);

  const bandSeries = [
    // Outer band base (p5)
    {
      name: 'p5',
      type: 'line' as const,
      data: percentiles.p5,
      lineStyle: { opacity: 0 },
      areaStyle: { color: 'transparent' },
      stack: 'confidence-outer',
      symbol: 'none' as const,
      silent: true,
      z: 2,
    },
    // Outer band fill (p95 - p5)
    {
      name: 'p5-p95',
      type: 'line' as const,
      data: p95MinusP5,
      lineStyle: { opacity: 0 },
      areaStyle: { color: isDark ? 'rgba(56, 189, 248, 0.08)' : 'rgba(56, 189, 248, 0.12)' },
      stack: 'confidence-outer',
      symbol: 'none' as const,
      silent: true,
      z: 2,
    },
    // Inner band base (p25)
    {
      name: 'p25',
      type: 'line' as const,
      data: percentiles.p25,
      lineStyle: { opacity: 0 },
      areaStyle: { color: 'transparent' },
      stack: 'confidence-inner',
      symbol: 'none' as const,
      silent: true,
      z: 3,
    },
    // Inner band fill (p75 - p25)
    {
      name: 'p25-p75',
      type: 'line' as const,
      data: p75MinusP25,
      lineStyle: { opacity: 0 },
      areaStyle: { color: isDark ? 'rgba(56, 189, 248, 0.15)' : 'rgba(56, 189, 248, 0.22)' },
      stack: 'confidence-inner',
      symbol: 'none' as const,
      silent: true,
      z: 3,
    },
    // Median line
    {
      name: '中位数 (p50)',
      type: 'line' as const,
      data: percentiles.p50,
      lineStyle: { width: 2, color: '#38bdf8' },
      symbol: 'none' as const,
      z: 5,
    },
  ];

  return {
    backgroundColor: 'transparent',
    animation: false,
    title: {
      text: `蒙特卡洛模拟 (${paths.length}次)`,
      left: 'center',
      textStyle: { color: c.textColor, fontSize: 14, fontFamily: 'monospace', fontWeight: 'normal' as const },
    },
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: c.tooltipBg,
      borderColor: c.borderColor,
      textStyle: { color: c.tooltipText, fontSize: 11, fontFamily: 'monospace' },
      padding: [8, 12],
      formatter: (params: any) => {
        const arr = Array.isArray(params) ? params : [params];
        const day = arr[0]?.dataIndex ?? 0;
        const p5Val = percentiles.p5[day]?.toFixed(2) ?? '-';
        const p50Val = percentiles.p50[day]?.toFixed(2) ?? '-';
        const p95Val = percentiles.p95[day]?.toFixed(2) ?? '-';
        return `第 ${day} 天<br/>P5: ¥${p5Val}<br/>P50: ¥${p50Val}<br/>P95: ¥${p95Val}`;
      },
    },
    grid: { left: '10%', right: '5%', top: '15%', bottom: '12%' },
    xAxis: {
      type: 'category' as const,
      data: xData,
      axisLine: { lineStyle: { color: c.borderColor } },
      axisLabel: {
        color: c.textColor,
        fontSize: 10,
        fontFamily: 'monospace',
        interval: Math.max(Math.floor(days / 8), 1),
      },
      axisTick: { show: false },
      name: '交易日',
      nameLocation: 'middle' as const,
      nameGap: 25,
      nameTextStyle: { color: c.textColor, fontSize: 11, fontFamily: 'monospace' },
    },
    yAxis: {
      type: 'value' as const,
      scale: true,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: true, lineStyle: { color: c.gridLineColor, type: 'dashed' as const } },
      axisLabel: { color: c.textColor, fontSize: 10, fontFamily: 'monospace' },
      name: '价格',
      nameTextStyle: { color: c.textColor, fontSize: 11, fontFamily: 'monospace' },
    },
    series: [
      ...sampleSeries,
      ...bandSeries,
      // Current price reference line
      {
        name: '当前价格',
        type: 'line' as const,
        markLine: {
          silent: true,
          symbol: ['none', 'none'],
          lineStyle: { color: '#f59e0b', type: 'dashed' as const, width: 1 },
          label: {
            formatter: `当前: ¥${currentPrice.toFixed(2)}`,
            color: '#f59e0b',
            fontSize: 10,
            fontFamily: 'monospace',
          },
          data: [{ yAxis: currentPrice }],
        },
        data: [],
      },
    ],
    legend: {
      show: true,
      bottom: 0,
      textStyle: { color: c.textColor, fontSize: 10, fontFamily: 'monospace' },
      data: ['中位数 (p50)', '当前价格'],
    },
  };
}

// ── Stress Test Horizontal Bar Chart ────────────────────────────────────────

export function buildStressTestChart(
  results: StressTestResult[],
  isDark: boolean,
) {
  const c = getThemeColors(isDark);

  const names = results.map((r) => r.scenario.name);
  const lossData = results.map((r) => r.projectedLossPercent * 100);

  // Red gradient: darker for worse losses
  const maxLoss = Math.max(...lossData.map(Math.abs));

  const barData = lossData.map((loss, i) => {
    const severity = maxLoss > 0 ? Math.abs(loss) / maxLoss : 0;
    const r = Math.round(180 + severity * 75);
    const g = Math.round(60 - severity * 40);
    const b = Math.round(60 - severity * 40);
    return {
      value: loss,
      itemStyle: { color: `rgb(${r}, ${g}, ${b})` },
      label: {
        show: true,
        position: 'insideRight' as const,
        formatter: `${loss.toFixed(1)}%  (~${results[i].recoveryDaysEstimate === Infinity ? '∞' : results[i].recoveryDaysEstimate}天恢复)`,
        color: '#fff',
        fontSize: 11,
        fontFamily: 'monospace',
      },
    };
  });

  return {
    backgroundColor: 'transparent',
    animation: false,
    title: {
      text: '压力测试',
      left: 'center',
      textStyle: { color: c.textColor, fontSize: 14, fontFamily: 'monospace', fontWeight: 'normal' as const },
    },
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: { type: 'shadow' as const },
      backgroundColor: c.tooltipBg,
      borderColor: c.borderColor,
      textStyle: { color: c.tooltipText, fontSize: 11, fontFamily: 'monospace' },
      padding: [8, 12],
      formatter: (params: any) => {
        const p = Array.isArray(params) ? params[0] : params;
        const idx = names.indexOf(p.name);
        if (idx < 0) return '';
        const r = results[idx];
        return [
          `<b>${r.scenario.name}</b>`,
          r.scenario.description,
          `预计损失: ${(r.projectedLossPercent * 100).toFixed(1)}%`,
          `恢复天数: ${r.recoveryDaysEstimate === Infinity ? '无法恢复' : r.recoveryDaysEstimate + '天'}`,
        ].join('<br/>');
      },
    },
    grid: { left: '22%', right: '12%', top: '15%', bottom: '8%' },
    xAxis: {
      type: 'value' as const,
      axisLine: { lineStyle: { color: c.borderColor } },
      axisLabel: {
        color: c.textColor,
        fontSize: 10,
        fontFamily: 'monospace',
        formatter: (v: number) => `${v}%`,
      },
      splitLine: { show: true, lineStyle: { color: c.gridLineColor, type: 'dashed' as const } },
      name: '预计损失 (%)',
      nameTextStyle: { color: c.textColor, fontSize: 11, fontFamily: 'monospace' },
    },
    yAxis: {
      type: 'category' as const,
      data: names,
      axisLine: { lineStyle: { color: c.borderColor } },
      axisLabel: { color: c.textColor, fontSize: 11, fontFamily: 'monospace' },
      axisTick: { show: false },
      inverse: true,
    },
    series: [
      {
        name: '损失',
        type: 'bar',
        data: barData,
        barWidth: '60%',
      },
    ],
  };
}

// ── Risk Gauge Chart ────────────────────────────────────────────────────────

export function buildRiskGaugeChart(riskScore: number, isDark: boolean) {
  const c = getThemeColors(isDark);

  return {
    backgroundColor: 'transparent',
    animation: false,
    title: {
      text: '风险评分',
      left: 'center',
      textStyle: { color: c.textColor, fontSize: 14, fontFamily: 'monospace', fontWeight: 'normal' as const },
    },
    series: [
      {
        name: '风险评分',
        type: 'gauge',
        min: 0,
        max: 100,
        splitNumber: 10,
        radius: '85%',
        center: ['50%', '60%'],
        axisLine: {
          lineStyle: {
            width: 20,
            color: [
              [0.3, '#22c55e'],
              [0.6, '#eab308'],
              [0.8, '#f97316'],
              [1, '#ef4444'],
            ] as [number, string][],
          },
        },
        pointer: {
          itemStyle: { color: 'auto' },
          width: 4,
          length: '70%',
        },
        axisTick: {
          distance: -20,
          length: 6,
          lineStyle: { color: '#fff', width: 1 },
        },
        splitLine: {
          distance: -24,
          length: 14,
          lineStyle: { color: '#fff', width: 2 },
        },
        axisLabel: {
          color: c.textColor,
          fontSize: 10,
          fontFamily: 'monospace',
          distance: 28,
        },
        detail: {
          valueAnimation: false,
          formatter: (val: number) => {
            if (val <= 30) return `${val.toFixed(0)}\n低风险`;
            if (val <= 60) return `${val.toFixed(0)}\n中等`;
            if (val <= 80) return `${val.toFixed(0)}\n较高`;
            return `${val.toFixed(0)}\n极高`;
          },
          color: c.textColor,
          fontSize: 18,
          fontFamily: 'monospace',
          offsetCenter: [0, '80%'],
          lineHeight: 24,
        },
        data: [{ value: riskScore }],
      },
    ],
  };
}

// ── Risk Score Calculator ───────────────────────────────────────────────────

export function calculateRiskScore(metrics: RiskMetrics): number {
  // VaR component: abs(dailyVaR95) * 200, capped at 40
  const varComponent = Math.min(Math.abs(metrics.dailyVaR95) * 200, 40);

  // Volatility component: annualizedVolatility * 100, capped at 30
  const volComponent = Math.min(metrics.annualizedVolatility * 100, 30);

  // Skewness component: penalize negative skew, abs(skewness) * 5, capped at 15
  const skewComponent = metrics.skewness < 0
    ? Math.min(Math.abs(metrics.skewness) * 5, 15)
    : 0;

  // Kurtosis component: penalize heavy tails (positive excess kurtosis), kurtosis * 2, capped at 15
  const kurtComponent = metrics.kurtosis > 0
    ? Math.min(metrics.kurtosis * 2, 15)
    : 0;

  const raw = varComponent + volComponent + skewComponent + kurtComponent;
  return Math.max(0, Math.min(100, raw));
}
