# Door Status Dashboard

A single-page, client-side dashboard that visualises whether a door is **open** or
**closed** over time. Live status plus nine "printed-paper" figures: a rolling
open-rate chart, today's timeline, daily aggregates, an hour × weekday heatmap, and
per-weekday hourly curves. Polls a small JSON API every few seconds and re-renders
only the parts that change.

All date/time logic is anchored to the **door's** timezone (`Europe/Berlin`), never
the viewer's. Every comparison ("21% later than usual") is scoped to a single
semester or break — comparisons never cross a semester/break boundary.

---

## Architecture

The UI is built from **light-DOM custom elements** (`<door-*>`). Each component is a
logic-only renderer that exposes a single imperative method, `update(payload)`, and
mutates its own subtree — it never re-renders the whole page. A small orchestrator
(`js/dashboard.js`) owns all data flow: it loads data once, fans it out to the
components by tag name, then polls the cheap endpoints on an interval.

Light DOM (not Shadow DOM) is deliberate: the global printed-paper theme and the
Tailwind Play CDN utility classes apply *inside* the components without duplicating
styles per shadow root.

```
door-dashboard-v2/
├── index.html                     Semantic markup: only <door-*> elements + Tailwind
│                                   config mapping color names → CSS custom properties.
├── css/
│   ├── theme.css                  Palette as CSS custom properties (single source of
│   │                               truth — Tailwind config AND Chart.js both read these).
│   └── dashboard.css              Paper grain/grid, .sheet chrome, status lamp, timeline,
│                                   heatmap cells, skeletons — all via var().
├── js/
│   ├── config.js                  CONFIG: API_BASE, POLL_MS, USE_MOCK, TZ, etc.
│   ├── mock-data.js               window.DOOR_MOCK — local fixture for offline dev.
│   ├── dashboard.js               ENTRY POINT (type="module"). Registers components,
│   │                               pins timezone, applies chart defaults, init() + tick().
│   ├── core/
│   │   ├── format.js              Timezone-aware date helpers (luxon), formatters.
│   │   ├── data-service.js        now(), get.{...} endpoints, interval/aggregation logic.
│   │   ├── printed-patterns.js    Cached hatch / crosshatch / stipple CanvasPatterns.
│   │   └── chart-theme.js         COL/WD_COL from CSS vars, gridScale(), baseOpts(),
│   │                               applyChartDefaults() (disables animation safely).
│   └── components/
│       ├── base-figure.js         BaseFigure (sheet chrome: Fig.N + heading + note) and
│       │                           ChartFigure (manages <canvas> + Chart.js upsert).
│       ├── status-card.js         <door-status>      live lamp / since / streak
│       ├── kpi-grid.js            <door-kpis>        4 KPI cards + delta badges
│       ├── hero-chart.js          <door-hero>        Fig 1 — rolling open rate
│       ├── timeline-strip.js      <door-timeline>    Fig 2 — today 00:00–24:00
│       ├── hours-chart.js         <door-hours>       Fig 3 — hours open / day
│       ├── band-chart.js          <door-band>        Fig 4 — first-open→last-close band
│       ├── heatmap-grid.js        <door-heatmap>     Fig 5 — hour × weekday heatmap
│       ├── weekday-chart.js       <door-weekday>     Fig 6 — open % by weekday
│       ├── hour-chart.js          <door-hour>        Fig 7 — open % by hour
│       ├── hour-weekday-chart.js  <door-hour-weekday> Fig 8 — open % by hour, per weekday
│       └── event-log.js           <door-log>         Fig 9 — recent open/close events
├── gen_mock.py                    Regenerates js/mock-data.js fixture.
└── API_SPEC.md                    Endpoint contract the real backend must satisfy.
```

### Adding a figure

1. Create `js/components/my-figure.js` extending `BaseFigure` or `ChartFigure`;
   implement `update(payload)`.
2. Register it in `js/dashboard.js` (`customElements.define`) and add it to the
   fan-out in `init()` / `tick()`.
3. Drop `<door-my-figure fig="10" heading="…" note="…">` into `index.html`.

No styling lives in the component — colors come from `css/theme.css`, chrome from
`BaseFigure`.

---

## Running locally

ES modules must be served over HTTP (not `file://`):

```bash
cd door-dashboard-v2
python3 -m http.server 8088
# open http://localhost:8088
```

Ships with `USE_MOCK: true`, so it runs fully offline against `js/mock-data.js`.

---

## Connecting the real API

The mock → real swap is two edits in **`js/config.js`**:

```js
export const CONFIG = {
  API_BASE: "https://your-host/api",  // ← point at the real backend
  USE_MOCK: false,                    // ← stop using the bundled fixture
  POLL_MS: 15000,
  ROLLING_WINDOW_MIN: 90,
  TZ: "Europe/Berlin",
};
```

The backend must implement the endpoints documented in `API_SPEC.md`:

- 30-day raw **events** feed.
- Aggregated **daily / by-weekday / by-hour / heatmap / baseline** endpoints
  (these need >30 days of history, so they are computed server-side).
- A **semesters** endpoint providing semester/break timeframes — drives the
  semester-scoped comparisons.

Fig 8 reuses the existing `/aggregate/heatmap` matrix, so no new backend work is
needed for the per-weekday hourly view.

---

## Design notes

- **Printed-paper aesthetic:** ink palette, serif/mono labels, dashed gridlines, and
  hatch / crosshatch / stipple fills instead of flat color or neon. Patterns are
  generated once and cached as `CanvasPattern` tiles.
- **No chart animation:** disabled via `applyChartDefaults()` for instant, flicker-free
  polling updates. Tooltip opacity is preserved (the animation object is *not* wholesale
  replaced, which would make tooltips invisible).
- **Single source of truth for color:** `css/theme.css` custom properties are read by
  both the Tailwind config (in `index.html`) and Chart.js (`chart-theme.js`), so the
  whole dashboard recolors from one place.
