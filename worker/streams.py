import asyncio
import json
from typing import Any, Dict, List
import websockets

from .auth import AuthClient
from .db import Db
from .config import Config
from .logger import get_logger, sanitize

MARKET_WS_URL = "wss://ws.broker.ru/trade-api-market-data-connector/api/v1/market-data/ws"
PORTFOLIO_WS_URL = "wss://ws.broker.ru/trade-api-bff-portfolio/api/v1/portfolio/ws"
LIMITS_WS_URL = "wss://ws.broker.ru/trade-api-bff-limit/api/v1/limits/ws"
ORDERS_EXECUTION_WS_URL = "wss://ws.broker.ru/trade-api-bff-operations/api/v1/orders/execution/ws"
ORDERS_TRANSACTION_WS_URL = "wss://ws.broker.ru/trade-api-bff-operations/api/v1/orders/transaction/ws"
MARGINAL_WS_URL = "wss://ws.broker.ru/trade-api-bff-marginal-indicators/api/v1/marginal-indicators/ws"


class MarketStream:
    def __init__(self, auth: AuthClient, db: Db, config: Config):
        self.auth = auth
        self.db = db
        self.config = config
        self.log = get_logger("worker.market")

    async def run(self):
        if not self.config.subscribe_instruments:
            self.log.warning("no instruments configured; skipping market stream")
            return

        while True:
            try:
                token = await self.auth.get_access_token()
                headers = {"Authorization": f"Bearer {token}"}
                async with websockets.connect(
                    MARKET_WS_URL,
                    extra_headers=headers,
                    ping_interval=20,
                    ping_timeout=20,
                ) as ws:
                    self.log.info(f"connected {sanitize({'url': MARKET_WS_URL})}")
                    await self._subscribe(ws)
                    async for message in ws:
                        await self._handle_message(message)
            except Exception as exc:
                self.log.error(f"ws error: {exc}; reconnect in 3s")
                await asyncio.sleep(3)

    async def _subscribe(self, ws):
        instruments = [
            {"ticker": i["ticker"], "classCode": i["class_code"]}
            for i in self.config.subscribe_instruments
        ]
        self.log.debug(f"subscribe {sanitize({'instruments': instruments})}")
        if self.config.store_orderbook:
            await ws.send(
                json.dumps(
                    {
                        "subscribeType": 0,
                        "dataType": 0,
                        "depth": 20,
                        "instruments": instruments,
                    }
                )
            )
        if self.config.store_candles:
            await ws.send(
                json.dumps(
                    {
                        "subscribeType": 0,
                        "dataType": 1,
                        "timeFrame": self.config.candle_time_frame,
                        "instruments": instruments,
                    }
                )
            )
        if self.config.store_last_trades:
            await ws.send(
                json.dumps(
                    {"subscribeType": 0, "dataType": 2, "instruments": instruments}
                )
            )
        if self.config.store_quotes:
            await ws.send(
                json.dumps(
                    {"subscribeType": 0, "dataType": 3, "instruments": instruments}
                )
            )

    async def _handle_message(self, message: str):
        try:
            data = json.loads(message)
        except Exception:
            return

        response_type = data.get("responseType")
        if self.log.isEnabledFor(10):
            self.log.debug(
                f"message {sanitize({'type': response_type, 'ticker': data.get('ticker'), 'classCode': data.get('classCode')})}"
            )
        if response_type == "OrderBook" and self.config.store_orderbook:
            await self.db.insert_orderbook(data)
        elif response_type == "Quotes" and self.config.store_quotes:
            await self.db.insert_quotes(data)
        elif response_type == "LastTrades" and self.config.store_last_trades:
            await self.db.insert_last_trade(data)
        elif response_type == "CandleStick" and self.config.store_candles:
            await self.db.upsert_candle(data)
        else:
            # ignore success or error messages
            return


class PortfolioStream:
    def __init__(self, auth: AuthClient, db: Db):
        self.auth = auth
        self.db = db
        self.log = get_logger("worker.portfolio")

    async def run(self):
        while True:
            try:
                token = await self.auth.get_access_token()
                headers = {"Authorization": f"Bearer {token}"}
                async with websockets.connect(
                    PORTFOLIO_WS_URL,
                    extra_headers=headers,
                    ping_interval=20,
                    ping_timeout=20,
                ) as ws:
                    self.log.info(f"connected {sanitize({'url': PORTFOLIO_WS_URL})}")
                    async for message in ws:
                        await self._handle_message(message)
            except Exception as exc:
                self.log.error(f"ws error: {exc}; reconnect in 3s")
                await asyncio.sleep(3)

    async def _handle_message(self, message: str):
        try:
            data = json.loads(message)
        except Exception:
            return
        if isinstance(data, list):
            if self.log.isEnabledFor(10):
                self.log.debug(f"snapshot {sanitize({'items': len(data)})}")
            await self.db.insert_holdings_snapshot(data)
            await self.db.upsert_holdings_current(data)


class OrdersStream:
    def __init__(self, auth: AuthClient, db: Db):
        self.auth = auth
        self.db = db
        self.log = get_logger("worker.orders")

    async def run(self):
        await asyncio.gather(
            self._run_one(ORDERS_EXECUTION_WS_URL, "execution"),
            self._run_one(ORDERS_TRANSACTION_WS_URL, "transaction"),
        )

    async def _run_one(self, url: str, label: str):
        while True:
            try:
                token = await self.auth.get_access_token()
                headers = {"Authorization": f"Bearer {token}"}
                async with websockets.connect(
                    url,
                    extra_headers=headers,
                    ping_interval=20,
                    ping_timeout=20,
                ) as ws:
                    self.log.info(f"connected {sanitize({'url': url, 'stream': label})}")
                    async for message in ws:
                        await self._handle_message(message)
            except Exception as exc:
                self.log.error(f"ws error ({label}): {exc}; reconnect in 3s")
                await asyncio.sleep(3)

    async def _handle_message(self, message: str):
        try:
            data = json.loads(message)
        except Exception:
            return
        if isinstance(data, dict):
            if self.log.isEnabledFor(10):
                self.log.debug(
                    f"event {sanitize({'originalClientOrderId': data.get('originalClientOrderId'), 'clientOrderId': data.get('clientOrderId')})}"
                )
            await self.db.insert_order_event(data)


class LimitsStream:
    def __init__(self, auth: AuthClient, db: Db):
        self.auth = auth
        self.db = db
        self.log = get_logger("worker.limits")

    async def run(self):
        while True:
            try:
                token = await self.auth.get_access_token()
                headers = {"Authorization": f"Bearer {token}"}
                async with websockets.connect(
                    LIMITS_WS_URL,
                    extra_headers=headers,
                    ping_interval=20,
                    ping_timeout=20,
                ) as ws:
                    self.log.info(f"connected {sanitize({'url': LIMITS_WS_URL})}")
                    async for message in ws:
                        await self._handle_message(message)
            except Exception as exc:
                self.log.error(f"ws error: {exc}; reconnect in 3s")
                await asyncio.sleep(3)

    async def _handle_message(self, message: str):
        try:
            data = json.loads(message)
        except Exception:
            return
        if isinstance(data, dict):
            if self.log.isEnabledFor(10):
                self.log.debug(f"snapshot {sanitize({'keys': list(data.keys())})}")
            await self.db.insert_limits_snapshot(data)


class MarginalStream:
    def __init__(self, auth: AuthClient, db: Db):
        self.auth = auth
        self.db = db
        self.log = get_logger("worker.marginal")

    async def run(self):
        while True:
            try:
                token = await self.auth.get_access_token()
                headers = {"Authorization": f"Bearer {token}"}
                async with websockets.connect(
                    MARGINAL_WS_URL,
                    extra_headers=headers,
                    ping_interval=20,
                    ping_timeout=20,
                ) as ws:
                    self.log.info(f"connected {sanitize({'url': MARGINAL_WS_URL})}")
                    async for message in ws:
                        await self._handle_message(message)
            except Exception as exc:
                self.log.error(f"ws error: {exc}; reconnect in 3s")
                await asyncio.sleep(3)

    async def _handle_message(self, message: str):
        try:
            data = json.loads(message)
        except Exception:
            return
        if isinstance(data, dict):
            if self.log.isEnabledFor(10):
                self.log.debug(f"snapshot {sanitize({'keys': list(data.keys())})}")
            await self.db.insert_marginal_snapshot(data)
