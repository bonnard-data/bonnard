import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";

const PORT = 3457;
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess: ChildProcess;

async function waitForServer(url: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/config`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server at ${url} did not start within ${timeoutMs}ms`);
}

beforeAll(async () => {
  // Start the OSS server as a child process
  serverProcess = spawn("node", ["dist/server/index.js"], {
    cwd: new URL("../../..", import.meta.url).pathname,
    env: {
      ...process.env,
      CUBE_API_URL: "http://localhost:19999", // fake — tools will return errors but protocol still works
      PORT: String(PORT),
    },
    stdio: "pipe",
  });

  // Collect stderr for debugging
  serverProcess.stderr?.on("data", (data) => {
    const msg = data.toString();
    if (msg.includes("Error")) {
      console.error("[server stderr]", msg.trim());
    }
  });

  await waitForServer(BASE_URL);
}, 15_000);

afterAll(async () => {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      serverProcess.on("exit", () => resolve());
      setTimeout(resolve, 3000);
    });
  }
});

describe("MCP protocol integration", () => {
  let client: Client;
  let transport: StreamableHTTPClientTransport;

  beforeAll(async () => {
    transport = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`));
    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await transport.close();
    await client.close();
  });

  it("initializes with correct server info", () => {
    const info = client.getServerVersion();
    expect(info?.name).toBe("Bonnard");
    expect(info?.version).toBe("0.1.0");
  });

  it("lists all 4 tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["describe_field", "explore_schema", "query", "sql_query"]);
  });

  it("explore_schema returns schema error when Cube is unreachable", async () => {
    const result = await client.callTool({ name: "explore_schema", arguments: {} });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toMatch(/\[(SCHEMA_ERROR|CONNECTION_ERROR)\]/);
  });

  it("query returns error when Cube is unreachable", async () => {
    const result = await client.callTool({ name: "query", arguments: {
      measures: ["orders.count"],
    } });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("ERROR");
  });

  it("sql_query returns error when Cube is unreachable", async () => {
    const result = await client.callTool({ name: "sql_query", arguments: {
      sql: "SELECT 1",
    } });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("ERROR");
  });

  it("describe_field returns error when Cube is unreachable", async () => {
    const result = await client.callTool({ name: "describe_field", arguments: {
      field: "orders.revenue",
    } });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("ERROR");
  });

  it("explore_schema tool has correct input schema", async () => {
    const { tools } = await client.listTools();
    const exploreTool = tools.find((t) => t.name === "explore_schema");
    expect(exploreTool).toBeDefined();
    const props = (exploreTool!.inputSchema as Record<string, unknown>).properties as Record<string, unknown>;
    expect(props).toHaveProperty("name");
    expect(props).toHaveProperty("search");
  });

  it("query tool accepts timeDimension singular alias", async () => {
    const { tools } = await client.listTools();
    const queryTool = tools.find((t) => t.name === "query");
    const props = (queryTool!.inputSchema as Record<string, unknown>).properties as Record<string, unknown>;
    expect(props).toHaveProperty("timeDimension");
    expect(props).toHaveProperty("timeDimensions");
  });

  it("query tool accepts dimension alias in filters", async () => {
    const { tools } = await client.listTools();
    const queryTool = tools.find((t) => t.name === "query");
    const props = (queryTool!.inputSchema as Record<string, unknown>).properties as Record<string, unknown>;
    const filters = props.filters as Record<string, unknown>;
    const items = filters.items as Record<string, unknown>;
    const filterProps = items.properties as Record<string, unknown>;
    expect(filterProps).toHaveProperty("member");
    expect(filterProps).toHaveProperty("dimension");
  });
});
