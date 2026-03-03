import crypto from "node:crypto";
import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server.js";
import { logger } from "../lib/logger.js";

// Map session ID → transport
const transports = new Map<string, StreamableHTTPServerTransport>();
const sessionLastActivity = new Map<string, number>();

interface SessionMeta {
  userAgent?: string;
  clientName?: string;
  clientVersion?: string;
}
const sessionMeta = new Map<string, SessionMeta>();

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // check every minute

const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [sessionId, lastActivity] of sessionLastActivity) {
    if (now - lastActivity > SESSION_TTL_MS) {
      const transport = transports.get(sessionId);
      if (transport) {
        transport.close().catch(() => {});
      }
      transports.delete(sessionId);
      sessionLastActivity.delete(sessionId);
      const meta = sessionMeta.get(sessionId);
      sessionMeta.delete(sessionId);
      logger.info("session expired", { sessionId, clientName: meta?.clientName });
    }
  }
}, CLEANUP_INTERVAL_MS);

cleanupInterval.unref();

/**
 * Handle an MCP request using Express req/res.
 */
export async function handleMcp(req: Request, res: Response) {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  // Log inbound JSON-RPC request method
  const body = req.body;
  if (body && req.method === "POST") {
    const msgs = Array.isArray(body) ? body : [body];
    for (const msg of msgs) {
      if (msg && typeof msg === "object" && "method" in msg) {
        const m = msg as { method: string; id?: unknown };
        const meta = sessionId ? sessionMeta.get(sessionId) : undefined;
        logger.info("mcp_inbound", {
          method: m.method,
          id: m.id,
          sessionId: sessionId ?? "new",
          clientName: meta?.clientName,
        });
      }
    }
  }

  try {
    // Look up existing transport by session ID
    if (sessionId) {
      const transport = transports.get(sessionId);
      if (!transport) {
        res.status(404).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found" },
          id: null,
        });
        return;
      }
      sessionLastActivity.set(sessionId, Date.now());
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // No session ID — must be an initialize request. Create new transport.
    const userAgent = req.headers["user-agent"] as string | undefined;
    let clientName: string | undefined;
    let clientVersion: string | undefined;
    if (body && !Array.isArray(body) && typeof body === "object" && "method" in body) {
      const initMsg = body as { method: string; params?: { clientInfo?: { name?: string; version?: string } } };
      if (initMsg.method === "initialize") {
        clientName = initMsg.params?.clientInfo?.name;
        clientVersion = initMsg.params?.clientInfo?.version;
      }
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport);
        sessionLastActivity.set(id, Date.now());
        sessionMeta.set(id, { userAgent, clientName, clientVersion });
        logger.info("mcp_session_init", {
          sessionId: id,
          userAgent,
          clientName,
          clientVersion,
        });
      },
      onsessionclosed: (id) => {
        transports.delete(id);
        sessionLastActivity.delete(id);
        sessionMeta.delete(id);
      },
    });

    const server = createMcpServer();
    await server.connect(transport);

    transport.onclose = () => {
      if (transport.sessionId) {
        transports.delete(transport.sessionId);
        sessionLastActivity.delete(transport.sessionId);
        sessionMeta.delete(transport.sessionId);
      }
    };

    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error("mcp handler error", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      method: req.method,
      sessionId,
    });

    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
}

export function getSessions(): Array<{
  id: string;
  clientName?: string;
  clientVersion?: string;
  lastActivity: number;
}> {
  return Array.from(transports.keys()).map((id) => {
    const meta = sessionMeta.get(id);
    return {
      id,
      clientName: meta?.clientName,
      clientVersion: meta?.clientVersion,
      lastActivity: sessionLastActivity.get(id) || 0,
    };
  });
}

export async function closeAllSessions(): Promise<void> {
  const closePromises = [];
  for (const transport of transports.values()) {
    closePromises.push(transport.close().catch(() => {}));
  }
  await Promise.all(closePromises);
  transports.clear();
  sessionLastActivity.clear();
  sessionMeta.clear();
  clearInterval(cleanupInterval);
}
