/* dashboard.js — orchestrator / entry point.
 *
 * 1. Registers every custom element.
 * 2. Pins the timezone + Chart.js defaults.
 * 3. Fetches the full dashboard payload from CONFIG.API_BASE on boot and on
 *    every CONFIG.POLL_MS interval, then fans it out via the door:data event.
 *
 * Components are dumb renderers; this file owns the data flow and refresh cadence.
 */
import { CONFIG } from "./config.js";
import { applyChartDefaults } from "./core/chart-theme.js";

import { StatusCard } from "./components/status-card.js";
import { TimelineStrip } from "./components/timeline-strip.js";
import { HoursChart } from "./components/hours-chart.js";
import { BandChart } from "./components/band-chart.js";
import { HeatmapGrid } from "./components/heatmap-grid.js";
import { WeekdayChart } from "./components/weekday-chart.js";
import { HourChart } from "./components/hour-chart.js";
import { HourWeekdayChart } from "./components/hour-weekday-chart.js";
import { EventLog } from "./components/event-log.js";

import { WEEKDAYS_LONG, MONTHS_LONG } from "./core/format.js";

/* ── register custom elements ───────────────────────────────────────────── */
const ELEMENTS = {
   "door-status": StatusCard,
   "door-timeline": TimelineStrip,
   "door-hours": HoursChart,
   "door-band": BandChart,
   "door-heatmap": HeatmapGrid,
   "door-weekday": WeekdayChart,
   "door-hour": HourChart,
   "door-hour-weekday": HourWeekdayChart,
   "door-log": EventLog,
};
for (const [tag, cls] of Object.entries(ELEMENTS)) {
   if (!customElements.get(tag)) customElements.define(tag, cls);
}

/* ── fetch + dispatch ───────────────────────────────────────────────────── */
async function fetchAndDispatch() {
   const r = await fetch(CONFIG.API_BASE);
   if (!r.ok) throw new Error(`Dashboard fetch failed: ${r.status}`);
   const data = await r.json();

   data.openEvents30Days = data.openEvents30Days
      .map((x) => ({ timestamp: new Date(x.timestamp), status: x.status }))
      .sort((a, b) => b.timestamp - a.timestamp);

   window.fullData = data;
   window.dispatchEvent(new CustomEvent("door:data", { detail: data }));

   const today = new Date();
   document.getElementById("date-heading").innerHTML =
      `${WEEKDAYS_LONG[today.getDay()]}, ${today.getDate()}. ${MONTHS_LONG[today.getMonth()]} ${today.getFullYear()}`;
   document.getElementById("semester-heading").innerHTML = data.currentPeriod.label;
}

/* ── boot ───────────────────────────────────────────────────────────────── */
async function init() {
   applyChartDefaults();

   fetchAndDispatch().catch(console.error);
   setInterval(() => fetchAndDispatch().catch(console.error), CONFIG.POLL_MS);
}

if (document.readyState === "loading") {
   document.addEventListener("DOMContentLoaded", init);
} else {
   init();
}
