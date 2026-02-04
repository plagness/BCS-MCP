import math

def _slope(values):
    n = len(values)
    if n < 2:
        return 0
    x_mean = (n - 1) / 2
    y_mean = sum(values) / n
    num = sum((i - x_mean) * (values[i] - y_mean) for i in range(n))
    den = sum((i - x_mean) ** 2 for i in range(n))
    return num / den if den else 0


def _atr(highs, lows, closes, period):
    trs = []
    for i in range(1, len(highs)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        trs.append(tr)
    window = trs[-period:]
    return sum(window) / period if window else 0


def run(payload):
    series = payload.get("series", {})
    closes = payload.get("closes") or series.get("close") or series.get("closes")
    highs = payload.get("highs") or series.get("high") or series.get("highs")
    lows = payload.get("lows") or series.get("low") or series.get("lows")
    period = int(payload.get("period", 50))

    if not closes:
        return {"error": "closes required"}
    if period <= 5:
        return {"error": "period must be > 5"}
    if len(closes) < period:
        return {"error": "not enough values", "needed": period}

    window = closes[-period:]
    mean_price = sum(window) / period
    slope = _slope(window)
    slope_norm = slope / mean_price if mean_price else 0

    vol_norm = None
    if highs and lows and len(highs) >= period and len(lows) >= period:
        atr = _atr(highs[-period:], lows[-period:], closes[-period:], min(14, period - 1))
        vol_norm = atr / mean_price if mean_price else 0

    # simple heuristics
    if vol_norm is None:
        vol_norm = 0

    if abs(slope_norm) > 0.001 and vol_norm < 0.01:
        regime = "trend_up" if slope_norm > 0 else "trend_down"
        style = "trend"
    elif abs(slope_norm) < 0.0005 and vol_norm < 0.008:
        regime = "range"
        style = "mean_reversion"
    elif vol_norm >= 0.012:
        regime = "volatile"
        style = "breakout"
    else:
        regime = "mixed"
        style = "neutral"

    return {
        "period": period,
        "mean_price": mean_price,
        "slope": slope,
        "slope_norm": slope_norm,
        "vol_norm": vol_norm,
        "regime": regime,
        "suggested_style": style,
    }
