import { config } from "./config.js";
import { logger } from "./logger.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function extractEmbedding(result: unknown): number[] {
  if (!result || typeof result !== "object") return [];
  const data = (result as { data?: unknown }).data;
  if (!data || typeof data !== "object") return [];
  const raw = (data as { embedding?: unknown }).embedding;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

function extractText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const data = (result as { data?: unknown }).data;
  if (!data || typeof data !== "object") return "";

  const response = (data as { response?: unknown }).response;
  if (typeof response === "string" && response.trim()) return response;

  const message = (data as { message?: unknown }).message;
  if (message && typeof message === "object") {
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") return content;
  }

  const choices = (data as { choices?: unknown }).choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (first && typeof first === "object") {
      const msg = (first as { message?: unknown }).message;
      if (msg && typeof msg === "object") {
        const content = (msg as { content?: unknown }).content;
        if (typeof content === "string") return content;
      }
      const text = (first as { text?: unknown }).text;
      if (typeof text === "string") return text;
    }
  }

  return "";
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // continue to regex extraction
  }

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function enqueueLlmJob(payload: Record<string, unknown>): Promise<string> {
  const resp = await fetch(`${config.llm.mcpBaseUrl.replace(/\/$/, "")}/v1/llm/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`llm_mcp enqueue failed ${resp.status}: ${body}`);
  }
  const data = (await resp.json()) as { job_id?: string };
  if (!data.job_id) {
    throw new Error("llm_mcp enqueue missing job_id");
  }
  return data.job_id;
}

async function waitLlmJob(jobId: string): Promise<Record<string, unknown>> {
  const timeoutSec = Math.max(3, config.llm.timeoutSec || 30);
  const started = Date.now();

  while ((Date.now() - started) / 1000 < timeoutSec) {
    const resp = await fetch(
      `${config.llm.mcpBaseUrl.replace(/\/$/, "")}/v1/jobs/${encodeURIComponent(jobId)}`,
      { method: "GET" }
    );
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`llm_mcp job read failed ${resp.status}: ${body}`);
    }

    const data = (await resp.json()) as {
      status?: string;
      error?: string;
      result?: unknown;
    };
    const status = (data.status || "").toLowerCase();
    if (status === "done") {
      if (data.result && typeof data.result === "object") {
        return data.result as Record<string, unknown>;
      }
      throw new Error("llm_mcp job done without result");
    }
    if (status === "failed" || status === "error" || status === "cancelled" || status === "canceled") {
      throw new Error(`llm_mcp job ${status}: ${data.error || "unknown"}`);
    }

    await sleep(500);
  }

  throw new Error(`llm_mcp job timeout after ${timeoutSec}s`);
}

async function runLlmTask(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const jobId = await enqueueLlmJob(payload);
  return waitLlmJob(jobId);
}

async function embedViaLlmMcp(query: string): Promise<number[]> {
  const providerRaw = (config.llm.mcpProvider || "auto").toLowerCase();
  const provider = providerRaw === "ollama" || providerRaw === "auto" ? providerRaw : "auto";

  const payload: Record<string, unknown> = {
    task: "embed",
    provider,
    prompt: query,
    source: "bcs-mcp",
    priority: 2,
    max_attempts: 2,
  };
  if (config.ollama.embedModel) {
    payload.model = config.ollama.embedModel;
  }

  const result = await runLlmTask(payload);
  const embedding = extractEmbedding(result);
  if (!embedding.length) {
    throw new Error("llm_mcp embed returned empty embedding");
  }
  return embedding;
}

async function embedViaOllama(query: string): Promise<number[]> {
  const resp = await fetch(`${config.ollama.baseUrl.replace(/\/$/, "")}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.ollama.embedModel,
      prompt: query,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`ollama error: ${resp.status} ${text}`);
  }
  const data = (await resp.json()) as { embedding?: number[] };
  if (!Array.isArray(data.embedding)) {
    throw new Error("ollama embedding missing in response");
  }
  return data.embedding;
}

async function chatViaLlmMcp(prompt: string): Promise<string> {
  const provider = (config.llm.mcpProvider || "auto").toLowerCase();
  const payload: Record<string, unknown> = {
    task: "chat",
    provider,
    prompt,
    source: "bcs-mcp",
    priority: 1,
    max_attempts: 1,
    max_tokens: 350,
    temperature: 0.2,
  };
  const result = await runLlmTask(payload);
  const text = extractText(result);
  if (!text.trim()) {
    throw new Error("llm_mcp chat returned empty text");
  }
  return text;
}

async function chatViaOllama(prompt: string): Promise<string> {
  const resp = await fetch(`${config.ollama.baseUrl.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama3.2:3b",
      prompt,
      stream: false,
      options: { temperature: 0.2 },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`ollama generate failed ${resp.status}: ${text}`);
  }
  const data = (await resp.json()) as { response?: string };
  if (typeof data.response !== "string" || !data.response.trim()) {
    throw new Error("ollama generate empty response");
  }
  return data.response;
}

export async function embedText(query: string): Promise<number[]> {
  const backend = (config.llm.backend || "llm_mcp").toLowerCase();
  if (backend === "llm_mcp") {
    try {
      return await embedViaLlmMcp(query);
    } catch (error) {
      logger.warn("llm.embed.llm_mcp_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      if (!config.llm.fallbackOllama) {
        throw error;
      }
    }
  }
  return embedViaOllama(query);
}

export async function enrichSignalDirection(payload: {
  ticker: string;
  classCode: string;
  timeFrame: string;
  probs: Record<string, unknown>;
  direction: Record<string, unknown>;
}): Promise<Record<string, unknown> | null> {
  const prompt = [
    "Верни только JSON с полями: bias, confidence, rationale, risk_flags, timeframe_hint.",
    "bias: bullish|bearish|neutral, confidence: 0..1.",
    "Данные:",
    JSON.stringify(payload),
  ].join("\n\n");

  const backend = (config.llm.backend || "llm_mcp").toLowerCase();
  try {
    const rawText =
      backend === "llm_mcp" ? await chatViaLlmMcp(prompt) : await chatViaOllama(prompt);
    return extractJsonObject(rawText);
  } catch (error) {
    logger.warn("llm.signal.enrichment_failed", {
      error: error instanceof Error ? error.message : String(error),
      backend,
    });
    if (backend === "llm_mcp" && config.llm.fallbackOllama) {
      try {
        const rawText = await chatViaOllama(prompt);
        return extractJsonObject(rawText);
      } catch {
        return null;
      }
    }
    return null;
  }
}
