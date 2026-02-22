import { handleStocksRoute } from "./routes/stocks";
import { handleAnalysisRoute } from "./routes/analysis";
import { handlePortfolioRoute } from "./routes/portfolio";
import { handleChatRoute } from "./routes/chat";
import { handleInsightRoute } from "./routes/insight";
import { CORS_HEADERS, jsonResponse } from "./routes/shared";

const PORT = process.env.API_PORT || 3135;

// Kill any existing process on the target port before starting
try {
  const proc = Bun.spawnSync(["lsof", "-ti", `:${PORT}`]);
  const pids = proc.stdout.toString().trim();
  if (pids) {
    for (const pid of pids.split("\n")) {
      try { process.kill(Number(pid), "SIGKILL"); } catch {}
    }
    Bun.sleepSync(500);
  }
} catch {}

console.log(`Starting Bun API server on port ${PORT}...`);

Bun.serve({
  port: PORT,
  idleTimeout: 255, // Max idle timeout (seconds) — agent tool calls can take a while
  async fetch(req: Request) {
    const url = new URL(req.url);

    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: CORS_HEADERS,
      });
    }

    // Route dispatch
    const handlers = [
      handleStocksRoute,
      handleAnalysisRoute,
      handlePortfolioRoute,
      handleChatRoute,
      handleInsightRoute,
    ];

    for (const handler of handlers) {
      const response = await handler(req, url);
      if (response) return response;
    }

    // Handle 404
    return jsonResponse({ error: "Not Found" }, 404);
  },
});
