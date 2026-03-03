import { describe, it, expect } from "vitest";

// We test the pure helper functions by importing the server module.
// Since they're not exported, we'll extract them into a helpers file,
// or test them indirectly through the MCP server.
//
// For now, we test the pure logic directly by duplicating the functions
// here — these are the exact implementations from server.ts.

// --- normalizeValue ---

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

describe("normalizeValue", () => {
  it("returns null for null/undefined", () => {
    expect(normalizeValue(null)).toBe(null);
    expect(normalizeValue(undefined)).toBe(null);
  });

  it("passes integers through", () => {
    expect(normalizeValue(42)).toBe(42);
    expect(normalizeValue(0)).toBe(0);
    expect(normalizeValue(-5)).toBe(-5);
  });

  it("rounds floats to 2 decimal places", () => {
    expect(normalizeValue(3.14159)).toBe(3.14);
    expect(normalizeValue(1.005)).toBe(1); // 1.005 * 100 = 100.49999... in IEEE 754
    expect(normalizeValue(99.999)).toBe(100);
  });

  it("converts numeric strings to numbers", () => {
    expect(normalizeValue("42")).toBe(42);
    expect(normalizeValue("3.14159")).toBe(3.14);
    expect(normalizeValue("0")).toBe(0);
    expect(normalizeValue("-10")).toBe(-10);
  });

  it("leaves non-numeric strings as-is", () => {
    expect(normalizeValue("hello")).toBe("hello");
    expect(normalizeValue("")).toBe("");
    expect(normalizeValue("abc123")).toBe("abc123");
  });

  it("passes other types through", () => {
    expect(normalizeValue(true)).toBe(true);
    expect(normalizeValue(false)).toBe(false);
    expect(normalizeValue([])).toEqual([]);
  });
});

// --- generateSqlErrorHints ---

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

describe("generateSqlErrorHints", () => {
  it("detects table not found", () => {
    const result = generateSqlErrorHints(
      'Table or CTE with name "orders" not found',
      "SELECT * FROM orders"
    );
    expect(result).toContain("Table not found");
    expect(result).toContain("explore_schema");
  });

  it("detects invalid identifier", () => {
    const result = generateSqlErrorHints(
      "Invalid identifier: orders.revenue",
      "SELECT orders.revenue FROM orders"
    );
    expect(result).toContain("Invalid column");
    expect(result).toContain("without view prefix");
  });

  it("detects missing MEASURE()", () => {
    const result = generateSqlErrorHints(
      "column 'revenue' could not be resolved",
      "SELECT revenue FROM orders"
    );
    expect(result).toContain("Missing MEASURE()");
  });

  it("does not suggest MEASURE() when already present", () => {
    const result = generateSqlErrorHints(
      "column 'foo' could not be resolved",
      "SELECT MEASURE(revenue) FROM orders"
    );
    expect(result).not.toContain("Missing MEASURE()");
  });

  it("detects missing GROUP BY", () => {
    const result = generateSqlErrorHints(
      "column 'category' could not be resolved",
      "SELECT category, MEASURE(revenue) FROM orders"
    );
    expect(result).toContain("Missing GROUP BY");
  });

  it("detects parser errors", () => {
    const result = generateSqlErrorHints(
      "ParserError: unexpected token SELEC",
      "SELEC * FROM orders"
    );
    expect(result).toContain("SQL syntax error");
    expect(result).toContain("single quotes");
  });

  it("warns about JOINs", () => {
    const result = generateSqlErrorHints(
      "some error",
      "SELECT * FROM orders JOIN products ON orders.id = products.order_id"
    );
    expect(result).toContain("JOINs not supported");
    expect(result).toContain("UNION");
  });

  it("returns generic hints when no pattern matches", () => {
    const result = generateSqlErrorHints(
      "unknown error occurred",
      "SELECT * FROM orders"
    );
    expect(result).toContain("Verify table/view names");
    expect(result).toContain("MEASURE()");
    expect(result).toContain("GROUP BY");
  });
});

// --- searchSchema ---

import type { CubeMetaItem } from "../../cube/client.js";

function isView(item: CubeMetaItem): boolean {
  return item.type === "view";
}

function nonTimeDimensions(item: CubeMetaItem) {
  return item.dimensions.filter((d) => d.type !== "time");
}

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
        matches.push({ source: cube.name, sourceType, name: m.name, kind: "measure", type: m.type, description: m.description });
      }
    }

    for (const d of nonTimeDimensions(cube)) {
      if (matches.length >= MAX_RESULTS) break;
      if (
        d.name.toLowerCase().includes(q) ||
        d.description?.toLowerCase().includes(q) ||
        d.title?.toLowerCase().includes(q)
      ) {
        matches.push({ source: cube.name, sourceType, name: d.name, kind: "dimension", type: d.type, description: d.description });
      }
    }

    for (const s of cube.segments) {
      if (matches.length >= MAX_RESULTS) break;
      if (
        s.name.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.title?.toLowerCase().includes(q)
      ) {
        matches.push({ source: cube.name, sourceType, name: s.name, kind: "segment", description: s.description });
      }
    }

    if (matches.length >= MAX_RESULTS) break;
  }

  return matches;
}

const sampleViews: CubeMetaItem[] = [
  {
    name: "orders",
    title: "Orders",
    description: "All customer orders",
    type: "view",
    measures: [
      { name: "orders.count", type: "count", title: "Order Count", description: "Total number of orders" },
      { name: "orders.revenue", type: "sum", title: "Revenue", description: "Total revenue from sales" },
    ],
    dimensions: [
      { name: "orders.status", type: "string", title: "Status", description: "Order status" },
      { name: "orders.created_at", type: "time", title: "Created At" },
    ],
    segments: [
      { name: "orders.completed", title: "Completed", description: "Only completed orders" },
    ],
  },
  {
    name: "products",
    title: "Products",
    type: "view",
    measures: [
      { name: "products.count", type: "count" },
    ],
    dimensions: [
      { name: "products.category", type: "string", title: "Category", description: "Product category" },
      { name: "products.name", type: "string", title: "Product Name" },
    ],
    segments: [],
  },
];

describe("searchSchema", () => {
  it("finds measures by name", () => {
    const results = searchSchema(sampleViews, "revenue");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("orders.revenue");
    expect(results[0].kind).toBe("measure");
  });

  it("finds dimensions by name", () => {
    const results = searchSchema(sampleViews, "status");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("orders.status");
    expect(results[0].kind).toBe("dimension");
  });

  it("finds segments by name", () => {
    const results = searchSchema(sampleViews, "completed");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("orders.completed");
    expect(results[0].kind).toBe("segment");
  });

  it("searches descriptions", () => {
    const results = searchSchema(sampleViews, "Total number");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("orders.count");
  });

  it("searches titles", () => {
    const results = searchSchema(sampleViews, "Product Name");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("products.name");
  });

  it("is case-insensitive", () => {
    const results = searchSchema(sampleViews, "REVENUE");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("orders.revenue");
  });

  it("finds matches across multiple views", () => {
    const results = searchSchema(sampleViews, "count");
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.source)).toEqual(["orders", "products"]);
  });

  it("excludes time dimensions", () => {
    const results = searchSchema(sampleViews, "created_at");
    expect(results).toHaveLength(0);
  });

  it("returns empty for no matches", () => {
    const results = searchSchema(sampleViews, "xyz_nonexistent");
    expect(results).toHaveLength(0);
  });

  it("caps at 50 results", () => {
    // Create a view with 60 measures
    const bigView: CubeMetaItem = {
      name: "big",
      type: "view",
      measures: Array.from({ length: 60 }, (_, i) => ({
        name: `big.metric_${i}`,
        type: "count",
        description: "matching field",
      })),
      dimensions: [],
      segments: [],
    };
    const results = searchSchema([bigView], "matching");
    expect(results).toHaveLength(50);
  });
});

// --- formatDetail ---

function formatMeasure(m: { name: string; type: string; description?: string }): string {
  const desc = m.description ? ` - ${m.description}` : "";
  return `  - **${m.name}** (${m.type})${desc}`;
}

function formatDimension(d: { name: string; type: string; description?: string }): string {
  const desc = d.description ? ` - ${d.description}` : "";
  return `  - **${d.name}** (${d.type})${desc}`;
}

function formatSegment(s: { name: string; description?: string }): string {
  const desc = s.description ? ` - ${s.description}` : "";
  return `  - **${s.name}**${desc}`;
}

function timeDimensionsFn(item: CubeMetaItem) {
  return item.dimensions.filter((d) => d.type === "time");
}

function formatDetail(item: CubeMetaItem): string {
  const badge = isView(item) ? "VIEW" : "CUBE";
  const title = item.title || item.name;
  const dims = nonTimeDimensions(item);
  const tds = timeDimensionsFn(item);

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

describe("formatDetail", () => {
  it("formats a view with all sections", () => {
    const result = formatDetail(sampleViews[0]);
    expect(result).toContain("## VIEW: orders");
    expect(result).toContain("**Orders**");
    expect(result).toContain("### Measures (2)");
    expect(result).toContain("orders.revenue");
    expect(result).toContain("### Dimensions (1)"); // excludes time
    expect(result).toContain("orders.status");
    expect(result).toContain("### Time Dimensions (1)");
    expect(result).toContain("orders.created_at");
    expect(result).toContain("### Segments (1)");
    expect(result).toContain("orders.completed");
  });

  it("labels cubes correctly", () => {
    const cube: CubeMetaItem = {
      name: "raw_orders",
      type: "cube",
      measures: [],
      dimensions: [],
      segments: [],
    };
    const result = formatDetail(cube);
    expect(result).toContain("## CUBE: raw_orders");
  });

  it("omits empty sections", () => {
    const result = formatDetail(sampleViews[1]); // products — no segments
    expect(result).not.toContain("### Segments");
    expect(result).not.toContain("### Time Dimensions");
  });
});
