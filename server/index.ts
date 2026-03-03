import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { getMeta, query, executeSql } from "./cube/client.js";
import { handleMcp, closeAllSessions, getSessions } from "./mcp/handler.js";

const app = express();

// --- Body parsing & CORS ---

app.use(express.json({ limit: "1mb" }));
app.use(cors({
  origin: config.corsOrigin,
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// --- Request logging ---

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    logger.info("request", {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Date.now() - start,
    });
  });
  next();
});

// --- Health check (no auth) ---

let cachedHealth: { ok: boolean; checkedAt: number } | null = null;
const HEALTH_CACHE_MS = 30_000;

app.get("/health", async (_req, res) => {
  const now = Date.now();

  if (!cachedHealth || now - cachedHealth.checkedAt > HEALTH_CACHE_MS) {
    try {
      await getMeta();
      cachedHealth = { ok: true, checkedAt: now };
    } catch {
      cachedHealth = { ok: false, checkedAt: now };
    }
  }

  res.status(cachedHealth.ok ? 200 : 503).json({
    status: cachedHealth.ok ? "ok" : "degraded",
    cube: cachedHealth.ok ? "connected" : "unreachable",
    cubeApiUrl: config.cubeApiUrl,
  });
});

// --- Optional admin token auth middleware ---

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!config.adminToken) return next();
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${config.adminToken}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// --- MCP routes ---

app.post("/mcp", requireAuth, (req, res) => {
  handleMcp(req, res).catch((err) => {
    logger.error("mcp_unhandled", { error: err instanceof Error ? err.message : String(err) });
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  });
});
app.get("/mcp", requireAuth, (req, res) => {
  handleMcp(req, res).catch((err) => {
    logger.error("mcp_unhandled", { error: err instanceof Error ? err.message : String(err) });
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  });
});
app.delete("/mcp", requireAuth, (req, res) => {
  handleMcp(req, res).catch((err) => {
    logger.error("mcp_unhandled", { error: err instanceof Error ? err.message : String(err) });
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  });
});

// --- Cube proxy routes (auth required) ---

app.get("/api/cube/meta", requireAuth, async (_req, res) => {
  try {
    const meta = await getMeta();
    res.json(meta);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("cube_meta_error", { error: message });
    res.status(502).json({ error: message });
  }
});

app.post("/api/cube/query", requireAuth, async (req, res) => {
  try {
    // Route SQL queries to executeSql (bon query --sql sends { sql: "..." })
    if (req.body.sql) {
      const result = await executeSql(req.body.sql);
      res.json(result);
      return;
    }
    const result = await query(req.body.query || req.body);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("cube_query_error", { error: message });
    res.status(502).json({ error: message });
  }
});

app.post("/api/cube/sql", requireAuth, async (req, res) => {
  try {
    const result = await executeSql(req.body.query || req.body.sql);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("cube_sql_error", { error: message });
    res.status(502).json({ error: message });
  }
});

// --- Config endpoint (non-sensitive) ---

const startTime = Date.now();

app.get("/api/config", requireAuth, (_req, res) => {
  res.json({
    cubeApiUrl: config.cubeApiUrl,
    hasAuth: !!config.adminToken,
    hasCubeSecret: !!config.cubeApiSecret,
    uptime_ms: Date.now() - startTime,
    version: "0.1.0",
  });
});

// --- MCP sessions endpoint ---

app.get("/api/mcp/sessions", requireAuth, (_req, res) => {
  const sessions = getSessions();
  res.json({ count: sessions.length, sessions });
});

// --- Deploy endpoint ---

app.post("/api/deploy", requireAuth, async (req, res) => {
  const { files, message } = req.body;

  // Validate request
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    res.status(400).json({ error: "files must be a non-empty object" });
    return;
  }

  const entries = Object.entries(files as Record<string, unknown>);
  if (entries.length === 0) {
    res.status(400).json({ error: "No files provided" });
    return;
  }
  if (entries.length > 200) {
    res.status(400).json({ error: `Too many files (${entries.length}, max 200)` });
    return;
  }

  // Validate each file
  let totalSize = 0;
  for (const [filePath, content] of entries) {
    if (typeof content !== "string") {
      res.status(400).json({ error: `File "${filePath}" content must be a string` });
      return;
    }
    // Path traversal check
    const normalized = path.normalize(filePath);
    if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
      res.status(400).json({ error: `Invalid file path: "${filePath}"` });
      return;
    }
    // Only allow YAML files
    if (!filePath.endsWith(".yaml") && !filePath.endsWith(".yml")) {
      res.status(400).json({ error: `Only .yaml/.yml files allowed: "${filePath}"` });
      return;
    }
    const size = Buffer.byteLength(content, "utf-8");
    if (size > 1_000_000) {
      res.status(400).json({ error: `File "${filePath}" too large (${size} bytes, max 1MB)` });
      return;
    }
    totalSize += size;
  }
  if (totalSize > 10_000_000) {
    res.status(400).json({ error: `Total payload too large (${totalSize} bytes, max 10MB)` });
    return;
  }

  // Write files — full replace (delete existing YAML, write new)
  const modelDir = config.modelDir;

  // Clear existing model files (preserve .version and non-YAML files)
  for (const sub of ["cubes", "views"]) {
    const dir = path.join(modelDir, sub);
    if (fs.existsSync(dir)) {
      for (const file of fs.readdirSync(dir)) {
        if (file.endsWith(".yaml") || file.endsWith(".yml")) {
          fs.unlinkSync(path.join(dir, file));
        }
      }
    }
  }

  // Write new files
  for (const [filePath, content] of entries) {
    const target = path.join(modelDir, filePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content as string);
  }

  // Write version file to trigger Cube schema reload
  const version = Date.now().toString();
  fs.writeFileSync(path.join(modelDir, ".version"), version);

  logger.info("deploy", {
    fileCount: entries.length,
    totalSize,
    version,
    message: message || null,
  });

  res.status(201).json({
    deployment: {
      id: version,
      status: "success",
      fileCount: entries.length,
      message: message || null,
    },
  });
});

// --- Static UI serving ---

app.use(express.static("dist/ui"));
app.get("/{*splat}", (_req, res) => {
  const indexPath = path.resolve("dist/ui/index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send("Not found");
  }
});

// --- Start server ---

logger.info("starting", {
  port: config.port,
  cubeApiUrl: config.cubeApiUrl,
  hasAuth: !!config.adminToken,
  hasCubeSecret: !!config.cubeApiSecret,
});

const server = app.listen(config.port, () => {
  logger.info("server started", { port: config.port });
});

// --- Graceful shutdown ---

async function shutdown(signal: string) {
  logger.info("shutting down", { signal });
  await closeAllSessions();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
