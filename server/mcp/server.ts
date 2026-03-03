import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getMeta,
  query,
  executeSql,
  type CubeMetaItem,
  type CubeMeasure,
  type CubeDimension,
  type CubeSegment,
} from "../cube/client.js";
import { logger } from "../lib/logger.js";

// --- Coerce helper ---
// Some MCP clients (e.g. Copilot Studio) serialize array/object arguments as
// JSON strings instead of native types. Others (e.g. CrewAI) send null for
// optional parameters instead of omitting them.
//
// NOTE: z.preprocess() MUST NOT be used in tool parameter schemas. When the
// MCP SDK (v1.27) converts Zod schemas to JSON Schema with `io: "input"`,
// z.preprocess() causes all wrapped fields to be listed in `required` even
// if the inner schema is .optional(). This breaks LLM APIs (e.g. Anthropic)
// that validate schemas strictly. Instead, coercion is done in handlers.

/** Coerce a single arg value: null → undefined, JSON string → parsed object/array */
function coerceArg(val: unknown): unknown {
  if (val === null || val === undefined) return undefined;
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (typeof parsed === "object" && parsed !== null) return parsed;
    } catch {
      // not JSON — return as-is
    }
  }
  return val;
}

// --- Error codes ---

type ErrorCode =
  | "SOURCE_NOT_FOUND"
  | "FIELD_NOT_FOUND"
  | "QUERY_ERROR"
  | "SQL_SYNTAX_ERROR"
  | "SQL_QUERY_ERROR"
  | "SCHEMA_ERROR"
  | "CONNECTION_ERROR"
  | "INTERNAL_ERROR";

function classifyError(err: unknown): ErrorCode {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND"))
    return "CONNECTION_ERROR";
  if (msg.includes("TIMEOUT") || msg.includes("timeout")) return "QUERY_ERROR";
  if (msg.includes("not found") || msg.includes("not exist")) return "FIELD_NOT_FOUND";
  if (msg.includes("ParserError") || msg.includes("syntax")) return "SQL_SYNTAX_ERROR";
  if (msg.includes("(429)")) return "QUERY_ERROR";
  return "INTERNAL_ERROR";
}

function errorResponse(code: ErrorCode, message: string) {
  return {
    content: [{ type: "text" as const, text: `[${code}] ${message}` }],
    isError: true,
  };
}

// --- Value normalization ---

function normalizeValue(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") {
    if (!Number.isInteger(val)) return Math.round(val * 100) / 100;
    return val;
  }
  if (typeof val === "string" && val !== "" && !isNaN(Number(val))) {
    const num = Number(val);
    if (!Number.isInteger(num)) return Math.round(num * 100) / 100;
    return num;
  }
  return val;
}

// --- Formatting helpers ---

function isView(item: CubeMetaItem): boolean {
  return item.type === "view";
}

function timeDimensions(item: CubeMetaItem): CubeDimension[] {
  return item.dimensions.filter((d) => d.type === "time");
}

function nonTimeDimensions(item: CubeMetaItem): CubeDimension[] {
  return item.dimensions.filter((d) => d.type !== "time");
}

function formatSummaryLine(item: CubeMetaItem): string {
  const badge = isView(item) ? "[view]" : "[cube]";
  const title = item.title || item.name;
  const desc = item.description ? ` - ${item.description}` : "";
  const dims = nonTimeDimensions(item);
  const tds = timeDimensions(item);
  const counts = [
    `${item.measures.length}m`,
    `${dims.length}d`,
    tds.length > 0 ? `${tds.length}t` : null,
    item.segments.length > 0 ? `${item.segments.length}s` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return `- ${badge} **${item.name}** (${counts}): ${title}${desc}`;
}

function formatMeasure(m: CubeMeasure): string {
  const desc = m.description ? ` - ${m.description}` : "";
  return `  - **${m.name}** (${m.type})${desc}`;
}

function formatDimension(d: CubeDimension): string {
  const desc = d.description ? ` - ${d.description}` : "";
  return `  - **${d.name}** (${d.type})${desc}`;
}

function formatSegment(s: CubeSegment): string {
  const desc = s.description ? ` - ${s.description}` : "";
  return `  - **${s.name}**${desc}`;
}

function formatDetail(item: CubeMetaItem): string {
  const badge = isView(item) ? "VIEW" : "CUBE";
  const title = item.title || item.name;
  const dims = nonTimeDimensions(item);
  const tds = timeDimensions(item);

  let result = `## ${badge}: ${item.name}\n`;
  result += `**${title}**\n`;
  if (item.description) result += `${item.description}\n`;

  if (item.measures.length > 0) {
    result += `\n### Measures (${item.measures.length})\n`;
    result += item.measures.map(formatMeasure).join("\n");
  }

  if (dims.length > 0) {
    result += `\n\n### Dimensions (${dims.length})\n`;
    result += dims.map(formatDimension).join("\n");
  }

  if (tds.length > 0) {
    result += `\n\n### Time Dimensions (${tds.length})\n`;
    result += tds.map((t) => `  - **${t.name}**`).join("\n");
  }

  if (item.segments.length > 0) {
    result += `\n\n### Segments (${item.segments.length})\n`;
    result += item.segments.map(formatSegment).join("\n");
  }

  return result;
}

// --- Schema search ---

interface SearchMatch {
  source: string;
  sourceType: string;
  name: string;
  kind: "measure" | "dimension" | "segment";
  type?: string;
  description?: string;
}

function searchSchema(cubes: CubeMetaItem[], query: string): SearchMatch[] {
  const q = query.toLowerCase();
  const matches: SearchMatch[] = [];
  const MAX_RESULTS = 50;

  for (const cube of cubes) {
    const sourceType = isView(cube) ? "view" : "cube";

    for (const m of cube.measures) {
      if (matches.length >= MAX_RESULTS) break;
      if (
        m.name.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q) ||
        m.title?.toLowerCase().includes(q)
      ) {
        matches.push({
          source: cube.name,
          sourceType,
          name: m.name,
          kind: "measure",
          type: m.type,
          description: m.description,
        });
      }
    }

    for (const d of nonTimeDimensions(cube)) {
      if (matches.length >= MAX_RESULTS) break;
      if (
        d.name.toLowerCase().includes(q) ||
        d.description?.toLowerCase().includes(q) ||
        d.title?.toLowerCase().includes(q)
      ) {
        matches.push({
          source: cube.name,
          sourceType,
          name: d.name,
          kind: "dimension",
          type: d.type,
          description: d.description,
        });
      }
    }

    for (const s of cube.segments) {
      if (matches.length >= MAX_RESULTS) break;
      if (
        s.name.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.title?.toLowerCase().includes(q)
      ) {
        matches.push({
          source: cube.name,
          sourceType,
          name: s.name,
          kind: "segment",
          description: s.description,
        });
      }
    }

    if (matches.length >= MAX_RESULTS) break;
  }

  return matches;
}

function formatSearchResults(matches: SearchMatch[], query: string): string {
  if (matches.length === 0) {
    return `No results for "${query}".`;
  }

  const grouped = new Map<string, SearchMatch[]>();
  for (const m of matches) {
    const key = m.source;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(m);
  }

  const sourceCount = grouped.size;
  let result = `# Search: "${query}" (${matches.length} match${matches.length === 1 ? "" : "es"} across ${sourceCount} source${sourceCount === 1 ? "" : "s"})\n`;

  for (const [source, items] of grouped) {
    const type = items[0].sourceType.toUpperCase();
    result += `\n## ${source} (${type})\n`;
    for (const item of items) {
      const desc = item.description ? ` - ${item.description}` : "";
      const typeStr = item.type ? `, ${item.type}` : "";
      result += `  - **${item.name}** (${item.kind}${typeStr})${desc}\n`;
    }
  }

  if (matches.length >= 50) {
    result += `\n*Results capped at 50. Refine your search for more specific results.*`;
  }

  result += `\nUse explore_schema with \`name\` to see all fields for a specific source.`;
  return result;
}

// --- Query result formatting ---

const MAX_ROWS = 250;

function formatQueryResults(
  data: Record<string, unknown>[],
  requestLimit: number,
  requestOffset?: number
): string {
  if (data.length === 0) return JSON.stringify({ data_completeness: "complete", rows_shown: 0, results: [] });

  const totalReturned = data.length;
  const capped = data.slice(0, MAX_ROWS);
  const rowsShown = capped.length;
  const isPartial = totalReturned > MAX_ROWS || totalReturned >= requestLimit;

  // Strip view prefix from keys (orders.revenue → revenue)
  const originalKeys = Object.keys(capped[0]);
  const rows = capped.map((row) => {
    const cleaned: Record<string, unknown> = {};
    for (const key of originalKeys) {
      const shortKey = key.split(".").pop() || key;
      cleaned[shortKey] = normalizeValue(row[key]);
    }
    return cleaned;
  });

  const meta: Record<string, unknown> = {
    data_completeness: isPartial ? "partial" : "complete",
    rows_shown: rowsShown,
  };

  if (requestOffset) meta.offset = requestOffset;

  if (isPartial) {
    const nextOffset = (requestOffset || 0) + rowsShown;
    meta.warning = `Partial results — do not sum or average these rows for totals. Use measures for accurate aggregations. To fetch more rows, use offset: ${nextOffset}.`;
  }

  return JSON.stringify({ ...meta, results: rows });
}

function formatSqlResults(
  columns: Array<{ name: string; column_type: string }>,
  data: Record<string, unknown>[]
): string {
  if (data.length === 0) return JSON.stringify({ data_completeness: "complete", rows_shown: 0, results: [] });

  const totalReturned = data.length;
  const capped = data.slice(0, MAX_ROWS);
  const rowsShown = capped.length;
  const isPartial = totalReturned > MAX_ROWS;
  const headers = columns.map((c) => c.name);

  const rows = capped.map((row) => {
    const cleaned: Record<string, unknown> = {};
    for (const h of headers) {
      cleaned[h] = normalizeValue(row[h]);
    }
    return cleaned;
  });

  const meta: Record<string, unknown> = {
    data_completeness: isPartial ? "partial" : "complete",
    rows_shown: rowsShown,
  };

  if (isPartial) {
    meta.warning = `Partial results (${totalReturned} total). Do not sum or average these rows. Add LIMIT/OFFSET to your SQL to page through results.`;
  }

  return JSON.stringify({ ...meta, results: rows });
}

// --- SQL error hints ---

function generateSqlErrorHints(error: string, sql: string): string {
  const hints: string[] = [];

  if (error.includes("Table or CTE with name") && error.includes("not found")) {
    hints.push("- Table not found: use explore_schema to list available views/cubes");
  }

  if (error.includes("Invalid identifier")) {
    hints.push("- Invalid column: check field names via explore_schema with `name` parameter");
    hints.push("- In SQL, use column names without view prefix (e.g. `revenue` not `view.revenue`)");
  }

  if (error.includes("could not be resolved")) {
    const hasMeasure = /MEASURE\s*\(/i.test(sql);
    const hasGroupBy = /GROUP\s+BY/i.test(sql);
    if (!hasMeasure) {
      hints.push("- Missing MEASURE(): wrap measure columns in MEASURE() function");
    }
    if (!hasGroupBy) {
      hints.push("- Missing GROUP BY: add GROUP BY for non-aggregated columns");
    }
  }

  if (error.includes("ParserError")) {
    hints.push("- SQL syntax error: check for typos or missing keywords");
    hints.push("- Use single quotes for string values: WHERE status = 'completed'");
  }

  if (/\bJOIN\b/i.test(sql)) {
    hints.push("- JOINs not supported: use UNION to combine results from different views");
  }

  if (hints.length === 0) {
    hints.push("- Verify table/view names with explore_schema");
    hints.push("- Use MEASURE() to aggregate measures");
    hints.push("- Include all non-aggregated columns in GROUP BY");
  }

  return hints.join("\n");
}

// --- describe_field via Cube meta API ---

interface FieldInfo {
  name: string;
  kind: "measure" | "dimension" | "segment";
  type: string;
  description?: string;
  format?: string;
  meta?: Record<string, unknown>;
  source: string;
  sourceType: string;
}

async function describeFieldFromMeta(qualifiedName: string): Promise<FieldInfo | null> {
  const parts = qualifiedName.split(".");
  if (parts.length !== 2) return null;

  const [cubeName, fieldName] = parts;
  const meta = await getMeta();
  const cube = meta.cubes?.find((c) => c.name === cubeName);
  if (!cube) return null;

  const sourceType = isView(cube) ? "view" : "cube";

  // Search measures
  for (const m of cube.measures) {
    if (m.name === qualifiedName || m.name.split(".").pop() === fieldName) {
      return {
        name: m.name,
        kind: "measure",
        type: m.type,
        description: m.description,
        format: m.format,
        meta: m.meta,
        source: cube.name,
        sourceType,
      };
    }
  }

  // Search dimensions
  for (const d of cube.dimensions) {
    if (d.name === qualifiedName || d.name.split(".").pop() === fieldName) {
      return {
        name: d.name,
        kind: "dimension",
        type: d.type,
        description: d.description,
        format: d.format,
        meta: d.meta,
        source: cube.name,
        sourceType,
      };
    }
  }

  // Search segments
  for (const s of cube.segments) {
    if (s.name === qualifiedName || s.name.split(".").pop() === fieldName) {
      return {
        name: s.name,
        kind: "segment",
        type: "boolean",
        description: s.description,
        source: cube.name,
        sourceType,
      };
    }
  }

  return null;
}

function formatFieldInfo(info: FieldInfo): string {
  const lines: string[] = [];

  lines.push(`## ${info.name}`);
  if (info.description) lines.push(info.description);
  lines.push("");

  const kindLabel = info.kind.charAt(0).toUpperCase() + info.kind.slice(1);
  lines.push(`**Kind:** ${kindLabel}`);
  lines.push(`**Type:** ${info.type}`);
  if (info.format) lines.push(`**Format:** ${info.format}`);
  if (info.meta && Object.keys(info.meta).length > 0) {
    const metaStr = Object.entries(info.meta)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    lines.push(`**Meta:** ${metaStr}`);
  }

  lines.push(`**Source:** ${info.sourceType} \`${info.source}\``);

  return lines.join("\n");
}

// --- Server factory ---

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "Bonnard",
    version: "0.1.0",
  });

  // --- explore_schema ---

  server.tool(
    "explore_schema",
    `Discover available data sources (views), their measures, dimensions, and segments.

**Always call this before querying.** Field names returned here are the exact names to use in the query tool.

Usage:
- No parameters → list all sources with summary counts. Start here.
- \`name\` → full field listing for one source. Call this to see measures/dimensions before building a query.
- \`search\` → find fields by keyword across all sources. Use when you know the concept (e.g. "revenue") but not which source has it.

Views are curated for analysis — prefer them over raw cubes. All field names are fully qualified (e.g. "orders.revenue").`,
    {
      name: z.string().optional()
        .describe("Source name to get full details (e.g. 'orders')"),
      search: z.string().optional()
        .describe("Keyword to search across all field names and descriptions (e.g. 'revenue', 'count', 'status')"),
    },
    {
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    async (args) => {
      try {
        const meta = await getMeta();
        const cubes = meta.cubes || [];
        const views = cubes.filter(isView);

        // Mode 3: search
        if (args.search) {
          const matches = searchSchema(views, args.search);
          const text = formatSearchResults(matches, args.search);
          logger.info("tool_result", { tool: "explore_schema", mode: "search" });
          return { content: [{ type: "text", text }] };
        }

        // Mode 2: detail for a specific source
        if (args.name) {
          const item = views.find((c) => c.name === args.name);
          if (!item) {
            const available = views.map((c) => c.name).join(", ");
            return errorResponse("SOURCE_NOT_FOUND", `"${args.name}" not found. Available: ${available}`);
          }
          const text = formatDetail(item);
          logger.info("tool_result", { tool: "explore_schema", mode: "detail" });
          return { content: [{ type: "text", text }] };
        }

        // Mode 1: list all views
        let result = "# Available Data Sources\n";

        if (views.length > 0) {
          result += `\n## Views\n`;
          result += views.map(formatSummaryLine).join("\n");
        } else {
          result += "\nNo views available. Deploy a schema first.";
        }

        result += "\n\nUse explore_schema with `name` to see full details for a source.";

        logger.info("tool_result", { tool: "explore_schema", mode: "list" });
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return errorResponse("SCHEMA_ERROR", err instanceof Error ? err.message : String(err));
      }
    }
  );

  // --- query ---

  server.tool(
    "query",
    `Primary tool for fetching data from the semantic layer. Use explore_schema first to discover field names.

All field names must be fully qualified: "view_name.field_name".

Measures include pre-computed ratios, variances, and percentages — check explore_schema before writing custom calculations.

Use \`timeDimensions\` (not filters) for date range constraints.

To discover dimension values (e.g. which cities exist), query with just \`dimensions\` and no measures.

**Pagination:** Results are capped at ${MAX_ROWS} rows per response. If data_completeness is "partial", use \`offset\` to fetch the next page. Do NOT sum/average partial row data — use measures for accurate totals.`,
    {
      measures: z.array(z.string())
        .optional()
        .describe('Measures to query (e.g. ["orders.revenue", "orders.count"]). Omit to list distinct dimension values.'),
      dimensions: z.array(z.string())
        .optional()
        .describe('Dimensions to group by (e.g. ["orders.status", "products.category"])'),
      timeDimensions: z.array(
        z.object({
          dimension: z.string().describe('Time dimension (e.g. "orders.created_at")'),
          dateRange: z.array(z.string()).length(2).describe("Date range as [start, end] in YYYY-MM-DD format"),
          granularity: z
            .enum(["day", "week", "month", "quarter", "year"])
            .optional()
            .describe("Time granularity for grouping"),
        })
      )
      .optional()
      .describe("Time dimensions with date range and optional granularity"),
      timeDimension: z.object({
        dimension: z.string(),
        dateRange: z.array(z.string()).length(2),
        granularity: z.enum(["day", "week", "month", "quarter", "year"]).optional(),
      })
      .optional()
      .describe("Alias for timeDimensions (single object)"),
      filters: z.array(
        z.object({
          member: z.string().optional().describe('Field to filter (e.g. "orders.status")'),
          dimension: z.string().optional(),
          operator: z
            .enum([
              "equals", "notEquals", "contains", "notContains",
              "gt", "gte", "lt", "lte",
              "set", "notSet",
              "inDateRange", "notInDateRange", "beforeDate", "afterDate",
            ])
            .describe("Filter operator"),
          values: z.array(z.string()).optional().describe("Values to filter by (not needed for set/notSet operators)"),
        })
      )
      .optional()
      .describe("Filters to apply"),
      segments: z.array(z.string())
        .optional()
        .describe('Pre-defined filter segments (e.g. ["orders.completed"])'),
      limit: z.number()
        .optional()
        .describe(`Maximum rows to return (default: ${MAX_ROWS}, max: 5000)`),
      offset: z.number()
        .optional()
        .describe("Number of rows to skip for pagination (e.g. 250 to get the second page)"),
      order: z.record(z.string(), z.enum(["asc", "desc"]))
        .optional()
        .describe('Sort order (e.g. {"orders.revenue": "desc"})'),
    },
    {
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    async (rawArgs) => {
      try {
        // Coerce args for clients that send null or JSON strings
        const args = {
          measures: coerceArg(rawArgs.measures) as string[] | undefined,
          dimensions: coerceArg(rawArgs.dimensions) as string[] | undefined,
          timeDimensions: coerceArg(rawArgs.timeDimensions) as typeof rawArgs.timeDimensions,
          timeDimension: coerceArg(rawArgs.timeDimension) as typeof rawArgs.timeDimension,
          filters: coerceArg(rawArgs.filters) as typeof rawArgs.filters,
          segments: coerceArg(rawArgs.segments) as string[] | undefined,
          limit: (rawArgs.limit ?? undefined) as number | undefined,
          offset: (rawArgs.offset ?? undefined) as number | undefined,
          order: coerceArg(rawArgs.order) as Record<string, "asc" | "desc"> | undefined,
        };

        // Normalize aliases: singular timeDimension → timeDimensions array
        const timeDims = args.timeDimensions
          || (args.timeDimension ? [args.timeDimension] : undefined);

        // Normalize filters: accept "dimension" as alias for "member"
        const filters = args.filters?.map((f) => ({
          member: f.member || f.dimension,
          operator: f.operator,
          values: f.values,
        })).filter((f) => f.member);

        const cubeQuery: Record<string, unknown> = {};
        if (args.measures && args.measures.length > 0) cubeQuery.measures = args.measures;
        if (args.dimensions) cubeQuery.dimensions = args.dimensions;
        if (timeDims) cubeQuery.timeDimensions = timeDims;
        if (filters && filters.length > 0) cubeQuery.filters = filters;
        if (args.segments) cubeQuery.segments = args.segments;
        const requestLimit = Math.min(args.limit || MAX_ROWS, 5000);
        cubeQuery.limit = requestLimit;
        if (args.offset) cubeQuery.offset = args.offset;
        if (args.order) cubeQuery.order = args.order;

        const result = await query(cubeQuery);
        const data = result.data || [];

        const text = formatQueryResults(data as Record<string, unknown>[], requestLimit, args.offset);
        logger.info("tool_result", { tool: "query", rows: Math.min((data as unknown[]).length, MAX_ROWS) });

        return { content: [{ type: "text", text }] };
      } catch (err) {
        const code = classifyError(err);
        return errorResponse(code === "INTERNAL_ERROR" ? "QUERY_ERROR" : code, err instanceof Error ? err.message : String(err));
      }
    }
  );

  // --- sql_query ---

  server.tool(
    "sql_query",
    `Execute raw SQL against the semantic layer. Only use when the query tool cannot express what you need.

**When to use:** CTEs, UNIONs, custom arithmetic, CASE expressions.
**Do not use for:** simple aggregations, filtering, grouping — use the query tool instead.

**Syntax:**
- MEASURE() required for aggregations: \`SELECT MEASURE(revenue) FROM orders\`
- Table names = view/model names from explore_schema
- Column names without view prefix: \`revenue\` not \`orders.revenue\`
- GROUP BY required for non-aggregated columns
- No JOINs (use UNION instead)

**Example — custom calculation:**
\`\`\`sql
SELECT category, MEASURE(revenue) / NULLIF(MEASURE(count), 0) as avg_order_value
FROM orders GROUP BY 1
\`\`\`

**Example — period comparison with CTE:**
\`\`\`sql
WITH current AS (
  SELECT MEASURE(revenue) as rev FROM orders WHERE created_at >= '2025-01-01' AND created_at < '2025-02-01'
),
previous AS (
  SELECT MEASURE(revenue) as rev FROM orders WHERE created_at >= '2024-12-01' AND created_at < '2025-01-01'
)
SELECT current.rev, previous.rev, current.rev - previous.rev as change FROM current, previous
\`\`\``,
    {
      sql: z.string().describe("SQL query using Cube SQL syntax with MEASURE() for aggregations"),
    },
    {
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    async (args) => {
      try {
        const result = await executeSql(args.sql);

        if (!result.success) {
          const code = result.error.includes("ParserError") ? "SQL_SYNTAX_ERROR" : "SQL_QUERY_ERROR";
          const hints = generateSqlErrorHints(result.error, args.sql);
          return errorResponse(code as ErrorCode, `${result.error}\n\n**Tips:**\n${hints}`);
        }

        const text = formatSqlResults(result.columns, result.data);
        logger.info("tool_result", { tool: "sql_query", rows: Math.min(result.data.length, MAX_ROWS) });

        return { content: [{ type: "text", text }] };
      } catch (err) {
        const code = classifyError(err);
        return errorResponse(code === "INTERNAL_ERROR" ? "SQL_QUERY_ERROR" : code, err instanceof Error ? err.message : String(err));
      }
    }
  );

  // --- describe_field ---

  server.tool(
    "describe_field",
    `Get detailed metadata for a specific field including its type, format, and description.

Use this to understand what a measure or dimension means before querying it.

The field name must be fully qualified: "view_name.field_name" (e.g. "orders.revenue").`,
    {
      field: z.string().describe('Fully qualified field name (e.g. "orders.revenue", "orders.status")'),
    },
    {
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    async (args) => {
      try {
        const info = await describeFieldFromMeta(args.field);

        if (!info) {
          return errorResponse("FIELD_NOT_FOUND", `Field "${args.field}" not found. Use explore_schema to discover available fields.`);
        }

        const text = formatFieldInfo(info);
        logger.info("tool_result", { tool: "describe_field" });

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return errorResponse(classifyError(err), err instanceof Error ? err.message : String(err));
      }
    }
  );

  // --- Strip $schema from tool schemas ---
  // The MCP SDK (v1.27) defaults to JSON Schema draft-07 when converting Zod v4
  // schemas, adding `$schema: "http://json-schema.org/draft-07/schema#"`. Some
  // LLM APIs (e.g. Anthropic) reject this, requiring draft-2020-12 or no $schema.
  // Since our schemas use only universal JSON Schema features, stripping $schema
  // ensures compatibility with all clients without changing schema semantics.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers = (server.server as any)._requestHandlers as
    Map<string, (...args: unknown[]) => unknown>;
  const origToolsListHandler = handlers.get("tools/list");
  if (origToolsListHandler) {
    handlers.set("tools/list", async (...handlerArgs: unknown[]) => {
      const result = (await origToolsListHandler(...handlerArgs)) as {
        tools?: Array<{ inputSchema?: Record<string, unknown> }>;
      };
      for (const tool of result.tools || []) {
        if (tool.inputSchema?.$schema) {
          delete tool.inputSchema.$schema;
        }
      }
      return result;
    });
  }

  return server;
}
