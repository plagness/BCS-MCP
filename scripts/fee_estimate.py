import math

def _pct(val):
    return float(val)

def _round_money(x):
    # округление до копейки
    return round(float(x), 2)

def run(payload):
    trade_value = payload.get("trade_value")
    if trade_value is None:
        return {"error": "trade_value required"}

    broker_pct = payload.get("broker_pct")
    exchange_pct = payload.get("exchange_pct")
    broker_pct_range = payload.get("broker_pct_range", [0.01, 0.03])
    exchange_pct_range = payload.get("exchange_pct_range", [0.01, 0.0125])
    roundtrip = bool(payload.get("roundtrip", True))

    if broker_pct is not None and exchange_pct is not None:
        total_pct = _pct(broker_pct) + _pct(exchange_pct)
        fee = trade_value * total_pct / 100.0
        fee = _round_money(fee)
        result = {
            "trade_value": trade_value,
            "total_pct": total_pct,
            "fee": fee,
        }
        if roundtrip:
            result["roundtrip_fee"] = _round_money(fee * 2)
        return result

    min_pct = _pct(broker_pct_range[0]) + _pct(exchange_pct_range[0])
    max_pct = _pct(broker_pct_range[1]) + _pct(exchange_pct_range[1])

    fee_min = _round_money(trade_value * min_pct / 100.0)
    fee_max = _round_money(trade_value * max_pct / 100.0)

    result = {
        "trade_value": trade_value,
        "min_pct": min_pct,
        "max_pct": max_pct,
        "fee_min": fee_min,
        "fee_max": fee_max,
        "note": "оценка по диапазону комиссий; реальные комиссии зависят от тарифа и оборота",
    }

    if roundtrip:
        result["roundtrip_fee_min"] = _round_money(fee_min * 2)
        result["roundtrip_fee_max"] = _round_money(fee_max * 2)
        result["roundtrip_pct_min"] = min_pct * 2
        result["roundtrip_pct_max"] = max_pct * 2

    return result
