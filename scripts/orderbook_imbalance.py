
def run(payload):
    bids = payload.get("bids") or []
    asks = payload.get("asks") or []
    depth = int(payload.get("depth", 5))

    bids = bids[:depth]
    asks = asks[:depth]

    bid_vol = sum(float(x.get("quantity", 0)) for x in bids)
    ask_vol = sum(float(x.get("quantity", 0)) for x in asks)

    imbalance = None
    if bid_vol + ask_vol > 0:
        imbalance = (bid_vol - ask_vol) / (bid_vol + ask_vol)

    best_bid = bids[0].get("price") if bids else None
    best_ask = asks[0].get("price") if asks else None
    spread = None
    spread_pct = None
    if best_bid is not None and best_ask is not None:
        spread = best_ask - best_bid
        spread_pct = (spread / best_ask) * 100 if best_ask else None

    return {
        "depth": depth,
        "bid_volume": bid_vol,
        "ask_volume": ask_vol,
        "imbalance": imbalance,
        "best_bid": best_bid,
        "best_ask": best_ask,
        "spread": spread,
        "spread_pct": spread_pct,
    }
