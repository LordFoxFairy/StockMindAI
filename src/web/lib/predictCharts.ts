import type { OHLCVItem } from './indicators';
import type { TrendResult, SupportResistance, IndicatorSignal } from './predict';

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

// ── Prediction K-line Chart with Support/Resistance ─────────────────────────

export function buildPredictionChart(
  klineData: OHLCVItem[],
  sr: SupportResistance,
  trend: TrendResult,
  isDark: boolean,
) {
  const c = getThemeColors(isDark);
  const dates = klineData.map(k => k.date);

  // Support/resistance mark lines
  const markLineData: any[] = [];
  for (const s of sr.supports.slice(0, 3)) {
    markLineData.push({
      yAxis: s.price,
      lineStyle: { color: '#22c55e', type: 'dashed' as const, width: 1.5 },
      label: {
        formatter: `支撑 ${s.price.toFixed(2)}`,
        color: '#22c55e',
        fontSize: 10,
        fontFamily: 'monospace',
        position: 'insideEndTop' as const,
      },
    });
  }
  for (const r of sr.resistances.slice(0, 3)) {
    markLineData.push({
      yAxis: r.price,
      lineStyle: { color: '#ef4444', type: 'dashed' as const, width: 1.5 },
      label: {
        formatter: `阻力 ${r.price.toFixed(2)}`,
        color: '#ef4444',
        fontSize: 10,
        fontFamily: 'monospace',
        position: 'insideEndTop' as const,
      },
    });
  }

  // Trend annotation
  const lastHigh = klineData[klineData.length - 1]?.high ?? 0;
  const trendColor = trend.direction === 'up' ? '#22c55e' : trend.direction === 'down' ? '#ef4444' : '#eab308';
  const trendSymbol = trend.direction === 'up' ? 'triangle' : trend.direction === 'down' ? 'arrow' : 'diamond';
  const trendLabel = trend.direction === 'up' ? '上升趋势' : trend.direction === 'down' ? '下降趋势' : '横盘震荡';

  const markPointData = [{
    coord: [dates[dates.length - 1], lastHigh * 1.02],
    symbol: trendSymbol,
    symbolSize: 16,
    symbolRotate: trend.direction === 'down' ? 180 : 0,
    itemStyle: { color: trendColor },
    label: {
      show: true,
      formatter: `${trendLabel}(${trend.strength})`,
      color: trendColor,
      fontSize: 10,
      fontFamily: 'monospace',
      position: 'top' as const,
    },
  }];

  return {
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: {
        type: 'cross' as const,
        crossStyle: { color: isDark ? '#475569' : '#cbd5e1', type: 'dashed' as const },
        label: {
          backgroundColor: isDark ? '#1e293b' : '#f8fafc',
          color: isDark ? '#e2e8f0' : '#334155',
          borderColor: c.borderColor,
          borderWidth: 1,
        },
      },
      backgroundColor: c.tooltipBg,
      borderColor: c.borderColor,
      textStyle: { color: c.tooltipText, fontSize: 11, fontFamily: 'monospace' },
      padding: [8, 12],
    },
    grid: [
      { left: '8%', right: '3%', top: '6%', height: '62%' },
      { left: '8%', right: '3%', top: '72%', height: '20%' },
    ],
    xAxis: [
      {
        type: 'category' as const,
        data: dates,
        gridIndex: 0,
        boundaryGap: true,
        axisLine: { lineStyle: { color: c.borderColor } },
        splitLine: { show: false },
        axisLabel: { show: false },
        axisTick: { show: false },
      },
      {
        type: 'category' as const,
        data: dates,
        gridIndex: 1,
        boundaryGap: true,
        axisLine: { lineStyle: { color: c.borderColor } },
        splitLine: { show: false },
        axisLabel: { color: c.textColor, fontSize: 10, formatter: (v: string) => v.slice(5) },
        axisTick: { show: false },
      },
    ],
    yAxis: [
      {
        scale: true,
        gridIndex: 0,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: true, lineStyle: { color: c.gridLineColor, type: 'dashed' as const } },
        axisLabel: { color: c.textColor, fontSize: 10 },
      },
      {
        scale: true,
        gridIndex: 1,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        splitNumber: 2,
      },
    ],
    dataZoom: [{ type: 'inside' as const, xAxisIndex: [0, 1], start: 0, end: 100 }],
    series: [
      {
        name: 'K线',
        type: 'candlestick' as const,
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: klineData.map(k => [k.open, k.close, k.low, k.high]),
        itemStyle: {
          color: c.upColor,
          color0: c.downColor,
          borderColor: c.upColor,
          borderColor0: c.downColor,
          borderWidth: 1,
        },
        markLine: {
          silent: true,
          symbol: ['none', 'none'],
          data: markLineData,
        },
        markPoint: {
          data: markPointData,
        },
      },
      {
        name: '成交量',
        type: 'bar' as const,
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: klineData.map(k => ({
          value: k.volume,
          itemStyle: { color: k.close >= k.open ? c.upColorAlpha : c.downColorAlpha },
        })),
      },
    ],
  };
}

// ── Radar Chart for Indicator Signals ───────────────────────────────────────

export function buildRadarChart(signals: IndicatorSignal[], isDark: boolean) {
  const c = getThemeColors(isDark);

  const indicatorNames = ['MACD', 'RSI', '布林带', 'KDJ', '均线'];
  const signalMap = new Map(signals.map(s => [s.name, s]));

  // Normalize scores to 0-100 range: (score + 100) / 2
  const values = indicatorNames.map(name => {
    const sig = signalMap.get(name);
    return sig ? Math.round((sig.score + 100) / 2) : 50;
  });

  const avgScore = signals.reduce((sum, s) => sum + s.score, 0) / signals.length;
  const fillColor = avgScore > 0
    ? (isDark ? 'rgba(34, 197, 94, 0.3)' : 'rgba(34, 197, 94, 0.25)')
    : (isDark ? 'rgba(239, 68, 68, 0.3)' : 'rgba(239, 68, 68, 0.25)');
  const lineColor = avgScore > 0 ? '#22c55e' : '#ef4444';

  return {
    backgroundColor: 'transparent',
    animation: false,
    title: {
      text: `综合评分: ${Math.round(avgScore)}`,
      left: 'center',
      top: 'center',
      textStyle: {
        color: avgScore > 0 ? '#22c55e' : avgScore < 0 ? '#ef4444' : c.textColor,
        fontSize: 16,
        fontFamily: 'monospace',
        fontWeight: 'bold' as const,
      },
    },
    radar: {
      indicator: indicatorNames.map(name => ({
        name,
        max: 100,
      })),
      shape: 'polygon' as const,
      splitNumber: 4,
      name: {
        textStyle: {
          color: c.textColor,
          fontSize: 12,
          fontFamily: 'monospace',
        },
      },
      splitLine: {
        lineStyle: { color: c.gridLineColor },
      },
      splitArea: {
        show: true,
        areaStyle: {
          color: isDark
            ? ['rgba(30, 41, 59, 0.3)', 'rgba(30, 41, 59, 0.1)']
            : ['rgba(241, 245, 249, 0.5)', 'rgba(241, 245, 249, 0.2)'],
        },
      },
      axisLine: {
        lineStyle: { color: c.gridLineColor },
      },
    },
    series: [{
      type: 'radar',
      data: [{
        value: values,
        name: '指标信号',
        areaStyle: { color: fillColor },
        lineStyle: { color: lineColor, width: 2 },
        symbol: 'circle',
        symbolSize: 6,
        itemStyle: { color: lineColor },
      }],
    }],
  };
}

// ── Composite Gauge Chart ───────────────────────────────────────────────────

export function buildCompositeGaugeChart(score: number, isDark: boolean) {
  const c = getThemeColors(isDark);

  return {
    backgroundColor: 'transparent',
    animation: false,
    title: {
      text: '综合预测评分',
      left: 'center',
      textStyle: {
        color: c.textColor,
        fontSize: 14,
        fontFamily: 'monospace',
        fontWeight: 'normal' as const,
      },
    },
    series: [{
      name: '综合评分',
      type: 'gauge',
      min: -100,
      max: 100,
      splitNumber: 10,
      radius: '85%',
      center: ['50%', '60%'],
      axisLine: {
        lineStyle: {
          width: 20,
          color: [
            [0.25, '#dc2626'],   // -100 to -50: deep red (强烈看跌)
            [0.40, '#ef4444'],   // -50 to -20: red (偏空)
            [0.60, '#eab308'],   // -20 to +20: yellow (中性)
            [0.75, '#22c55e'],   // +20 to +50: green (偏多)
            [1, '#15803d'],      // +50 to +100: deep green (强烈看涨)
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
          if (val <= -50) return `${val.toFixed(0)}\n强烈看跌`;
          if (val <= -20) return `${val.toFixed(0)}\n偏空`;
          if (val < 20) return `${val.toFixed(0)}\n中性`;
          if (val < 50) return `${val.toFixed(0)}\n偏多`;
          return `${val.toFixed(0)}\n强烈看涨`;
        },
        color: c.textColor,
        fontSize: 18,
        fontFamily: 'monospace',
        offsetCenter: [0, '80%'],
        lineHeight: 24,
      },
      data: [{ value: score }],
    }],
  };
}
