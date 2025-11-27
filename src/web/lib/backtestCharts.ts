import type { BacktestResult, Trade, EquityPoint } from './backtest';

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

// ─── Helper: calculate monthly returns ────────────────────────────────────────

export function calculateMonthlyReturns(
  equityCurve: EquityPoint[],
): { year: number; month: number; return: number }[] {
  if (equityCurve.length === 0) return [];

  // Group equity points by year-month
  const groups = new Map<string, EquityPoint[]>();
  for (const pt of equityCurve) {
    const d = pt.date; // "YYYY-MM-DD"
    const key = d.slice(0, 7); // "YYYY-MM"
    let arr = groups.get(key);
    if (!arr) {
      arr = [];
      groups.set(key, arr);
    }
    arr.push(pt);
  }

  const results: { year: number; month: number; return: number }[] = [];
  for (const [key, pts] of Array.from(groups.entries())) {
    const year = parseInt(key.slice(0, 4), 10);
    const month = parseInt(key.slice(5, 7), 10);
    const first = pts[0].equity;
    const last = pts[pts.length - 1].equity;
    const ret = first > 0 ? (last - first) / first : 0;
    results.push({ year, month, return: +ret.toFixed(6) });
  }

  return results;
}

// ─── 1. Equity Curve Chart ────────────────────────────────────────────────────

export function buildEquityCurveChart(result: BacktestResult, isDark: boolean) {
  const c = getThemeColors(isDark);
  const dates = result.equityCurve.map(p => p.date);
  const equityData = result.equityCurve.map(p => p.equity);
  const benchmarkData = result.equityCurve.map(p => p.benchmark);
  const drawdownData = result.equityCurve.map(p => +(p.drawdown * 100).toFixed(2));

  // Build date-to-index map for trade markers
  const dateIndexMap = new Map<string, number>();
  for (let i = 0; i < dates.length; i++) {
    dateIndexMap.set(dates[i], i);
  }

  // Buy/sell scatter on equity curve
  const buyScatter: (null | { value: [string, number]; itemStyle: { color: string } })[] = dates.map(() => null);
  const sellScatter: (null | { value: [string, number]; itemStyle: { color: string } })[] = dates.map(() => null);

  for (const trade of result.trades) {
    const buyIdx = dateIndexMap.get(trade.entryDate);
    if (buyIdx !== undefined) {
      buyScatter[buyIdx] = {
        value: [dates[buyIdx], equityData[buyIdx]],
        itemStyle: { color: '#22c55e' },
      };
    }
    const sellIdx = dateIndexMap.get(trade.exitDate);
    if (sellIdx !== undefined) {
      sellScatter[sellIdx] = {
        value: [dates[sellIdx], equityData[sellIdx]],
        itemStyle: { color: '#ef4444' },
      };
    }
  }

  // Per-trade P&L bars
  const tradePnlData = result.trades.map((t, i) => ({
    value: +(t.pnlPercent * 100).toFixed(2),
    itemStyle: { color: t.pnl > 0 ? c.downColor : c.upColor },
  }));
  const tradeLabels = result.trades.map((_, i) => `#${i + 1}`);

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
      formatter: (params: any) => {
        if (!Array.isArray(params) || params.length === 0) return '';
        const date = params[0].axisValue;
        const lines: string[] = [`<b>${date}</b>`];
        for (const p of params) {
          if (p.seriesName === '策略收益') {
            lines.push(`策略: ¥${Number(p.value).toLocaleString()}`);
          } else if (p.seriesName === '基准(持有)') {
            lines.push(`基准: ¥${Number(p.value).toLocaleString()}`);
          } else if (p.seriesName === '回撤') {
            lines.push(`回撤: ${p.value}%`);
          }
        }
        return lines.join('<br/>');
      },
    },
    legend: {
      data: ['策略收益', '基准(持有)'],
      top: 0,
      textStyle: { color: c.textColor, fontSize: 11 },
    },
    grid: [
      { left: '8%', right: '3%', top: '8%', height: '42%' },
      { left: '8%', right: '3%', top: '54%', height: '16%' },
      { left: '8%', right: '3%', top: '76%', height: '18%' },
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
        axisLabel: {
          color: c.textColor,
          fontSize: 10,
          formatter: (v: string) => v.slice(5),
        },
        axisTick: { show: false },
      },
      {
        type: 'category' as const,
        data: tradeLabels,
        gridIndex: 2,
        boundaryGap: true,
        axisLine: { lineStyle: { color: c.borderColor } },
        splitLine: { show: false },
        axisLabel: { color: c.textColor, fontSize: 9 },
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
        splitNumber: 3,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: true, lineStyle: { color: c.gridLineColor, type: 'dashed' as const } },
        axisLabel: {
          color: c.textColor,
          fontSize: 10,
          formatter: (v: number) => `${v}%`,
        },
      },
      {
        scale: true,
        gridIndex: 2,
        splitNumber: 3,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: true, lineStyle: { color: c.gridLineColor, type: 'dashed' as const } },
        axisLabel: {
          color: c.textColor,
          fontSize: 10,
          formatter: (v: number) => `${v}%`,
        },
      },
    ],
    series: [
      {
        name: '策略收益',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: equityData,
        lineStyle: { width: 1.5, color: '#38bdf8' },
        symbol: 'none',
      },
      {
        name: '基准(持有)',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: benchmarkData,
        lineStyle: { width: 1, color: '#94a3b8', type: 'dashed' as const },
        symbol: 'none',
      },
      {
        name: '买入',
        type: 'scatter',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: buyScatter,
        symbol: 'triangle',
        symbolSize: 10,
        z: 10,
      },
      {
        name: '卖出',
        type: 'scatter',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: sellScatter,
        symbol: 'pin',
        symbolSize: 12,
        symbolRotate: 180,
        z: 10,
      },
      {
        name: '回撤',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: drawdownData,
        lineStyle: { width: 1, color: c.upColor },
        areaStyle: { color: c.upColorAlpha, opacity: 0.3 },
        symbol: 'none',
      },
      {
        name: '交易盈亏',
        type: 'bar',
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: tradePnlData,
      },
    ],
    dataZoom: [
      { type: 'inside' as const, xAxisIndex: [0, 1], start: 0, end: 100 },
    ],
  };
}

// ─── 2. Trade Distribution Chart ──────────────────────────────────────────────

export function buildTradeDistributionChart(trades: Trade[], isDark: boolean) {
  const c = getThemeColors(isDark);

  if (trades.length === 0) {
    return {
      backgroundColor: 'transparent',
      animation: false,
      title: {
        text: '无交易数据',
        left: 'center',
        top: 'center',
        textStyle: { color: c.textColor, fontSize: 14 },
      },
    };
  }

  // ── Grid 0: P&L distribution histogram ──
  const pnlValues = trades.map(t => +(t.pnlPercent * 100).toFixed(2));
  const minPnl = Math.min(...pnlValues);
  const maxPnl = Math.max(...pnlValues);
  const range = maxPnl - minPnl;
  const bucketCount = 20;
  const bucketSize = range > 0 ? range / bucketCount : 1;

  const buckets: { center: number; count: number }[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const lo = minPnl + i * bucketSize;
    const hi = lo + bucketSize;
    const center = +((lo + hi) / 2).toFixed(2);
    const count = pnlValues.filter(v => (i < bucketCount - 1 ? v >= lo && v < hi : v >= lo && v <= hi)).length;
    buckets.push({ center, count });
  }

  const histLabels = buckets.map(b => `${b.center}%`);
  const histData = buckets.map(b => ({
    value: b.count,
    itemStyle: { color: b.center >= 0 ? c.downColor : c.upColor },
  }));

  // ── Grid 1: Cumulative P&L line ──
  const cumPnl: number[] = [];
  let running = 0;
  for (const t of trades) {
    running += t.pnl;
    cumPnl.push(+running.toFixed(2));
  }
  const finalCum = cumPnl.length > 0 ? cumPnl[cumPnl.length - 1] : 0;
  const cumColor = finalCum >= 0 ? c.downColor : c.upColor;
  const cumColorAlpha = finalCum >= 0 ? c.downColorAlpha : c.upColorAlpha;
  const tradeNumbers = trades.map((_, i) => `${i + 1}`);

  // Find the zero bucket index for markLine
  let zeroIdx = 0;
  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i].center >= 0) { zeroIdx = i; break; }
  }

  return {
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: {
        type: 'shadow' as const,
      },
      backgroundColor: c.tooltipBg,
      borderColor: c.borderColor,
      textStyle: { color: c.tooltipText, fontSize: 11, fontFamily: 'monospace' },
      padding: [8, 12],
    },
    grid: [
      { left: '10%', right: '5%', top: '6%', height: '40%' },
      { left: '10%', right: '5%', top: '56%', height: '36%' },
    ],
    xAxis: [
      {
        type: 'category' as const,
        data: histLabels,
        gridIndex: 0,
        boundaryGap: true,
        axisLine: { lineStyle: { color: c.borderColor } },
        splitLine: { show: false },
        axisLabel: { color: c.textColor, fontSize: 9, rotate: 45 },
        axisTick: { show: false },
        name: '收益率(%)',
        nameTextStyle: { color: c.textColor, fontSize: 10 },
      },
      {
        type: 'category' as const,
        data: tradeNumbers,
        gridIndex: 1,
        boundaryGap: true,
        axisLine: { lineStyle: { color: c.borderColor } },
        splitLine: { show: false },
        axisLabel: { color: c.textColor, fontSize: 10 },
        axisTick: { show: false },
        name: '交易序号',
        nameTextStyle: { color: c.textColor, fontSize: 10 },
      },
    ],
    yAxis: [
      {
        type: 'value' as const,
        gridIndex: 0,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: true, lineStyle: { color: c.gridLineColor, type: 'dashed' as const } },
        axisLabel: { color: c.textColor, fontSize: 10 },
        name: '次数',
        nameTextStyle: { color: c.textColor, fontSize: 10 },
      },
      {
        type: 'value' as const,
        gridIndex: 1,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: true, lineStyle: { color: c.gridLineColor, type: 'dashed' as const } },
        axisLabel: { color: c.textColor, fontSize: 10 },
        name: '累计盈亏(¥)',
        nameTextStyle: { color: c.textColor, fontSize: 10 },
      },
    ],
    series: [
      {
        name: '分布',
        type: 'bar',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: histData,
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: c.textColor, type: 'dashed' as const, width: 1 },
          data: [{ xAxis: histLabels[zeroIdx] }],
        },
      },
      {
        name: '累计盈亏',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: cumPnl,
        lineStyle: { width: 1.5, color: cumColor },
        areaStyle: { color: cumColorAlpha, opacity: 0.3 },
        symbol: 'none',
      },
    ],
  };
}

// ─── 3. Monthly Returns Heatmap ───────────────────────────────────────────────

export function buildMonthlyReturnsChart(equityCurve: EquityPoint[], isDark: boolean) {
  const c = getThemeColors(isDark);
  const monthly = calculateMonthlyReturns(equityCurve);

  if (monthly.length === 0) {
    return {
      backgroundColor: 'transparent',
      animation: false,
      title: {
        text: '无月度数据',
        left: 'center',
        top: 'center',
        textStyle: { color: c.textColor, fontSize: 14 },
      },
    };
  }

  const years = Array.from(new Set(monthly.map(m => m.year))).sort((a, b) => a - b);
  const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

  // Build heatmap data: [monthIndex, yearIndex, returnPercent]
  const heatmapData: [number, number, number | null][] = [];
  for (let yi = 0; yi < years.length; yi++) {
    for (let mi = 0; mi < 12; mi++) {
      const entry = monthly.find(m => m.year === years[yi] && m.month === mi + 1);
      if (entry) {
        heatmapData.push([mi, yi, +(entry.return * 100).toFixed(2)]);
      } else {
        heatmapData.push([mi, yi, null]);
      }
    }
  }

  // Find min/max for visualMap
  const validReturns = heatmapData
    .filter((d): d is [number, number, number] => d[2] !== null)
    .map(d => d[2]);
  const minReturn = validReturns.length > 0 ? Math.min(...validReturns) : -10;
  const maxReturn = validReturns.length > 0 ? Math.max(...validReturns) : 10;
  const absMax = Math.max(Math.abs(minReturn), Math.abs(maxReturn), 1);

  return {
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: c.tooltipBg,
      borderColor: c.borderColor,
      textStyle: { color: c.tooltipText, fontSize: 11, fontFamily: 'monospace' },
      padding: [8, 12],
      formatter: (params: any) => {
        const [mi, yi, val] = params.data;
        if (val === null) return '';
        return `${years[yi]}年${months[mi]}<br/>收益率: ${val > 0 ? '+' : ''}${val}%`;
      },
    },
    grid: {
      left: '10%',
      right: '12%',
      top: '6%',
      bottom: '10%',
    },
    xAxis: {
      type: 'category' as const,
      data: months,
      splitArea: { show: true },
      axisLine: { lineStyle: { color: c.borderColor } },
      axisLabel: { color: c.textColor, fontSize: 10 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'category' as const,
      data: years.map(String),
      splitArea: { show: true },
      axisLine: { lineStyle: { color: c.borderColor } },
      axisLabel: { color: c.textColor, fontSize: 10 },
      axisTick: { show: false },
    },
    visualMap: {
      min: -absMax,
      max: absMax,
      calculable: true,
      orient: 'vertical' as const,
      right: '2%',
      top: 'center',
      inRange: {
        color: ['#ef4444', '#fca5a5', '#fef2f2', '#f0fdf4', '#86efac', '#22c55e'],
      },
      textStyle: { color: c.textColor, fontSize: 10 },
      formatter: (val: number) => `${val > 0 ? '+' : ''}${val.toFixed(1)}%`,
    },
    series: [
      {
        type: 'heatmap',
        data: heatmapData.filter(d => d[2] !== null),
        label: {
          show: true,
          color: c.tooltipText,
          fontSize: 10,
          fontFamily: 'monospace',
          formatter: (params: any) => {
            const val = params.data[2];
            return val !== null ? `${val > 0 ? '+' : ''}${val}%` : '';
          },
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
      },
    ],
  };
}
