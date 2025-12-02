# StockMind AI

基于 AI 的智能股票分析终端，集成实时行情、K线图表、AI 对话分析、量化策略、回测引擎、风险分析、AI 预测和多股对比。

## 界面预览

![量化策略分析](docs/assets/img.png)

![股票K线详情](docs/assets/img_1.png)

## 功能特性

- **AI 对话分析** — 自然语言查询股票技术面和基本面，支持流式响应，内置搜索/行情/K线/回测/优化/预测工具
- **实时行情看板** — 自选股管理、板块分类、实时价格轮询
- **K线图表** — 多周期（1分/5分/15分/30分/时/日/周/月）K线，支持成交量、MA均线
- **量化策略分析** — 内置五种经典技术指标，纯前端计算 + ECharts 可视化：
  - **MACD** — DIF/DEA/柱状图，动能趋势判断
  - **RSI** — 相对强弱指数，超买超卖信号
  - **布林带** — 上中下三轨，波动率和突破分析
  - **KDJ** — 随机指标，短期超买超卖
  - **均线交叉** — 双均线金叉/死叉信号检测
- **策略回测引擎** — 完整回测系统，支持佣金/滑点/印花税模拟：
  - 收益曲线 + 基准对比 + 回撤图 + 交易明细
  - 夏普比率、最大回撤、胜率、盈亏比、Calmar比率
  - 月度收益热力图 + 交易分布直方图
- **风险分析** — VaR/CVaR、蒙特卡洛模拟、压力测试（5种A股历史场景）、风险评分仪表盘
- **AI 因子实验室** — 对话式策略研究，AI 自动运行回测 + 网格搜索优化 + 策略进化追踪
- **AI 预测分析** — 多指标综合预测评分（-100~+100）：
  - 综合仪表盘 + 雷达图 + K线支撑/阻力位标注
  - 趋势检测（MA5/MA20/MA60 斜率分析）
  - 置信度评估（指标一致性）
- **多股对比** — 最多5只股票同时对比：
  - 归一化收益曲线 + 波动率对比 + 相关性热力图 + 指标对比
- **主题切换** — 支持亮色/暗色主题
- **状态持久化** — localStorage 保存会话、选股、tab 状态

## 技术栈

- **运行时**: Bun
- **前端**: Next.js 16 + React 19 + TypeScript + Tailwind CSS
- **图表**: ECharts (echarts-for-react)
- **后端**: Bun.serve() API 服务
- **AI**: DeepAgents 集成

## 快速开始

安装依赖：

```bash
bun install
```

启动开发服务器（前端 + API）：

```bash
bun run dev
```

- 前端: http://localhost:3134
- API: http://localhost:3135

生产构建：

```bash
bun run build
```

## 项目结构

```
src/
├── core/
│   └── api/          # Bun API 服务器
├── web/
│   ├── app/          # Next.js 页面
│   ├── components/   # React 组件
│   │   ├── Chat.tsx             # AI 对话界面
│   │   ├── StockChart.tsx       # ECharts 图表渲染
│   │   ├── StockDetail.tsx      # 股票详情（K线+行情）
│   │   ├── StockWatchlist.tsx   # 自选股/行情看板
│   │   ├── QuantStrategy.tsx    # 量化策略分析页面
│   │   ├── BacktestPanel.tsx    # 策略回测面板
│   │   ├── StrategyLab.tsx      # AI 因子实验室
│   │   ├── PredictionPanel.tsx  # AI 预测分析面板
│   │   ├── ComparePanel.tsx     # 多股对比面板
│   │   └── ThemeProvider.tsx    # 主题管理
│   └── lib/
│       ├── indicators.ts        # 技术指标计算（SMA/EMA/MACD/RSI/BOLL/KDJ/MA交叉）
│       ├── indicatorCharts.ts   # 各策略 ECharts 图表配置生成
│       ├── backtest.ts          # 回测引擎核心
│       ├── backtestCharts.ts    # 回测可视化图表
│       ├── risk.ts              # 风险分析（VaR/CVaR/MC/压力测试）
│       ├── riskCharts.ts        # 风险分析图表
│       ├── predict.ts           # 多指标预测分析
│       ├── predictCharts.ts     # 预测可视化图表
│       ├── compare.ts           # 多股对比计算
│       └── compareCharts.ts     # 对比可视化图表
```

## API 接口

| 接口                                      | 说明                         |
|-------------------------------------------|------------------------------|
| `GET /api/stocks/search?q=`               | 股票搜索                     |
| `GET /api/stocks/kline/:code?days=&klt=`  | K线数据                      |
| `GET /api/stocks/quote/:code`             | 实时行情                     |
| `GET /api/stocks/hot`                     | 热门股票（按成交额排序）     |
| `GET /api/stocks/sectors`                 | 行业板块列表                 |
| `GET /api/stocks/sector/:code`            | 板块内股票                   |
| `POST /api/chat`                          | AI 对话（SSE 流式）          |
| `POST /api/backtest`                      | 策略回测                     |
| `POST /api/risk`                          | 风险分析                     |
| `POST /api/optimize`                      | 策略参数优化                 |
| `POST /api/predict`                       | AI 预测分析                  |
