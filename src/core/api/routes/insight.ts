import { createChatAgent } from "@/core/agent/chatAgent";
import { jsonResponse, errorResponse } from "./shared";

type CardType = 'sentiment' | 'diagnosis' | 'risk' | 'strategy' | 'portfolio';

const INSIGHT_PROMPTS: Record<CardType, (stockCode?: string, stockName?: string) => string> = {
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

const VALID_TYPES = new Set<string>(['sentiment', 'diagnosis', 'risk', 'strategy', 'portfolio']);

export async function handleInsightRoute(req: Request, url: URL): Promise<Response | null> {
  if (req.method !== "POST" || url.pathname !== "/api/agent/insight") return null;

  try {
    const body = await req.json() as {
      type?: string;
      stockCode?: string;
      stockName?: string;
    };

    const { type, stockCode, stockName } = body;

    if (!type || !VALID_TYPES.has(type)) {
      return errorResponse("Invalid or missing type. Must be one of: sentiment, diagnosis, risk, strategy, portfolio", 400);
    }

    const cardType = type as CardType;

    if (cardType === 'diagnosis' && !stockCode) {
      return errorResponse("stockCode is required for diagnosis type", 400);
    }

    const prompt = INSIGHT_PROMPTS[cardType](stockCode, stockName);
    const agent = createChatAgent();

    // Use invoke (non-streaming) to get the full response
    const result = await agent.invoke(
      { messages: [{ role: 'user', content: prompt }] },
      { recursionLimit: 80 },
    );

    // Extract text from the last AI message
    let fullText = '';
    const messages = result.messages || [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const msgType = msg._getType?.();
      if (msgType === 'ai') {
        if (typeof msg.content === 'string') {
          fullText = msg.content;
        } else if (Array.isArray(msg.content)) {
          fullText = msg.content
            .filter((c: any) => c.type === 'text' || typeof c === 'string')
            .map((c: any) => (typeof c === 'string' ? c : c.text || ''))
            .join('');
        }
        break;
      }
    }

    // Try to parse structured JSON from the response
    const jsonMatch = fullText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return jsonResponse({
          summary: parsed.summary || fullText.slice(0, 200),
          score: typeof parsed.score === 'number' ? parsed.score : undefined,
          trend: parsed.trend || undefined,
          items: Array.isArray(parsed.items) ? parsed.items : [],
          tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        });
      } catch {
        // fall through to fallback
      }
    }

    // Fallback: return raw text as summary
    return jsonResponse({ summary: fullText.slice(0, 500), items: [] });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error("Error in insight route:", err);
    return errorResponse(errorMessage);
  }
}
