import { describe, it, expect } from "vitest";
import { logger } from "../logger.js";

describe("logger.summarize", () => {
  it("returns {type:'null'} for null/undefined", () => {
    expect(logger.summarize(null)).toEqual({ type: "null" });
    expect(logger.summarize(undefined)).toEqual({ type: "null" });
  });

  it("summarizes arrays", () => {
    expect(logger.summarize([1, 2, 3])).toEqual({ type: "array", length: 3 });
  });

  it("summarizes strings with preview", () => {
    const result = logger.summarize("hello world");
    expect(result).toEqual({
      type: "string",
      length: 11,
      preview: "hello world",
    });
  });

  it("truncates long string preview to 120 chars", () => {
    const long = "x".repeat(200);
    const result = logger.summarize(long) as { preview: string };
    expect(result.preview.length).toBeLessThanOrEqual(123); // 120 + "..."
  });

  it("summarizes objects with keys and keyCount", () => {
    const result = logger.summarize({ a: 1, b: 2 }) as {
      keys: string[];
      keyCount: number;
    };
    expect(result.type).toBe("object");
    expect(result.keys).toEqual(["a", "b"]);
    expect(result.keyCount).toBe(2);
  });

  it("returns type+value for numbers", () => {
    expect(logger.summarize(42)).toEqual({ type: "number", value: 42 });
  });

  it("returns type+value for booleans", () => {
    expect(logger.summarize(true)).toEqual({ type: "boolean", value: true });
  });
});

describe("logger.sanitize", () => {
  it("masks sensitive keys", () => {
    const result = logger.sanitize({
      username: "admin",
      password: "secret123",
      token: "abc",
      authorization: "Bearer xyz",
    });
    expect(result.username).toBe("admin");
    expect(result.password).toBe("***");
    expect(result.token).toBe("***");
    expect(result.authorization).toBe("***");
  });

  it("returns null/undefined as-is", () => {
    expect(logger.sanitize(null)).toBeNull();
    expect(logger.sanitize(undefined)).toBeUndefined();
  });

  it("limits array to 20 items", () => {
    const arr = Array.from({ length: 25 }, (_, i) => i);
    const result = logger.sanitize(arr);
    expect(result).toHaveLength(21); // 20 items + "[+5 more]"
    expect(result[20]).toBe("[+5 more]");
  });

  it("limits object to 50 keys", () => {
    const obj = Object.fromEntries(
      Array.from({ length: 55 }, (_, i) => [`key${i}`, i])
    );
    const result = logger.sanitize(obj);
    expect(result._truncated).toBe(5);
  });

  it("stops recursion at depth > 4", () => {
    // depth 0: {a:...}, depth 1: {b:...}, depth 2: {c:...}, depth 3: {d:...}, depth 4: {e:...} → "[max-depth]" at depth 5
    const deep = { a: { b: { c: { d: { e: { f: "deep" } } } } } };
    const result = logger.sanitize(deep);
    expect(result.a.b.c.d.e).toBe("[max-depth]");
  });

  it("truncates long strings to 500 chars", () => {
    const long = "x".repeat(600);
    const result = logger.sanitize(long);
    expect(result.length).toBe(503); // 500 + "..."
    expect(result.endsWith("...")).toBe(true);
  });

  it("passes short strings through", () => {
    expect(logger.sanitize("hello")).toBe("hello");
  });

  it("passes numbers through", () => {
    expect(logger.sanitize(42)).toBe(42);
  });
});

describe("logger.enabled", () => {
  // По умолчанию LOG_LEVEL=info (в тестовом окружении)
  it("info is enabled by default", () => {
    expect(logger.enabled("info")).toBe(true);
  });

  it("warn is enabled", () => {
    expect(logger.enabled("warn")).toBe(true);
  });

  it("error is enabled", () => {
    expect(logger.enabled("error")).toBe(true);
  });
});
