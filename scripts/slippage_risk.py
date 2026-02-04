
def run(payload):
    order_size = float(payload.get("order_size", 0))
    bid = payload.get("bid")
    ask = payload.get("ask")
    top_bid_qty = float(payload.get("top_bid_qty", 0))
    top_ask_qty = float(payload.get("top_ask_qty", 0))

    if bid is None or ask is None:
        return {"error": "bid and ask required"}
    if order_size <= 0:
        return {"error": "order_size must be > 0"}

    spread = ask - bid
    spread_pct = (spread / ask) * 100 if ask else None

    # simple risk heuristic
    if order_size <= min(top_bid_qty, top_ask_qty):
        depth_risk = "low"
    elif order_size <= (top_bid_qty + top_ask_qty):
        depth_risk = "medium"
    else:
        depth_risk = "high"

    if spread_pct is None:
        spread_risk = "unknown"
    elif spread_pct < 0.05:
        spread_risk = "low"
    elif spread_pct < 0.2:
        spread_risk = "medium"
    else:
        spread_risk = "high"

    overall = "high" if "high" in (depth_risk, spread_risk) else "medium"
    if depth_risk == "low" and spread_risk == "low":
        overall = "low"

    return {
        "order_size": order_size,
        "spread": spread,
        "spread_pct": spread_pct,
        "depth_risk": depth_risk,
        "spread_risk": spread_risk,
        "risk": overall,
    }
