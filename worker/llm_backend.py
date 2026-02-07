from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import aiohttp

from .config import Config


def _normalize_backend(value: str | None) -> str:
    backend = (value or "").strip().lower()
    if backend in {"llm_mcp", "ollama"}:
        return backend
    return "llm_mcp"


async def _enqueue_job(session: aiohttp.ClientSession, base_url: str, payload: dict[str, Any]) -> str:
    url = f"{base_url.rstrip('/')}/v1/llm/request"
    async with session.post(url, json=payload) as resp:
        body = await resp.text()
        if resp.status not in {200, 202}:
            raise RuntimeError(f"llm_mcp enqueue failed status={resp.status} body={body[:280]}")
    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError("llm_mcp enqueue invalid json") from exc

    job_id = data.get("job_id")
    if not isinstance(job_id, str) or not job_id:
        raise RuntimeError("llm_mcp enqueue missing job_id")
    return job_id


async def _wait_job_result(
    session: aiohttp.ClientSession,
    base_url: str,
    job_id: str,
    timeout_sec: int,
) -> dict[str, Any]:
    url = f"{base_url.rstrip('/')}/v1/jobs/{job_id}"
    started = time.monotonic()
    timeout = max(3, timeout_sec)

    while True:
        if time.monotonic() - started > timeout:
            raise RuntimeError(f"llm_mcp job timeout id={job_id} timeout={timeout}s")

        async with session.get(url) as resp:
            body = await resp.text()
            if resp.status != 200:
                raise RuntimeError(f"llm_mcp job read failed status={resp.status} body={body[:280]}")

        try:
            job = json.loads(body)
        except json.JSONDecodeError as exc:
            raise RuntimeError("llm_mcp job invalid json") from exc

        status = str(job.get("status") or "").lower()
        if status == "done":
            result = job.get("result")
            if isinstance(result, dict):
                return result
            raise RuntimeError("llm_mcp job done without structured result")
        if status in {"failed", "error", "cancelled", "canceled"}:
            raise RuntimeError(f"llm_mcp job {status}: {job.get('error') or 'unknown'}")

        await asyncio.sleep(0.5)


async def embed_text(session: aiohttp.ClientSession, config: Config, text: str) -> list[float]:
    backend = _normalize_backend(config.llm_backend)

    if backend == "llm_mcp":
        provider = config.llm_mcp_provider
        if provider not in {"auto", "ollama"}:
            provider = "auto"

        payload: dict[str, Any] = {
            "task": "embed",
            "provider": provider,
            "prompt": text,
            "source": "bcs-mcp",
            "priority": 2,
            "max_attempts": 2,
        }
        if config.ollama_embed_model:
            payload["model"] = config.ollama_embed_model

        try:
            job_id = await _enqueue_job(session, config.llm_mcp_base_url, payload)
            result = await _wait_job_result(
                session=session,
                base_url=config.llm_mcp_base_url,
                job_id=job_id,
                timeout_sec=config.llm_backend_timeout_sec,
            )
            data = result.get("data")
            if not isinstance(data, dict):
                raise RuntimeError("llm_mcp embed result missing data")
            embedding = data.get("embedding")
            if not isinstance(embedding, list):
                raise RuntimeError("llm_mcp embed result missing embedding")
            out: list[float] = []
            for item in embedding:
                try:
                    out.append(float(item))
                except (TypeError, ValueError):
                    continue
            if out:
                return out
            raise RuntimeError("llm_mcp embed result empty")
        except Exception:
            if not config.llm_backend_fallback_ollama:
                raise

    url = config.ollama_base_url.rstrip("/") + "/api/embeddings"
    payload = {
        "model": config.ollama_embed_model,
        "prompt": text,
    }
    async with session.post(url, json=payload) as resp:
        resp.raise_for_status()
        data = await resp.json()
        embedding = data.get("embedding")
        if isinstance(embedding, list):
            return [float(item) for item in embedding]
        return []
