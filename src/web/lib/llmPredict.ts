export interface LLMTimeframe {
  period: string;
  outlook: 'bullish' | 'bearish' | 'neutral';
  reasoning: string;
}

export interface LLMPrediction {
  trend: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  priceTarget: { low: number; mid: number; high: number };
  timeframes: LLMTimeframe[];
  keyFactors: string[];
  risks: string[];
  catalysts: string[];
  summary?: string;
}

const DEEP_PREDICT_PROMPT = (code: string, name: string) =>
  `作为资深量化分析师，请对${name}(${code})进行深度预测分析。综合技术面、基本面、资金面、消息面给出全面预判。

请严格以如下JSON格式返回（不要多余文字）：
{
  "trend": "bullish 或 bearish 或 neutral",
  "confidence": 0到100的数字,
  "priceTarget": { "low": 最低目标价, "mid": 中间目标价, "high": 最高目标价 },
  "timeframes": [
    { "period": "短期(1-2周)", "outlook": "bullish/bearish/neutral", "reasoning": "理由" },
    { "period": "中期(1-3月)", "outlook": "bullish/bearish/neutral", "reasoning": "理由" },
    { "period": "长期(3-6月)", "outlook": "bullish/bearish/neutral", "reasoning": "理由" }
  ],
  "keyFactors": ["关键因子1", "关键因子2", ...],
  "risks": ["风险1", "风险2", ...],
  "catalysts": ["催化剂1", "催化剂2", ...],
  "summary": "一段总结性分析文字"
}`;

export async function fetchDeepPrediction(
  stockCode: string,
  stockName: string,
): Promise<LLMPrediction> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3135';
  const prompt = DEEP_PREDICT_PROMPT(stockCode, stockName);

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
            // ignore partial chunk parse errors
          }
        }
      }
    }
  }

  return parseLLMPrediction(fullText);
}

export function parseLLMPrediction(text: string): LLMPrediction {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        trend: parsed.trend || 'neutral',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 50,
        priceTarget: {
          low: parsed.priceTarget?.low ?? 0,
          mid: parsed.priceTarget?.mid ?? 0,
          high: parsed.priceTarget?.high ?? 0,
        },
        timeframes: Array.isArray(parsed.timeframes)
          ? parsed.timeframes.map((tf: any) => ({
              period: tf.period || '',
              outlook: tf.outlook || 'neutral',
              reasoning: tf.reasoning || '',
            }))
          : [],
        keyFactors: Array.isArray(parsed.keyFactors) ? parsed.keyFactors : [],
        risks: Array.isArray(parsed.risks) ? parsed.risks : [],
        catalysts: Array.isArray(parsed.catalysts) ? parsed.catalysts : [],
        summary: parsed.summary || undefined,
      };
    } catch {
      // fall through
    }
  }
  return {
    trend: 'neutral',
    confidence: 0,
    priceTarget: { low: 0, mid: 0, high: 0 },
    timeframes: [],
    keyFactors: [],
    risks: [text.slice(0, 200) || '无法解析预测结果'],
    catalysts: [],
    summary: text.slice(0, 500),
  };
}
