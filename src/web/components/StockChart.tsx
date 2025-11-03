import React from 'react';
import ReactECharts from 'echarts-for-react';

interface StockChartProps {
  data?: Record<string, unknown>;
  className?: string;
}

export default function StockChart({ data, className = '' }: StockChartProps) {
  // Sophisticated terminal-style dark theme for ECharts
  const terminalTheme = {
    backgroundColor: 'transparent',
    textStyle: {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    },
    title: {
      textStyle: {
        color: '#94a3b8',
      }
    },
    line: {
      smooth: true,
    }
  };

  // Demo mock data for empty state
  const mockOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
        label: {
          backgroundColor: '#0f172a',
          color: '#e2e8f0',
          borderColor: '#334155',
          borderWidth: 1,
          shadowBlur: 0,
        },
        crossStyle: { color: '#334155', type: 'dashed' }
      },
      backgroundColor: 'rgba(10, 14, 23, 0.95)',
      borderColor: '#1e293b',
      textStyle: { color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace' },
      padding: [8, 12],
      borderRadius: 4,
    },
    grid: [
      { left: '4%', right: '4%', height: '55%', top: '5%' },
      { left: '4%', right: '4%', top: '65%', height: '20%' }
    ],
    xAxis: [
      {
        type: 'category',
        data: ['2023-01', '2023-02', '2023-03', '2023-04', '2023-05', '2023-06', '2023-07'],
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#334155' } },
        splitLine: { show: true, lineStyle: { color: '#1e293b', type: 'dashed' } },
        axisLabel: { color: '#64748b', fontSize: 11, margin: 12 },
        min: 'dataMin',
        max: 'dataMax',
      },
      {
        type: 'category',
        gridIndex: 1,
        data: ['2023-01', '2023-02', '2023-03', '2023-04', '2023-05', '2023-06', '2023-07'],
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#334155' } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        min: 'dataMin',
        max: 'dataMax'
      }
    ],
    yAxis: [
      {
        scale: true,
        splitArea: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: true, lineStyle: { color: '#1e293b', type: 'dashed' } },
        axisLabel: { color: '#64748b', fontSize: 11, inside: true, margin: 8 },
      },
      {
        scale: true,
        gridIndex: 1,
        splitNumber: 2,
        axisLabel: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false }
      }
    ],
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: [0, 1],
        start: 10,
        end: 100
      },
      {
        show: true,
        xAxisIndex: [0, 1],
        type: 'slider',
        top: '90%',
        height: 20,
        start: 10,
        end: 100,
        borderColor: '#1e293b',
        backgroundColor: 'transparent',
        fillerColor: 'rgba(56, 189, 248, 0.1)',
        handleStyle: {
          color: '#38bdf8',
          borderColor: '#0284c7',
        },
        textStyle: { color: '#64748b' }
      }
    ],
    series: [
      {
        name: 'Candlestick',
        type: 'candlestick',
        data: [
          [20, 34, 10, 38],
          [40, 35, 30, 50],
          [31, 38, 33, 44],
          [38, 15, 5, 42],
          [20, 34, 10, 38],
          [40, 35, 30, 50],
          [31, 38, 33, 44]
        ],
        itemStyle: {
          color: 'rgba(239, 68, 68, 0.9)', // Up in Red (Finance style var) or transparent green
          color0: 'rgba(16, 185, 129, 0.9)', // Down in Green
          borderColor: '#ef4444',
          borderColor0: '#10b981',
          borderWidth: 1.5,
        }
      },
      // MA Lines
      {
        name: 'MA5',
        type: 'line',
        data: [25, 34, 30, 32, 28, 34, 36],
        smooth: true,
        lineStyle: { opacity: 0.8, width: 1.5, color: '#38bdf8' },
        symbol: 'none'
      },
      {
        name: 'MA10',
        type: 'line',
        data: [22, 28, 35, 29, 26, 30, 38],
        smooth: true,
        lineStyle: { opacity: 0.8, width: 1.5, color: '#c084fc' },
        symbol: 'none'
      },
      {
        name: 'Volume',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: [1000, 2000, 1500, 3000, 1200, 2500, 1800],
        itemStyle: {
          color: (params: { dataIndex: number }) => {
            // Very simplified volume color matching
            return params.dataIndex % 2 === 0 ? 'rgba(239, 68, 68, 0.5)' : 'rgba(16, 185, 129, 0.5)';
          }
        }
      }
    ]
  };

  const option = data || mockOption;

  return (
    <div className={`w-full h-full ${className}`}>
      {/*
        This div wraps ECharts to perfectly fill its container.
        We don't need padding/borders here, let the parent control it for maximum flexibility
      */}
      <ReactECharts
        option={option}
        style={{ height: '100%', width: '100%' }}
        opts={{ renderer: 'canvas' }}
        theme={terminalTheme}
      />
    </div>
  );
}