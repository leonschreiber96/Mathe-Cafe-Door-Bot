# CLAUDE.md

Guidance for working in this repository. Captures the things that aren't obvious
from reading the code.

## What this is

`Mathe-Cafe-Door-Bot` monitors a café door's open/closed status and surfaces it
three ways:

- **Telegram bot** — subscribe/unsubscribe to change notifications, query status,
  view today's shift plan.
- **SQLite persistence** — append-only event log + derived KPIs.
- **Web dashboard** — a "printed paper" dashboard of historical opening patterns.

A `DoorService` polls the door API; status changes fan out to subscribers and are
written to the DB. Two scheduled crawlers keep the shift plan and academic-term
dates fresh and alert an admin chat when they change or fail.

## Run / develop

- `npm run dev` — nodemon + tsx, watches `src/`, loads `.env`, sets
  `DEVELOPMENT=1` (DEBUG logs on, log persistence off).
- `npm start` — runs the compiled `dist/` build with `node --env-file=.env`.
- **Type-check**: `npx -p typescript@5.7 tsc --noEmit --skipLibCheck`.
  `--skipLibCheck` is needed: `@types/node` 25 conflicts with the bundled DOM lib.
  Note `tsx`/esbuild does **not** type-check — run `tsc` yourself to catch type errors.
- There is **no test suite**. Copy `.env.example` → `.env` to configure.

## Environment variables

See `.env.example` for the full annotated list. Required: `BOT_TOKEN`,
`DOOR_API_URL`. Notable optional ones: `ADMIN_CHAT_ID` (crawler alerts),
`DAY_START_HOUR` (logical-day cutoff, default 3), `SHIFT_PLAN_SCAN_MS` /
`SEMESTER_SCAN_MS` (crawler cadence), `SHIFT_PLAN_URL` / `SEMESTER_DATES_URL`.

## Architecture

`src/index.ts` wires singletons: `logger`, `database`, `DoorService`,
`TelegramBot`, `webServer`, then `startScheduler(...)`.

| File | Responsibility |
|------|----------------|
| `doorService.ts` | Polls the door API, detects changes, writes events, notifies subscribers. **Debounces** readings (`STATUS_CONFIRMATIONS`, default 3) so a flaky sensor/API can't flip state or spam notifications; a failed poll is just an `UNKNOWN` reading that must clear the same bar. Only genuine OPEN⇄CLOSED changes notify (UNKNOWN/OFFLINE are logged, never announced). Guards against backward API clock skew; writes `OFFLINE` on shutdown / unclean restart. |
| `database.ts` | SQLite schema + all queries. Builds the dashboard payload and KPIs on read. Derives semester periods from stored data. |
| `bot.ts` | Telegram commands (`/start`, `/subscribe`, `/unsubscribe`, `/status`, `/schichtplan`) + `notifyAdmin()`. |
| `shiftPlanService.ts` | Scrapes/parses/persists the shift plan; `getCurrentShift()` for the dashboard. |
| `semesterService.ts` | Scrapes/parses/persists TU Berlin semester dates. |
| `scheduler.ts` | Periodically runs both crawlers; alerts the admin on change/failure. |
| `webServer.ts` | Express. `GET /api/dashboard` = `database.getDashboardData()` + `currentShift`. |
| `logger.ts` | Console always; persists INFO/WARN/ERROR to the DB only in production. |

## Data layer conventions

- **All time math is in the door's timezone** (`Europe/Berlin`), never the
  viewer's — on both backend (`Intl` with `timeZone`) and frontend (`core/format.js`).
- `door_status` is **append-only event rows** (`status` + `event_time`); KPIs are
  computed on read via a `LEAD()` window function that pairs each event with the next.
- **Logical-day cutoff** (`DAY_START_HOUR`, default 03:00): the opening **streak**
  attributes post-midnight activity to the prior day, so a Friday close after
  midnight stays on Friday. The hour-of-day / weekday **heatmaps deliberately stay
  on true clock hours**. See `logicalDayStart`/`logicalDateKey` in `database.ts`.
- **Semester periods** are derived (not hardcoded) from the scraped `semesters`
  table by `buildPeriods()`: lecture time (Vorlesungszeit, with Christmas carved
  out), the Christmas break (Vorlesungsfreie Zeit), and the semester break between
  consecutive semesters. Until the first crawl populates the table there is no
  current period — the dashboard falls back to a last-90-days window and an
  "Unknown Period" label.
- New tables: `shift_plans` (historical change-log, new row only on content-hash
  change) and `semesters` (upserted by label, history preserved).
- **Time-travel**: `getDashboardData(asOf?)` computes the whole dashboard against a
  reference instant (default: now). `GET /api/dashboard?date=YYYY-MM-DD` renders it
  "as if it were the end of that day" (clamped to now) — academic period, status,
  streak and all aggregates are recomputed for that date; `currentShift` is only
  sent for today. The frontend reads `?date=`, drives the heading off `data.asOf`,
  hides the shift row when `data.isToday === false`, and exposes ◀/▶ day nav.

## Frontend conventions (`src/www`)

- **Light-DOM custom elements** (`<door-*>`), one per figure, each listening to the
  `door:data` window event and rendering its own slice. `dashboard.js` owns the
  fetch/poll loop and dispatches `door:data`; components are dumb renderers.
- **Chart.js 4.4.3** via CDN; **Tailwind Play CDN** for utilities. Colours live as
  CSS variables in `css/theme.css` and are read into Chart.js at runtime
  (`core/chart-theme.js`) — one source of truth for the palette.
- Line charts with `pointRadius: 0` need
  `interaction: { mode: "index", intersect: false }` for tooltips to fire on hover
  (otherwise the default `nearest`/`intersect` finds no point).
- The heatmap is a CSS grid, not a canvas; it scrolls horizontally inside its card
  on narrow screens (`.heat-scroll`, sticky weekday label column).

## Gotchas

- The shift-plan and semester scrapers depend on **brittle upstream HTML**.
  Failures are thrown and surfaced to `ADMIN_CHAT_ID` via the scheduler. If a
  source page restructures, fix the selectors in the respective service.
- `database.ts` opens the real SQLite file on import — be careful running ad-hoc
  scripts that import it while the app is running.
- Avoid an import cycle: `currentShift` is merged into the dashboard payload in
  `webServer.ts` (which imports `shiftPlanService`), not inside `database.ts`.
