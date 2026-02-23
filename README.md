# StockMind AI

基于 AI 的智能股票分析终端，集成实时行情、K线图表、AI 对话分析、量化策略、回测引擎、风险分析、AI 洞察、组合优化、因子分析和多股对比。

## 界面预览

### 行情中心

| 图表 | 行情看板 |
|:---:|:---:|
| ![图表](docs/assets/market-chart.png) | ![行情](docs/assets/market-watchlist.png) |

### 量化分析

| 技术指标 | 策略回测 | AI 实验室 |
|:---:|:---:|:---:|
| ![量化](docs/assets/quant-strategy.png) | ![回测](docs/assets/quant-backtest.png) | ![实验室](docs/assets/quant-lab.png) |

### AI 洞察 & 预测

| AI 洞察卡片 | AI 预测分析 |
|:---:|:---:|
| ![AI卡片](docs/assets/ai-insight-cards.png) | ![预测](docs/assets/ai-predict.png) |

### 组合优化 & 多股对比

| 组合优化 | 因子分析 | 多股对比 |
|:---:|:---:|:---:|
| ![组合](docs/assets/portfolio-optimize.png) | ![因子](docs/assets/portfolio-factor.png) | ![对比](docs/assets/compare.png) |

### 暗色主题

| 行情图表 | AI 洞察 | 策略回测 |
|:---:|:---:|:---:|
| ![暗色行情](docs/assets/dark-market-chart.png) | ![暗色AI](docs/assets/dark-ai-insight.png) | ![暗色回测](docs/assets/dark-quant-backtest.png) |

## 功能特性

### 行情中心
- **AI 对话分析** — 自然语言查询股票技术面和基本面，支持流式响应，内置 16 种 Agent 工具
- **实时行情看板** — 自选股管理、板块分类、实时价格轮询
- **K线图表** — 多周期（日/周/月）K线，支持成交量、MA均线

### 量化分析
- **技术指标** — 8种技术指标（MACD/RSI/布林带/KDJ/均线交叉/WR/OBV/ATR），插件化架构动态注册
- **策略回测** — 完整回测系统：
  - 7种内置策略 + DualThrust/海龟突破
  - 止损/止盈（百分比/ATR/追踪止损）
  - 仓位管理（固定比例/Kelly/ATR）
  - A股执行模型（T+1/涨跌停检测）
  - Walk-Forward 验证 + Deflated Sharpe 过拟合检测
  - 贝叶斯/差分进化参数优化
- **AI 实验室** — 对话式策略研究，AI 自动运行回测 + 策略进化追踪

### AI 洞察
- **AI 洞察卡片** — 5类 LLM 驱动分析卡片（市场情绪/个股诊断/风险预警/策略建议/配置洞察），支持自动刷新
- **AI 深度预测** — LLM 综合技术面+基本面+新闻的多周期预测
- **传统预测** — 多指标综合评分（-100~+100），趋势检测、支撑/阻力位

### 组合优化
- **Markowitz 均值-方差优化** — 有效前沿 + 切线组合
- **风险平价** — 等风险贡献配置
- **Black-Litterman 模型** — 市场均衡 + 主观观点融合
- **因子分析** — 动量/波动率/RSI/MACD 多因子选股，IC 值（Spearman 秩相关）

### 风险分析
- **VaR/CVaR** — 历史/Cornish-Fisher 修正/GARCH 条件异方差
- **波动率建模** — EWMA（λ=0.94）/ GARCH(1,1) MLE
- **蒙特卡洛模拟** — GBM/t-分布/Merton 跳跃扩散
- **压力测试** — 5种 A 股历史场景
- **协方差估计** — Ledoit-Wolf 收缩估计

### 其他
- **多股对比** — 最多 5 只股票：归一化收益/波动率/相关性热力图/指标对比
- **智能荐股** — 价值/成长/动量/红利 4 种风格，多因子评分推荐
- **主题切换** — 亮色/暗色主题
- **插件系统** — 22 个算法插件（8 指标 + 7 策略 + 4 风险 + 3 组合），注册中心动态管理

## 技术栈

- **运行时**: Bun
- **前端**: Next.js 16 + React 19 + TypeScript + Tailwind CSS
- **图表**: ECharts (echarts-for-react)
- **后端**: Bun.serve() 路由模块化 API
- **AI**: LangChain + DeepAgents，16 种工具
- **截图**: Playwright 自动化

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

自动截图（需先启动 dev server）：

```bash
bun scripts/screenshot.ts
```

## 项目结构

```
src/
├── core/
│   ├── api/
│   │   ├── server.ts              # API 入口（路由分发）
│   │   └── routes/                # 路由模块
│   │       ├── stocks.ts          # 股票行情/搜索/K线
│   │       ├── analysis.ts        # 回测/风险/优化/预测
│   │       ├── portfolio.ts       # 组合优化/因子分析
│   │       ├── chat.ts            # AI 对话（SSE 流式）
│   │       ├── insight.ts         # AI 洞察（结构化 JSON）
│   │       └── shared.ts          # CORS/响应工具
│   ├── agent/
│   │   ├── chatAgent.ts           # LangChain Agent 配置
│   │   └── tools/                 # 16 种 Agent 工具
│   │       ├── market.ts          # 行情/K线/基本面
│   │       ├── search.ts          # AI 搜索（新闻/股票/基本面）
│   │       ├── analysis.ts        # 回测/优化/风险/预测
│   │       ├── compare.ts         # 多股对比
│   │       ├── portfolio.ts       # 组合优化
│   │       ├── factor.ts          # 因子分析
│   │       ├── screening.ts       # 条件筛选
│   │       ├── recommend.ts       # 智能荐股
│   │       ├── deepPredict.ts     # AI 深度预测
│   │       └── chart.ts           # ECharts 图表生成
│   └── services/
│       └── eastmoney.ts           # 东方财富 API 封装
├── web/
│   ├── app/page.tsx               # 主页面（模块化导航）
│   ├── components/
│   │   ├── Chat.tsx               # AI 对话界面
│   │   ├── StockChart.tsx         # ECharts 图表渲染
│   │   ├── StockDetail.tsx        # 股票详情
│   │   ├── StockWatchlist.tsx     # 行情看板
│   │   ├── QuantStrategy.tsx      # 量化策略（插件驱动）
│   │   ├── BacktestPanel.tsx      # 回测面板（止损/仓位管理）
│   │   ├── StrategyLab.tsx        # AI 实验室
│   │   ├── AgentInsightPanel.tsx  # AI 洞察卡片
│   │   ├── PredictionPanel.tsx    # 预测分析（含 AI 深度预测）
│   │   ├── ComparePanel.tsx       # 多股对比
│   │   ├── PortfolioPanel.tsx     # 组合优化
│   │   └── FactorPanel.tsx        # 因子分析
│   ├── lib/
│   │   ├── plugins/               # 算法插件系统（22 个插件）
│   │   │   ├── types.ts           # 插件接口定义
│   │   │   ├── registry.ts        # 注册中心
│   │   │   ├── indicator/         # 8 个技术指标插件
│   │   │   ├── strategy/          # 7 个策略插件
│   │   │   ├── risk/              # 4 个风险模型插件
│   │   │   └── portfolio/         # 3 个组合优化插件
│   │   ├── indicators.ts          # 技术指标计算引擎
│   │   ├── backtest.ts            # 回测引擎核心
│   │   ├── risk.ts                # 风险分析（VaR/MC/压力测试）
│   │   ├── volatility.ts          # 波动率建模（EWMA/GARCH）
│   │   ├── advancedVaR.ts         # Cornish-Fisher VaR
│   │   ├── covariance.ts          # Ledoit-Wolf 协方差
│   │   ├── portfolio.ts           # 组合优化算法
│   │   ├── factor.ts              # 因子分析
│   │   ├── execution.ts           # A股执行模型（T+1/涨跌停）
│   │   ├── positionSizing.ts      # 仓位管理（Kelly/ATR）
│   │   ├── ensemble.ts            # 策略组合（投票/加权）
│   │   ├── validation.ts          # Walk-Forward 验证
│   │   ├── overfitDetection.ts    # Deflated Sharpe 过拟合检测
│   │   ├── optimizer.ts           # 贝叶斯/差分进化优化器
│   │   ├── agentCards.ts          # AI 洞察卡片数据层
│   │   └── llmPredict.ts          # LLM 深度预测
│   ├── types/stock.ts             # 共享类型定义
│   └── hooks/useStockSearch.ts    # 共享搜索 Hook
└── scripts/
    └── screenshot.ts              # Playwright 自动截图
```

## API 接口

| 接口 | 说明 |
|---|---|
| `GET /api/stocks/search?q=` | 股票搜索 |
| `GET /api/stocks/kline/:code?days=&klt=` | K线数据 |
| `GET /api/stocks/quote/:code` | 实时行情 |
| `GET /api/stocks/hot` | 热门股票 |
| `GET /api/stocks/sectors` | 行业板块 |
| `GET /api/stocks/sector/:code` | 板块内股票 |
| `GET /api/stocks/news/:code` | 股票新闻 |
| `GET /api/stocks/fundamentals/:code` | 基本面数据 |
| `POST /api/chat` | AI 对话（SSE 流式） |
| `POST /api/backtest` | 策略回测 |
| `POST /api/risk` | 风险分析 |
| `POST /api/optimize` | 策略参数优化 |
| `POST /api/predict` | 预测分析 |
| `POST /api/compare` | 多股对比 |
| `POST /api/portfolio/optimize` | 组合优化 |
| `POST /api/factor/analyze` | 因子分析 |
| `POST /api/stock/screen` | 条件筛选 |
| `POST /api/stocks/recommend` | 智能荐股 |
| `POST /api/agent/insight` | AI 洞察（结构化 JSON） |

## 环境变量

```env
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_MODEL_NAME=anthropic/claude-3.7-sonnet
NEXT_PUBLIC_API_URL=http://localhost:3135
```
