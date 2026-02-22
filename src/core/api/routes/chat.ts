import { createChatAgent } from "@/core/agent/chatAgent";
import { CORS_HEADERS, errorResponse } from "./shared";

export async function handleChatRoute(req: Request, url: URL): Promise<Response | null> {
  if (req.method !== "POST" || url.pathname !== "/api/chat") return null;

  try {
    const { messages } = await req.json();

    // =========================================================================
    // STEP 1: INITIALIZE AGENT
    // =========================================================================
    const agent = createChatAgent();

    // =========================================================================
    // STEP 2: GENERATE STREAM
    // =========================================================================
    const stream = await agent.stream({ messages }, { streamMode: "messages", recursionLimit: 80 });

    // =========================================================================
    // STEP 3: FORMAT STREAM FOR CLIENT
    // =========================================================================
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        // Accumulate tool_call_chunks (they arrive as partial fragments).
        // Key: "stepN-indexM" to handle multiple agent steps with reused indices.
        const toolCallAccum: Record<string, { name: string; args: string; id: string }> = {};
        let currentStep = 0;
        let lastSeenIndices = new Set<number>();
        let controllerClosed = false;

        const safeEnqueue = (data: Uint8Array) => {
          if (controllerClosed) return;
          try {
            controller.enqueue(data);
          } catch {
            controllerClosed = true;
          }
        };

        const safeClose = () => {
          if (controllerClosed) return;
          try {
            controller.close();
            controllerClosed = true;
          } catch {
            controllerClosed = true;
          }
        };

        try {
          for await (const chunk of stream) {
            if (controllerClosed) break;

            // With streamMode: "messages", LangGraph yields [AIMessageChunk, metadata]
            let message: any;
            if (Array.isArray(chunk)) {
              message = chunk[0]; // AIMessageChunk is the first element
            } else {
              message = chunk;
            }

            if (!message) continue;

            // Only stream AI assistant messages to the client.
            // Skip tool results (ToolMessage/ToolMessageChunk) and
            // human messages (HumanMessage/HumanMessageChunk) to prevent
            // raw JSON tool output from appearing in the chat.
            const msgType = message._getType?.();
            if (msgType && msgType !== 'ai') continue;

            // Extract text content from AIMessageChunk
            let content = '';
            if (typeof message.content === 'string') {
              content = message.content;
            } else if (Array.isArray(message.content)) {
              const textParts = message.content
                .filter((c: any) => c.type === 'text' || typeof c === 'string')
                .map((c: any) => (typeof c === 'string' ? c : c.text || ''));
              content = textParts.join('');
            }

            // Stream text content immediately for real-time display
            if (content) {
              safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content })}\n\n`));
            }

            // DO NOT emit message.tool_calls from intermediate chunks —
            // they arrive with empty args {} before accumulation is complete.
            // Instead, accumulate tool_call_chunks and emit once at stream end.

            // Accumulate partial tool_call_chunks for later emission.
            if (message.tool_call_chunks && message.tool_call_chunks.length > 0) {
              for (const tc of message.tool_call_chunks) {
                const idx = tc.index ?? 0;
                // Detect new agent step: if we see an index we've already
                // completed (has a name), it's a new step with reused indices.
                if (tc.name && lastSeenIndices.has(idx)) {
                  currentStep++;
                  lastSeenIndices = new Set();
                }
                lastSeenIndices.add(idx);

                const key = `s${currentStep}-i${idx}`;
                if (!toolCallAccum[key]) {
                  toolCallAccum[key] = { name: '', args: '', id: '' };
                }
                if (tc.name) toolCallAccum[key].name += tc.name;
                if (tc.args) toolCallAccum[key].args += tc.args;
                if (tc.id) toolCallAccum[key].id = tc.id;
              }
            }

            // Also check message.tool_calls — if they have non-empty args,
            // they may be fully-parsed calls we haven't seen via chunks.
            if (message.tool_calls && message.tool_calls.length > 0) {
              for (const tc of message.tool_calls) {
                if (tc.name && tc.args && Object.keys(tc.args).length > 0) {
                  const key = tc.id || `direct-${tc.name}-${currentStep}`;
                  if (!toolCallAccum[key]) {
                    toolCallAccum[key] = {
                      name: tc.name,
                      args: JSON.stringify(tc.args),
                      id: tc.id || '',
                    };
                  }
                }
              }
            }
          }

          // Emit accumulated tool calls at stream end (with complete args)
          const accumulated = Object.values(toolCallAccum).filter(tc => tc.name && tc.args);
          if (accumulated.length > 0) {
            const parsedCalls = accumulated.map(tc => {
              let args: any;
              try { args = JSON.parse(tc.args); } catch { args = tc.args; }
              return { name: tc.name, args, id: tc.id };
            });
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'tool_calls',
              content: '',
              tool_calls: parsedCalls
            })}\n\n`));
          }

          safeEnqueue(encoder.encode('data: [DONE]\n\n'));
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error("Stream error:", errMsg, err);
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', content: `智能体处理出错: ${errMsg}` })}\n\n`));
          // Still emit any accumulated tool calls before closing
          const accum = Object.values(toolCallAccum).filter(tc => tc.name && tc.args);
          if (accum.length > 0) {
            const calls = accum.map(tc => {
              let args: any;
              try { args = JSON.parse(tc.args); } catch { args = tc.args; }
              return { name: tc.name, args, id: tc.id };
            });
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'tool_calls',
              content: '',
              tool_calls: calls
            })}\n\n`));
          }
          safeEnqueue(encoder.encode('data: [DONE]\n\n'));
        } finally {
          safeClose();
        }
      }
    });

    return new Response(readable, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error("Error in chat route:", err);
    return errorResponse(errorMessage);
  }
}
