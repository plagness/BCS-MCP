import asyncio
import signal

from .config import load_config
from .db import Db
from .auth import AuthClient
from .streams import (
    MarketStream,
    PortfolioStream,
    OrdersStream,
    LimitsStream,
    MarginalStream,
)
from .embeddings import run_embedding_worker
from .logger import setup_logging, get_logger, sanitize


async def main():
    setup_logging()
    log = get_logger("worker")
    config = load_config()
    has_token = bool(config.refresh_token)
    if not has_token:
        log.warning("BCS_REFRESH_TOKEN is empty; streams are disabled")
    else:
        log.info("BCS token present; streams enabled according to flags")

    db = await Db.create(
        config.db_host,
        config.db_port,
        config.db_user,
        config.db_password,
        config.db_market,
        config.db_private,
    )
    log.info(
        f"db.connected {sanitize({'db_host': config.db_host, 'db_port': config.db_port})}"
    )

    if config.use_db_instruments:
        instruments = await db.get_selected_assets()
        if instruments:
            config.subscribe_instruments = instruments
            log.info(f"loaded instruments from DB {sanitize({'count': len(instruments)})}")
        else:
            log.warning("no instruments in DB; fallback to env list")
    log.debug(f"config {sanitize(config.__dict__)}")

    auth = AuthClient(config.refresh_token, config.client_id)

    tasks = []
    if has_token and config.stream_market:
        tasks.append(asyncio.create_task(MarketStream(auth, db, config).run()))
    if has_token and config.stream_portfolio:
        tasks.append(asyncio.create_task(PortfolioStream(auth, db).run()))
    if has_token and config.stream_orders:
        tasks.append(asyncio.create_task(OrdersStream(auth, db).run()))
    if has_token and config.stream_limits:
        tasks.append(asyncio.create_task(LimitsStream(auth, db).run()))
    if has_token and config.stream_marginal:
        tasks.append(asyncio.create_task(MarginalStream(auth, db).run()))

    # Embeddings worker is always on
    tasks.append(asyncio.create_task(run_embedding_worker(db, config)))

    if not tasks:
        log.warning("no tasks configured; sleeping")
        await asyncio.sleep(3600)
        return

    stop_event = asyncio.Event()

    def _stop():
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _stop)

    await stop_event.wait()
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


if __name__ == "__main__":
    asyncio.run(main())
