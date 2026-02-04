from datetime import datetime, time
from zoneinfo import ZoneInfo

def _parse_ts(value, tz):
    if not value:
        return datetime.now(tz)
    # Accept ISO, with or without Z
    value = value.replace("Z", "+00:00")
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=tz)
    return dt.astimezone(tz)


def _in_range(t, start, end):
    return start <= t <= end


def run(payload):
    tz_name = payload.get("timezone", "Europe/Moscow")
    tz = ZoneInfo(tz_name)
    ts = _parse_ts(payload.get("timestamp"), tz)

    dow = ts.weekday()  # 0=Mon
    if dow >= 5:
        return {
            "timestamp": ts.isoformat(),
            "session": "weekend",
            "is_tradable": False,
            "risk": "none",
        }

    t = ts.time()
    # Windows (MSK)
    morning_auction = (time(9, 50), time(10, 0))
    main_session = (time(10, 0), time(18, 39, 59))
    mid_clearing = (time(14, 0), time(14, 5))
    evening_clearing = (time(18, 40), time(19, 0))
    evening_session = (time(19, 5), time(23, 50))

    if _in_range(t, mid_clearing[0], mid_clearing[1]):
        session = "clearing"
        is_tradable = False
        risk = "none"
    elif _in_range(t, evening_clearing[0], evening_clearing[1]):
        session = "clearing"
        is_tradable = False
        risk = "none"
    elif _in_range(t, morning_auction[0], morning_auction[1]):
        session = "auction"
        is_tradable = False
        risk = "low"
    elif _in_range(t, main_session[0], main_session[1]):
        session = "main"
        is_tradable = True
        risk = "normal"
    elif _in_range(t, evening_session[0], evening_session[1]):
        session = "evening"
        is_tradable = True
        risk = "high"
    else:
        session = "off"
        is_tradable = False
        risk = "none"

    forts_new_day_started = t >= time(19, 5)

    return {
        "timestamp": ts.isoformat(),
        "session": session,
        "is_tradable": is_tradable,
        "risk": risk,
        "forts_new_day_started": forts_new_day_started,
    }
