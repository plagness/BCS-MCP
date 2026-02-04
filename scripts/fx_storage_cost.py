import math

def run(payload):
    amount = payload.get("amount")
    if amount is None:
        return {"error": "amount required"}

    annual_pct = float(payload.get("annual_pct", 12))
    days = int(payload.get("days", 1))

    daily_rate = annual_pct / 100.0 / 365.0
    daily_cost = float(amount) * daily_rate
    total_cost = daily_cost * days

    return {
        "amount": amount,
        "annual_pct": annual_pct,
        "days": days,
        "daily_cost": daily_cost,
        "total_cost": total_cost,
    }
