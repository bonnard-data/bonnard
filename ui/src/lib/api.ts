export interface CubeMeasure {
  name: string;
  title: string;
  shortTitle: string;
  description?: string;
  type: string;
  aggType?: string;
  format?: string;
}

export interface CubeDimension {
  name: string;
  title: string;
  shortTitle: string;
  description?: string;
  type: string;
  format?: string;
}

export interface CubeSegment {
  name: string;
  title: string;
  shortTitle: string;
  description?: string;
}

export interface CubeMetaItem {
  name: string;
  title: string;
  description?: string;
  type: string;
  measures: CubeMeasure[];
  dimensions: CubeDimension[];
  segments: CubeSegment[];
}

export interface CubeMetaResponse {
  cubes: CubeMetaItem[];
}

export interface HealthResponse {
  status: string;
  cube: string;
  cubeApiUrl: string;
}

export interface ConfigResponse {
  cubeApiUrl: string;
  hasAuth: boolean;
  hasCubeSecret: boolean;
  uptime_ms: number;
  version: string;
}

export interface McpSession {
  id: string;
  clientName?: string;
  clientVersion?: string;
  lastActivity: number;
}

export interface McpSessionsResponse {
  count: number;
  sessions: McpSession[];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  health: () => get<HealthResponse>("/health"),
  config: () => get<ConfigResponse>("/api/config"),
  cubeMeta: () => get<CubeMetaResponse>("/api/cube/meta"),
  mcpSessions: () => get<McpSessionsResponse>("/api/mcp/sessions"),
};
