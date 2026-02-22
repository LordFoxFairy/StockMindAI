export type CardType = 'sentiment' | 'diagnosis' | 'risk' | 'strategy' | 'portfolio';

export interface AgentCard {
  id: string;
  type: CardType;
  title: string;
  icon: string;
  stockCode?: string;
  stockName?: string;
  loading: boolean;
  error: string | null;
  data: CardData | null;
  updatedAt: Date | null;
}

export interface CardData {
  summary: string;
  score?: number;
  trend?: 'bullish' | 'bearish' | 'neutral';
  items: CardItem[];
  tags?: string[];
}

export interface CardItem {
  label: string;
  value: string;
  type?: 'positive' | 'negative' | 'neutral' | 'warning';
}

export const CARD_PROMPTS: Record<CardType, (stockCode?: string, stockName?: string) => string> = {
  sentiment: () =>
    `分析当前A股市场整体情绪，包括成交量、涨跌比、板块轮动、资金流向等。请以JSON格式返回：{"summary":"一句话总结", "score": 0到100的数字, "trend":"bullish或bearish或neutral", "items":[{"label":"指标名", "value":"指标值", "type":"positive或negative或neutral"}], "tags":["关键词"]}`,
  diagnosis: (code, name) =>
    `对${name}(${code})进行全面诊断分析，包括技术面、基本面、资金面、消息面。请以JSON格式返回：{"summary":"一句话总结", "score": 0到100的数字, "trend":"bullish或bearish或neutral", "items":[{"label":"指标名", "value":"指标值", "type":"positive或negative或neutral"}], "tags":["关键词"]}`,
  risk: (code, name) =>
    `分析${name ? name + '(' + code + ')' : 'A股市场'}当前风险状况，包括波动率、回撤风险、估值风险、政策风险等。请以JSON格式返回：{"summary":"一句话总结", "score": 0到100的数字, "trend":"bullish或bearish或neutral", "items":[{"label":"风险因子", "value":"描述", "type":"positive或negative或neutral或warning"}], "tags":["关键词"]}`,
  strategy: (code, name) =>
    `基于当前市场状况，推荐${name ? name + '的' : ''}交易策略，包括进出场时机、仓位建议、止损止盈。请以JSON格式返回：{"summary":"一句话总结", "score": 0到100的数字, "trend":"bullish或bearish或neutral", "items":[{"label":"策略要点", "value":"具体建议", "type":"positive或negative或neutral"}], "tags":["关键词"]}`,
  portfolio: () =>
    `分析当前市场环境下的最优资产配置建议，包括大类资产比例、行业配置、风格偏好。请以JSON格式返回：{"summary":"一句话总结", "score": 0到100的数字, "trend":"bullish或bearish或neutral", "items":[{"label":"配置方向", "value":"具体建议", "type":"positive或negative或neutral"}], "tags":["关键词"]}`,
};

export async function fetchCardInsight(
  type: CardType,
  stockCode?: string,
  stockName?: string,
): Promise<CardData> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3135';
  const prompt = CARD_PROMPTS[type](stockCode, stockName);

  const response = await fetch(`${apiUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.body) throw new Error('No response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let done = false;
  let sseBuffer = '';

  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;
    if (value) {
      sseBuffer += decoder.decode(value, { stream: true });
      const parts = sseBuffer.split('\n\n');
      sseBuffer = parts.pop() || '';
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.type === 'text' && data.content) {
              fullText += data.content;
            }
          } catch {
            // ignore parse errors on partial chunks
          }
        }
      }
    }
  }

  return parseCardResponse(fullText);
}

export async function fetchCardInsightDirect(
  type: CardType,
  stockCode?: string,
  stockName?: string,
): Promise<CardData> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3135';

  const response = await fetch(`${apiUrl}/api/agent/insight`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, stockCode, stockName }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error((errBody as any)?.error || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return {
    summary: data.summary || '',
    score: typeof data.score === 'number' ? data.score : undefined,
    trend: data.trend || undefined,
    items: Array.isArray(data.items) ? data.items : [],
    tags: Array.isArray(data.tags) ? data.tags : [],
  };
}

export function parseCardResponse(text: string): CardData {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || text.slice(0, 200),
        score: typeof parsed.score === 'number' ? parsed.score : undefined,
        trend: parsed.trend || undefined,
        items: Array.isArray(parsed.items) ? parsed.items : [],
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      };
    } catch {
      // fall through to fallback
    }
  }
  return { summary: text.slice(0, 500), items: [] };
}

export const CARD_CONFIGS: {
  type: CardType;
  title: string;
  icon: string;
  needsStock: boolean;
}[] = [
  { type: 'sentiment', title: '市场情绪', icon: 'Activity', needsStock: false },
  { type: 'diagnosis', title: '个股诊断', icon: 'Stethoscope', needsStock: true },
  { type: 'risk', title: '风险预警', icon: 'ShieldAlert', needsStock: false },
  { type: 'strategy', title: '策略建议', icon: 'Lightbulb', needsStock: false },
  { type: 'portfolio', title: '配置洞察', icon: 'PieChart', needsStock: false },
];

export function createDefaultCards(
  stockCode?: string,
  stockName?: string,
): AgentCard[] {
  return CARD_CONFIGS.map((cfg, i) => ({
    id: `card-${cfg.type}-${Date.now()}-${i}`,
    type: cfg.type,
    title: cfg.title,
    icon: cfg.icon,
    stockCode: cfg.needsStock ? stockCode : undefined,
    stockName: cfg.needsStock ? stockName : undefined,
    loading: false,
    error: null,
    data: null,
    updatedAt: null,
  }));
}
