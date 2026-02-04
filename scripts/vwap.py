
def run(payload):
    series = payload.get("series", {})
    prices = payload.get("prices") or series.get("close") or series.get("prices")
    volumes = payload.get("volumes") or series.get("volume") or series.get("volumes")

    if not prices or not volumes:
        return {"error": "prices and volumes required"}
    if len(prices) != len(volumes):
        return {"error": "prices and volumes length mismatch"}

    total_vol = sum(volumes)
    if total_vol == 0:
        return {"error": "total volume is zero"}

    vwap = sum(p * v for p, v in zip(prices, volumes)) / total_vol

    return {
        "vwap": vwap,
        "total_volume": total_vol,
    }
