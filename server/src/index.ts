import express from "express";
import type { Request, Response, NextFunction } from "express";
import cors from "cors";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import crypto from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { config, flags } from "./config.js";
import { marketPool, privatePool } from "./db.js";
import {
  runQuery,
  runLatest,
  runAggregate,
  MARKET_TABLES,
  PRIVATE_TABLES,
} from "./query.js";
import { loadManifest, runScript } from "./scripts.js";
import { bcs } from "./bcs.js";
import { logger } from "./logger.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const requestId = crypto.randomUUID();
  (req as any).requestId = requestId;
  logger.info("http.request", {
    id: requestId,
    method: req.method,
    path: req.path,
  });
  res.on("finish", () => {
    logger.info("http.response", {
      id: requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - start,
    });
  });
  next();
});

const manifest = loadManifest();

interface ToolDef {
  name: string;
  description: string;
  parameters: z.ZodTypeAny;
  execute: (params: any) => Promise<any>;
}

const tools: ToolDef[] = [];

function addTool(tool: ToolDef) {
  tools.push(tool);
}

function findTool(name: string) {
  return tools.find((t) => t.name === name);
}

async function upsertInstruments(items: any[]) {
  let stored = 0;
  for (const item of items || []) {
    const ticker = item.ticker;
    const classCode =
      item.primaryBoard ||
      item.classCode ||
      item.board ||
      (Array.isArray(item.secondaryBoards) ? item.secondaryBoards[0] : null);
    if (!ticker || !classCode) {
      continue;
    }
    const isin = item.isin || null;
    const instrumentType = item.instrumentType || item.type || null;
    const displayName = item.displayName || item.shortName || null;
    await marketPool.query(
      `INSERT INTO instruments (ticker, class_code, isin, instrument_type, display_name, data, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())
       ON CONFLICT (ticker, class_code)
       DO UPDATE SET isin = EXCLUDED.isin,
                     instrument_type = EXCLUDED.instrument_type,
                     display_name = EXCLUDED.display_name,
                     data = EXCLUDED.data,
                     updated_at = now()`,
      [ticker, classCode, isin, instrumentType, displayName, item]
    );
    stored += 1;
  }
  return stored;
}

async function storePortfolioSnapshot(items: any[]) {
  await privatePool.query(
    "INSERT INTO holdings_snapshots (ts, data) VALUES (now(), $1)",
    [items]
  );
  for (const item of items || []) {
    const account = item.account || null;
    const ticker = item.ticker || null;
    const classCode = item.board || item.classCode || item.class_code || null;
    if (!ticker || !classCode) continue;
    const quantity = item.quantity ?? null;
    const avgPrice = item.balancePrice ?? item.averagePrice ?? null;
    const currency = item.currency ?? null;
    await privatePool.query(
      `INSERT INTO holdings_current (account, ticker, class_code, quantity, avg_price, currency, data, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())
       ON CONFLICT (account, ticker, class_code)
       DO UPDATE SET quantity = EXCLUDED.quantity,
                     avg_price = EXCLUDED.avg_price,
                     currency = EXCLUDED.currency,
                     data = EXCLUDED.data,
                     updated_at = now()`,
      [account, ticker, classCode, quantity, avgPrice, currency, item]
    );
  }
}

async function storeLimitsSnapshot(data: any) {
  await privatePool.query(
    "INSERT INTO limits_snapshots (ts, data) VALUES (now(), $1)",
    [data]
  );
}

async function storeTradingStatusSnapshot(classCode: string, data: any) {
  await marketPool.query(
    "INSERT INTO trading_status_snapshots (class_code, ts, data) VALUES ($1, now(), $2)",
    [classCode, data]
  );
}

async function storeTradingScheduleSnapshot(
  classCode: string,
  ticker: string,
  data: any
) {
  await marketPool.query(
    "INSERT INTO trading_schedule_snapshots (class_code, ticker, ts, data) VALUES ($1, $2, now(), $3)",
    [classCode, ticker, data]
  );
}

async function storeInstrumentDiscounts(items: any[]) {
  for (const item of items || []) {
    const ticker = item.ticker;
    if (!ticker) continue;
    await marketPool.query(
      `INSERT INTO instrument_discounts (ticker, ts, discount_long, discount_short, data)
       VALUES ($1, now(), $2, $3, $4)`,
      [ticker, item.discountLong ?? null, item.discountShort ?? null, item]
    );
  }
}

const authMiddleware = (req: any, res: any, next: any) => {
  if (!config.mcpHttpToken) return next();
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== config.mcpHttpToken) {
    return res.status(401).json({ error: "unauthorized" });
  }
  return next();
};

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    version: "26.02.1",
    time: new Date().toISOString(),
  });
});

app.get("/tools", authMiddleware, (_req: Request, res: Response) => {
  res.json(
    tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.parameters, t.name),
    }))
  );
});

app.post("/tools/:name", authMiddleware, async (req: Request, res: Response) => {
  const requestId = (req as any).requestId;
  const tool = findTool(req.params.name);
  if (!tool) return res.status(404).json({ error: "tool not found" });
  const parsed = tool.parameters.safeParse(req.body || {});
  if (!parsed.success) {
    logger.warn("http.tool.invalid", {
      id: requestId,
      tool: req.params.name,
      error: parsed.error.message,
    });
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    logger.debug("http.tool.call", {
      id: requestId,
      tool: req.params.name,
      args: logger.sanitize(parsed.data),
    });
    const started = Date.now();
    const result = await tool.execute(parsed.data);
    logger.info("http.tool.ok", {
      id: requestId,
      tool: req.params.name,
      ms: Date.now() - started,
      result: logger.summarize(result),
    });
    res.json(result);
  } catch (err: any) {
    logger.error("http.tool.error", {
      id: requestId,
      tool: req.params.name,
      error: err?.message || String(err),
    });
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// --- Tools ---

addTool({
  name: "health",
  description: "Проверка состояния сервера и баз данных",
  parameters: z.object({}),
  execute: async () => {
    const market = await marketPool.query("SELECT 1");
    const priv = await privatePool.query("SELECT 1");
    return { ok: true, market: !!market, private: !!priv };
  },
});

addTool({
  name: "market.fetch",
  description:
    "Чтение рыночных данных из bcs_market. Поддерживает фильтры и диапазоны дат.",
  parameters: z.object({
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
  }),
  execute: async (params) => {
    const meta = MARKET_TABLES[params.table];
    return runQuery(marketPool, meta, params);
  },
});

addTool({
  name: "market.latest",
  description:
    "Получить последнюю запись из bcs_market с проверкой актуальности.",
  parameters: z.object({
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
    maxAgeSeconds: z.number().int().min(1).optional(),
  }),
  execute: async (params) => {
    const meta = MARKET_TABLES[params.table];
    return runLatest(marketPool, meta, params);
  },
});

addTool({
  name: "market.aggregate",
  description:
    "Агрегировать временной ряд из bcs_market. Возвращает min/max/avg/sum/count по бакетам.",
  parameters: z.object({
    table: z.enum(Object.keys(MARKET_TABLES) as [string, ...string[]]),
    valueField: z.string().min(1),
    filters: z.record(z.any()).optional(),
    range: z
      .object({
        field: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
      })
      .optional(),
    bucketSeconds: z.number().int().min(1).max(31536000).optional(),
    limit: z.number().int().min(1).max(10000).optional(),
    order: z.enum(["asc", "desc"]).optional(),
  }),
  execute: async (params) => {
    const meta = MARKET_TABLES[params.table];
    return runAggregate(marketPool, meta, params);
  },
});

addTool({
  name: "market.compute",
  description:
    "Выполнить скрипт над временным рядом из bcs_market (значения не выходят наружу).",
  parameters: z.object({
    table: z.enum(Object.keys(MARKET_TABLES) as [string, ...string[]]),
    valueField: z.string().optional(),
    fields: z.array(z.string()).optional(),
    filters: z.record(z.any()).optional(),
    range: z
      .object({
        field: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
      })
      .optional(),
    limit: z.number().int().min(1).max(200000).optional(),
    order: z.enum(["asc", "desc"]).optional(),
    script: z.string().min(1),
    payload: z.record(z.any()).optional(),
  }),
  execute: async (params) => {
    const meta = MARKET_TABLES[params.table];
    const fields =
      params.fields && params.fields.length
        ? params.fields
        : params.valueField
          ? [params.valueField]
          : [];
    if (!fields.length) {
      throw new Error("valueField or fields is required");
    }
    const rows = await runQuery(marketPool, meta, {
      table: params.table,
      columns: fields,
      filters: params.filters,
      range: params.range,
      limit: params.limit || 5000,
      order: params.order || "asc",
      maxLimit: 200000,
    });
    const series: Record<string, any[]> = {};
    for (const field of fields) {
      series[field] = rows
        .map((row) => row[field])
        .filter((v) => v !== null && v !== undefined);
    }
    const payload = { ...(params.payload || {}), series };
    if (fields.length === 1) {
      payload.values = series[fields[0]];
    }
    return runScript(params.script, payload);
  },
});

addTool({
  name: "market.snapshot",
  description:
    "Компактный срез рынка из БД: последняя котировка, последний трейд и топ стакана.",
  parameters: z.object({
    ticker: z.string().min(1),
    classCode: z.string().min(1),
    maxAgeSeconds: z.number().int().min(1).optional().default(60),
    includeBook: z.boolean().optional().default(false),
  }),
  execute: async (params) => {
    const quote = await marketPool.query(
      `SELECT * FROM quotes WHERE ticker = $1 AND class_code = $2 ORDER BY ts DESC LIMIT 1`,
      [params.ticker, params.classCode]
    );
    const trade = await marketPool.query(
      `SELECT * FROM last_trades WHERE ticker = $1 AND class_code = $2 ORDER BY ts DESC LIMIT 1`,
      [params.ticker, params.classCode]
    );
    const book = await marketPool.query(
      `SELECT * FROM order_book_snapshots WHERE ticker = $1 AND class_code = $2 ORDER BY ts DESC LIMIT 1`,
      [params.ticker, params.classCode]
    );

    const quoteRow = quote.rows[0] || null;
    const tradeRow = trade.rows[0] || null;
    const bookRow = book.rows[0] || null;

    const now = Date.now();
    const age = (ts?: string) =>
      ts ? Math.floor((now - new Date(ts).getTime()) / 1000) : null;

    const quoteAge = age(quoteRow?.ts);
    const tradeAge = age(tradeRow?.ts);
    const bookAge = age(bookRow?.ts);

    const bestBid = bookRow?.bids?.[0]?.price ?? null;
    const bestAsk = bookRow?.asks?.[0]?.price ?? null;
    const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
    const spreadPct =
      spread !== null && bestAsk
        ? Number((spread / bestAsk) * 100)
        : null;
    const imbalance =
      bookRow?.bid_volume !== null && bookRow?.ask_volume !== null
        ? Number(
            (bookRow.bid_volume - bookRow.ask_volume) /
              (bookRow.bid_volume + bookRow.ask_volume)
          )
        : null;

    const stale =
      [quoteAge, tradeAge, bookAge]
        .filter((v) => v !== null)
        .some((v) => (v as number) > params.maxAgeSeconds) ?? false;

    return {
      ticker: params.ticker,
      classCode: params.classCode,
      stale,
      ages: { quoteAge, tradeAge, bookAge },
      quote: quoteRow
        ? {
            ts: quoteRow.ts,
            bid: quoteRow.bid,
            offer: quoteRow.offer,
            last: quoteRow.last,
            open: quoteRow.open,
            close: quoteRow.close,
            high: quoteRow.high,
            low: quoteRow.low,
            change: quoteRow.change,
            changeRate: quoteRow.change_rate,
            currency: quoteRow.currency,
            securityTradingStatus: quoteRow.security_trading_status,
          }
        : null,
      trade: tradeRow
        ? {
            ts: tradeRow.ts,
            side: tradeRow.side,
            price: tradeRow.price,
            quantity: tradeRow.quantity,
            volume: tradeRow.volume,
          }
        : null,
      book: bookRow
        ? {
            ts: bookRow.ts,
            depth: bookRow.depth,
            bidVolume: bookRow.bid_volume,
            askVolume: bookRow.ask_volume,
            bestBid,
            bestAsk,
            spread,
            spreadPct,
            imbalance,
            bids: params.includeBook ? bookRow.bids : undefined,
            asks: params.includeBook ? bookRow.asks : undefined,
          }
        : null,
    };
  },
});

addTool({
  name: "private.fetch",
  description:
    "Чтение личных данных из bcs_private (портфель, сделки, PnL, логи решений).",
  parameters: z.object({
    table: z.enum(Object.keys(PRIVATE_TABLES) as [string, ...string[]]),
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
  }),
  execute: async (params) => {
    const meta = PRIVATE_TABLES[params.table];
    return runQuery(privatePool, meta, params);
  },
});

addTool({
  name: "private.latest",
  description:
    "Получить последнюю запись из bcs_private с проверкой актуальности.",
  parameters: z.object({
    table: z.enum(Object.keys(PRIVATE_TABLES) as [string, ...string[]]),
    columns: z.array(z.string()).optional(),
    filters: z.record(z.any()).optional(),
    range: z
      .object({
        field: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
      })
      .optional(),
    maxAgeSeconds: z.number().int().min(1).optional(),
  }),
  execute: async (params) => {
    const meta = PRIVATE_TABLES[params.table];
    return runLatest(privatePool, meta, params);
  },
});

addTool({
  name: "private.aggregate",
  description:
    "Агрегировать временной ряд из bcs_private. Возвращает min/max/avg/sum/count по бакетам.",
  parameters: z.object({
    table: z.enum(Object.keys(PRIVATE_TABLES) as [string, ...string[]]),
    valueField: z.string().min(1),
    filters: z.record(z.any()).optional(),
    range: z
      .object({
        field: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
      })
      .optional(),
    bucketSeconds: z.number().int().min(1).max(31536000).optional(),
    limit: z.number().int().min(1).max(10000).optional(),
    order: z.enum(["asc", "desc"]).optional(),
  }),
  execute: async (params) => {
    const meta = PRIVATE_TABLES[params.table];
    return runAggregate(privatePool, meta, params);
  },
});
addTool({
  name: "selected_assets.list",
  description: "Список выбранных активов для подписок/аналитики",
  parameters: z.object({}),
  execute: async () => {
    const rows = await privatePool.query(
      "SELECT ticker, class_code, enabled, notes FROM selected_assets ORDER BY ticker"
    );
    return rows.rows;
  },
});

addTool({
  name: "selected_assets.upsert",
  description: "Добавить или обновить актив в списке выбранных",
  parameters: z.object({
    ticker: z.string().min(1),
    classCode: z.string().min(1),
    enabled: z.boolean().optional().default(true),
    notes: z.string().optional(),
  }),
  execute: async (params) => {
    await privatePool.query(
      `INSERT INTO selected_assets (ticker, class_code, enabled, notes, updated_at)
       VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (ticker, class_code)
       DO UPDATE SET enabled = EXCLUDED.enabled, notes = EXCLUDED.notes, updated_at = now()`,
      [params.ticker, params.classCode, params.enabled, params.notes || null]
    );
    return { ok: true };
  },
});

addTool({
  name: "decision.log",
  description:
    "Сохранить решение/ответ модели (prompt/response) и опционально поставить в очередь эмбеддингов",
  parameters: z.object({
    model: z.string().optional(),
    prompt: z.string().min(1),
    response: z.string().min(1),
    metadata: z.record(z.any()).optional(),
    embed: z.boolean().optional().default(true),
  }),
  execute: async (params) => {
    const result = await privatePool.query(
      `INSERT INTO decision_logs (model, prompt, response, metadata)
       VALUES ($1,$2,$3,$4)
       RETURNING id`,
      [params.model || null, params.prompt, params.response, params.metadata || null]
    );
    const id = result.rows[0]?.id;
    if (params.embed && id) {
      const text = `PROMPT:\n${params.prompt}\n\nRESPONSE:\n${params.response}`;
      await privatePool.query(
        `INSERT INTO embedding_queue (entity_type, entity_id, text, metadata)
         VALUES ($1,$2,$3,$4)`,
        ["decision", id, text, params.metadata || null]
      );
    }
    return { ok: true, id };
  },
});

addTool({
  name: "policy.get",
  description: "Получить правила/ограничения торговли (сводная политика)",
  parameters: z.object({
    key: z.string().optional().default("bcs_policy_v1"),
  }),
  execute: async (params) => {
    const res = await privatePool.query(
      "SELECT key, data, updated_at FROM policy_docs WHERE key = $1",
      [params.key]
    );
    if (!res.rows[0]) {
      return { ok: false, error: "policy not found" };
    }
    return { ok: true, ...res.rows[0] };
  },
});

addTool({
  name: "policy.compact",
  description: "Короткое описание торговых условий (для минимального контекста)",
  parameters: z.object({
    key: z.string().optional().default("bcs_policy_v1"),
  }),
  execute: async (params) => {
    const res = await privatePool.query(
      "SELECT data FROM policy_docs WHERE key = $1",
      [params.key]
    );
    if (!res.rows[0]) {
      return { ok: false, error: "policy not found" };
    }
    const compact = res.rows[0]?.data?.compact;
    return { ok: true, compact: compact || null };
  },
});

addTool({
  name: "policy.section",
  description:
    "Получить один раздел политики (коротко или подробно) для минимального контекста",
  parameters: z.object({
    key: z.string().optional().default("bcs_policy_v1"),
    section: z.string().min(1),
    compact: z.boolean().optional().default(true),
  }),
  execute: async (params) => {
    const res = await privatePool.query(
      "SELECT data FROM policy_docs WHERE key = $1",
      [params.key]
    );
    if (!res.rows[0]) {
      return { ok: false, error: "policy not found" };
    }
    const data = res.rows[0]?.data || {};
    if (params.compact) {
      const compactSections = data.compact_sections || {};
      const compactText = compactSections[params.section] || null;
      return { ok: true, section: params.section, compact: compactText };
    }
    return { ok: true, section: params.section, data: data[params.section] || null };
  },
});

addTool({
  name: "embedding.enqueue",
  description: "Поставить текст в очередь эмбеддингов",
  parameters: z.object({
    entityType: z.string().min(1),
    entityId: z.string().min(1),
    text: z.string().min(1),
    metadata: z.record(z.any()).optional(),
  }),
  execute: async (params) => {
    await privatePool.query(
      `INSERT INTO embedding_queue (entity_type, entity_id, text, metadata)
       VALUES ($1,$2,$3,$4)`,
      [params.entityType, params.entityId, params.text, params.metadata || null]
    );
    return { ok: true };
  },
});

addTool({
  name: "embedding.search",
  description:
    "Семантический поиск по базе эмбеддингов (pgvector). Ищет похожие решения/ошибки.",
  parameters: z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(50).optional().default(10),
  }),
  execute: async (params) => {
    const resp = await fetch(`${config.ollama.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.ollama.embedModel,
        prompt: params.query,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`ollama error: ${resp.status} ${text}`);
    }
    const data = await resp.json();
    const embedding = data.embedding as number[];
    const vector = `[${embedding.join(",")}]`;
    const result = await privatePool.query(
      `SELECT entity_type, entity_id, metadata, (embedding <=> $1) AS distance
       FROM embeddings
       ORDER BY embedding <=> $1
       LIMIT $2`,
      [vector, params.limit]
    );
    return result.rows;
  },
});

addTool({
  name: "scripts.list",
  description: "Список доступных скриптов для быстрых расчётов",
  parameters: z.object({}),
  execute: async () => manifest,
});

addTool({
  name: "scripts.catalog",
  description:
    "Короткий каталог скриптов (с фильтром по категории/стратегии)",
  parameters: z.object({
    category: z.string().optional(),
    strategy: z.string().optional(),
  }),
  execute: async (params) => {
    const scripts = (manifest.scripts || []).filter((script: any) => {
      if (params.category && script.category !== params.category) return false;
      if (params.strategy && !(script.strategies || []).includes(params.strategy))
        return false;
      return true;
    });
    return scripts.map((s: any) => ({
      name: s.name,
      description: s.description,
      category: s.category,
      strategies: s.strategies,
      input: s.input,
    }));
  },
});

addTool({
  name: "scripts.run",
  description: "Запуск скрипта из /scripts с JSON-входом",
  parameters: z.object({
    name: z.string().min(1),
    payload: z.record(z.any()).optional(),
  }),
  execute: async (params) => runScript(params.name, params.payload || {}),
});

addTool({
  name: "signals.run",
  description:
    "Собрать признаки по свечам/стакану, посчитать вероятности режимов и направления. По умолчанию сохраняет в БД.",
  parameters: z.object({
    ticker: z.string().min(1),
    classCode: z.string().min(1),
    timeFrame: z
      .enum(["M1", "M5", "M15", "M30", "H1", "H4", "D", "W", "MN"])
      .optional()
      .default("M1"),
    lookback: z.number().int().min(20).max(5000).optional().default(200),
    includeFeatures: z.boolean().optional().default(false),
    store: z.boolean().optional().default(true),
    maxAgeSeconds: z.number().int().min(1).optional(),
  }),
  execute: async (params) => {
    const rows = await marketPool.query(
      `SELECT ts, open, high, low, close, volume
       FROM candles
       WHERE ticker = $1 AND class_code = $2 AND time_frame = $3
       ORDER BY ts DESC
       LIMIT $4`,
      [params.ticker, params.classCode, params.timeFrame, params.lookback]
    );
    if (!rows.rows.length) {
      return { ok: false, error: "no candles available" };
    }
    const ordered = rows.rows.slice().reverse();
    const series = {
      open: ordered.map((r: any) => r.open).filter((v: any) => v !== null),
      high: ordered.map((r: any) => r.high).filter((v: any) => v !== null),
      low: ordered.map((r: any) => r.low).filter((v: any) => v !== null),
      close: ordered.map((r: any) => r.close).filter((v: any) => v !== null),
      volume: ordered.map((r: any) => r.volume).filter((v: any) => v !== null),
    };

    const lastTs = ordered[ordered.length - 1]?.ts;
    const ageSeconds = lastTs
      ? Math.floor((Date.now() - new Date(lastTs).getTime()) / 1000)
      : null;
    const stale =
      params.maxAgeSeconds && ageSeconds !== null
        ? ageSeconds > params.maxAgeSeconds
        : false;

    const bookRes = await marketPool.query(
      `SELECT bids, asks, bid_volume, ask_volume, ts
       FROM order_book_snapshots
       WHERE ticker = $1 AND class_code = $2
       ORDER BY ts DESC
       LIMIT 1`,
      [params.ticker, params.classCode]
    );
    const bookRow = bookRes.rows[0] || null;
    const orderbook = bookRow
      ? {
          bids: bookRow.bids,
          asks: bookRow.asks,
          bidVolume: bookRow.bid_volume,
          askVolume: bookRow.ask_volume,
          ts: bookRow.ts,
        }
      : null;

    const wrapped = await runScript("signal_score", { series, orderbook });
    if (wrapped?.ok === false) {
      return { ok: false, error: wrapped.error || "signal_score failed" };
    }
    const result = wrapped?.result || wrapped || {};
    if (result?.error) {
      return { ok: false, error: result.error, details: result };
    }

    let featuresId: string | null = null;
    if (params.store) {
      const featureRes = await privatePool.query(
        `INSERT INTO signal_features (ticker, class_code, time_frame, lookback, features)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id`,
        [
          params.ticker,
          params.classCode,
          params.timeFrame,
          series.close.length,
          result.features || {},
        ]
      );
      featuresId = featureRes.rows[0]?.id || null;
      await privatePool.query(
        `INSERT INTO signal_probs (ticker, class_code, time_frame, model, probs, direction, features_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          params.ticker,
          params.classCode,
          params.timeFrame,
          result.model || "heuristic-v1",
          result.probs || {},
          result.direction || {},
          featuresId,
        ]
      );
    }

    return {
      ok: true,
      ticker: params.ticker,
      classCode: params.classCode,
      timeFrame: params.timeFrame,
      lookback: series.close.length,
      model: result.model || "heuristic-v1",
      probs: result.probs || {},
      direction: result.direction || {},
      ageSeconds,
      stale,
      featuresId,
      features: params.includeFeatures ? result.features || {} : undefined,
    };
  },
});

// --- BCS REST tools ---

addTool({
  name: "bcs.portfolio.get",
  description: "Получить портфель через BCS API",
  parameters: z.object({
    cacheSeconds: z.number().int().min(0).max(3600).optional().default(30),
  }),
  execute: async (params) => {
    if (params.cacheSeconds > 0) {
      const cached = await privatePool.query(
        "SELECT ts, data FROM holdings_snapshots ORDER BY ts DESC LIMIT 1"
      );
      const row = cached.rows[0];
      if (row?.ts) {
        const ageSeconds = Math.floor(
          (Date.now() - new Date(row.ts).getTime()) / 1000
        );
        if (ageSeconds <= params.cacheSeconds) {
          return { source: "db", ageSeconds, data: row.data };
        }
      }
    }
    const data = await bcs.getPortfolio();
    if (Array.isArray(data)) {
      await storePortfolioSnapshot(data);
    }
    return { source: "api", data };
  },
});

addTool({
  name: "bcs.limits.get",
  description: "Получить лимиты через BCS API",
  parameters: z.object({
    cacheSeconds: z.number().int().min(0).max(3600).optional().default(30),
  }),
  execute: async (params) => {
    if (params.cacheSeconds > 0) {
      const cached = await privatePool.query(
        "SELECT ts, data FROM limits_snapshots ORDER BY ts DESC LIMIT 1"
      );
      const row = cached.rows[0];
      if (row?.ts) {
        const ageSeconds = Math.floor(
          (Date.now() - new Date(row.ts).getTime()) / 1000
        );
        if (ageSeconds <= params.cacheSeconds) {
          return { source: "db", ageSeconds, data: row.data };
        }
      }
    }
    const data = await bcs.getLimits();
    if (data) {
      await storeLimitsSnapshot(data);
    }
    return { source: "api", data };
  },
});

addTool({
  name: "bcs.orders.create",
  description:
    "Создать торговую заявку (требует BCS_ALLOW_WRITE=1 и trade-api-write токен)",
  parameters: z.object({
    clientOrderId: z.string().uuid().optional(),
    side: z.union([z.literal(1), z.literal(2)]),
    orderType: z.union([z.literal(1), z.literal(2)]),
    orderQuantity: z.number().int().min(1),
    ticker: z.string().min(1),
    classCode: z.string().min(1),
    price: z.number().optional(),
  }),
  execute: async (params) => {
    if (!flags.allowWrite) {
      throw new Error("write operations disabled: set BCS_ALLOW_WRITE=1");
    }
    const id = params.clientOrderId || crypto.randomUUID();
    const payload = { ...params, clientOrderId: id };
    const result = await bcs.createOrder(payload);
    await privatePool.query(
      `INSERT INTO orders (original_client_order_id, client_order_id, ticker, class_code, side, order_type, quantity, price, status, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (original_client_order_id)
       DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data, updated_at = now()`,
      [
        id,
        id,
        params.ticker,
        params.classCode,
        params.side,
        params.orderType,
        params.orderQuantity,
        params.price || null,
        result?.status || null,
        result,
      ]
    );
    return { clientOrderId: id, result };
  },
});

addTool({
  name: "bcs.orders.cancel",
  description: "Отменить заявку",
  parameters: z.object({
    originalClientOrderId: z.string().uuid(),
    clientOrderId: z.string().uuid().optional(),
  }),
  execute: async (params) => {
    if (!flags.allowWrite) {
      throw new Error("write operations disabled: set BCS_ALLOW_WRITE=1");
    }
    const payload = {
      clientOrderId: params.clientOrderId || crypto.randomUUID(),
    };
    const result = await bcs.cancelOrder(params.originalClientOrderId, payload);
    await privatePool.query(
      `UPDATE orders SET status = $2, updated_at = now(), data = $3 WHERE original_client_order_id = $1`,
      [params.originalClientOrderId, result?.status || null, result]
    );
    return result;
  },
});

addTool({
  name: "bcs.orders.replace",
  description: "Изменить заявку",
  parameters: z.object({
    originalClientOrderId: z.string().uuid(),
    clientOrderId: z.string().uuid().optional(),
    price: z.number().optional(),
    orderQuantity: z.number().int().min(1),
  }),
  execute: async (params) => {
    if (!flags.allowWrite) {
      throw new Error("write operations disabled: set BCS_ALLOW_WRITE=1");
    }
    const payload = {
      clientOrderId: params.clientOrderId || crypto.randomUUID(),
      price: params.price,
      orderQuantity: params.orderQuantity,
    };
    const result = await bcs.replaceOrder(params.originalClientOrderId, payload);
    await privatePool.query(
      `UPDATE orders SET updated_at = now(), data = $2 WHERE original_client_order_id = $1`,
      [params.originalClientOrderId, result]
    );
    return result;
  },
});

addTool({
  name: "bcs.orders.status",
  description: "Получить статус заявки",
  parameters: z.object({ originalClientOrderId: z.string().uuid() }),
  execute: async (params) => bcs.getOrderStatus(params.originalClientOrderId),
});

addTool({
  name: "bcs.orders.search",
  description: "Поиск заявок (фильтры и пагинация)",
  parameters: z.object({
    page: z.number().int().min(0).optional(),
    size: z.number().int().min(1).max(100).optional(),
    sort: z.array(z.string()).optional(),
    body: z.record(z.any()).optional(),
    store: z.boolean().optional().default(false),
  }),
  execute: async (params) => {
    const query = new URLSearchParams();
    if (params.page !== undefined) query.set("page", String(params.page));
    if (params.size !== undefined) query.set("size", String(params.size));
    if (params.sort) params.sort.forEach((s: string) => query.append("sort", s));
    const data = await bcs.searchOrders(query, params.body || {});
    if (params.store && data?.records) {
      for (const record of data.records) {
        const originalId =
          record.originalClientOrderId ||
          record.original_client_order_id ||
          record.clientOrderId ||
          record.client_order_id;
        if (!originalId) continue;
        await privatePool.query(
          `INSERT INTO orders (original_client_order_id, client_order_id, ticker, class_code, side, order_type, quantity, price, status, data)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (original_client_order_id)
           DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data, updated_at = now()`,
          [
            originalId,
            record.clientOrderId || record.client_order_id || null,
            record.ticker || null,
            record.classCode || record.class_code || null,
            record.side || null,
            record.orderType || record.order_type || null,
            record.orderQuantity || record.order_quantity || null,
            record.price || null,
            record.orderStatus || record.order_status || null,
            record,
          ]
        );
      }
    }
    return data;
  },
});

addTool({
  name: "bcs.trades.search",
  description: "Поиск сделок (фильтры и пагинация)",
  parameters: z.object({
    page: z.number().int().min(0).optional(),
    size: z.number().int().min(1).max(100).optional(),
    sort: z.array(z.string()).optional(),
    body: z.record(z.any()).optional(),
    store: z.boolean().optional().default(false),
  }),
  execute: async (params) => {
    const query = new URLSearchParams();
    if (params.page !== undefined) query.set("page", String(params.page));
    if (params.size !== undefined) query.set("size", String(params.size));
    if (params.sort) params.sort.forEach((s: string) => query.append("sort", s));
    const data = await bcs.searchTrades(query, params.body || {});
    if (params.store && data?.records) {
      for (const record of data.records) {
        const ts =
          record.tradeDateTime ||
          record.trade_date_time ||
          record.dateTime ||
          record.transactionTime ||
          new Date().toISOString();
        await privatePool.query(
          `INSERT INTO trades (execution_id, ts, ticker, class_code, side, price, quantity, commission, data)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            record.executionId || record.execution_id || record.tradeNum || null,
            ts,
            record.ticker || null,
            record.classCode || record.class_code || null,
            record.side || null,
            record.price || null,
            record.quantity || null,
            record.commission || null,
            record,
          ]
        );
      }
    }
    return data;
  },
});

addTool({
  name: "bcs.candles.get",
  description: "Получить исторические свечи через BCS API",
  parameters: z.object({
    classCode: z.string().min(1),
    ticker: z.string().min(1),
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    timeFrame: z.enum(["M1", "M5", "M15", "M30", "H1", "H4", "D", "W", "MN"]),
  }),
  execute: async (params) => {
    const query = new URLSearchParams({
      classCode: params.classCode,
      ticker: params.ticker,
      startDate: params.startDate,
      endDate: params.endDate,
      timeFrame: params.timeFrame,
    });
    return bcs.getCandles(query);
  },
});

addTool({
  name: "bcs.candles.backfill",
  description:
    "Получить исторические свечи и сохранить в bcs_market.candles (апсерт)",
  parameters: z.object({
    classCode: z.string().min(1),
    ticker: z.string().min(1),
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    timeFrame: z.enum(["M1", "M5", "M15", "M30", "H1", "H4", "D", "W", "MN"]),
  }),
  execute: async (params) => {
    const query = new URLSearchParams({
      classCode: params.classCode,
      ticker: params.ticker,
      startDate: params.startDate,
      endDate: params.endDate,
      timeFrame: params.timeFrame,
    });
    const data = await bcs.getCandles(query);
    const bars = (data as any).bars || [];
    for (const bar of bars) {
      await marketPool.query(
        `INSERT INTO candles (ticker, class_code, time_frame, ts, open, high, low, close, volume, data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (ticker, class_code, time_frame, ts)
         DO UPDATE SET open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low,
                       close=EXCLUDED.close, volume=EXCLUDED.volume, data=EXCLUDED.data`,
        [
          params.ticker,
          params.classCode,
          params.timeFrame,
          bar.time,
          bar.open,
          bar.high,
          bar.low,
          bar.close,
          bar.volume,
          bar,
        ]
      );
    }
    return { ok: true, count: bars.length };
  },
});

addTool({
  name: "bcs.instruments.by_tickers",
  description: "Получить инструменты по тикерам",
  parameters: z.object({
    tickers: z.array(z.string()).min(1),
    page: z.number().int().min(0).optional(),
    size: z.number().int().min(1).max(100).optional(),
    store: z.boolean().optional().default(false),
  }),
  execute: async (params) => {
    const query = new URLSearchParams();
    if (params.page !== undefined) query.set("page", String(params.page));
    if (params.size !== undefined) query.set("size", String(params.size));
    const data = await bcs.instrumentsByTickers(query, { tickers: params.tickers });
    if (params.store && Array.isArray(data)) {
      const stored = await upsertInstruments(data);
      return { data, stored };
    }
    return data;
  },
});

addTool({
  name: "bcs.instruments.by_isins",
  description: "Получить инструменты по ISIN",
  parameters: z.object({
    isins: z.array(z.string()).min(1),
    page: z.number().int().min(0).optional(),
    size: z.number().int().min(1).max(100).optional(),
    store: z.boolean().optional().default(false),
  }),
  execute: async (params) => {
    const query = new URLSearchParams();
    if (params.page !== undefined) query.set("page", String(params.page));
    if (params.size !== undefined) query.set("size", String(params.size));
    const data = await bcs.instrumentsByIsins(query, { isins: params.isins });
    if (params.store && Array.isArray(data)) {
      const stored = await upsertInstruments(data);
      return { data, stored };
    }
    return data;
  },
});

addTool({
  name: "bcs.instruments.by_type",
  description: "Получить инструменты по типу",
  parameters: z.object({
    type: z.enum([
      "CURRENCY",
      "STOCK",
      "FOREIGN_STOCK",
      "BONDS",
      "NOTES",
      "DEPOSITARY_RECEIPTS",
      "EURO_BONDS",
      "MUTUAL_FUNDS",
      "ETF",
      "FUTURES",
      "OPTIONS",
      "GOODS",
      "INDICES",
    ]),
    baseAssetTicker: z.string().optional(),
    page: z.number().int().min(0).optional(),
    size: z.number().int().min(1).max(100).optional(),
    store: z.boolean().optional().default(false),
  }),
  execute: async (params) => {
    const query = new URLSearchParams();
    query.set("type", params.type);
    if (params.baseAssetTicker) query.set("baseAssetTicker", params.baseAssetTicker);
    if (params.page !== undefined) query.set("page", String(params.page));
    if (params.size !== undefined) query.set("size", String(params.size));
    const data = await bcs.instrumentsByType(query);
    if (params.store && Array.isArray(data)) {
      const stored = await upsertInstruments(data);
      return { data, stored };
    }
    return data;
  },
});

addTool({
  name: "bcs.instruments.discounts",
  description: "Получить дисконты по инструментам",
  parameters: z.object({
    cacheSeconds: z.number().int().min(0).max(86400).optional().default(300),
    store: z.boolean().optional().default(true),
  }),
  execute: async (params) => {
    if (params.cacheSeconds > 0) {
      const lastTs = await marketPool.query(
        "SELECT max(ts) as ts FROM instrument_discounts"
      );
      const ts = lastTs.rows[0]?.ts;
      if (ts) {
        const ageSeconds = Math.floor(
          (Date.now() - new Date(ts).getTime()) / 1000
        );
        if (ageSeconds <= params.cacheSeconds) {
          const rows = await marketPool.query(
            "SELECT ticker, discount_long, discount_short, ts, data FROM instrument_discounts WHERE ts = $1",
            [ts]
          );
          return { source: "db", ageSeconds, data: rows.rows };
        }
      }
    }

    const data = await bcs.instrumentsDiscounts();
    if (params.store && Array.isArray(data)) {
      await storeInstrumentDiscounts(data);
    }
    return { source: "api", data };
  },
});

addTool({
  name: "bcs.trading.status",
  description: "Статус торгов по classCode",
  parameters: z.object({
    classCode: z.string().min(1),
    cacheSeconds: z.number().int().min(0).max(86400).optional().default(60),
    store: z.boolean().optional().default(true),
  }),
  execute: async (params) => {
    if (params.cacheSeconds > 0) {
      const cached = await marketPool.query(
        "SELECT ts, data FROM trading_status_snapshots WHERE class_code = $1 ORDER BY ts DESC LIMIT 1",
        [params.classCode]
      );
      const row = cached.rows[0];
      if (row?.ts) {
        const ageSeconds = Math.floor(
          (Date.now() - new Date(row.ts).getTime()) / 1000
        );
        if (ageSeconds <= params.cacheSeconds) {
          return { source: "db", ageSeconds, data: row.data };
        }
      }
    }
    const query = new URLSearchParams({ classCode: params.classCode });
    const data = await bcs.tradingStatus(query);
    if (params.store) {
      await storeTradingStatusSnapshot(params.classCode, data);
    }
    return { source: "api", data };
  },
});

addTool({
  name: "bcs.trading.schedule",
  description: "Расписание торгов по инструменту",
  parameters: z.object({
    classCode: z.string().min(1),
    ticker: z.string().min(1),
    cacheSeconds: z.number().int().min(0).max(86400).optional().default(300),
    store: z.boolean().optional().default(true),
  }),
  execute: async (params) => {
    if (params.cacheSeconds > 0) {
      const cached = await marketPool.query(
        "SELECT ts, data FROM trading_schedule_snapshots WHERE class_code = $1 AND ticker = $2 ORDER BY ts DESC LIMIT 1",
        [params.classCode, params.ticker]
      );
      const row = cached.rows[0];
      if (row?.ts) {
        const ageSeconds = Math.floor(
          (Date.now() - new Date(row.ts).getTime()) / 1000
        );
        if (ageSeconds <= params.cacheSeconds) {
          return { source: "db", ageSeconds, data: row.data };
        }
      }
    }
    const query = new URLSearchParams({
      classCode: params.classCode,
      ticker: params.ticker,
    });
    const data = await bcs.dailySchedule(query);
    if (params.store) {
      await storeTradingScheduleSnapshot(params.classCode, params.ticker, data);
    }
    return { source: "api", data };
  },
});

// --- MCP server wiring ---

const server = new Server(
  { name: "bcs-mcp", version: "26.02.1" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  logger.debug("mcp.list_tools");
  return {
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.parameters, t.name),
    })),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const requestId = crypto.randomUUID();
  logger.info("mcp.tool.call", {
    id: requestId,
    tool: request.params.name,
    args: logger.sanitize(request.params.arguments ?? {}),
  });
  const tool = findTool(request.params.name);
  if (!tool) {
    logger.warn("mcp.tool.unknown", { id: requestId, tool: request.params.name });
    return {
      content: [
        {
          type: "text",
          text: `Unknown tool: ${request.params.name}`,
        },
      ],
      isError: true,
    };
  }
  const parsed = tool.parameters.safeParse(request.params.arguments ?? {});
  if (!parsed.success) {
    logger.warn("mcp.tool.invalid", {
      id: requestId,
      tool: request.params.name,
      error: parsed.error.message,
    });
    return {
      content: [
        {
          type: "text",
          text: `Invalid input: ${parsed.error.message}`,
        },
      ],
      isError: true,
    };
  }
  try {
    const started = Date.now();
    const result = await tool.execute(parsed.data);
    logger.info("mcp.tool.ok", {
      id: requestId,
      tool: request.params.name,
      ms: Date.now() - started,
      result: logger.summarize(result),
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err: any) {
    logger.error("mcp.tool.error", {
      id: requestId,
      tool: request.params.name,
      error: err?.message || String(err),
    });
    return {
      content: [
        {
          type: "text",
          text: `Tool error: ${err?.message || String(err)}`,
        },
      ],
      isError: true,
    };
  }
});

async function start() {
  logger.debug("startup.config", {
    mcpTransport: config.mcpTransport,
    mcpHost: config.mcpHost,
    mcpPort: config.mcpPort,
    db: config.db,
    bcs: { clientId: config.bcs.clientId },
    ollama: config.ollama,
    allowWrite: flags.allowWrite,
  });
  if (config.mcpTransport === "stdio") {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("mcp.transport.ready", { transport: "stdio" });
  } else {
    logger.warn(
      `[mcp] MCP_TRANSPORT=${config.mcpTransport} not supported; falling back to stdio`
    );
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }

  app.listen(config.mcpPort, config.mcpHost, () => {
    logger.info("http.listen", { host: config.mcpHost, port: config.mcpPort });
  });
}

start().catch((err) => {
  logger.error("startup.error", { error: err?.message || String(err) });
  process.exit(1);
});
