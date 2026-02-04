import math

def run(payload):
    series = payload.get("series", {})
    highs = payload.get("highs") or series.get("high") or series.get("highs")
    lows = payload.get("lows") or series.get("low") or series.get("lows")
    closes = payload.get("closes") or series.get("close") or series.get("closes")
    period = int(payload.get("period", 14))

    if not highs or not lows or not closes:
        return {"error": "highs, lows, closes required"}
    if period <= 0:
        return {"error": "period must be > 0"}
    if len(highs) < period + 1 or len(lows) < period + 1 or len(closes) < period + 1:
        return {"error": "not enough values", "needed": period + 1}

    trs = []
    for i in range(1, len(highs)):
        high = highs[i]
        low = lows[i]
        prev_close = closes[i - 1]
        tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
        trs.append(tr)

    window = trs[-period:]
    atr = sum(window) / period

    return {
        "period": period,
        "atr": atr,
        "last_tr": window[-1] if window else None,
    }
