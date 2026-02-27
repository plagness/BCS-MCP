import { describe, it, expect } from "vitest";
import { z } from "zod";
import { MARKET_TABLES, PRIVATE_TABLES } from "../query.js";

// Паттерн tool registry (воспроизведён из index.ts)
interface ToolDef {
  name: string;
  description: string;
  parameters: z.ZodTypeAny;
}

function findTool(tools: ToolDef[], name: string) {
  return tools.find((t) => t.name === name);
}

// Минимальный набор tool definitions для тестирования
const tools: ToolDef[] = [
  {
    name: "health",
    description: "Health check",
    parameters: z.object({}),
  },
  {
    name: "market.fetch",
    description: "Read market data",
    parameters: z.object({
      table: z.enum(Object.keys(MARKET_TABLES) as [string, ...string[]]),
      columns: z.array(z.string()).optional(),
      filters: z.record(z.any()).optional(),
      limit: z.number().int().min(1).max(10000).optional(),
      offset: z.number().int().min(0).optional(),
      order: z.enum(["asc", "desc"]).optional(),
    }),
  },
  {
    name: "private.fetch",
    description: "Read private data",
    parameters: z.object({
      table: z.enum(Object.keys(PRIVATE_TABLES) as [string, ...string[]]),
      columns: z.array(z.string()).optional(),
      filters: z.record(z.any()).optional(),
      limit: z.number().int().min(1).max(10000).optional(),
      offset: z.number().int().min(0).optional(),
      order: z.enum(["asc", "desc"]).optional(),
    }),
  },
  {
    name: "bcs.orders.create",
    description: "Create order",
    parameters: z.object({
      clientOrderId: z.string().uuid().optional(),
      side: z.union([z.literal(1), z.literal(2)]),
      orderType: z.union([z.literal(1), z.literal(2)]),
      orderQuantity: z.number().int().min(1),
      ticker: z.string().min(1),
      classCode: z.string().min(1),
      price: z.number().optional(),
    }),
  },
];

describe("tool registry", () => {
  it("finds existing tool by name", () => {
    expect(findTool(tools, "health")).toBeDefined();
    expect(findTool(tools, "market.fetch")?.name).toBe("market.fetch");
  });

  it("returns undefined for unknown tool", () => {
    expect(findTool(tools, "nonexistent")).toBeUndefined();
  });

  it("all tools have required fields", () => {
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
    }
  });

  it("all tool names are unique", () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("Zod: bcs.orders.create", () => {
  const schema = findTool(tools, "bcs.orders.create")!.parameters;

  it("accepts valid buy order", () => {
    const result = schema.safeParse({
      side: 1,
      orderType: 1,
      orderQuantity: 10,
      ticker: "SBER",
      classCode: "TQBR",
      price: 250.5,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ side: 1 }).success).toBe(false);
  });

  it("rejects invalid side (must be 1 or 2)", () => {
    const result = schema.safeParse({
      side: 3,
      orderType: 1,
      orderQuantity: 1,
      ticker: "SBER",
      classCode: "TQBR",
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero quantity", () => {
    const result = schema.safeParse({
      side: 1,
      orderType: 1,
      orderQuantity: 0,
      ticker: "SBER",
      classCode: "TQBR",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty ticker", () => {
    const result = schema.safeParse({
      side: 1,
      orderType: 1,
      orderQuantity: 1,
      ticker: "",
      classCode: "TQBR",
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional UUID clientOrderId", () => {
    const result = schema.safeParse({
      clientOrderId: "550e8400-e29b-41d4-a716-446655440000",
      side: 2,
      orderType: 2,
      orderQuantity: 5,
      ticker: "GAZP",
      classCode: "TQBR",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid UUID clientOrderId", () => {
    const result = schema.safeParse({
      clientOrderId: "not-a-uuid",
      side: 1,
      orderType: 1,
      orderQuantity: 1,
      ticker: "SBER",
      classCode: "TQBR",
    });
    expect(result.success).toBe(false);
  });
});

describe("Zod: market/private table enum validation", () => {
  const marketSchema = findTool(tools, "market.fetch")!.parameters;
  const privateSchema = findTool(tools, "private.fetch")!.parameters;

  it("market.fetch rejects private table names", () => {
    const result = marketSchema.safeParse({ table: "orders" });
    expect(result.success).toBe(false);
  });

  it("private.fetch rejects market table names", () => {
    const result = privateSchema.safeParse({ table: "candles" });
    expect(result.success).toBe(false);
  });
});
