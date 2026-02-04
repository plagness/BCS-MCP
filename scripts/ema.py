import math

def run(payload):
    values = payload.get("values", [])
    period = int(payload.get("period", 0))
    if period <= 0:
        return {"error": "period must be > 0"}
    if len(values) < period:
        return {"error": "not enough values", "needed": period, "got": len(values)}

    k = 2 / (period + 1)
    ema = sum(values[:period]) / period
    series = [ema]
    for v in values[period:]:
        ema = v * k + ema * (1 - k)
        series.append(ema)

    return {
        "period": period,
        "count": len(values),
        "ema": series[-1],
        "series": series
    }
