import { pluginRegistry } from './registry';

// ─── Indicator Plugins ──────────────────────────────────────────────────────
import { macdPlugin } from './indicator/macd';
import { rsiPlugin } from './indicator/rsi';
import { bollingerPlugin } from './indicator/bollinger';
import { kdjPlugin } from './indicator/kdj';
import { maCrossPlugin } from './indicator/maCross';
import { wrPlugin } from './indicator/wr';
import { obvPlugin } from './indicator/obv';
import { atrPlugin } from './indicator/atr';

// ─── Risk Plugins ──────────────────────────────────────────────────────────
import historicalVaRPlugin from './risk/historicalVaR';
import garchVaRPlugin from './risk/garchVaR';
import ewmaVolPlugin from './risk/ewmaVol';
import cornishFisherPlugin from './risk/cornishFisher';

// ─── Portfolio Plugins ────────────────────────────────────────────────────
import markowitzPlugin from './portfolio/markowitz';
import riskParityPlugin from './portfolio/riskParity';
import blackLittermanPlugin from './portfolio/blackLitterman';

// ─── Strategy Plugins ───────────────────────────────────────────────────────
import { macdStrategyPlugin } from './strategy/macdStrategy';
import { rsiStrategyPlugin } from './strategy/rsiStrategy';
import { bollingerStrategyPlugin } from './strategy/bollingerStrategy';
import { kdjStrategyPlugin } from './strategy/kdjStrategy';
import { maCrossStrategyPlugin } from './strategy/maCrossStrategy';
import { dualThrustPlugin } from './strategy/dualThrust';
import { turtleBreakoutPlugin } from './strategy/turtleBreakout';

// ─── Register Indicator Plugins ─────────────────────────────────────────────
pluginRegistry.register(macdPlugin);
pluginRegistry.register(rsiPlugin);
pluginRegistry.register(bollingerPlugin);
pluginRegistry.register(kdjPlugin);
pluginRegistry.register(maCrossPlugin);
pluginRegistry.register(wrPlugin);
pluginRegistry.register(obvPlugin);
pluginRegistry.register(atrPlugin);

// ─── Register Strategy Plugins ──────────────────────────────────────────────
pluginRegistry.register(macdStrategyPlugin);
pluginRegistry.register(rsiStrategyPlugin);
pluginRegistry.register(bollingerStrategyPlugin);
pluginRegistry.register(kdjStrategyPlugin);
pluginRegistry.register(maCrossStrategyPlugin);
pluginRegistry.register(dualThrustPlugin);
pluginRegistry.register(turtleBreakoutPlugin);

// ─── Register Risk Plugins ─────────────────────────────────────────────────
pluginRegistry.register(historicalVaRPlugin);
pluginRegistry.register(garchVaRPlugin);
pluginRegistry.register(ewmaVolPlugin);
pluginRegistry.register(cornishFisherPlugin);

// ─── Register Portfolio Plugins ────────────────────────────────────────────
pluginRegistry.register(markowitzPlugin);
pluginRegistry.register(riskParityPlugin);
pluginRegistry.register(blackLittermanPlugin);

// ─── Re-export ──────────────────────────────────────────────────────────────
export { pluginRegistry };

export type {
  PluginCategory,
  ParamSchema,
  PluginMeta,
  IndicatorPlugin,
  StrategyPlugin,
  RiskPlugin,
  AssetData,
  PortfolioPlugin,
  AlgoPlugin,
} from './types';
