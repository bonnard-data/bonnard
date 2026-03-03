import http from "node:http";
import { SignJWT } from "jose";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

// --- Cube meta types ---

export interface CubeMeasure {
  name: string;
  title?: string;
  shortTitle?: string;
  description?: string;
  type: string;
  aggType?: string;
  format?: string;
  meta?: Record<string, unknown>;
}

export interface CubeDimension {
  name: string;
  title?: string;
  shortTitle?: string;
  description?: string;
  type: string;
  format?: string;
  meta?: Record<string, unknown>;
}

export interface CubeSegment {
  name: string;
  title?: string;
  shortTitle?: string;
  description?: string;
}

export interface CubeMetaItem {
  name: string;
  title?: string;
  description?: string;
  type?: string; // "cube" or "view"
  measures: CubeMeasure[];
  dimensions: CubeDimension[];
  segments: CubeSegment[];
}

export interface CubeMetaResponse {
  cubes: CubeMetaItem[];
}

// --- Query response types ---

export interface CubeQueryResponse {
  data: Record<string, unknown>[];
}

export interface CubeSqlColumn {
  name: string;
  column_type: string;
}

export type CubeSqlResult =
  | { success: true; columns: CubeSqlColumn[]; data: Record<string, unknown>[]; rowCount: number }
  | { success: false; error: string };

// --- HTTP client ---
//
// Retry strategy matches the official Cube SDK (@cubejs-client/core):
// - Immediate retry on "Continue wait" (no delay — the server is already working)
// - Overall timeout instead of retry count (Cube's executionTimeout is 600s)
// - Fresh JWT signed per attempt to avoid expiry during long retry loops
// - Per-request fetch timeout to prevent hung connections

/** Overall timeout for Continue wait retry loops. */
const OVERALL_TIMEOUT_MS = 120_000; // 2 minutes

/** Per-request fetch timeout to detect hung connections. */
const PER_REQUEST_TIMEOUT_MS = 30_000; // 30 seconds

/** Timeout for executeSql (streaming NDJSON — single request, no retry). */
const SQL_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * Get the auth header for Cube API requests.
 * If CUBE_API_SECRET is set, signs a minimal JWT.
 * If not set, returns undefined (unauthenticated — works for local Cube with no secret).
 */
async function getAuthHeader(): Promise<string | undefined> {
  if (!config.cubeApiSecret) return undefined;

  const secret = new TextEncoder().encode(config.cubeApiSecret);
  const token = await new SignJWT({ source: "bonnard" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);

  return token;
}

/**
 * Make a single request to the Cube API.
 * Token is passed in so callers can refresh it per retry attempt.
 */
async function cubeRequest(
  path: string,
  options?: { method?: string; body?: unknown }
): Promise<unknown> {
  const url = `${config.cubeApiUrl}${path}`;
  const token = await getAuthHeader();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = token;
  }

  const res = await fetch(url, {
    method: options?.method || "GET",
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cube API error (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Fetch Cube schema metadata (cubes, views, measures, dimensions, segments).
 * Retries on "Continue wait" responses until the overall timeout.
 */
export async function getMeta(): Promise<CubeMetaResponse> {
  const deadline = Date.now() + OVERALL_TIMEOUT_MS;
  let attempts = 0;

  while (Date.now() < deadline) {
    const result = (await cubeRequest("/cubejs-api/v1/meta")) as Record<string, unknown>;

    if (result.error === "Continue wait") {
      if (attempts === 0) {
        logger.info("cube_meta_continue_wait");
      }
      attempts++;
      continue;
    }

    if (attempts > 0) {
      logger.info("cube_meta_resolved", {
        attempts,
        elapsed_ms: OVERALL_TIMEOUT_MS - (deadline - Date.now()),
      });
    }
    return result as unknown as CubeMetaResponse;
  }

  logger.error("cube_meta_timeout", { attempts, timeout_ms: OVERALL_TIMEOUT_MS });
  throw new Error(
    `Cube schema loading timed out after ${OVERALL_TIMEOUT_MS / 1000}s (${attempts} retries)`
  );
}

/**
 * Execute a JSON query against the Cube load API.
 * Retries on "Continue wait" responses until the overall timeout.
 */
export async function query(
  cubeQuery: Record<string, unknown>
): Promise<CubeQueryResponse> {
  const deadline = Date.now() + OVERALL_TIMEOUT_MS;
  let attempts = 0;

  while (Date.now() < deadline) {
    const result = (await cubeRequest(
      "/cubejs-api/v1/load",
      { method: "POST", body: { query: cubeQuery } }
    )) as Record<string, unknown>;

    if (result.error === "Continue wait") {
      if (attempts === 0) {
        logger.info("cube_query_continue_wait");
      }
      attempts++;
      continue;
    }

    if (attempts > 0) {
      logger.info("cube_query_resolved", {
        attempts,
        elapsed_ms: OVERALL_TIMEOUT_MS - (deadline - Date.now()),
      });
    }

    if (result.error) {
      throw new Error(String(result.error));
    }

    return result as unknown as CubeQueryResponse;
  }

  logger.error("cube_query_timeout", { attempts, timeout_ms: OVERALL_TIMEOUT_MS });
  throw new Error(
    `Cube query timed out after ${OVERALL_TIMEOUT_MS / 1000}s (${attempts} retries)`
  );
}

/**
 * Low-level HTTP request using node:http with insecureHTTPParser.
 *
 * Cube's /cubesql endpoint sends both Content-Length and Transfer-Encoding
 * headers, violating HTTP/1.1. Node 22's fetch (undici) strictly rejects this
 * with HPE_UNEXPECTED_CONTENT_LENGTH. Using node:http with insecureHTTPParser
 * tolerates the malformed response.
 */
function httpPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers,
        insecureHTTPParser: true,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Cube SQL request timed out after ${timeoutMs}ms`));
    });
    req.write(body);
    req.end();
  });
}

/**
 * Execute a raw SQL query via the Cube SQL API.
 * Parses the NDJSON response (first line = schema, subsequent lines = data chunks).
 */
export async function executeSql(sql: string): Promise<CubeSqlResult> {
  const token = await getAuthHeader();
  const url = `${config.cubeApiUrl}/cubejs-api/v1/cubesql`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = token;
  }

  const res = await httpPost(url, headers, JSON.stringify({ query: sql }), SQL_TIMEOUT_MS);

  if (res.status >= 400) {
    throw new Error(`Cube SQL error (${res.status}): ${res.body}`);
  }

  // Parse NDJSON response: first line = schema, subsequent lines = data chunks
  const lines = res.body.trim().split("\n").filter((l) => l.length > 0);

  if (lines.length === 0) {
    throw new Error("Empty response from Cube SQL API");
  }

  const schemaLine = JSON.parse(lines[0]) as {
    schema?: CubeSqlColumn[];
    error?: string;
  };

  // Cube SQL returns query errors in the JSON body with 200 status
  if (schemaLine.error) {
    return { success: false, error: schemaLine.error };
  }

  const columns: CubeSqlColumn[] = schemaLine.schema || [];
  const data: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const chunk = JSON.parse(lines[i]) as { data?: unknown[][] };
    if (chunk.data && Array.isArray(chunk.data)) {
      for (const row of chunk.data) {
        if (Array.isArray(row)) {
          const rowObj: Record<string, unknown> = {};
          for (let j = 0; j < columns.length; j++) {
            rowObj[columns[j].name] = row[j];
          }
          data.push(rowObj);
        }
      }
    }
  }

  return { success: true, columns, data, rowCount: data.length };
}
