import { createChatAgent } from "@/core/agent/chatAgent";

const PORT = process.env.API_PORT || 3135;

console.log(`Starting Bun API server on port ${PORT}...`);

Bun.serve({
  port: PORT,
  async fetch(req: Request) {
    const url = new URL(req.url);

    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // CORS headers for all responses
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
    };

    if (req.method === "POST" && url.pathname === "/api/chat") {
      try {
        const { messages } = await req.json();

        // =========================================================================
        // STEP 1: INITIALIZE AGENT
        // =========================================================================
        const agent = createChatAgent();

        // =========================================================================
        // STEP 2: GENERATE STREAM
        // =========================================================================
        const stream = await agent.stream({ messages }, { streamMode: "messages" });

        // =========================================================================
        // STEP 3: FORMAT STREAM FOR CLIENT
        // =========================================================================
        const encoder = new TextEncoder();
        const readable = new ReadableStream({
          async start(controller) {
            try {
              for await (const chunk of stream) {
                // Determine format
                let chunkData: any = chunk;
                if (Array.isArray(chunk)) {
                  chunkData = chunk[1]; // Get data from [event, data] pair
                }

                if (!chunkData) continue;

                // Format the chunk correctly for the client
                let content = '';
                let tool_calls = undefined;

                if (chunkData.tool_calls && chunkData.tool_calls.length > 0) {
                  tool_calls = chunkData.tool_calls;
                }

                if (chunkData.content !== undefined && chunkData.content !== null) {
                  // Handle AIMessageChunk
                  if (typeof chunkData.content === 'string') {
                    content = chunkData.content;
                  } else if (Array.isArray(chunkData.content)) {
                    // Extract text from content array if present
                    const textChunks = chunkData.content.filter((c: any) => c.type === 'text');
                    content = textChunks.map((c: any) => c.text).join('');
                  }
                }

                if (chunkData.kwargs) {
                   if (chunkData.kwargs.tool_calls && chunkData.kwargs.tool_calls.length > 0) {
                      tool_calls = tool_calls || chunkData.kwargs.tool_calls;
                   }
                   if (chunkData.kwargs.content) {
                      const kwargsContent = typeof chunkData.kwargs.content === 'string'
                          ? chunkData.kwargs.content
                          : '';
                      content = content || kwargsContent;
                   }
                }

                if (content || tool_calls) {
                  let type = 'text';
                  if (tool_calls && content) type = 'mixed';
                  else if (tool_calls) type = 'tool_calls';

                  const formattedChunk = {
                    type,
                    content,
                    tool_calls
                  };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(formattedChunk)}\n\n`));
                }
              }
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            } catch (err) {
              console.error("Stream error:", err);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', content: 'Streaming error occurred.' })}\n\n`));
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            } finally {
              controller.close();
            }
          }
        });

        return new Response(readable, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });

      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error("Error in chat route:", err);
        return new Response(JSON.stringify({ error: errorMessage }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          },
        });
      }
    }

    // Handle 404
    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  },
});
