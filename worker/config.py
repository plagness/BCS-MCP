import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()


def _bool(key: str, default: bool = False) -> bool:
    val = os.getenv(key)
    if val is None:
        return default
    return val.strip().lower() in {"1", "true", "yes", "y"}


def _int(key: str, default: int) -> int:
    val = os.getenv(key)
    if val is None:
        return default
    try:
        return int(val)
    except ValueError:
        return default


@dataclass
class Config:
    refresh_token: str
    client_id: str

    db_host: str
    db_port: int
    db_user: str
    db_password: str
    db_market: str
    db_private: str

    stream_market: bool
    stream_portfolio: bool
    stream_orders: bool
    stream_limits: bool
    stream_marginal: bool

    store_orderbook: bool
    store_quotes: bool
    store_last_trades: bool
    store_candles: bool

    subscribe_instruments: list
    use_db_instruments: bool

    ollama_base_url: str
    ollama_embed_model: str
    llm_backend: str
    llm_mcp_base_url: str
    llm_mcp_provider: str
    llm_backend_fallback_ollama: bool
    llm_backend_timeout_sec: int

    candle_time_frame: str


def load_config() -> Config:
    instruments_raw = os.getenv("BCS_SUBSCRIBE_INSTRUMENTS", "").strip()
    instruments = []
    if instruments_raw:
        for item in instruments_raw.split(","):
            item = item.strip()
            if not item:
                continue
            if ":" not in item:
                continue
            class_code, ticker = item.split(":", 1)
            instruments.append({"class_code": class_code.strip(), "ticker": ticker.strip()})

    return Config(
        refresh_token=os.getenv("BCS_REFRESH_TOKEN", ""),
        client_id=os.getenv("BCS_CLIENT_ID", "trade-api-read"),
        db_host=os.getenv("BCS_DB_HOST", "127.0.0.1"),
        db_port=_int("BCS_DB_PORT", 5433),
        db_user=os.getenv("BCS_DB_USER", "bcs"),
        db_password=os.getenv("BCS_DB_PASSWORD", "bcs_secret"),
        db_market=os.getenv("BCS_DB_MARKET", "bcs_market"),
        db_private=os.getenv("BCS_DB_PRIVATE", "bcs_private"),
        stream_market=_bool("BCS_STREAM_MARKET", True),
        stream_portfolio=_bool("BCS_STREAM_PORTFOLIO", False),
        stream_orders=_bool("BCS_STREAM_ORDERS", False),
        stream_limits=_bool("BCS_STREAM_LIMITS", False),
        stream_marginal=_bool("BCS_STREAM_MARGINAL", False),
        store_orderbook=_bool("BCS_STORE_ORDERBOOK", True),
        store_quotes=_bool("BCS_STORE_QUOTES", True),
        store_last_trades=_bool("BCS_STORE_LAST_TRADES", True),
        store_candles=_bool("BCS_STORE_CANDLES", True),
        subscribe_instruments=instruments,
        use_db_instruments=_bool("BCS_USE_DB_INSTRUMENTS", False),
        ollama_base_url=os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
        ollama_embed_model=os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text"),
        llm_backend=os.getenv("LLM_BACKEND", "llm_mcp").strip().lower() or "llm_mcp",
        llm_mcp_base_url=os.getenv("LLM_MCP_BASE_URL", "http://llmcore:8080"),
        llm_mcp_provider=os.getenv("LLM_MCP_PROVIDER", "auto").strip().lower() or "auto",
        llm_backend_fallback_ollama=_bool("LLM_BACKEND_FALLBACK_OLLAMA", True),
        llm_backend_timeout_sec=_int("LLM_BACKEND_TIMEOUT_SEC", 30),
        candle_time_frame=os.getenv("BCS_CANDLE_TIMEFRAME", "M1"),
    )
