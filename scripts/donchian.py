
def run(payload):
    series = payload.get("series", {})
    highs = payload.get("highs") or series.get("high") or series.get("highs")
    lows = payload.get("lows") or series.get("low") or series.get("lows")
    closes = payload.get("closes") or series.get("close") or series.get("closes")
    period = int(payload.get("period", 20))

    if not highs or not lows:
        return {"error": "highs and lows required"}
    if period <= 0:
        return {"error": "period must be > 0"}
    if len(highs) < period or len(lows) < period:
        return {"error": "not enough values", "needed": period}

    window_high = max(highs[-period:])
    window_low = min(lows[-period:])
    mid = (window_high + window_low) / 2
    last_close = closes[-1] if closes else None

    breakout = None
    if last_close is not None:
        if last_close > window_high:
            breakout = "up"
        elif last_close < window_low:
            breakout = "down"
        else:
            breakout = "none"

    return {
        "period": period,
        "upper": window_high,
        "lower": window_low,
        "mid": mid,
        "last_close": last_close,
        "breakout": breakout,
    }
