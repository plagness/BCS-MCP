import { Pool } from "pg";

export type RangeInput = {
  field?: string;
  start?: string;
  end?: string;
};

export type FilterValue =
  | string
  | number
  | boolean
  | null
  | { op: "gt" | "gte" | "lt" | "lte" | "neq" | "like" | "ilike" | "in"; value: any }
  | Array<string | number | boolean | null>;

export type QueryInput = {
  table: string;
  columns?: string[];
  filters?: Record<string, FilterValue>;
  range?: RangeInput;
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
  maxLimit?: number;
};

export type LatestInput = Omit<QueryInput, "limit" | "offset"> & {
  maxAgeSeconds?: number;
};

export type AggregateInput = {
  table: string;
  valueField: string;
  filters?: Record<string, FilterValue>;
  range?: RangeInput;
  bucketSeconds?: number;
  limit?: number;
  order?: "asc" | "desc";
};

export type TableMeta = {
  columns: string[];
  timeField: string | null;
};

export const MARKET_TABLES: Record<string, TableMeta> = {
  candles: {
    timeField: "ts",
    columns: [
      "ticker",
      "class_code",
      "time_frame",
      "ts",
      "open",
      "high",
      "low",
      "close",
      "volume",
      "data",
    ],
  },
  quotes: {
    timeField: "ts",
    columns: [
      "id",
      "ticker",
      "class_code",
      "ts",
      "bid",
      "offer",
      "last",
      "open",
      "close",
      "high",
      "low",
      "change",
      "change_rate",
      "currency",
      "security_trading_status",
      "data",
    ],
  },
  order_book_snapshots: {
    timeField: "ts",
    columns: [
      "id",
      "ticker",
      "class_code",
      "ts",
      "depth",
      "bid_volume",
      "ask_volume",
      "bids",
      "asks",
      "data",
    ],
  },
  last_trades: {
    timeField: "ts",
    columns: [
      "id",
      "ticker",
      "class_code",
      "ts",
      "side",
      "price",
      "quantity",
      "volume",
      "data",
    ],
  },
  trading_status_snapshots: {
    timeField: "ts",
    columns: ["id", "class_code", "ts", "data"],
  },
  trading_schedule_snapshots: {
    timeField: "ts",
    columns: ["id", "class_code", "ticker", "ts", "data"],
  },
  instrument_discounts: {
    timeField: "ts",
    columns: [
      "id",
      "ticker",
      "ts",
      "discount_long",
      "discount_short",
      "data",
    ],
  },
  instruments: {
    timeField: "updated_at",
    columns: [
      "id",
      "ticker",
      "class_code",
      "isin",
      "instrument_type",
      "display_name",
      "data",
      "updated_at",
    ],
  },
};

export const PRIVATE_TABLES: Record<string, TableMeta> = {
  selected_assets: {
    timeField: "updated_at",
    columns: [
      "id",
      "ticker",
      "class_code",
      "instrument_type",
      "currency",
      "enabled",
      "notes",
      "created_at",
      "updated_at",
    ],
  },
  decision_logs: {
    timeField: "ts",
    columns: ["id", "ts", "model", "prompt", "response", "metadata"],
  },
  wallet_operations: {
    timeField: "ts",
    columns: ["id", "ts", "currency", "amount", "op_type", "details"],
  },
  holdings_current: {
    timeField: "updated_at",
    columns: [
      "id",
      "account",
      "ticker",
      "class_code",
      "quantity",
      "avg_price",
      "currency",
      "data",
      "updated_at",
    ],
  },
  holdings_snapshots: {
    timeField: "ts",
    columns: ["id", "ts", "account", "data"],
  },
  orders: {
    timeField: "created_at",
    columns: [
      "original_client_order_id",
      "client_order_id",
      "ticker",
      "class_code",
      "side",
      "order_type",
      "quantity",
      "price",
      "status",
      "data",
      "created_at",
      "updated_at",
    ],
  },
  order_events: {
    timeField: "ts",
    columns: [
      "id",
      "ts",
      "original_client_order_id",
      "client_order_id",
      "order_status",
      "execution_type",
      "ticker",
      "class_code",
      "data",
    ],
  },
  limits_snapshots: {
    timeField: "ts",
    columns: ["id", "ts", "data"],
  },
  marginal_indicators_snapshots: {
    timeField: "ts",
    columns: ["id", "ts", "data"],
  },
  trades: {
    timeField: "ts",
    columns: [
      "id",
      "execution_id",
      "ts",
      "ticker",
      "class_code",
      "side",
      "price",
      "quantity",
      "commission",
      "data",
    ],
  },
  pnl_daily: {
    timeField: null,
    columns: ["day", "realized", "unrealized", "total", "currency", "details"],
  },
  pnl_events: {
    timeField: "ts",
    columns: ["id", "ts", "pnl_value", "currency", "source", "details"],
  },
  mistake_logs: {
    timeField: "ts",
    columns: [
      "id",
      "ts",
      "ticker",
      "class_code",
      "expected",
      "actual",
      "delta",
      "notes",
      "metadata",
    ],
  },
  embedding_queue: {
    timeField: "created_at",
    columns: ["id", "entity_type", "entity_id", "text", "metadata", "status", "created_at"],
  },
  embeddings: {
    timeField: "created_at",
    columns: ["id", "entity_type", "entity_id", "metadata", "created_at"],
  },
  policy_docs: {
    timeField: "updated_at",
    columns: ["key", "data", "updated_at"],
  },
  signal_features: {
    timeField: "ts",
    columns: [
      "id",
      "ts",
      "ticker",
      "class_code",
      "time_frame",
      "lookback",
      "features",
    ],
  },
  signal_probs: {
    timeField: "ts",
    columns: [
      "id",
      "ts",
      "ticker",
      "class_code",
      "time_frame",
      "model",
      "probs",
      "direction",
      "features_id",
    ],
  },
};

const OPS: Record<string, string> = {
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  neq: "!=",
  like: "LIKE",
  ilike: "ILIKE",
  in: "IN",
};

function buildWhere(meta: TableMeta, input: { filters?: Record<string, FilterValue>; range?: RangeInput }) {
  const allowed = new Set(meta.columns);
  const where: string[] = [];
  const values: any[] = [];

  const filters = input.filters || {};
  for (const [key, raw] of Object.entries(filters)) {
    if (!allowed.has(key)) {
      throw new Error(`invalid filter column: ${key}`);
    }
    if (raw === null) {
      where.push(`${key} IS NULL`);
      continue;
    }
    if (Array.isArray(raw)) {
      values.push(raw);
      where.push(`${key} = ANY($${values.length})`);
      continue;
    }
    if (typeof raw === "object" && raw !== null && "op" in raw) {
      const op = OPS[raw.op];
      if (!op) {
        throw new Error(`invalid operator for ${key}`);
      }
      if (raw.op === "in") {
        values.push(raw.value);
        where.push(`${key} = ANY($${values.length})`);
      } else {
        values.push(raw.value);
        where.push(`${key} ${op} $${values.length}`);
      }
      continue;
    }
    values.push(raw);
    where.push(`${key} = $${values.length}`);
  }

  if (input.range && meta.timeField) {
    const field = input.range.field || meta.timeField;
    if (!allowed.has(field)) {
      throw new Error(`invalid range field: ${field}`);
    }
    if (input.range.start) {
      values.push(input.range.start);
      where.push(`${field} >= $${values.length}`);
    }
    if (input.range.end) {
      values.push(input.range.end);
      where.push(`${field} <= $${values.length}`);
    }
  }

  return { where, values, allowed };
}

export async function runQuery(
  pool: Pool,
  meta: TableMeta,
  input: QueryInput
): Promise<any[]> {
  const table = input.table;
  const { where, values, allowed } = buildWhere(meta, input);
  const columns = input.columns?.length
    ? input.columns.filter((col) => allowed.has(col))
    : meta.columns;
  if (!columns.length) {
    throw new Error("no valid columns requested");
  }

  const maxLimit = input.maxLimit ?? 10000;
  const limit = Math.min(input.limit || 1000, maxLimit);
  const offset = Math.max(input.offset || 0, 0);
  const order = input.order || "desc";

  let sql = `SELECT ${columns.join(", ")} FROM ${table}`;
  if (where.length) {
    sql += ` WHERE ${where.join(" AND ")}`;
  }
  if (meta.timeField) {
    sql += ` ORDER BY ${meta.timeField} ${order.toUpperCase()}`;
  }
  sql += ` LIMIT ${limit} OFFSET ${offset}`;

  const result = await pool.query(sql, values);
  return result.rows;
}

export async function runLatest(
  pool: Pool,
  meta: TableMeta,
  input: LatestInput
): Promise<{ row: any | null; ageSeconds: number | null; stale: boolean }> {
  const rows = await runQuery(pool, meta, {
    ...input,
    limit: 1,
    offset: 0,
    order: "desc",
  });
  const row = rows[0] ?? null;
  if (!row || !meta.timeField) {
    return { row, ageSeconds: null, stale: false };
  }
  const ts = new Date(row[meta.timeField]).getTime();
  const ageSeconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  const maxAge = input.maxAgeSeconds ?? 0;
  const stale = maxAge > 0 ? ageSeconds > maxAge : false;
  return { row, ageSeconds, stale };
}

export async function runAggregate(
  pool: Pool,
  meta: TableMeta,
  input: AggregateInput
): Promise<any[]> {
  if (!meta.timeField) {
    throw new Error("table has no time field");
  }
  const { where, values, allowed } = buildWhere(meta, input);
  const valueField = input.valueField;
  if (!allowed.has(valueField)) {
    throw new Error(`invalid valueField: ${valueField}`);
  }
  if (["data", "metadata", "bids", "asks"].includes(valueField)) {
    throw new Error(`valueField not numeric: ${valueField}`);
  }

  const bucketSeconds = Math.min(Math.max(input.bucketSeconds || 60, 1), 31536000);
  values.push(bucketSeconds);
  const bucketIndex = values.length;
  const bucketExpr = `to_timestamp(floor(extract(epoch from ${meta.timeField}) / $${bucketIndex}) * $${bucketIndex})`;

  let sql = `SELECT ${bucketExpr} AS bucket,
                    min(${valueField}) AS min,
                    max(${valueField}) AS max,
                    avg(${valueField}) AS avg,
                    sum(${valueField}) AS sum,
                    count(*) AS count
             FROM ${input.table}`;
  if (where.length) {
    sql += ` WHERE ${where.join(" AND ")}`;
  }
  sql += ` GROUP BY bucket`;
  const order = input.order || "desc";
  sql += ` ORDER BY bucket ${order.toUpperCase()}`;
  const limit = Math.min(input.limit || 1000, 10000);
  sql += ` LIMIT ${limit}`;

  const result = await pool.query(sql, values);
  return result.rows;
}
