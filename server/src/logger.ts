type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const envLevel = (process.env.LOG_LEVEL || "info").toLowerCase();
const CURRENT: Level =
  envLevel === "debug" || envLevel === "info" || envLevel === "warn" || envLevel === "error"
    ? envLevel
    : "info";

const SENSITIVE_KEY = /token|authorization|password|secret|refresh|access|clientsecret/i;

function enabled(level: Level) {
  return LEVELS[level] >= LEVELS[CURRENT];
}

function truncate(value: string, max = 500) {
  if (value.length <= max) return value;
  return value.slice(0, max) + "...";
}

function sanitize(value: any, depth = 0): any {
  if (value === null || value === undefined) return value;
  if (depth > 4) return "[max-depth]";
  if (Array.isArray(value)) {
    const limited = value.slice(0, 20).map((v) => sanitize(v, depth + 1));
    if (value.length > 20) {
      limited.push(`[+${value.length - 20} more]`);
    }
    return limited;
  }
  if (typeof value === "object") {
    const out: Record<string, any> = {};
    const entries = Object.entries(value);
    for (const [key, val] of entries.slice(0, 50)) {
      if (SENSITIVE_KEY.test(key)) {
        out[key] = "***";
      } else {
        out[key] = sanitize(val, depth + 1);
      }
    }
    if (entries.length > 50) {
      out["_truncated"] = entries.length - 50;
    }
    return out;
  }
  if (typeof value === "string") {
    return truncate(value, 500);
  }
  return value;
}

function summarize(value: any) {
  if (value === null || value === undefined) return { type: "null" };
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (typeof value === "string")
    return { type: "string", length: value.length, preview: truncate(value, 120) };
  if (typeof value === "object")
    return { type: "object", keys: Object.keys(value).slice(0, 20), keyCount: Object.keys(value).length };
  return { type: typeof value, value };
}

function log(level: Level, message: string, meta?: any) {
  if (!enabled(level)) return;
  const ts = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(sanitize(meta))}` : "";
  const line = `[${ts}] [${level}] ${message}${metaStr}`;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, meta?: any) => log("debug", message, meta),
  info: (message: string, meta?: any) => log("info", message, meta),
  warn: (message: string, meta?: any) => log("warn", message, meta),
  error: (message: string, meta?: any) => log("error", message, meta),
  summarize,
  sanitize,
  enabled,
};
