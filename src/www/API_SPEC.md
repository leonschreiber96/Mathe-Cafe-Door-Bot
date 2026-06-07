# Door Status Dashboard — API Specification

The dashboard is a single static `index.html` + Chart.js. It polls a small set of
JSON endpoints. All endpoints are read-only `GET`. The frontend never writes.

Configure the base URL once in `js/config.js`:

```js
window.DOOR_CONFIG = {
  API_BASE: "/api",        // e.g. "https://door.example.org/api"
  POLL_MS: 15000,          // live refresh interval
  USE_MOCK: true           // true -> load bundled mock JSON, false -> hit API_BASE
};
```

All timestamps are **ISO 8601 with offset** (e.g. `2026-06-07T20:54:00+02:00`).
Status values are exactly: `"open"`, `"closed"`, `"unknown"`.

---

## 1. `GET /api/status`  — live "right now" snapshot

Cheap endpoint, polled every `POLL_MS`.

```json
{
  "status": "open",
  "since": "2026-06-07T09:12:00+02:00",   // when the CURRENT status began
  "server_time": "2026-06-07T20:54:00+02:00",
  "first_open_today": "2026-06-07T09:12:00+02:00", // null if not opened yet today
  "open_streak_days": 4,                  // consecutive days with >=1 open event, incl. today
  "open_seconds_today": 42120             // accumulated open time since local 00:00
}
```

## 2. `GET /api/events?days=30` — raw event log (last 30 days)

Backed by the `door_status` table. One row per status change. Ordered ascending by
`event_time`. The frontend derives intervals by pairing consecutive events.

```json
{
  "range": { "from": "2026-05-08T00:00:00+02:00", "to": "2026-06-07T20:54:00+02:00" },
  "events": [
    { "event_time": "2026-05-08T08:45:00+02:00", "status": "open" },
    { "event_time": "2026-05-08T18:30:00+02:00", "status": "closed" }
  ]
}
```

## 3. `GET /api/semesters` — semester / break calendar

Drives all "compare like-with-like" logic. The currently active period is flagged.
Periods are contiguous and non-overlapping. `type` is `"lecture"`, `"break"`, or `"exam"`.

```json
{
  "current_period_id": "ss26-lecture",
  "periods": [
    { "id": "ws25-lecture", "type": "lecture", "label": "WS 2025/26 Lecture",
      "from": "2025-10-13", "to": "2026-02-14" },
    { "id": "ws25-break",   "type": "break",   "label": "Winter Break",
      "from": "2026-02-15", "to": "2026-04-12" },
    { "id": "ss26-lecture", "type": "lecture", "label": "SS 2026 Lecture",
      "from": "2026-04-13", "to": "2026-07-18" }
  ]
}
```

## 4. `GET /api/aggregate/daily?days=30` — per-day rollup

Each day within the window. `period_id` lets the frontend color/group by semester.

```json
{
  "days": [
    { "date": "2026-06-07", "weekday": 0, "open_hours": 11.7,
      "first_open": "2026-06-07T09:12:00+02:00",
      "last_close": "2026-06-07T20:54:00+02:00",
      "period_id": "ss26-lecture" }
  ]
}
```
(`weekday`: 0=Mon … 6=Sun.)

## 5. `GET /api/aggregate/by-weekday?period_id=<id>` — open% / hours by weekday

Aggregated over the **whole period** (needs >30 days of history, so it's a
dedicated endpoint, not derived client-side).

```json
{
  "period_id": "ss26-lecture",
  "weekdays": [
    { "weekday": 0, "open_pct": 41.2, "avg_open_hours": 9.9 }
  ]
}
```

## 6. `GET /api/aggregate/by-hour?period_id=<id>` — open% by hour-of-day

```json
{
  "period_id": "ss26-lecture",
  "hours": [ { "hour": 0, "open_pct": 6.1 }, { "hour": 9, "open_pct": 58.0 } ]
}
```

## 7. `GET /api/aggregate/heatmap?period_id=<id>` — hour × weekday matrix

`matrix[weekday][hour]` = % of time the door was open in that hour bucket over the period.

```json
{
  "period_id": "ss26-lecture",
  "matrix": [ [3.1, 2.0, ... 24 values ... ], ... 7 rows ... ]
}
```

## 8. `GET /api/aggregate/baseline?period_id=<id>` — comparison baselines

Pre-computed reference values for KPI deltas, scoped to the period. Used to answer
"today vs. a usual <weekday> **this** semester/break".

```json
{
  "period_id": "ss26-lecture",
  "avg_open_hours_per_day": 10.4,
  "by_weekday_avg_open_hours": [9.9, 11.0, 10.8, 10.6, 10.1, 4.2, 2.1],
  "avg_first_open_min": 552,   // minutes after midnight, this weekday's usual first-open
  "by_weekday_first_open_min": [549, 540, 545, 548, 552, 705, 760],
  // cumulative expected open-hours by weekday at each hour boundary (25 values,
  // index 0..24). Lets the dashboard compare "open so far today" against the
  // usual amount open BY THIS TIME — a fair mid-day pace comparison.
  "by_weekday_cum_open_hours": [[0,0,...,10.4], ... 7 rows of 25 ...]
}
```

---

### Notes for the backend implementer
- Endpoints 4–8 require more than 30 days of raw history; compute them server-side
  against the full `door_status` archive.
- `unknown` time should be excluded from `open_pct` denominators where possible, or
  reported separately. The mock treats unknown as its own small slice.
- All "today"/"this weekday" comparisons must be filtered to the **same period type**
  (current semester or break) — never mixing across period boundaries.
