import math

def run(payload):
    values = payload.get("values", [])
    period = int(payload.get("period", 0))
    if period <= 0:
        return {"error": "period must be > 0"}
    if len(values) <= period:
        return {"error": "not enough values", "needed": period + 1, "got": len(values)}

    deltas = [values[i] - values[i - 1] for i in range(1, len(values))]
    gains = [max(d, 0) for d in deltas]
    losses = [abs(min(d, 0)) for d in deltas]

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    series = []
    for i in range(period, len(deltas)):
        if i > period:
            avg_gain = (avg_gain * (period - 1) + gains[i]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        if avg_loss == 0:
            rsi = 100.0
        else:
            rs = avg_gain / avg_loss
            rsi = 100 - (100 / (1 + rs))
        series.append(rsi)

    return {
        "period": period,
        "count": len(values),
        "rsi": series[-1] if series else None,
        "series": series
    }
