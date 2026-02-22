import type { OHLCVItem } from '../indicators';
import type { TradeSignal } from '../backtest';

export type PluginCategory = 'indicator' | 'strategy' | 'risk' | 'portfolio';

export interface ParamSchema {
  key: string;
  label: string;
  type: 'number' | 'select';
  default: number | string;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string | number }[];
}

export interface PluginMeta {
  id: string;
  name: string;
  category: PluginCategory;
  description: string;
  params: ParamSchema[];
}

export interface IndicatorPlugin extends PluginMeta {
  category: 'indicator';
  compute: (data: OHLCVItem[], params: Record<string, any>) => any;
}

export interface StrategyPlugin extends PluginMeta {
  category: 'strategy';
  generateSignals: (data: OHLCVItem[], params: Record<string, any>) => TradeSignal[];
}

export interface RiskPlugin extends PluginMeta {
  category: 'risk';
  analyze: (returns: number[], params: Record<string, any>) => any;
}

export interface AssetData {
  code: string;
  name: string;
  returns: number[];
  expectedReturn?: number;
}

export interface PortfolioPlugin extends PluginMeta {
  category: 'portfolio';
  optimize: (assets: AssetData[], params: Record<string, any>) => any;
}

export type AlgoPlugin = IndicatorPlugin | StrategyPlugin | RiskPlugin | PortfolioPlugin;
