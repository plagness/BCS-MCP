import asyncio
import time
from typing import Optional
import aiohttp

TOKEN_URL = "https://be.broker.ru/trade-api-keycloak/realms/tradeapi/protocol/openid-connect/token"
from .logger import get_logger

log = get_logger("worker.auth")


class AuthClient:
    def __init__(self, refresh_token: str, client_id: str):
        self.refresh_token = refresh_token
        self.client_id = client_id
        self._access_token: Optional[str] = None
        self._expires_at: float = 0.0
        self._lock = asyncio.Lock()

    async def get_access_token(self) -> str:
        async with self._lock:
            if self._access_token and time.time() < self._expires_at - 60:
                return self._access_token
            await self._refresh()
            return self._access_token

    async def _refresh(self):
        log.debug("token.refresh.start")
        async with aiohttp.ClientSession() as session:
            data = {
                "client_id": self.client_id,
                "refresh_token": self.refresh_token,
                "grant_type": "refresh_token",
            }
            async with session.post(TOKEN_URL, data=data) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    log.error(f"token.refresh.error status={resp.status} body={text}")
                    raise RuntimeError(f"Token refresh failed: {resp.status} {text}")
                payload = await resp.json()
                self._access_token = payload.get("access_token")
                expires_in = int(payload.get("expires_in", 0))
                self._expires_at = time.time() + expires_in
                log.debug(f"token.refresh.ok expires_in={expires_in}")
