import { fetchKlineWithMeta } from "@/core/services/eastmoney";
import { jsonResponse, errorResponse } from "./shared";

export async function handlePortfolioRoute(req: Request, url: URL): Promise<Response | null> {
  // ─── POST /api/portfolio/optimize ─────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/portfolio/optimize") {
    try {
      const body = await req.json() as { stocks?: string[]; algorithm?: string; days?: number; riskFreeRate?: number };
      const { stocks, algorithm = 'markowitz', days = 250, riskFreeRate = 0.025 } = body;
      if (!stocks || stocks.length < 2 || stocks.length > 10) {
        return errorResponse("需要2-10只股票", 400);
      }

      const { dailyReturns: dr } = await import("@/web/lib/risk");
      const dataPromises = stocks.map((s: string) => fetchKlineWithMeta(s, 'daily', days));
      const results = await Promise.all(dataPromises);

      const assets: { code: string; name: string; returns: number[] }[] = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (typeof r === 'string') return errorResponse(`获取 ${stocks[i]} 失败`, 400);
        const closes = r.items.map((item: any) => item.close);
        assets.push({ code: r.symbol, name: r.name, returns: dr(closes) });
      }
      const minLen = Math.min(...assets.map(a => a.returns.length));
      for (const a of assets) a.returns = a.returns.slice(a.returns.length - minLen);

      const n = assets.length;
      const meanReturns = assets.map(a => (a.returns.reduce((s, v) => s + v, 0) / a.returns.length) * 252);
      const covMatrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const mi = assets[i].returns.reduce((s, v) => s + v, 0) / minLen;
        const mj = assets[j].returns.reduce((s, v) => s + v, 0) / minLen;
        let cov = 0;
        for (let k = 0; k < minLen; k++) cov += (assets[i].returns[k] - mi) * (assets[j].returns[k] - mj);
        covMatrix[i][j] = (cov / (minLen - 1)) * 252;
      }

      let weights: number[];
      if (algorithm === 'risk-parity') {
        const vols = covMatrix.map((_, i) => Math.sqrt(covMatrix[i][i]));
        const invVols = vols.map(v => v > 0 ? 1 / v : 0);
        const s = invVols.reduce((a, b) => a + b, 0);
        weights = s > 0 ? invVols.map(v => v / s) : Array(n).fill(1 / n);
      } else {
        const scores = meanReturns.map((r, i) => { const v = Math.sqrt(covMatrix[i][i]); return v > 0 ? Math.max(0, (r - riskFreeRate) / v) : 0; });
        const s = scores.reduce((a, b) => a + b, 0);
        weights = s > 0 ? scores.map(v => v / s) : Array(n).fill(1 / n);
      }

      let portReturn = 0, portVar = 0;
      for (let i = 0; i < n; i++) portReturn += weights[i] * meanReturns[i];
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) portVar += weights[i] * weights[j] * covMatrix[i][j];
      const portVol = Math.sqrt(portVar);

      const frontier: { return: number; volatility: number; sharpe: number }[] = [];
      const minRet = Math.min(...meanReturns), maxRet = Math.max(...meanReturns);
      for (let t = 0; t <= 10; t++) {
        const ratio = t / 10;
        const w = meanReturns.map(r => Math.max(0, 1 / n + (ratio - 0.5) * (r > (minRet + maxRet) / 2 ? 0.3 : -0.1)));
        const ws = w.reduce((a, b) => a + b, 0);
        for (let i = 0; i < n; i++) w[i] /= ws;
        let r = 0, v = 0;
        for (let i = 0; i < n; i++) r += w[i] * meanReturns[i];
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v += w[i] * w[j] * covMatrix[i][j];
        const vol = Math.sqrt(Math.max(0, v));
        frontier.push({ return: +r.toFixed(4), volatility: +vol.toFixed(4), sharpe: vol > 0 ? +((r - riskFreeRate) / vol).toFixed(4) : 0 });
      }

      return jsonResponse({
        weights: assets.map((a, i) => ({ code: a.code, name: a.name, weight: +weights[i].toFixed(4) })),
        metrics: { expectedReturn: +portReturn.toFixed(4), volatility: +portVol.toFixed(4), sharpeRatio: +(portVol > 0 ? (portReturn - riskFreeRate) / portVol : 0).toFixed(4) },
        frontier,
      });
    } catch (e: unknown) {
      return errorResponse(e instanceof Error ? e.message : 'Unknown error');
    }
  }

  // ─── POST /api/factor/analyze ─────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/factor/analyze") {
    try {
      const body = await req.json() as { stocks?: string[]; factors?: string[]; days?: number };
      const { stocks, factors = ['momentum', 'volatility', 'rsi', 'macd'], days = 120 } = body;
      if (!stocks || stocks.length < 2) {
        return errorResponse("需要至少2只股票", 400);
      }

      const { macd: macdFn, rsi: rsiFn } = await import("@/web/lib/indicators");
      const dataPromises = stocks.map((s: string) => fetchKlineWithMeta(s, 'daily', days));
      const results = await Promise.all(dataPromises);

      const stockList: { code: string; name: string; closes: number[] }[] = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (typeof r === 'string') continue;
        stockList.push({ code: r.symbol, name: r.name, closes: r.items.map((k: any) => k.close) });
      }

      const exposures: any[] = [];
      const scores: Record<string, Record<string, number>> = {};
      for (const stock of stockList) {
        scores[stock.code] = {};
        for (const f of factors) {
          let val = 0;
          if (f === 'momentum' && stock.closes.length >= 20) {
            val = (stock.closes[stock.closes.length - 1] - stock.closes[stock.closes.length - 20]) / stock.closes[stock.closes.length - 20];
          } else if (f === 'volatility' && stock.closes.length >= 20) {
            const rets: number[] = [];
            for (let i = stock.closes.length - 20; i < stock.closes.length; i++) if (i > 0) rets.push((stock.closes[i] - stock.closes[i - 1]) / stock.closes[i - 1]);
            const m = rets.reduce((s, v) => s + v, 0) / rets.length;
            val = -Math.sqrt(rets.reduce((s, v) => s + (v - m) ** 2, 0) / rets.length) * Math.sqrt(252);
          } else if (f === 'rsi') {
            const rsiVals = rsiFn(stock.closes, 14).filter((v: any): v is number => v !== null);
            if (rsiVals.length > 0) { const r = rsiVals[rsiVals.length - 1]; val = r < 50 ? (50 - r) / 50 : -(r - 50) / 50; }
          } else if (f === 'macd') {
            const hist = macdFn(stock.closes).histogram.filter((v: any): v is number => v !== null);
            if (hist.length > 0) val = hist[hist.length - 1];
          }
          scores[stock.code][f] = +val.toFixed(6);
          exposures.push({ stockCode: stock.code, factorName: f, exposure: +val.toFixed(6) });
        }
      }

      const rankings = stockList.map(stock => {
        const s = scores[stock.code];
        const vals = factors.map(f => s[f] || 0);
        return { code: stock.code, name: stock.name, scores: s, compositeScore: +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(6) };
      }).sort((a, b) => b.compositeScore - a.compositeScore);

      // Spearman IC: rank correlation between factor exposure and forward returns
      const icResults = factors.map(f => {
        if (stockList.length < 3) return { factorName: f, ic: 0, pValue: 1 };
        const n = stockList.length;
        const fVals = stockList.map(s => scores[s.code][f] || 0);
        const fwdRets = stockList.map(s => {
          const c = s.closes;
          if (c.length < 6) return 0;
          return (c[c.length - 1] - c[c.length - 6]) / c[c.length - 6];
        });
        const rank = (arr: number[]) => {
          const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
          const ranks = new Array(n);
          for (let i = 0; i < n; i++) ranks[sorted[i].i] = i + 1;
          return ranks;
        };
        const rankF = rank(fVals);
        const rankR = rank(fwdRets);
        let sumD2 = 0;
        for (let i = 0; i < n; i++) sumD2 += (rankF[i] - rankR[i]) ** 2;
        const ic = n > 1 ? 1 - (6 * sumD2) / (n * (n * n - 1)) : 0;
        const t = n > 2 ? ic * Math.sqrt((n - 2) / (1 - ic * ic + 1e-10)) : 0;
        const pValue = n > 2 ? Math.max(0.001, Math.exp(-0.5 * t * t) * 0.8) : 1;
        return { factorName: f, ic: +ic.toFixed(4), pValue: +pValue.toFixed(4) };
      });

      return jsonResponse({ rankings, exposures, icResults });
    } catch (e: unknown) {
      return errorResponse(e instanceof Error ? e.message : 'Unknown error');
    }
  }

  return null;
}
