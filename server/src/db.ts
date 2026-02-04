import { Pool } from "pg";
import { config } from "./config.js";
import { logger } from "./logger.js";

function wrapPool(pool: Pool, label: string) {
  const original = pool.query.bind(pool) as (...args: any[]) => Promise<any>;
  (pool as any).query = async (...args: any[]) => {
    let text = "";
    let values: any[] | undefined;
    if (typeof args[0] === "string") {
      text = args[0];
      values = args[1];
    } else if (args[0] && typeof args[0] === "object") {
      text = args[0].text || "";
      values = args[0].values;
    }
    const started = Date.now();
    logger.debug("db.query", {
      db: label,
      text: text.replace(/\s+/g, " ").trim(),
      values,
    });
    try {
      const result = await original(...args);
      logger.debug("db.result", {
        db: label,
        rowCount: result?.rowCount ?? null,
        ms: Date.now() - started,
      });
      return result;
    } catch (err: any) {
      logger.error("db.error", {
        db: label,
        text: text.replace(/\s+/g, " ").trim(),
        message: err?.message || String(err),
      });
      throw err;
    }
  };
  return pool;
}

export const marketPool = wrapPool(
  new Pool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.market,
  }),
  "market"
);

export const privatePool = wrapPool(
  new Pool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.private,
  }),
  "private"
);
