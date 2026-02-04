import logging
import os
import sys

SENSITIVE_KEYS = ("token", "authorization", "password", "secret", "refresh", "access", "clientsecret")


def _is_sensitive(key: str) -> bool:
    key = key.lower()
    return any(part in key for part in SENSITIVE_KEYS)


def sanitize(value, depth: int = 0):
    if value is None:
        return value
    if depth > 4:
        return "[max-depth]"
    if isinstance(value, dict):
        out = {}
        for idx, (k, v) in enumerate(value.items()):
            if idx > 50:
                out["_truncated"] = len(value) - 50
                break
            out[k] = "***" if _is_sensitive(str(k)) else sanitize(v, depth + 1)
        return out
    if isinstance(value, list):
        items = [sanitize(v, depth + 1) for v in value[:20]]
        if len(value) > 20:
            items.append(f"[+{len(value) - 20} more]")
        return items
    if isinstance(value, str):
        return value[:500] + ("..." if len(value) > 500 else "")
    return value


def summarize(value):
    if value is None:
        return {"type": "null"}
    if isinstance(value, list):
        return {"type": "list", "length": len(value)}
    if isinstance(value, dict):
        return {"type": "dict", "keys": list(value.keys())[:20], "keyCount": len(value)}
    if isinstance(value, str):
        return {"type": "string", "length": len(value), "preview": value[:120]}
    return {"type": type(value).__name__, "value": value}


def setup_logging():
    level_raw = os.getenv("LOG_LEVEL", "info").upper()
    level = getattr(logging, level_raw, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        stream=sys.stdout,
    )


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
