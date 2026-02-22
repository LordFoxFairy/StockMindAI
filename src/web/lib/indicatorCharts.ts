import type { OHLCVItem, MACDResult, BollingerResult, KDJResult, MACrossResult } from './indicators';
import type { WRResult } from './plugins/indicator/wr';
import type { OBVResult } from './plugins/indicator/obv';
import type { ATRResult } from './plugins/indicator/atr';

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

function buildBaseOption(dates: string[], isDark: boolean) {
  const c = getThemeColors(isDark);
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
    dataZoom: [{ type: 'inside' as const, xAxisIndex: [0, 1, 2], start: 0, end: 100 }],
  };
}

function buildCandleSeries(items: OHLCVItem[], isDark: boolean) {
  const c = getThemeColors(isDark);
  return {
    name: 'K线',
    type: 'candlestick' as const,
    data: items.map(k => [k.open, k.close, k.low, k.high]),
    itemStyle: {
      color: c.upColor,
      color0: c.downColor,
      borderColor: c.upColor,
      borderColor0: c.downColor,
      borderWidth: 1,
    },
  };
}

function buildVolumeSeries(items: OHLCVItem[], isDark: boolean, xAxisIndex: number, yAxisIndex: number) {
  const c = getThemeColors(isDark);
  return {
    name: '成交量',
    type: 'bar' as const,
    xAxisIndex,
    yAxisIndex,
    data: items.map(k => ({
      value: k.volume,
      itemStyle: { color: k.close >= k.open ? c.upColorAlpha : c.downColorAlpha },
    })),
  };
}

function makeXAxis(dates: string[], c: ThemeColors, show = true) {
  return {
    type: 'category' as const,
    data: dates,
    boundaryGap: true,
    axisLine: { lineStyle: { color: c.borderColor } },
    splitLine: { show: false },
    axisLabel: show
      ? { color: c.textColor, fontSize: 10, formatter: (v: string) => v.slice(5) }
      : { show: false },
    axisTick: { show: false },
  };
}

function makeYAxis(c: ThemeColors, opts?: { gridIndex?: number; show?: boolean; splitNumber?: number }) {
  const show = opts?.show ?? true;
  return {
    scale: true,
    gridIndex: opts?.gridIndex,
    splitNumber: opts?.splitNumber,
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { show, lineStyle: { color: c.gridLineColor, type: 'dashed' as const } },
    axisLabel: show ? { color: c.textColor, fontSize: 10 } : { show: false },
  };
}

// ---- MACD Chart ----
export function buildMACDChart(
  items: OHLCVItem[],
  macdData: MACDResult,
  isDark: boolean,
) {
  const dates = items.map(k => k.date);
  const c = getThemeColors(isDark);
  const base = buildBaseOption(dates, isDark);

  return {
    ...base,
    grid: [
      { left: '8%', right: '3%', top: '6%', height: '42%' },
      { left: '8%', right: '3%', top: '52%', height: '22%' },
      { left: '8%', right: '3%', top: '78%', height: '16%' },
    ],
    xAxis: [
      { ...makeXAxis(dates, c, false), gridIndex: 0 },
      { ...makeXAxis(dates, c, false), gridIndex: 1 },
      { ...makeXAxis(dates, c, true), gridIndex: 2 },
    ],
    yAxis: [
      makeYAxis(c, { gridIndex: 0 }),
      makeYAxis(c, { gridIndex: 1, show: true, splitNumber: 3 }),
      makeYAxis(c, { gridIndex: 2, show: false, splitNumber: 2 }),
    ],
    series: [
      { ...buildCandleSeries(items, isDark), xAxisIndex: 0, yAxisIndex: 0 },
      {
        name: 'DIF',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: macdData.dif,
        lineStyle: { width: 1.5, color: '#38bdf8' },
        symbol: 'none',
      },
      {
        name: 'DEA',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: macdData.dea,
        lineStyle: { width: 1.5, color: '#fb923c' },
        symbol: 'none',
      },
      {
        name: 'MACD',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: macdData.histogram.map(v =>
          v === null
            ? { value: 0 }
            : { value: v, itemStyle: { color: v >= 0 ? c.upColor : c.downColor } },
        ),
      },
      { ...buildVolumeSeries(items, isDark, 2, 2) },
    ],
    dataZoom: [{ type: 'inside' as const, xAxisIndex: [0, 1, 2], start: 0, end: 100 }],
  };
}

// ---- RSI Chart ----
export function buildRSIChart(
  items: OHLCVItem[],
  rsiData: (number | null)[],
  isDark: boolean,
) {
  const dates = items.map(k => k.date);
  const c = getThemeColors(isDark);
  const base = buildBaseOption(dates, isDark);

  return {
    ...base,
    grid: [
      { left: '8%', right: '3%', top: '6%', height: '45%' },
      { left: '8%', right: '3%', top: '56%', height: '22%' },
      { left: '8%', right: '3%', top: '82%', height: '12%' },
    ],
    xAxis: [
      { ...makeXAxis(dates, c, false), gridIndex: 0 },
      { ...makeXAxis(dates, c, false), gridIndex: 1 },
      { ...makeXAxis(dates, c, true), gridIndex: 2 },
    ],
    yAxis: [
      makeYAxis(c, { gridIndex: 0 }),
      {
        ...makeYAxis(c, { gridIndex: 1, show: true, splitNumber: 3 }),
        min: 0,
        max: 100,
      },
      makeYAxis(c, { gridIndex: 2, show: false, splitNumber: 2 }),
    ],
    series: [
      { ...buildCandleSeries(items, isDark), xAxisIndex: 0, yAxisIndex: 0 },
      {
        name: 'RSI',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: rsiData,
        lineStyle: { width: 1.5, color: '#a78bfa' },
        symbol: 'none',
      },
      {
        name: '超买线',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: dates.map(() => 70),
        lineStyle: { width: 1, color: c.upColor, type: 'dashed' as const },
        symbol: 'none',
        silent: true,
      },
      {
        name: '超卖线',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: dates.map(() => 30),
        lineStyle: { width: 1, color: c.downColor, type: 'dashed' as const },
        symbol: 'none',
        silent: true,
      },
      { ...buildVolumeSeries(items, isDark, 2, 2) },
    ],
    dataZoom: [{ type: 'inside' as const, xAxisIndex: [0, 1, 2], start: 0, end: 100 }],
  };
}

// ---- Bollinger Bands Chart ----
export function buildBollingerChart(
  items: OHLCVItem[],
  boll: BollingerResult,
  isDark: boolean,
) {
  const dates = items.map(k => k.date);
  const c = getThemeColors(isDark);
  const base = buildBaseOption(dates, isDark);

  return {
    ...base,
    grid: [
      { left: '8%', right: '3%', top: '6%', height: '58%' },
      { left: '8%', right: '3%', top: '70%', height: '22%' },
    ],
    xAxis: [
      { ...makeXAxis(dates, c, false), gridIndex: 0 },
      { ...makeXAxis(dates, c, true), gridIndex: 1 },
    ],
    yAxis: [
      makeYAxis(c, { gridIndex: 0 }),
      makeYAxis(c, { gridIndex: 1, show: false, splitNumber: 2 }),
    ],
    series: [
      { ...buildCandleSeries(items, isDark), xAxisIndex: 0, yAxisIndex: 0 },
      {
        name: '中轨',
        type: 'line',
        data: boll.middle,
        lineStyle: { width: 1.5, color: '#fb923c' },
        symbol: 'none',
      },
      {
        name: '上轨',
        type: 'line',
        data: boll.upper,
        lineStyle: { width: 1, color: '#f87171', type: 'dashed' as const },
        symbol: 'none',
      },
      {
        name: '下轨',
        type: 'line',
        data: boll.lower,
        lineStyle: { width: 1, color: '#34d399', type: 'dashed' as const },
        symbol: 'none',
      },
      { ...buildVolumeSeries(items, isDark, 1, 1) },
    ],
    dataZoom: [{ type: 'inside' as const, xAxisIndex: [0, 1], start: 0, end: 100 }],
  };
}

// ---- KDJ Chart ----
export function buildKDJChart(
  items: OHLCVItem[],
  kdjData: KDJResult,
  isDark: boolean,
) {
  const dates = items.map(k => k.date);
  const c = getThemeColors(isDark);
  const base = buildBaseOption(dates, isDark);

  return {
    ...base,
    grid: [
      { left: '8%', right: '3%', top: '6%', height: '42%' },
      { left: '8%', right: '3%', top: '52%', height: '22%' },
      { left: '8%', right: '3%', top: '78%', height: '16%' },
    ],
    xAxis: [
      { ...makeXAxis(dates, c, false), gridIndex: 0 },
      { ...makeXAxis(dates, c, false), gridIndex: 1 },
      { ...makeXAxis(dates, c, true), gridIndex: 2 },
    ],
    yAxis: [
      makeYAxis(c, { gridIndex: 0 }),
      {
        ...makeYAxis(c, { gridIndex: 1, show: true, splitNumber: 3 }),
        min: 0,
        max: 100,
      },
      makeYAxis(c, { gridIndex: 2, show: false, splitNumber: 2 }),
    ],
    series: [
      { ...buildCandleSeries(items, isDark), xAxisIndex: 0, yAxisIndex: 0 },
      {
        name: 'K',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: kdjData.k,
        lineStyle: { width: 1.5, color: '#38bdf8' },
        symbol: 'none',
      },
      {
        name: 'D',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: kdjData.d,
        lineStyle: { width: 1.5, color: '#fb923c' },
        symbol: 'none',
      },
      {
        name: 'J',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: kdjData.j,
        lineStyle: { width: 1.5, color: '#a78bfa' },
        symbol: 'none',
      },
      {
        name: '超买线',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: dates.map(() => 80),
        lineStyle: { width: 1, color: c.upColor, type: 'dashed' as const },
        symbol: 'none',
        silent: true,
      },
      {
        name: '超卖线',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: dates.map(() => 20),
        lineStyle: { width: 1, color: c.downColor, type: 'dashed' as const },
        symbol: 'none',
        silent: true,
      },
      { ...buildVolumeSeries(items, isDark, 2, 2) },
    ],
    dataZoom: [{ type: 'inside' as const, xAxisIndex: [0, 1, 2], start: 0, end: 100 }],
  };
}

// ---- MA Cross Chart ----
export function buildMACrossChart(
  items: OHLCVItem[],
  crossData: MACrossResult,
  shortPeriod: number,
  longPeriod: number,
  isDark: boolean,
) {
  const dates = items.map(k => k.date);
  const c = getThemeColors(isDark);
  const base = buildBaseOption(dates, isDark);

  const goldenScatter: (null | { value: number; itemStyle: { color: string } })[] = dates.map(() => null);
  const deadScatter: (null | { value: number; itemStyle: { color: string } })[] = dates.map(() => null);
  for (const sig of crossData.signals) {
    if (sig.type === 'golden') {
      goldenScatter[sig.index] = { value: sig.price * 0.98, itemStyle: { color: '#ef4444' } };
    } else {
      deadScatter[sig.index] = { value: sig.price * 1.02, itemStyle: { color: '#22c55e' } };
    }
  }

  return {
    ...base,
    grid: [
      { left: '8%', right: '3%', top: '6%', height: '58%' },
      { left: '8%', right: '3%', top: '70%', height: '22%' },
    ],
    xAxis: [
      { ...makeXAxis(dates, c, false), gridIndex: 0 },
      { ...makeXAxis(dates, c, true), gridIndex: 1 },
    ],
    yAxis: [
      makeYAxis(c, { gridIndex: 0 }),
      makeYAxis(c, { gridIndex: 1, show: false, splitNumber: 2 }),
    ],
    series: [
      { ...buildCandleSeries(items, isDark), xAxisIndex: 0, yAxisIndex: 0 },
      {
        name: `MA${shortPeriod}`,
        type: 'line',
        data: crossData.shortMA,
        lineStyle: { width: 1.5, color: '#38bdf8' },
        symbol: 'none',
      },
      {
        name: `MA${longPeriod}`,
        type: 'line',
        data: crossData.longMA,
        lineStyle: { width: 1.5, color: '#c084fc' },
        symbol: 'none',
      },
      {
        name: '金叉',
        type: 'scatter',
        data: goldenScatter,
        symbol: 'triangle',
        symbolSize: 12,
        z: 10,
      },
      {
        name: '死叉',
        type: 'scatter',
        data: deadScatter,
        symbol: 'pin',
        symbolSize: 14,
        symbolRotate: 180,
        z: 10,
      },
      { ...buildVolumeSeries(items, isDark, 1, 1) },
    ],
    dataZoom: [{ type: 'inside' as const, xAxisIndex: [0, 1], start: 0, end: 100 }],
  };
}

// ---- Williams %R Chart ----
export function buildWRChart(
  items: OHLCVItem[],
  wrData: WRResult,
  isDark: boolean,
) {
  const dates = items.map(k => k.date);
  const c = getThemeColors(isDark);
  const base = buildBaseOption(dates, isDark);

  return {
    ...base,
    grid: [
      { left: '8%', right: '3%', top: '6%', height: '45%' },
      { left: '8%', right: '3%', top: '56%', height: '22%' },
      { left: '8%', right: '3%', top: '82%', height: '12%' },
    ],
    xAxis: [
      { ...makeXAxis(dates, c, false), gridIndex: 0 },
      { ...makeXAxis(dates, c, false), gridIndex: 1 },
      { ...makeXAxis(dates, c, true), gridIndex: 2 },
    ],
    yAxis: [
      makeYAxis(c, { gridIndex: 0 }),
      {
        ...makeYAxis(c, { gridIndex: 1, show: true, splitNumber: 3 }),
        min: -100,
        max: 0,
      },
      makeYAxis(c, { gridIndex: 2, show: false, splitNumber: 2 }),
    ],
    series: [
      { ...buildCandleSeries(items, isDark), xAxisIndex: 0, yAxisIndex: 0 },
      {
        name: 'WR',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: wrData.wr,
        lineStyle: { width: 1.5, color: '#a78bfa' },
        symbol: 'none',
      },
      {
        name: '超买线',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: dates.map(() => -20),
        lineStyle: { width: 1, color: c.upColor, type: 'dashed' as const },
        symbol: 'none',
        silent: true,
      },
      {
        name: '超卖线',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: dates.map(() => -80),
        lineStyle: { width: 1, color: c.downColor, type: 'dashed' as const },
        symbol: 'none',
        silent: true,
      },
      { ...buildVolumeSeries(items, isDark, 2, 2) },
    ],
    dataZoom: [{ type: 'inside' as const, xAxisIndex: [0, 1, 2], start: 0, end: 100 }],
  };
}

// ---- OBV Chart ----
export function buildOBVChart(
  items: OHLCVItem[],
  obvData: OBVResult,
  isDark: boolean,
) {
  const dates = items.map(k => k.date);
  const c = getThemeColors(isDark);
  const base = buildBaseOption(dates, isDark);

  return {
    ...base,
    grid: [
      { left: '8%', right: '3%', top: '6%', height: '45%' },
      { left: '8%', right: '3%', top: '56%', height: '22%' },
      { left: '8%', right: '3%', top: '82%', height: '12%' },
    ],
    xAxis: [
      { ...makeXAxis(dates, c, false), gridIndex: 0 },
      { ...makeXAxis(dates, c, false), gridIndex: 1 },
      { ...makeXAxis(dates, c, true), gridIndex: 2 },
    ],
    yAxis: [
      makeYAxis(c, { gridIndex: 0 }),
      makeYAxis(c, { gridIndex: 1, show: true, splitNumber: 3 }),
      makeYAxis(c, { gridIndex: 2, show: false, splitNumber: 2 }),
    ],
    series: [
      { ...buildCandleSeries(items, isDark), xAxisIndex: 0, yAxisIndex: 0 },
      {
        name: 'OBV',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: obvData.obv,
        lineStyle: { width: 1.5, color: '#38bdf8' },
        areaStyle: { color: 'rgba(56, 189, 248, 0.1)' },
        symbol: 'none',
      },
      { ...buildVolumeSeries(items, isDark, 2, 2) },
    ],
    dataZoom: [{ type: 'inside' as const, xAxisIndex: [0, 1, 2], start: 0, end: 100 }],
  };
}

// ---- ATR Chart ----
export function buildATRChart(
  items: OHLCVItem[],
  atrData: ATRResult,
  isDark: boolean,
) {
  const dates = items.map(k => k.date);
  const c = getThemeColors(isDark);
  const base = buildBaseOption(dates, isDark);

  return {
    ...base,
    grid: [
      { left: '8%', right: '3%', top: '6%', height: '45%' },
      { left: '8%', right: '3%', top: '56%', height: '22%' },
      { left: '8%', right: '3%', top: '82%', height: '12%' },
    ],
    xAxis: [
      { ...makeXAxis(dates, c, false), gridIndex: 0 },
      { ...makeXAxis(dates, c, false), gridIndex: 1 },
      { ...makeXAxis(dates, c, true), gridIndex: 2 },
    ],
    yAxis: [
      makeYAxis(c, { gridIndex: 0 }),
      makeYAxis(c, { gridIndex: 1, show: true, splitNumber: 3 }),
      makeYAxis(c, { gridIndex: 2, show: false, splitNumber: 2 }),
    ],
    series: [
      { ...buildCandleSeries(items, isDark), xAxisIndex: 0, yAxisIndex: 0 },
      {
        name: 'ATR',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: atrData.atr,
        lineStyle: { width: 1.5, color: '#fb923c' },
        areaStyle: { color: 'rgba(251, 146, 60, 0.1)' },
        symbol: 'none',
      },
      {
        name: 'TR',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: atrData.tr,
        lineStyle: { width: 1, color: '#94a3b8', type: 'dotted' as const },
        symbol: 'none',
      },
      { ...buildVolumeSeries(items, isDark, 2, 2) },
    ],
    dataZoom: [{ type: 'inside' as const, xAxisIndex: [0, 1, 2], start: 0, end: 100 }],
  };
}
