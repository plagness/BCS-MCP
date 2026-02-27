import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  MARKET_TABLES,
  PRIVATE_TABLES,
} from "../query.js";

describe("MARKET_TABLES metadata", () => {
  it("has expected tables", () => {
    const expected = [
      "candles",
      "quotes",
      "order_book_snapshots",
      "last_trades",
      "trading_status_snapshots",
      "trading_schedule_snapshots",
      "instrument_discounts",
      "instruments",
    ];
    for (const name of expected) {
      expect(MARKET_TABLES[name]).toBeDefined();
    }
  });

  it("all tables have columns array", () => {
    for (const [name, meta] of Object.entries(MARKET_TABLES)) {
      expect(Array.isArray(meta.columns), `${name}.columns`).toBe(true);
      expect(meta.columns.length, `${name} has columns`).toBeGreaterThan(0);
    }
  });

  it("all tables have timeField (string or null)", () => {
    for (const [name, meta] of Object.entries(MARKET_TABLES)) {
      expect(
        meta.timeField === null || typeof meta.timeField === "string",
        `${name}.timeField`
      ).toBe(true);
    }
  });

  it("candles has ticker, ts, open, high, low, close, volume", () => {
    const cols = MARKET_TABLES.candles.columns;
    expect(cols).toContain("ticker");
    expect(cols).toContain("ts");
    expect(cols).toContain("open");
    expect(cols).toContain("high");
    expect(cols).toContain("low");
    expect(cols).toContain("close");
    expect(cols).toContain("volume");
  });

  it("candles timeField is ts", () => {
    expect(MARKET_TABLES.candles.timeField).toBe("ts");
  });
});

describe("PRIVATE_TABLES metadata", () => {
  it("has expected tables", () => {
    const expected = [
      "selected_assets",
      "decision_logs",
      "holdings_current",
      "orders",
      "trades",
      "pnl_daily",
      "embeddings",
      "signal_features",
      "signal_probs",
    ];
    for (const name of expected) {
      expect(PRIVATE_TABLES[name], `missing table: ${name}`).toBeDefined();
    }
  });

  it("pnl_daily has no timeField", () => {
    expect(PRIVATE_TABLES.pnl_daily.timeField).toBeNull();
  });

  it("orders timeField is created_at", () => {
    expect(PRIVATE_TABLES.orders.timeField).toBe("created_at");
  });

  it("all private tables have columns", () => {
    for (const [name, meta] of Object.entries(PRIVATE_TABLES)) {
      expect(meta.columns.length, `${name} has columns`).toBeGreaterThan(0);
    }
  });
});

describe("Zod schemas: market.fetch", () => {
  const marketFetchSchema = z.object({
    table: z.enum(Object.keys(MARKET_TABLES) as [string, ...string[]]),
    columns: z.array(z.string()).optional(),
    filters: z.record(z.any()).optional(),
    range: z
      .object({
        field: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
      })
      .optional(),
    limit: z.number().int().min(1).max(10000).optional(),
    offset: z.number().int().min(0).optional(),
    order: z.enum(["asc", "desc"]).optional(),
  });

  it("accepts valid candles query", () => {
    const result = marketFetchSchema.safeParse({
      table: "candles",
      filters: { ticker: "SBER" },
      limit: 100,
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown table", () => {
    const result = marketFetchSchema.safeParse({
      table: "nonexistent_table",
    });
    expect(result.success).toBe(false);
  });

  it("rejects limit > 10000", () => {
    const result = marketFetchSchema.safeParse({
      table: "candles",
      limit: 10001,
    });
    expect(result.success).toBe(false);
  });

  it("accepts range with start/end", () => {
    const result = marketFetchSchema.safeParse({
      table: "quotes",
      range: { start: "2026-01-01", end: "2026-02-01" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts all valid table names", () => {
    for (const table of Object.keys(MARKET_TABLES)) {
      const result = marketFetchSchema.safeParse({ table });
      expect(result.success, `table ${table} should be valid`).toBe(true);
    }
  });
});

describe("Zod schemas: market.snapshot", () => {
  const snapshotSchema = z.object({
    ticker: z.string().min(1),
    classCode: z.string().min(1),
    maxAgeSeconds: z.number().int().min(1).optional().default(60),
    includeBook: z.boolean().optional().default(false),
  });

  it("requires ticker and classCode", () => {
    expect(snapshotSchema.safeParse({}).success).toBe(false);
    expect(snapshotSchema.safeParse({ ticker: "SBER" }).success).toBe(false);
  });

  it("accepts valid snapshot params", () => {
    const result = snapshotSchema.safeParse({
      ticker: "SBER",
      classCode: "TQBR",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxAgeSeconds).toBe(60);
      expect(result.data.includeBook).toBe(false);
    }
  });

  it("rejects empty ticker", () => {
    const result = snapshotSchema.safeParse({
      ticker: "",
      classCode: "TQBR",
    });
    expect(result.success).toBe(false);
  });
});
