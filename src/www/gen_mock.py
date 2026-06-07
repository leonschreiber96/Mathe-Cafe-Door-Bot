#!/usr/bin/env python3
"""Generate realistic mock JSON for the door dashboard, matching API_SPEC.md.

Outputs js/mock_data.js -> window.DOOR_MOCK = {...} so the static page can load
it with no server. Semester/break aware. Live /status is computed client-side
from the event stream, so we only bundle the static parts here.
"""
import json, math, random
from datetime import datetime, timedelta, timezone, date

random.seed(42)
TZ = timezone(timedelta(hours=2))  # CEST

# Anchor "now" to a lively weekday afternoon so the demo shows an OPEN door with
# an active rolling-probability line and a populated today-timeline. In real use
# the backend's /status drives "now"; the frontend uses the wall clock.
# 2026-06-03 is a Wednesday.
NOW = datetime(2026, 6, 3, 15, 20, tzinfo=TZ)
TODAY = NOW.date()

# ---- semester / break calendar -------------------------------------------------
PERIODS = [
    {"id": "ws25-lecture", "type": "lecture", "label": "WS 2025/26 Lecture",
     "from": "2025-10-13", "to": "2026-02-14"},
    {"id": "ws25-break",   "type": "break",   "label": "Winter Break",
     "from": "2026-02-15", "to": "2026-04-12"},
    {"id": "ss26-lecture", "type": "lecture", "label": "SS 2026 Lecture",
     "from": "2026-04-13", "to": "2026-07-18"},
]
CURRENT_PERIOD = "ss26-lecture"

def period_for(d: date):
    s = d.isoformat()
    for p in PERIODS:
        if p["from"] <= s <= p["to"]:
            return p
    return PERIODS[-1]

# ---- open-probability model ----------------------------------------------------
# Probability the door is open at a given (weekday, minute-of-day), depends on
# whether the day is in a lecture period or a break. Café-like: open daytime on
# weekdays, much less on weekends, and reduced during breaks.
def open_prob(weekday, minute, ptype):
    hour = minute / 60.0
    # base bell curve centered ~14:00, active roughly 9-21
    center, width = 14.0, 4.2
    bell = math.exp(-((hour - center) ** 2) / (2 * width ** 2))
    # hard gate before ~8:30 and after ~22:30
    if hour < 8.0 or hour > 22.5:
        bell *= 0.04
    # weekday scaling
    wk_scale = [1.0, 1.0, 1.0, 1.0, 0.95, 0.45, 0.28][weekday]
    # break scaling
    if ptype == "break":
        wk_scale *= 0.45
    p = bell * wk_scale * 0.95
    return max(0.0, min(0.985, p))

# ---- generate raw events for the archive (we keep ~220 days for aggregates) ----
ARCHIVE_DAYS = 230
STEP_MIN = 5  # sampling resolution for the latent open state

def gen_state_series():
    """Build a realistic open/closed series day by day. Each day we pick an
    open window [first_open, last_close] driven by the weekday/period, then add
    occasional mid-day closures and rare 'unknown' sensor gaps. This guarantees
    clean nights-closed and sensible first-open/last-close, while keeping the
    intra-day open% varied."""
    start = (NOW - timedelta(days=ARCHIVE_DAYS)).date()
    series = []
    ndays = ARCHIVE_DAYS + 1
    for back in range(ndays, -1, -1):
        d = TODAY - timedelta(days=back)
        if d < start:
            continue
        wd = d.weekday()
        ptype = period_for(d)["type"]
        # likelihood the space opens at all this day
        open_day_prob = [0.97, 0.98, 0.97, 0.97, 0.95, 0.55, 0.40][wd]
        if ptype == "break":
            open_day_prob *= 0.55
        opens_today = random.random() < open_day_prob
        day0 = datetime(d.year, d.month, d.day, tzinfo=TZ)
        # default first-open / last-close (minutes from midnight) with jitter
        base_open = {0: 8 * 60 + 45, 1: 8 * 60 + 30, 2: 8 * 60 + 40,
                     3: 8 * 60 + 35, 4: 8 * 60 + 50, 5: 10 * 60 + 30,
                     6: 11 * 60 + 30}[wd]
        base_close = {0: 21 * 60, 1: 21 * 60 + 30, 2: 21 * 60, 3: 21 * 60,
                      4: 20 * 60, 5: 17 * 60, 6: 16 * 60}[wd]
        if ptype == "break":
            base_open += 60; base_close -= 120
        fo = base_open + random.randint(-25, 35)
        lc = base_close + random.randint(-40, 40)
        t = day0
        end_of_day = day0 + timedelta(days=1)
        while t < end_of_day and t <= NOW:
            minute = t.hour * 60 + t.minute
            status = "closed"
            if opens_today and fo <= minute < lc:
                # within open window, but allow short closures (lunch lull etc.)
                p = open_prob(wd, minute, ptype)
                # normalize: inside window we want mostly open
                status = "open" if random.random() < (0.55 + 0.45 * p) else "closed"
            # rare sensor unknown
            if random.random() < 0.0015:
                status = "unknown"
            series.append((t, status))
            t += timedelta(minutes=STEP_MIN)
    return series

def state_to_events(series):
    """Collapse a sampled state series into change-events."""
    events = []
    prev = None
    for t, s in series:
        if s != prev:
            events.append({"event_time": t.isoformat(), "status": s})
            prev = s
    return events

series = gen_state_series()
all_events = state_to_events(series)

# ---- endpoint 2: events for last 30 days --------------------------------------
cutoff30 = NOW - timedelta(days=30)
events_30 = [e for e in all_events if datetime.fromisoformat(e["event_time"]) >= cutoff30]
events_payload = {
    "range": {"from": cutoff30.isoformat(), "to": NOW.isoformat()},
    "events": events_30,
}

# ---- helper: per-minute open fraction from sampled series ----------------------
# Build a quick lookup of status at each sample point.
def iter_intervals(series):
    """Yield (start_dt, end_dt, status) intervals from the sampled series."""
    for i in range(len(series) - 1):
        yield series[i][0], series[i + 1][0], series[i][1]

intervals = list(iter_intervals(series))

# ---- endpoint 4: daily rollup (last 30 days) ----------------------------------
def daily_rollup(days=30):
    out = []
    for back in range(days - 1, -1, -1):
        d = TODAY - timedelta(days=back)
        day_start = datetime(d.year, d.month, d.day, tzinfo=TZ)
        day_end = day_start + timedelta(days=1)
        open_sec = 0
        first_open = None
        last_close = None
        for s, e, st in intervals:
            if e <= day_start or s >= day_end:
                continue
            seg_s = max(s, day_start); seg_e = min(e, day_end, NOW)
            if seg_e <= seg_s:
                continue
            if st == "open":
                open_sec += (seg_e - seg_s).total_seconds()
                if first_open is None:
                    first_open = seg_s
                last_close = seg_e
        out.append({
            "date": d.isoformat(),
            "weekday": d.weekday(),
            "open_hours": round(open_sec / 3600.0, 2),
            "first_open": first_open.isoformat() if first_open else None,
            "last_close": last_close.isoformat() if last_close else None,
            "period_id": period_for(d)["id"],
        })
    return out

daily = daily_rollup(30)

# ---- period-scoped aggregates over the WHOLE current period --------------------
cp = next(p for p in PERIODS if p["id"] == CURRENT_PERIOD)
cp_from = date.fromisoformat(cp["from"])
cp_to = min(date.fromisoformat(cp["to"]), TODAY)

def period_intervals(p_from, p_to):
    s0 = datetime(p_from.year, p_from.month, p_from.day, tzinfo=TZ)
    e0 = datetime(p_to.year, p_to.month, p_to.day, tzinfo=TZ) + timedelta(days=1)
    e0 = min(e0, NOW)
    return [(max(s, s0), min(e, e0), st) for s, e, st in intervals
            if e > s0 and s < e0 and min(e, e0) > max(s, s0)]

pints = period_intervals(cp_from, cp_to)

# by weekday: open% and avg open hours/day
wd_open = [0.0] * 7      # open seconds
wd_total = [0.0] * 7     # total observed seconds (open+closed, exclude unknown)
wd_days = [set() for _ in range(7)]
for s, e, st in pints:
    if st == "unknown":
        continue
    wd = s.weekday()
    sec = (e - s).total_seconds()
    wd_total[wd] += sec
    wd_days[wd].add(s.date())
    if st == "open":
        wd_open[wd] += sec

by_weekday = []
by_weekday_avg_hours = []
for wd in range(7):
    pct = (wd_open[wd] / wd_total[wd] * 100.0) if wd_total[wd] else 0.0
    ndays = max(1, len(wd_days[wd]))
    avg_h = (wd_open[wd] / 3600.0) / ndays
    by_weekday.append({"weekday": wd, "open_pct": round(pct, 1),
                       "avg_open_hours": round(avg_h, 2)})
    by_weekday_avg_hours.append(round(avg_h, 2))

# by hour: open%
hr_open = [0.0] * 24
hr_total = [0.0] * 24
# also hour x weekday for heatmap
mat_open = [[0.0] * 24 for _ in range(7)]
mat_total = [[0.0] * 24 for _ in range(7)]

# split intervals at hour boundaries for clean bucketing
def split_hourly(s, e):
    cur = s
    while cur < e:
        nxt = (cur.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1))
        seg_e = min(nxt, e)
        yield cur, seg_e, cur.hour, cur.weekday()
        cur = seg_e

for s, e, st in pints:
    if st == "unknown":
        continue
    for cs, ce, hr, wd in split_hourly(s, e):
        sec = (ce - cs).total_seconds()
        hr_total[hr] += sec
        mat_total[wd][hr] += sec
        if st == "open":
            hr_open[hr] += sec
            mat_open[wd][hr] += sec

by_hour = [{"hour": h,
            "open_pct": round((hr_open[h] / hr_total[h] * 100.0) if hr_total[h] else 0.0, 1)}
           for h in range(24)]

heatmap = [[round((mat_open[wd][h] / mat_total[wd][h] * 100.0) if mat_total[wd][h] else 0.0, 1)
            for h in range(24)] for wd in range(7)]

# baseline: avg open hours per day + first-open minutes by weekday
total_open_h = sum(wd_open) / 3600.0
total_days = len(set().union(*[ds for ds in wd_days])) if any(wd_days) else 1
avg_open_hours_per_day = round(total_open_h / max(1, total_days), 2)

# first-open minutes by weekday (avg), from the daily rollup restricted to period
fo_by_wd = [[] for _ in range(7)]
period_daily = daily_rollup(min(ARCHIVE_DAYS, (TODAY - cp_from).days + 1))
for d in period_daily:
    if d["period_id"] != CURRENT_PERIOD:
        continue
    if d["first_open"]:
        fo = datetime.fromisoformat(d["first_open"])
        fo_by_wd[d["weekday"]].append(fo.hour * 60 + fo.minute)
by_weekday_first_open_min = [
    round(sum(v) / len(v)) if v else None for v in fo_by_wd
]
all_fo = [m for v in fo_by_wd for m in v]
avg_first_open_min = round(sum(all_fo) / len(all_fo)) if all_fo else None

# cumulative expected open-hours by weekday up to each hour boundary (0..24).
# Lets the dashboard compare "open so far today" against "usual by this time".
# Built from the hour x weekday open-% matrix and the per-weekday observed days.
wd_obs_days = [max(1, len(wd_days[wd])) for wd in range(7)]
by_weekday_cum_open_hours = []
for wd in range(7):
    cum = [0.0]
    running = 0.0
    for h in range(24):
        frac = (mat_open[wd][h] / mat_total[wd][h]) if mat_total[wd][h] else 0.0
        running += frac  # each hour contributes up to 1 open-hour on average
        cum.append(round(running, 3))
    by_weekday_cum_open_hours.append(cum)

baseline = {
    "period_id": CURRENT_PERIOD,
    "avg_open_hours_per_day": avg_open_hours_per_day,
    "by_weekday_avg_open_hours": by_weekday_avg_hours,
    "avg_first_open_min": avg_first_open_min,
    "by_weekday_first_open_min": by_weekday_first_open_min,
    "by_weekday_cum_open_hours": by_weekday_cum_open_hours,
}

# event log (human-readable recent events) — last 40
log_events = [
    {"event_time": e["event_time"], "status": e["status"]}
    for e in events_30[-40:]
]

mock = {
    "generated_at": NOW.isoformat(),
    "semesters": {"current_period_id": CURRENT_PERIOD, "periods": PERIODS},
    "events": events_payload,
    "daily": {"days": daily},
    "by_weekday": {"period_id": CURRENT_PERIOD, "weekdays": by_weekday},
    "by_hour": {"period_id": CURRENT_PERIOD, "hours": by_hour},
    "heatmap": {"period_id": CURRENT_PERIOD, "matrix": heatmap},
    "baseline": baseline,
    "log": {"events": log_events},
}

out = "window.DOOR_MOCK = " + json.dumps(mock, separators=(",", ":")) + ";\n"
with open("js/mock_data.js", "w") as f:
    f.write(out)

print("events_30:", len(events_30))
print("daily days:", len(daily))
print("avg_open_hours_per_day:", avg_open_hours_per_day)
print("by_weekday open_pct:", [w["open_pct"] for w in by_weekday])
print("baseline first_open_min by wd:", by_weekday_first_open_min)
print("file bytes:", len(out))
