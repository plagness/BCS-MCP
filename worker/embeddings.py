import asyncio
import aiohttp

from .db import Db
from .config import Config
from .logger import get_logger, sanitize

log = get_logger("worker.embeddings")


def _endpoint(base: str) -> str:
    return base.rstrip("/") + "/api/embeddings"


async def run_embedding_worker(db: Db, config: Config):
    url = _endpoint(config.ollama_base_url)
    log.info(f"embedding worker started {sanitize({'url': url, 'model': config.ollama_embed_model})}")
    while True:
        batch = await db.fetch_embedding_batch(limit=10)
        if not batch:
            await asyncio.sleep(2)
            continue

        async with aiohttp.ClientSession() as session:
            for row in batch:
                try:
                    payload = {
                        "model": config.ollama_embed_model,
                        "prompt": row["text"],
                    }
                    log.debug(
                        f"ollama request {sanitize({'entity_type': row['entity_type'], 'entity_id': row['entity_id'], 'chars': len(row['text'])})}"
                    )
                    async with session.post(url, json=payload) as resp:
                        if resp.status != 200:
                            text = await resp.text()
                            log.error(
                                f"ollama error {sanitize({'status': resp.status, 'body': text[:500]})}"
                            )
                            await db.mark_embedding_failed(row["id"], f"ollama {resp.status}: {text}")
                            continue
                        result = await resp.json()
                        embedding = result.get("embedding")
                        if not embedding:
                            log.error("ollama returned empty embedding")
                            await db.mark_embedding_failed(row["id"], "empty embedding")
                            continue
                        await db.store_embedding(
                            row["id"],
                            row["entity_type"],
                            row["entity_id"],
                            embedding,
                            row.get("metadata"),
                        )
                        log.debug(
                            f"ollama ok {sanitize({'queue_id': row['id'], 'size': len(embedding)})}"
                        )
                except Exception as exc:
                    log.error(f"ollama exception {sanitize({'error': str(exc)})}")
                    await db.mark_embedding_failed(row["id"], str(exc))
