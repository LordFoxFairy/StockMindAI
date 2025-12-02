import type { NormalizedReturn, CorrelationMatrix, MetricRanking, VolatilityComparison } from './compare';
import type { compareIndicators } from './compare';

// ── Theme ───────────────────────────────────────────────────────────────────

interface ThemeColors {
  textColor: string;
  borderColor: string;
  gridLineColor: string;
  tooltipBg: string;
  tooltipText: string;
}

function getThemeColors(isDark: boolean): ThemeColors {
  return isDark
    ? {
        textColor: '#94a3b8',
        borderColor: '#1e293b',
        gridLineColor: '#1e293b',
        tooltipBg: 'rgba(15, 23, 42, 0.95)',
        tooltipText: '#e2e8f0',
      }
    : {
        textColor: '#64748b',
        borderColor: '#e2e8f0',
        gridLineColor: '#f1f5f9',
        tooltipBg: 'rgba(255, 255, 255, 0.95)',
        tooltipText: '#334155',
      };
}

const STOCK_COLORS = ['#38bdf8', '#fb923c', '#a78bfa', '#34d399', '#f87171'];

// ── Normalized Return Chart ─────────────────────────────────────────────────

export function buildNormalizedReturnChart(data: NormalizedReturn, isDark: boolean) {
  const c = getThemeColors(isDark);

  const series: any[] = data.series.map((s, i) => ({
    name: s.name,
    type: 'line',
    data: s.values,
    lineStyle: { width: 2, color: STOCK_COLORS[i % STOCK_COLORS.length] },
    itemStyle: { color: STOCK_COLORS[i % STOCK_COLORS.length] },
    symbol: 'none',
    z: 2,
  }));

  // Baseline at 100
  series.push({
    name: '基准线',
    type: 'line',
    data: data.dates.map(() => 100),
    lineStyle: { width: 1, color: c.textColor, type: 'dashed' as const, opacity: 0.5 },
    symbol: 'none',
    silent: true,
    z: 1,
  });

  return {
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: c.tooltipBg,
      borderColor: c.borderColor,
      textStyle: { color: c.tooltipText, fontSize: 11, fontFamily: 'monospace' },
      padding: [8, 12],
    },
    legend: {
      data: data.series.map(s => s.name),
      textStyle: { color: c.textColor, fontSize: 11 },
      top: 0,
    },
    grid: { left: '8%', right: '3%', top: '12%', bottom: '18%' },
    xAxis: {
      type: 'category' as const,
      data: data.dates,
      boundaryGap: false,
      axisLine: { lineStyle: { color: c.borderColor } },
      axisLabel: { color: c.textColor, fontSize: 10, formatter: (v: string) => v.slice(5) },
      axisTick: { show: false },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value' as const,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: true, lineStyle: { color: c.gridLineColor, type: 'dashed' as const } },
      axisLabel: { color: c.textColor, fontSize: 10 },
    },
    dataZoom: [{ type: 'inside' as const, start: 0, end: 100 }],
    series,
  };
}

// ── Correlation Heatmap ─────────────────────────────────────────────────────

export function buildCorrelationHeatmap(matrix: CorrelationMatrix, isDark: boolean) {
  const c = getThemeColors(isDark);
  const names = matrix.stockNames;

  // Build data: [x, y, value]
  const data: [number, number, number][] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = 0; j < names.length; j++) {
      data.push([j, i, +matrix.matrix[i][j].toFixed(2)]);
    }
  }

  return {
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      position: 'top' as const,
      backgroundColor: c.tooltipBg,
      borderColor: c.borderColor,
      textStyle: { color: c.tooltipText, fontSize: 11, fontFamily: 'monospace' },
      formatter: (params: any) => {
        const d = params.data;
        return `${names[d[1]]} vs ${names[d[0]]}<br/>相关系数: ${d[2]}`;
      },
    },
    grid: { left: '18%', right: '12%', top: '8%', bottom: '18%' },
    xAxis: {
      type: 'category' as const,
      data: names,
      axisLine: { lineStyle: { color: c.borderColor } },
      axisLabel: { color: c.textColor, fontSize: 10, rotate: 30 },
      axisTick: { show: false },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'category' as const,
      data: names,
      axisLine: { lineStyle: { color: c.borderColor } },
      axisLabel: { color: c.textColor, fontSize: 10 },
      axisTick: { show: false },
      splitLine: { show: false },
    },
    visualMap: {
      min: -1,
      max: 1,
      calculable: false,
      orient: 'horizontal' as const,
      left: 'center',
      bottom: '0%',
      inRange: {
        color: ['#ef4444', '#fbbf24', '#ffffff', '#93c5fd', '#3b82f6'],
      },
      textStyle: { color: c.textColor, fontSize: 10 },
    },
    series: [
      {
        type: 'heatmap' as const,
        data,
        label: {
          show: true,
          color: isDark ? '#e2e8f0' : '#334155',
          fontSize: 11,
          fontFamily: 'monospace',
          formatter: (params: any) => params.data[2].toFixed(2),
        },
        itemStyle: { borderColor: isDark ? '#0f172a' : '#ffffff', borderWidth: 2 },
      },
    ],
  };
}

// ── Compare Bar Chart (Horizontal) ──────────────────────────────────────────

export function buildCompareBarChart(ranking: MetricRanking, isDark: boolean) {
  const c = getThemeColors(isDark);
  const names = ranking.rankings.map(r => r.name);
  const values = ranking.rankings.map(r => r.value);

  return {
    backgroundColor: 'transparent',
    animation: false,
    title: {
      text: ranking.metric,
      left: 'center',
      top: 0,
      textStyle: { color: c.textColor, fontSize: 13, fontFamily: 'monospace', fontWeight: 'normal' as const },
    },
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: { type: 'shadow' as const },
      backgroundColor: c.tooltipBg,
      borderColor: c.borderColor,
      textStyle: { color: c.tooltipText, fontSize: 11, fontFamily: 'monospace' },
    },
    grid: { left: '22%', right: '12%', top: '14%', bottom: '8%' },
    xAxis: {
      type: 'value' as const,
      axisLine: { lineStyle: { color: c.borderColor } },
      axisLabel: { color: c.textColor, fontSize: 10 },
      splitLine: { show: true, lineStyle: { color: c.gridLineColor, type: 'dashed' as const } },
    },
    yAxis: {
      type: 'category' as const,
      data: names.reverse(),
      axisLine: { lineStyle: { color: c.borderColor } },
      axisLabel: { color: c.textColor, fontSize: 10 },
      axisTick: { show: false },
    },
    series: [
      {
        type: 'bar' as const,
        data: values.reverse().map((v, i) => ({
          value: v,
          itemStyle: { color: STOCK_COLORS[i % STOCK_COLORS.length] },
        })),
        barWidth: '50%',
        label: {
          show: true,
          position: 'right' as const,
          color: c.textColor,
          fontSize: 10,
          fontFamily: 'monospace',
          formatter: (params: any) => {
            const val = params.value;
            if (ranking.metric === '夏普比率') return val.toFixed(2);
            return (val * 100).toFixed(2) + '%';
          },
        },
      },
    ],
  };
}

// ── Volatility Compare Chart ────────────────────────────────────────────────

export function buildVolatilityCompareChart(volData: VolatilityComparison, isDark: boolean) {
  const c = getThemeColors(isDark);
  const names = volData.stocks.map(s => s.name);
  const values = volData.stocks.map(s => +(s.annualizedVol * 100).toFixed(2));
  const avgVol = values.reduce((a, b) => a + b, 0) / values.length;

  // Color gradient: lower vol = green, higher vol = red
  const minVol = Math.min(...values);
  const maxVol = Math.max(...values);
  const range = maxVol - minVol || 1;

  function volColor(val: number): string {
    const ratio = (val - minVol) / range;
    const r = Math.round(34 + ratio * (239 - 34));
    const g = Math.round(197 - ratio * (197 - 68));
    const b = Math.round(94 - ratio * (94 - 68));
    return `rgb(${r}, ${g}, ${b})`;
  }

  return {
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: { type: 'shadow' as const },
      backgroundColor: c.tooltipBg,
      borderColor: c.borderColor,
      textStyle: { color: c.tooltipText, fontSize: 11, fontFamily: 'monospace' },
      formatter: (params: any) => {
        const p = params[0];
        return `${p.name}<br/>年化波动率: ${p.value.toFixed(2)}%`;
      },
    },
    grid: { left: '12%', right: '5%', top: '8%', bottom: '12%' },
    xAxis: {
      type: 'category' as const,
      data: names,
      axisLine: { lineStyle: { color: c.borderColor } },
      axisLabel: { color: c.textColor, fontSize: 10 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value' as const,
      name: '年化波动率 (%)',
      nameTextStyle: { color: c.textColor, fontSize: 10 },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: true, lineStyle: { color: c.gridLineColor, type: 'dashed' as const } },
      axisLabel: { color: c.textColor, fontSize: 10 },
    },
    series: [
      {
        type: 'bar' as const,
        data: values.map(v => ({
          value: v,
          itemStyle: { color: volColor(v) },
        })),
        barWidth: '50%',
        label: {
          show: true,
          position: 'top' as const,
          color: c.textColor,
          fontSize: 10,
          fontFamily: 'monospace',
          formatter: (params: any) => params.value.toFixed(2) + '%',
        },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: '#94a3b8', type: 'dashed' as const, width: 1 },
          data: [{ yAxis: +avgVol.toFixed(2), label: { formatter: '平均: {c}%', color: c.textColor, fontSize: 10 } }],
        },
      },
    ],
  };
}

// ── Indicator Compare Chart (Grouped Bar) ───────────────────────────────────

export function buildIndicatorCompareChart(
  indicators: ReturnType<typeof compareIndicators>,
  isDark: boolean,
) {
  const c = getThemeColors(isDark);
  const metricLabels = ['MACD柱值', 'RSI', 'KDJ-K', '布林位置'];

  const series = indicators.map((stock, i) => ({
    name: stock.name,
    type: 'bar' as const,
    data: [stock.macd, stock.rsi, stock.kdj_k, stock.bollPosition],
    itemStyle: { color: STOCK_COLORS[i % STOCK_COLORS.length] },
    barGap: '10%',
    label: {
      show: false,
    },
  }));

  return {
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: { type: 'shadow' as const },
      backgroundColor: c.tooltipBg,
      borderColor: c.borderColor,
      textStyle: { color: c.tooltipText, fontSize: 11, fontFamily: 'monospace' },
    },
    legend: {
      data: indicators.map(s => s.name),
      textStyle: { color: c.textColor, fontSize: 11 },
      top: 0,
    },
    grid: { left: '10%', right: '5%', top: '14%', bottom: '8%' },
    xAxis: {
      type: 'category' as const,
      data: metricLabels,
      axisLine: { lineStyle: { color: c.borderColor } },
      axisLabel: { color: c.textColor, fontSize: 10 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value' as const,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: true, lineStyle: { color: c.gridLineColor, type: 'dashed' as const } },
      axisLabel: { color: c.textColor, fontSize: 10 },
    },
    series,
  };
}
