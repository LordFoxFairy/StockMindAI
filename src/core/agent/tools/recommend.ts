import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { fetchEastMoney } from "@/core/services/eastmoney";

interface StockRaw {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  turnover: number;
  pe: number;
  pb: number;
  roe: number;
  marketCap: number;
  eps: number;
}

function parseNum(v: any): number {
  if (v === null || v === undefined || v === '-') return NaN;
  const n = Number(v);
  return isNaN(n) ? NaN : n;
}

function isValid(v: number): boolean {
  return !isNaN(v) && isFinite(v);
}

type Style = 'value' | 'growth' | 'momentum' | 'dividend';

function filterAndScore(stocks: StockRaw[], style: Style): (StockRaw & { score: number; reason: string })[] {
  const scored: (StockRaw & { score: number; reason: string })[] = [];

  for (const s of stocks) {
    let pass = true;
    let score = 0;
    let reason = '';

    switch (style) {
      case 'value':
        // low PE (<20), low PB (<3), high ROE (>10%)
        if (!isValid(s.pe) || s.pe <= 0 || s.pe >= 20) pass = false;
        if (!isValid(s.pb) || s.pb <= 0 || s.pb >= 3) pass = false;
        if (!isValid(s.roe) || s.roe <= 10) pass = false;
        if (pass) {
          score = (20 - s.pe) / 20 * 30 + (3 - s.pb) / 3 * 30 + (s.roe - 10) / 10 * 40;
          reason = `PE=${s.pe}(低估值), PB=${s.pb}(资产折价), ROE=${s.roe}%(高回报)`;
        }
        break;

      case 'growth':
        // high ROE (>15%), positive change%, moderate PE
        if (!isValid(s.roe) || s.roe <= 15) pass = false;
        if (!isValid(s.changePercent) || s.changePercent <= 0) pass = false;
        if (!isValid(s.pe) || s.pe <= 0 || s.pe > 60) pass = false;
        if (pass) {
          score = (s.roe - 15) / 15 * 40 + s.changePercent / 5 * 30 + (60 - s.pe) / 60 * 30;
          reason = `ROE=${s.roe}%(高成长), 涨幅=${s.changePercent}%(动能强), PE=${s.pe}(估值合理)`;
        }
        break;

      case 'momentum':
        // top gainers by changePercent, high turnover (>3%)
        if (!isValid(s.changePercent) || s.changePercent <= 1) pass = false;
        if (!isValid(s.turnover) || s.turnover <= 3) pass = false;
        if (pass) {
          score = s.changePercent / 10 * 50 + s.turnover / 10 * 50;
          reason = `涨幅=${s.changePercent}%(势头强劲), 换手率=${s.turnover}%(交投活跃)`;
        }
        break;

      case 'dividend':
        // low PE (<25), high ROE (>12%), low volatility (low turnover as proxy)
        if (!isValid(s.pe) || s.pe <= 0 || s.pe >= 25) pass = false;
        if (!isValid(s.roe) || s.roe <= 12) pass = false;
        if (!isValid(s.turnover) || s.turnover > 5) pass = false;
        if (pass) {
          score = (25 - s.pe) / 25 * 35 + (s.roe - 12) / 12 * 40 + (5 - s.turnover) / 5 * 25;
          reason = `PE=${s.pe}(低估值稳健), ROE=${s.roe}%(盈利能力强), 换手率=${s.turnover}%(波动低)`;
        }
        break;
    }

    if (pass && score > 0) {
      scored.push({ ...s, score, reason });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

const styleLabels: Record<Style, string> = {
  value: '价值型',
  growth: '成长型',
  momentum: '动量型',
  dividend: '红利型',
};

export const recommendStocks = tool(
  async ({ style, sector, riskLevel, budget, count }: {
    style?: string;
    sector?: string;
    riskLevel?: string;
    budget?: string;
    count?: number;
  }) => {
    try {
      const investStyle = (style || 'value') as Style;
      const maxCount = Math.min(count || 10, 30);

      // Fetch stock list from East Money (same as screening tool)
      const fields = 'f2,f3,f5,f8,f9,f12,f14,f20,f23,f37,f55';
      const apiUrl = `http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=500&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,0+t:80,m:1+t:2,m:1+t:23&fields=${fields}`;
      const json = await fetchEastMoney(apiUrl) as { data?: { diff?: any[] } };

      if (!json?.data?.diff) {
        return '未获取到股票数据，请稍后重试。';
      }

      let stocks: StockRaw[] = json.data.diff.map((item: any) => ({
        code: item.f12 as string,
        name: item.f14 as string,
        price: parseNum(item.f2),
        changePercent: parseNum(item.f3),
        volume: parseNum(item.f5),
        turnover: parseNum(item.f8),
        pe: parseNum(item.f9),
        marketCap: parseNum(item.f20),
        pb: parseNum(item.f23),
        roe: parseNum(item.f37),
        eps: parseNum(item.f55),
      }));

      // Filter by price (invalid/zero prices removed)
      stocks = stocks.filter(s => isValid(s.price) && s.price > 0);

      // Filter by risk level (market cap as proxy)
      if (riskLevel === 'low') {
        stocks = stocks.filter(s => isValid(s.marketCap) && s.marketCap > 50_000_000_000);
      } else if (riskLevel === 'medium') {
        stocks = stocks.filter(s => isValid(s.marketCap) && s.marketCap > 10_000_000_000);
      }
      // 'high' = no market cap filter

      // Filter by budget
      if (budget) {
        const budgetNum = parseFloat(budget);
        if (isValid(budgetNum) && budgetNum > 0) {
          // Need at least 100 shares (1 hand)
          stocks = stocks.filter(s => s.price * 100 <= budgetNum);
        }
      }

      // Apply style-based filtering and scoring
      const recommendations = filterAndScore(stocks, investStyle);

      if (recommendations.length === 0) {
        return `未找到符合${styleLabels[investStyle]}风格的推荐股票。可尝试放宽筛选条件或更换投资风格。`;
      }

      const topN = recommendations.slice(0, maxCount);

      return JSON.stringify({
        style: styleLabels[investStyle],
        riskLevel: riskLevel || '不限',
        budget: budget || '不限',
        totalMatched: recommendations.length,
        returned: topN.length,
        recommendations: topN.map((s, i) => ({
          rank: i + 1,
          code: s.code,
          name: s.name,
          price: s.price,
          changePercent: s.changePercent,
          pe: s.pe,
          pb: s.pb,
          roe: s.roe,
          turnover: s.turnover,
          score: +s.score.toFixed(2),
          reason: s.reason,
        })),
      });
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      return `股票推荐错误: ${errorMessage}`;
    }
  },
  {
    name: "recommend_stocks",
    description: "根据用户投资风格和偏好智能推荐股票。支持价值型(value)、成长型(growth)、动量型(momentum)、红利型(dividend)四种风格。可按风险等级和预算过滤，返回评分排名和推荐理由。",
    schema: z.object({
      style: z.enum(['value', 'growth', 'momentum', 'dividend']).optional().describe("投资风格：value(价值型)、growth(成长型)、momentum(动量型)、dividend(红利型)，默认value"),
      sector: z.string().optional().describe("行业板块（暂未启用）"),
      riskLevel: z.enum(['low', 'medium', 'high']).optional().describe("风险等级：low(低风险/大盘)、medium(中风险)、high(高风险/不限)"),
      budget: z.string().optional().describe("投资预算金额（元），用于过滤股价过高的股票"),
      count: z.number().optional().describe("推荐数量，默认10，最多30"),
    }),
  }
);

export const recommendTools = [recommendStocks];
