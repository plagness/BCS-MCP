import math


def run(payload):
    values = payload.get("values", [])
    period = int(payload.get("period", 20))
    std_mult = float(payload.get("std_mult", 2))

    if period <= 0:
        return {"error": "period must be > 0"}
    if len(values) < period:
        return {"error": "not enough values", "needed": period}

    window = values[-period:]
    mean = sum(window) / period
    var = sum((v - mean) ** 2 for v in window) / period
    std = math.sqrt(var)

    upper = mean + std_mult * std
    lower = mean - std_mult * std
    last = values[-1]
    zscore = 0 if std == 0 else (last - mean) / std
    bandwidth = 0 if mean == 0 else (upper - lower) / mean

    return {
        "period": period,
        "std_mult": std_mult,
        "mid": mean,
        "upper": upper,
        "lower": lower,
        "last": last,
        "zscore": zscore,
        "bandwidth": bandwidth,
    }
