import math

def _ema(values, period):
    k = 2 / (period + 1)
    ema = sum(values[:period]) / period
    for v in values[period:]:
        ema = v * k + ema * (1 - k)
    return ema


def run(payload):
    values = payload.get("values", [])
    fast = int(payload.get("fast", 12))
    slow = int(payload.get("slow", 26))

    if fast <= 0 or slow <= 0:
        return {"error": "fast/slow must be > 0"}
    if len(values) < max(fast, slow) + 1:
        return {"error": "not enough values", "needed": max(fast, slow) + 1}

    fast_ema = _ema(values, fast)
    slow_ema = _ema(values, slow)

    # previous values to detect cross
    fast_prev = _ema(values[:-1], fast)
    slow_prev = _ema(values[:-1], slow)

    cross_up = fast_prev <= slow_prev and fast_ema > slow_ema
    cross_down = fast_prev >= slow_prev and fast_ema < slow_ema

    if cross_up:
        signal = "bullish_cross"
    elif cross_down:
        signal = "bearish_cross"
    elif fast_ema > slow_ema:
        signal = "bullish"
    elif fast_ema < slow_ema:
        signal = "bearish"
    else:
        signal = "neutral"

    return {
        "fast": fast,
        "slow": slow,
        "fast_ema": fast_ema,
        "slow_ema": slow_ema,
        "signal": signal,
        "cross_up": cross_up,
        "cross_down": cross_down,
    }
