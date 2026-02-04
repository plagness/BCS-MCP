import { readFileSync } from "fs";
import { spawn } from "child_process";
import path from "path";
import { logger } from "./logger.js";

const MANIFEST_PATH = path.resolve("/app/scripts/manifest.json");

export type ScriptInfo = {
  name: string;
  path: string;
  description: string;
  input: Record<string, string>;
};

export function loadManifest(): { scripts: ScriptInfo[] } {
  const raw = readFileSync(MANIFEST_PATH, "utf-8");
  return JSON.parse(raw);
}

export function runScript(name: string, payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    logger.debug("script.run.start", {
      name,
      payload: logger.sanitize(payload),
    });
    const proc = spawn("python3", ["/app/scripts/run.py", name], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code !== 0 && !stdout) {
        logger.error("script.run.error", {
          name,
          code,
          stderr,
          ms: Date.now() - started,
        });
        return reject(new Error(stderr || `script exited with code ${code}`));
      }
      try {
        const parsed = JSON.parse(stdout || "{}");
        logger.debug("script.run.ok", {
          name,
          ms: Date.now() - started,
          result: logger.summarize(parsed),
        });
        resolve(parsed);
      } catch (err) {
        logger.error("script.run.parse_error", { name, error: String(err) });
        reject(err);
      }
    });

    proc.stdin.write(JSON.stringify(payload ?? {}));
    proc.stdin.end();
  });
}
