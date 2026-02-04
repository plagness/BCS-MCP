import asyncpg
from datetime import datetime
from typing import Any, Dict, List, Optional
from .logger import get_logger, sanitize

log = get_logger("worker.db")


def _dt(value: Optional[str]) -> datetime:
    if not value:
        return datetime.utcnow()
    # Accept ISO with Z
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _vector_str(vec: List[float]) -> str:
    return "[" + ",".join(f"{v:.8f}" for v in vec) + "]"


class Db:
    def __init__(self, market_pool: asyncpg.Pool, private_pool: asyncpg.Pool):
        self.market = market_pool
        self.private = private_pool

    @classmethod
    async def create(cls, host, port, user, password, market_db, private_db):
        market_pool = await asyncpg.create_pool(
            host=host, port=port, user=user, password=password, database=market_db
        )
        private_pool = await asyncpg.create_pool(
            host=host, port=port, user=user, password=password, database=private_db
        )
        return cls(market_pool, private_pool)

    async def get_selected_assets(self) -> List[Dict[str, str]]:
        rows = await self.private.fetch(
            "SELECT ticker, class_code FROM selected_assets WHERE enabled = true"
        )
        log.debug(f"selected_assets fetched {sanitize({'count': len(rows)})}")
        return [{"ticker": r["ticker"], "class_code": r["class_code"]} for r in rows]

    async def insert_orderbook(self, data: Dict[str, Any]):
        log.debug(
            f"insert orderbook {sanitize({'ticker': data.get('ticker'), 'classCode': data.get('classCode'), 'depth': data.get('depth')})}"
        )
        await self.market.execute(
            """
            INSERT INTO order_book_snapshots
              (ticker, class_code, ts, depth, bid_volume, ask_volume, bids, asks, data)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            """,
            data.get("ticker"),
            data.get("classCode"),
            _dt(data.get("dateTime")),
            data.get("depth"),
            data.get("bidVolume"),
            data.get("askVolume"),
            data.get("bids"),
            data.get("asks"),
            data,
        )

    async def insert_quotes(self, data: Dict[str, Any]):
        log.debug(
            f"insert quotes {sanitize({'ticker': data.get('ticker'), 'classCode': data.get('classCode'), 'last': data.get('last')})}"
        )
        await self.market.execute(
            """
            INSERT INTO quotes
              (ticker, class_code, ts, bid, offer, last, open, close, high, low,
               change, change_rate, currency, security_trading_status, data)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
            """,
            data.get("ticker"),
            data.get("classCode"),
            _dt(data.get("dateTime")),
            data.get("bid"),
            data.get("offer"),
            data.get("last"),
            data.get("open"),
            data.get("close"),
            data.get("high"),
            data.get("low"),
            data.get("change"),
            data.get("changeRate"),
            data.get("currency"),
            data.get("securityTradingStatus"),
            data,
        )

    async def insert_last_trade(self, data: Dict[str, Any]):
        log.debug(
            f"insert last trade {sanitize({'ticker': data.get('ticker'), 'classCode': data.get('classCode'), 'price': data.get('price'), 'quantity': data.get('quantity')})}"
        )
        await self.market.execute(
            """
            INSERT INTO last_trades
              (ticker, class_code, ts, side, price, quantity, volume, data)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            """,
            data.get("ticker"),
            data.get("classCode"),
            _dt(data.get("dateTime")),
            data.get("side"),
            data.get("price"),
            data.get("quantity"),
            data.get("volume"),
            data,
        )

    async def upsert_candle(self, data: Dict[str, Any]):
        log.debug(
            f"upsert candle {sanitize({'ticker': data.get('ticker'), 'classCode': data.get('classCode'), 'timeFrame': data.get('timeFrame'), 'ts': data.get('dateTime')})}"
        )
        await self.market.execute(
            """
            INSERT INTO candles
              (ticker, class_code, time_frame, ts, open, high, low, close, volume, data)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            ON CONFLICT (ticker, class_code, time_frame, ts)
            DO UPDATE SET open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low,
                          close=EXCLUDED.close, volume=EXCLUDED.volume, data=EXCLUDED.data
            """,
            data.get("ticker"),
            data.get("classCode"),
            data.get("timeFrame"),
            _dt(data.get("dateTime")),
            data.get("open"),
            data.get("high"),
            data.get("low"),
            data.get("close"),
            data.get("volume"),
            data,
        )

    async def insert_holdings_snapshot(self, data: Any):
        log.debug(
            f"insert holdings snapshot {sanitize({'items': len(data) if isinstance(data, list) else None})}"
        )
        await self.private.execute(
            "INSERT INTO holdings_snapshots (ts, data) VALUES ($1,$2)",
            datetime.utcnow(),
            data,
        )

    async def upsert_holdings_current(self, items: List[Dict[str, Any]]):
        log.debug(f"upsert holdings current {sanitize({'items': len(items)})}")
        for item in items:
            await self.private.execute(
                """
                INSERT INTO holdings_current
                  (account, ticker, class_code, quantity, avg_price, currency, data, updated_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                ON CONFLICT (account, ticker, class_code)
                DO UPDATE SET quantity=EXCLUDED.quantity, avg_price=EXCLUDED.avg_price,
                              currency=EXCLUDED.currency, data=EXCLUDED.data, updated_at=EXCLUDED.updated_at
                """,
                item.get("account"),
                item.get("ticker"),
                item.get("board") or item.get("classCode") or item.get("class_code"),
                item.get("quantity"),
                item.get("balancePrice") or item.get("averagePrice"),
                item.get("currency"),
                item,
                datetime.utcnow(),
            )

    async def insert_order_event(self, data: Dict[str, Any]):
        data_block = data.get("data") or {}
        log.debug(
            f"insert order event {sanitize({'originalClientOrderId': data.get('originalClientOrderId'), 'orderStatus': data_block.get('orderStatus'), 'executionType': data_block.get('executionType')})}"
        )
        await self.private.execute(
            """
            INSERT INTO order_events
              (ts, original_client_order_id, client_order_id, order_status, execution_type,
               ticker, class_code, data)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            """,
            _dt(data_block.get("transactionTime") or data_block.get("dateTime")),
            data.get("originalClientOrderId"),
            data.get("clientOrderId"),
            data_block.get("orderStatus"),
            data_block.get("executionType"),
            data_block.get("ticker"),
            data_block.get("classCode"),
            data,
        )

    async def insert_limits_snapshot(self, data: Dict[str, Any]):
        log.debug(f"insert limits snapshot {sanitize({'keys': list(data.keys())})}")
        await self.private.execute(
            "INSERT INTO limits_snapshots (ts, data) VALUES ($1,$2)",
            datetime.utcnow(),
            data,
        )

    async def insert_marginal_snapshot(self, data: Dict[str, Any]):
        log.debug(f"insert marginal snapshot {sanitize({'keys': list(data.keys())})}")
        await self.private.execute(
            "INSERT INTO marginal_indicators_snapshots (ts, data) VALUES ($1,$2)",
            datetime.utcnow(),
            data,
        )

    async def enqueue_embedding(self, entity_type: str, entity_id: str, text: str, metadata: Dict[str, Any] | None = None):
        log.debug(f"enqueue embedding {sanitize({'entity_type': entity_type, 'entity_id': entity_id})}")
        await self.private.execute(
            """
            INSERT INTO embedding_queue (entity_type, entity_id, text, metadata)
            VALUES ($1,$2,$3,$4)
            """,
            entity_type,
            entity_id,
            text,
            metadata,
        )

    async def fetch_embedding_batch(self, limit: int = 10):
        rows = await self.private.fetch(
            """
            UPDATE embedding_queue
            SET status = 'processing', updated_at = now()
            WHERE id IN (
              SELECT id FROM embedding_queue
              WHERE status = 'pending'
              ORDER BY created_at ASC
              LIMIT $1
              FOR UPDATE SKIP LOCKED
            )
            RETURNING id, entity_type, entity_id, text, metadata
            """,
            limit,
        )
        log.debug(f"fetch embedding batch {sanitize({'count': len(rows)})}")
        return rows

    async def store_embedding(self, queue_id: str, entity_type: str, entity_id: str, embedding: List[float], metadata: Dict[str, Any] | None = None):
        log.debug(
            f"store embedding {sanitize({'queue_id': queue_id, 'entity_type': entity_type, 'entity_id': entity_id, 'size': len(embedding)})}"
        )
        await self.private.execute(
            """
            INSERT INTO embeddings (entity_type, entity_id, embedding, metadata)
            VALUES ($1,$2,$3,$4)
            """,
            entity_type,
            entity_id,
            _vector_str(embedding),
            metadata,
        )
        await self.private.execute(
            "UPDATE embedding_queue SET status='done', updated_at=now() WHERE id=$1",
            queue_id,
        )

    async def mark_embedding_failed(self, queue_id: str, error: str):
        log.error(f"embedding failed {sanitize({'queue_id': queue_id, 'error': error})}")
        await self.private.execute(
            "UPDATE embedding_queue SET status='error', updated_at=now(), metadata = jsonb_set(coalesce(metadata,'{}'::jsonb), '{error}', to_jsonb($2::text), true) WHERE id=$1",
            queue_id,
            error,
        )
