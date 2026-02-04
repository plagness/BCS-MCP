import math

def run(payload):
    values = payload.get("values", [])
    period = int(payload.get("period", 0))
    if period <= 0:
        return {"error": "period must be > 0"}
    if len(values) < period:
        return {"error": "not enough values", "needed": period, "got": len(values)}

    series = []
    window_sum = sum(values[:period])
    series.append(window_sum / period)
    for i in range(period, len(values)):
        window_sum += values[i] - values[i - period]
        series.append(window_sum / period)

    return {
        "period": period,
        "count": len(values),
        "sma": series[-1],
        "series": series
    }
