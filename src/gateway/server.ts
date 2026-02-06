import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { streamSSE } from "hono/streaming";
import { getControlHtml } from "./ui.js";
import type { AgentLoop } from "../agent/loop.js";
import { VERSION } from "../index.js";

export interface GatewayServerOptions {
  agent: AgentLoop;
  port: number;
}

export interface GatewayServer {
  /** Push a message to all connected SSE clients. */
  notify(role: string, content: string, chatId?: string): void;
  /** Push a tool call event to all connected SSE clients. */
  notifyToolCall(name: string, args: string): void;
  /** Push a tool result event to all connected SSE clients. */
  notifyToolResult(name: string, output: string): void;
}

export function createGatewayServer(opts: GatewayServerOptions): GatewayServer {
  const { agent, port } = opts;
  const app = new Hono();

  // Track SSE clients for real-time push
  const sseClients = new Set<(data: string) => void>();

  function broadcast(payload: string): void {
    for (const send of sseClients) {
      try {
        send(payload);
      } catch {
        // client disconnected, will be cleaned up
      }
    }
  }

  function notify(role: string, content: string, chatId = "default"): void {
    broadcast(JSON.stringify({ type: "message", role, content, chatId }));
  }

  function notifyToolCall(name: string, args: string): void {
    broadcast(JSON.stringify({ type: "tool_call", name, arguments: args }));
  }

  function notifyToolResult(name: string, output: string): void {
    broadcast(JSON.stringify({ type: "tool_result", name, output }));
  }

  // Serve the control UI
  app.get("/", (c) => {
    return c.html(getControlHtml());
  });

  // Chat endpoint — sends a message to the agent and returns the response
  app.post("/api/chat", async (c) => {
    const body = await c.req.json<{ message?: string; session?: string }>();
    const message = body.message?.trim();

    if (!message) {
      return c.json({ error: "message is required" }, 400);
    }

    const sessionKey = body.session ?? "web:default";

    try {
      const response = await agent.processDirect(
        message,
        sessionKey,
        "web",
        "default",
      );
      return c.json({ response });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("Chat error:", errMsg);
      return c.json({ error: errMsg }, 500);
    }
  });

  // History endpoint — returns conversation history for the UI
  app.get("/api/history", (c) => {
    const sessionKey = c.req.query("session") ?? "web:default";
    const session = agent.sessions.getOrCreate(sessionKey);
    const history = session.getHistory();

    // Return user, assistant, and tool messages for the UI
    const messages: Array<{
      role: string;
      content: string;
      tool_calls?: Array<{ name: string; arguments: string }>;
      tool_name?: string;
    }> = [];

    for (const msg of history) {
      if (msg.role === "user" || msg.role === "assistant") {
        const content =
          typeof msg.content === "string"
            ? msg.content
            : msg.content
              ? msg.content
                  .filter((p): p is { type: "text"; text: string } => p.type === "text")
                  .map((p) => p.text)
                  .join("")
              : "";

        const entry: (typeof messages)[number] = { role: msg.role, content };

        // Include tool calls if present on assistant messages
        if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
          entry.tool_calls = msg.tool_calls.map((tc) => ({
            name: tc.function.name,
            arguments: tc.function.arguments,
          }));
        }

        // Skip empty assistant messages that only have tool_calls (no text)
        if (msg.role === "assistant" && !content && !entry.tool_calls) continue;

        messages.push(entry);
      } else if (msg.role === "tool") {
        const content =
          typeof msg.content === "string"
            ? msg.content
            : "";
        messages.push({
          role: "tool",
          content,
          tool_name: msg.name,
        });
      }
    }

    return c.json({ messages });
  });

  // SSE endpoint — real-time push for cron results and other async messages
  app.get("/api/events", (c) => {
    return streamSSE(c, async (stream) => {
      const send = (data: string) => {
        stream.writeSSE({ data }).catch(() => {});
      };

      sseClients.add(send);

      // Send a ping so the client knows the connection is alive
      await stream.writeSSE({ data: JSON.stringify({ type: "connected" }) });

      // Keep alive with periodic pings
      const pingInterval = setInterval(() => {
        stream.writeSSE({ data: JSON.stringify({ type: "ping" }) }).catch(() => {
          clearInterval(pingInterval);
        });
      }, 30_000);

      // Wait until the client disconnects
      try {
        await new Promise<void>((resolve) => {
          stream.onAbort(() => resolve());
        });
      } finally {
        clearInterval(pingInterval);
        sseClients.delete(send);
      }
    });
  });

  // Status / health check
  app.get("/api/status", (c) => {
    return c.json({
      status: "ok",
      version: VERSION,
      uptime: process.uptime(),
    });
  });

  // Start the server
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`Gateway HTTP server listening on http://localhost:${info.port}`);
  });

  return { notify, notifyToolCall, notifyToolResult };
}
