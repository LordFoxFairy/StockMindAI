import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { fetchEastMoney } from "@/core/services/eastmoney";

export const stockScreening = tool(
  async ({ conditions, market, limit }: {
    conditions: { field: string; operator: string; value: number }[];
    market?: string;
    limit?: number;
  }) => {
    try {
      const maxResults = Math.min(limit || 20, 50);

      // Build East Money screening filter string
      // f9=PE, f23=PB, f37=ROE, f20=总市值, f8=换手率, f3=涨跌幅, f62=主力净流入
      const fieldMap: Record<string, string> = {
        pe: 'f9', pb: 'f23', roe: 'f37', marketCap: 'f20',
        turnover: 'f8', changePercent: 'f3', mainNetInflow: 'f62',
        price: 'f2', volume: 'f5', eps: 'f55',
      };

      // Fetch stock list from East Money
      const mkt = market === 'sh' ? 1 : market === 'sz' ? 0 : '';
      const fields = 'f2,f3,f4,f5,f6,f7,f8,f9,f12,f14,f20,f23,f37,f55,f62';
      const url = `http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=200&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:${mkt === '' ? '0+t:6,0+t:80,m:1+t:2,m:1+t:23' : mkt + '+t:2'}&fields=${fields}`;
      const json = await fetchEastMoney(url) as { data?: { diff?: any[] } };

      if (!json?.data?.diff) {
        return '未找到符合条件的股票数据。';
      }

      let stocks = json.data.diff.map((item: any) => ({
        code: item.f12 as string,
        name: item.f14 as string,
        price: item.f2 as number,
        changePercent: item.f3 as number,
        volume: item.f5 as number,
        turnover: item.f8 as number,
        pe: item.f9 as number,
        marketCap: item.f20 as number,
        pb: item.f23 as number,
        roe: item.f37 as number,
        eps: item.f55 as number,
        mainNetInflow: item.f62 as number,
      }));

      // Apply filters
      for (const cond of conditions) {
        const field = cond.field as keyof typeof stocks[0];
        stocks = stocks.filter((s: any) => {
          const val = s[field];
          if (val === null || val === undefined || val === '-') return false;
          const numVal = Number(val);
          if (isNaN(numVal)) return false;
          switch (cond.operator) {
            case '>': return numVal > cond.value;
            case '<': return numVal < cond.value;
            case '>=': return numVal >= cond.value;
            case '<=': return numVal <= cond.value;
            case '==': return numVal === cond.value;
            default: return true;
          }
        });
      }

      const results = stocks.slice(0, maxResults);

      return JSON.stringify({
        totalMatched: stocks.length,
        returned: results.length,
        stocks: results.map((s: any) => ({
          code: s.code,
          name: s.name,
          price: s.price,
          changePercent: s.changePercent,
          pe: s.pe,
          pb: s.pb,
          roe: s.roe,
          marketCap: s.marketCap,
          turnover: s.turnover,
        })),
      });
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      return `股票筛选错误: ${errorMessage}`;
    }
  },
  {
    name: "stock_screening",
    description: "多条件股票筛选。支持按PE、PB、ROE、市值、换手率、涨跌幅等条件筛选A股。返回符合条件的股票列表及基本指标。",
    schema: z.object({
      conditions: z.array(z.object({
        field: z.enum(['pe', 'pb', 'roe', 'marketCap', 'turnover', 'changePercent', 'price', 'eps']).describe("筛选字段"),
        operator: z.enum(['>', '<', '>=', '<=', '==']).describe("比较运算符"),
        value: z.number().describe("比较值"),
      })).describe("筛选条件列表"),
      market: z.enum(['sh', 'sz', 'all']).optional().describe("市场：sh(上海)、sz(深圳)、all(全部)"),
      limit: z.number().optional().describe("返回数量，默认20，最多50"),
    }),
  }
);

export const screeningTools = [stockScreening];
