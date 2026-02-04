import math

def run(payload):
    values = payload.get("values", [])
    period = int(payload.get("period", 20))
    if period <= 0:
        return {"error": "period must be > 0"}
    if len(values) < period:
        return {"error": "not enough values", "needed": period}

    window = values[-period:]
    mean = sum(window) / period
    var = sum((v - mean) ** 2 for v in window) / period
    std = math.sqrt(var)
    last = values[-1]
    z = 0 if std == 0 else (last - mean) / std

    return {
        "period": period,
        "mean": mean,
        "std": std,
        "last": last,
        "zscore": z,
    }
