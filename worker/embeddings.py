import asyncio
import aiohttp

from .db import Db
from .config import Config
from .llm_backend import embed_text
from .logger import get_logger, sanitize

log = get_logger("worker.embeddings")


async def run_embedding_worker(db: Db, config: Config):
    log.info(
        f"embedding worker started {sanitize({'backend': config.llm_backend, 'llm_mcp_base_url': config.llm_mcp_base_url, 'ollama_base_url': config.ollama_base_url, 'model': config.ollama_embed_model})}"
    )
    while True:
        batch = await db.fetch_embedding_batch(limit=10)
        if not batch:
            await asyncio.sleep(2)
            continue

        async with aiohttp.ClientSession() as session:
            for row in batch:
                try:
                    log.debug(
                        f"embedding request {sanitize({'entity_type': row['entity_type'], 'entity_id': row['entity_id'], 'chars': len(row['text']), 'backend': config.llm_backend})}"
                    )
                    embedding = await embed_text(session=session, config=config, text=row["text"])
                    if not embedding:
                        log.error("embedding backend returned empty embedding")
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
                        f"embedding ok {sanitize({'queue_id': row['id'], 'size': len(embedding)})}"
                    )
                except Exception as exc:
                    log.error(f"embedding exception {sanitize({'error': str(exc)})}")
                    await db.mark_embedding_failed(row["id"], str(exc))
