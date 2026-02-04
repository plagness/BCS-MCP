import math

def run(payload):
    contracts = payload.get("contracts")
    if contracts is None:
        return {"error": "contracts required"}

    broker_fee = payload.get("broker_fee_rub")
    exchange_fee = payload.get("exchange_fee_rub")
    broker_range = payload.get("broker_fee_rub_range", [1, 10])
    exchange_range = payload.get("exchange_fee_rub_range", [2, 5])
    roundtrip = bool(payload.get("roundtrip", True))

    if broker_fee is not None and exchange_fee is not None:
        per_contract = float(broker_fee) + float(exchange_fee)
        total = per_contract * float(contracts)
        result = {
            "contracts": contracts,
            "per_contract": per_contract,
            "total": total,
        }
        if roundtrip:
            result["roundtrip_total"] = total * 2
        return result

    per_min = float(broker_range[0]) + float(exchange_range[0])
    per_max = float(broker_range[1]) + float(exchange_range[1])
    total_min = per_min * float(contracts)
    total_max = per_max * float(contracts)

    result = {
        "contracts": contracts,
        "per_contract_min": per_min,
        "per_contract_max": per_max,
        "total_min": total_min,
        "total_max": total_max,
        "note": "оценка по диапазону комиссий на контракт",
    }
    if roundtrip:
        result["roundtrip_total_min"] = total_min * 2
        result["roundtrip_total_max"] = total_max * 2
    return result
