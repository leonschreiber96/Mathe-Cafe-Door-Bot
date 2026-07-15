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
import { CalendarHeatmap } from "./components/calendar-heatmap.js";
import { HeatmapGrid } from "./components/heatmap-grid.js";
import { WeekdayChart } from "./components/weekday-chart.js";
import { HourChart } from "./components/hour-chart.js";
import { HourWeekdayChart } from "./components/hour-weekday-chart.js";
import { ShiftAdherence } from "./components/shift-adherence.js";
import { FirstOpenChart } from "./components/first-open-chart.js";
import { SessionLengthChart } from "./components/session-length-chart.js";
import { SessionRetentionChart } from "./components/session-retention-chart.js";
import { EventLog } from "./components/event-log.js";

import { WEEKDAYS_LONG, MONTHS_LONG } from "./core/format.js";

/* ── register custom elements ───────────────────────────────────────────── */
const ELEMENTS = {
   "door-status": StatusCard,
   "door-timeline": TimelineStrip,
   "door-hours": HoursChart,
   "door-calendar": CalendarHeatmap,
   "door-heatmap": HeatmapGrid,
   "door-weekday": WeekdayChart,
   "door-hour": HourChart,
   "door-hour-weekday": HourWeekdayChart,
   "door-shift-adherence": ShiftAdherence,
   "door-first-open": FirstOpenChart,
   "door-session": SessionLengthChart,
   "door-retention": SessionRetentionChart,
   "door-log": EventLog,
};
for (const [tag, cls] of Object.entries(ELEMENTS)) {
   if (!customElements.get(tag)) customElements.define(tag, cls);
}

/* ── time-travel helpers ────────────────────────────────────────────────── */
const todayStr = () => new Date().toLocaleDateString("sv");
const dateParam = () => new URLSearchParams(location.search).get("date");
const shiftDate = (yyyymmdd, delta) => {
   const d = new Date(yyyymmdd + "T12:00:00");
   d.setDate(d.getDate() + delta);
   return d.toLocaleDateString("sv");
};

/* ── fetch + dispatch ───────────────────────────────────────────────────── */
async function fetchAndDispatch() {
   const date = dateParam();
   const url = date ? `${CONFIG.API_BASE}?date=${encodeURIComponent(date)}` : CONFIG.API_BASE;
   const r = await fetch(url);
   if (!r.ok) throw new Error(`Dashboard fetch failed: ${r.status}`);
   const data = await r.json();

   data.openEvents30Days = data.openEvents30Days
      .map((x) => ({ timestamp: new Date(x.timestamp), status: x.status }))
      .sort((a, b) => b.timestamp - a.timestamp);

   if (data.currentStatus) data.currentStatus.timestamp = new Date(data.currentStatus.timestamp);

   window.fullData = data;
   window.dispatchEvent(new CustomEvent("door:data", { detail: data }));

   // Heading reflects the reference day (today, or the ?date= we're viewing).
   const ref = new Date(data.asOf);
   document.getElementById("date-heading").innerHTML =
      `${WEEKDAYS_LONG[(ref.getDay() + 6) % 7]}, ${ref.getDate()}. ${MONTHS_LONG[ref.getMonth()]} ${ref.getFullYear()}`;
   document.getElementById("semester-heading").innerHTML = data.currentPeriod.label;

   // Figure headings say "(Current Period)" for today, but name the actual period
   // when looking back (it's no longer "current").
   const periodText = data.isToday === false ? data.currentPeriod.label : "Current Period";
   document.querySelectorAll('[heading*="(Current Period)"]').forEach((el) => {
      const h2 = el.querySelector("h2");
      if (h2) h2.textContent = el.getAttribute("heading").replace("(Current Period)", `(${periodText})`);
   });
}

/* ── day navigation ─────────────────────────────────────────────────────── */
function setupNav() {
   const refStr = dateParam() || todayStr();
   const isHistorical = refStr < todayStr();

   const go = (dateStr) => {
      location.search = dateStr >= todayStr() ? "" : `?date=${dateStr}`;
   };

   document.getElementById("prev-day").onclick = () => go(shiftDate(refStr, -1));

   const next = document.getElementById("next-day");
   next.onclick = () => go(shiftDate(refStr, +1));
   next.disabled = !isHistorical; // can't travel past today
   next.classList.toggle("opacity-30", !isHistorical);
   next.classList.toggle("pointer-events-none", !isHistorical);

   document.getElementById("today-link").classList.toggle("hidden", !isHistorical);
}

/* ── boot ───────────────────────────────────────────────────────────────── */
async function init() {
   applyChartDefaults();
   setupNav();

   fetchAndDispatch().catch(console.error);
   // Only live-poll today's view; historical snapshots don't change.
   if (!dateParam() || dateParam() === todayStr()) {
      setInterval(() => fetchAndDispatch().catch(console.error), CONFIG.POLL_MS);
   }
}

if (document.readyState === "loading") {
   document.addEventListener("DOMContentLoaded", init);
} else {
   init();
}
