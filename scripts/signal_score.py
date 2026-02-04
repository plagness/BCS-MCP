import sys
import json
import math


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def mean(values):
    if not values:
        return 0.0
    return sum(values) / len(values)


def stddev(values):
    if not values:
        return 0.0
    m = mean(values)
    var = sum((v - m) ** 2 for v in values) / len(values)
    return math.sqrt(var)


def ema(values, period):
    if period <= 0 or len(values) < period:
        return None
    k = 2 / (period + 1)
    current = mean(values[:period])
    for v in values[period:]:
        current = v * k + current * (1 - k)
    return current


def rsi(values, period=14):
    if period <= 0 or len(values) <= period:
        return None
    gains = 0.0
    losses = 0.0
    for i in range(1, period + 1):
        delta = values[i] - values[i - 1]
        if delta >= 0:
            gains += delta
        else:
            losses += -delta
    avg_gain = gains / period
    avg_loss = losses / period
    for i in range(period + 1, len(values)):
        delta = values[i] - values[i - 1]
        gain = max(delta, 0.0)
        loss = max(-delta, 0.0)
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def atr(highs, lows, closes, period=14):
    if period <= 0 or len(highs) < period + 1:
        return None
    trs = []
    for i in range(1, len(highs)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        trs.append(tr)
    if len(trs) < period:
        return None
    return mean(trs[-period:])


def linear_slope(values):
    n = len(values)
    if n < 2:
        return 0.0
    x_mean = (n - 1) / 2.0
    y_mean = mean(values)
    num = 0.0
    den = 0.0
    for i, v in enumerate(values):
        dx = i - x_mean
        num += dx * (v - y_mean)
        den += dx * dx
    if den == 0:
        return 0.0
    return num / den


def safe_div(a, b):
    if b == 0:
        return 0.0
    return a / b


def prepare_series(series):
    closes = series.get("close") or series.get("closes") or series.get("values") or []
    opens = series.get("open") or series.get("opens") or []
    highs = series.get("high") or series.get("highs") or []
    lows = series.get("low") or series.get("lows") or []
    volumes = series.get("volume") or series.get("volumes") or []

    lengths = [len(closes)]
    for arr in (opens, highs, lows, volumes):
        if arr:
            lengths.append(len(arr))
    n = min(lengths) if lengths else 0
    if n <= 0:
        return None
    return {
        "closes": closes[-n:],
        "opens": opens[-n:] if opens else None,
        "highs": highs[-n:] if highs else None,
        "lows": lows[-n:] if lows else None,
        "volumes": volumes[-n:] if volumes else None,
        "count": n,
    }


def compute_orderbook(orderbook):
    if not orderbook:
        return {
            "imbalance": None,
            "spread": None,
            "best_bid": None,
            "best_ask": None,
        }
    bids = orderbook.get("bids") or []
    asks = orderbook.get("asks") or []
    bid_volume = orderbook.get("bidVolume")
    ask_volume = orderbook.get("askVolume")
    best_bid = bids[0].get("price") if bids else None
    best_ask = asks[0].get("price") if asks else None
    if best_bid is not None and best_ask is not None:
        spread = best_ask - best_bid
    else:
        spread = None
    imbalance = None
    if bid_volume is not None and ask_volume is not None:
        total = bid_volume + ask_volume
        if total:
            imbalance = (bid_volume - ask_volume) / total
    return {
        "imbalance": imbalance,
        "spread": spread,
        "best_bid": best_bid,
        "best_ask": best_ask,
    }


def run(payload):
    series = prepare_series(payload.get("series") or {})
    if not series:
        return {"error": "series is empty"}

    closes = series["closes"]
    highs = series["highs"] or closes
    lows = series["lows"] or closes
    volumes = series["volumes"] or []
    n = series["count"]

    if n < 10:
        return {"error": "not enough bars", "got": n, "needed": 10}

    close = closes[-1]
    prev = closes[-2]
    ret1 = safe_div(close - prev, prev)
    ret5 = safe_div(close - closes[-6], closes[-6]) if n >= 6 else ret1

    slope = linear_slope(closes)
    slope_pct = safe_div(slope, mean(closes))
    price_std = stddev(closes)
    trend_strength = safe_div(abs(slope), price_std + 1e-9)

    rsi_val = rsi(closes, period=min(14, n - 1))
    rsi_val = rsi_val if rsi_val is not None else 50.0
    rsi_over = clamp((rsi_val - 70.0) / 30.0)
    rsi_under = clamp((30.0 - rsi_val) / 30.0)
    rsi_extreme = max(rsi_over, rsi_under)

    z_val = 0.0
    if price_std > 0:
        z_val = (close - mean(closes)) / price_std
    z_extreme = clamp(abs(z_val) / 2.5)

    boll_mid = mean(closes[-20:]) if n >= 20 else mean(closes)
    boll_std = stddev(closes[-20:]) if n >= 20 else price_std
    boll_pos = safe_div(close - boll_mid, (boll_std * 2) if boll_std else 1.0)

    atr_val = atr(highs, lows, closes, period=min(14, n - 1))
    atr_val = atr_val if atr_val is not None else 0.0
    atr_pct = safe_div(atr_val, close)

    short_vol = stddev(closes[-20:]) if n >= 20 else price_std
    long_vol = stddev(closes[-60:]) if n >= 60 else price_std
    vol_ratio = safe_div(short_vol, long_vol + 1e-9)

    donchian_period = 20 if n >= 20 else max(5, n // 2)
    d_high = max(highs[-donchian_period:])
    d_low = min(lows[-donchian_period:])
    breakout_up = close >= d_high
    breakout_down = close <= d_low

    vol_spike = None
    if volumes:
        avg_vol = mean(volumes[-20:]) if n >= 20 else mean(volumes)
        vol_spike = safe_div(volumes[-1], avg_vol + 1e-9)

    orderbook = compute_orderbook(payload.get("orderbook"))
    imbalance = orderbook["imbalance"]

    trend_score = clamp(trend_strength / 2.0)
    mean_rev_score = clamp((z_extreme + rsi_extreme + clamp(abs(boll_pos))) / 3.0)

    breakout_score = 0.0
    if breakout_up or breakout_down:
        breakout_score += 0.7
    if vol_ratio > 1.2:
        breakout_score += clamp((vol_ratio - 1.2) / 1.5, 0.0, 0.3)
    breakout_score = clamp(breakout_score)

    divergence = 0.0
    long_ret = safe_div(close - closes[-10], closes[-10]) if n >= 10 else ret5
    if (ret5 > 0 and long_ret < 0) or (ret5 < 0 and long_ret > 0):
        divergence = 0.4
    reversal_score = clamp((rsi_extreme * (1 - trend_score)) + divergence)

    range_score = clamp((1 - trend_strength) * (1 - breakout_score * 0.5))

    orderflow_score = clamp(abs(imbalance) / 0.5) if imbalance is not None else 0.0

    scores = {
        "trend": trend_score,
        "mean_reversion": mean_rev_score,
        "breakout": breakout_score,
        "reversal": reversal_score,
        "range": range_score,
        "orderflow": orderflow_score,
    }

    total = sum(scores.values())
    if total <= 0:
        probs = {k: 1.0 / len(scores) for k in scores}
    else:
        probs = {k: v / total for k, v in scores.items()}

    dir_up = max(0.0, slope_pct) + max(0.0, ret5)
    dir_down = max(0.0, -slope_pct) + max(0.0, -ret5)
    if imbalance is not None:
        dir_up += max(0.0, imbalance)
        dir_down += max(0.0, -imbalance)
    dir_side = range_score + (1.0 - clamp(abs(slope_pct) * 5.0))

    dir_total = dir_up + dir_down + dir_side
    if dir_total <= 0:
        direction = {"up": 0.33, "down": 0.33, "sideways": 0.34}
    else:
        direction = {
            "up": dir_up / dir_total,
            "down": dir_down / dir_total,
            "sideways": dir_side / dir_total,
        }

    features = {
        "count": n,
        "close": close,
        "return_1": ret1,
        "return_5": ret5,
        "slope": slope,
        "slope_pct": slope_pct,
        "trend_strength": trend_strength,
        "rsi": rsi_val,
        "zscore": z_val,
        "boll_pos": boll_pos,
        "atr": atr_val,
        "atr_pct": atr_pct,
        "vol_ratio": vol_ratio,
        "donchian_high": d_high,
        "donchian_low": d_low,
        "breakout_up": breakout_up,
        "breakout_down": breakout_down,
        "volume_spike": vol_spike,
        "orderbook_imbalance": imbalance,
        "spread": orderbook["spread"],
        "best_bid": orderbook["best_bid"],
        "best_ask": orderbook["best_ask"],
    }

    return {
        "model": "heuristic-v1",
        "probs": probs,
        "direction": direction,
        "features": features,
    }


if __name__ == "__main__":
    raw = sys.stdin.read().strip()
    payload = json.loads(raw) if raw else {}
    result = run(payload)
    print(json.dumps(result))
