/* dashboard.js — the orchestrator (entry point).
 *
 * 1. Registers every custom element.
 * 2. Pins the timezone + Chart.js defaults.
 * 3. On boot: loads the current period + all aggregates once, fans the data
 *    out to the matching component via its imperative update().
 * 4. Polls the cheap live bits (status / hero / timeline / KPIs) every
 *    CONFIG.POLL_MS without touching the heavier historical charts.
 *
 * Components are dumb renderers; this file is the only place that knows the
 * data flow and the refresh cadence.
 */
import { CONFIG } from "./config.js";
import { pinTimezone, fmtTime } from "./core/format.js";
import { applyChartDefaults } from "./core/chart-theme.js";
import { get, now } from "./core/data-service.js";

import { StatusCard } from "./components/status-card.js";
import { TimelineStrip } from "./components/timeline-strip.js";
import { HoursChart } from "./components/hours-chart.js";
import { BandChart } from "./components/band-chart.js";
import { HeatmapGrid } from "./components/heatmap-grid.js";
import { WeekdayChart } from "./components/weekday-chart.js";
import { HourChart } from "./components/hour-chart.js";
import { HourWeekdayChart } from "./components/hour-weekday-chart.js";
import { EventLog } from "./components/event-log.js";

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

const $ = (sel) => document.querySelector(sel);
const el = (tag) => $(tag); // a component is reachable by its tag name (one each)

/* boot cache: baseline + daily are needed by the per-poll KPI refresh */
const boot = {};
let periods = null;

/* ── live tick: cheap, frequent ─────────────────────────────────────────── */
async function tick() {
   try {
      const [st, ev] = await Promise.all([get.status(), get.events()]);
      el("door-status").update(st);
      el("door-hero").update(ev.events);
      el("door-timeline").update(ev.events);
      $("#liveLabel").textContent = "live · " + fmtTime(now());
   } catch (e) {
      console.error(e);
      $("#liveLabel").textContent = "offline";
   }
}

/* ── boot: load everything once, render all figures ─────────────────────── */
async function init() {
   pinTimezone();
   applyChartDefaults();

   try {
      const sem = await get.semesters();
      periods = sem.periods;
      const pid = sem.current_period_id;
      const cp = periods.find((p) => p.id === pid);
      const periodLabel = cp ? cp.label : pid;
      $("#periodPill").innerHTML =
         `<span class="text-inkfaint">period</span> <b class="text-open font-semibold">${periodLabel}</b>`;
      el("door-heatmap").setNote(periodLabel);

      const [ev, daily, byWd, byHr, heat, baseline] = await Promise.all([
         get.events(),
         get.daily(),
         get.byWeekday(pid),
         get.byHour(pid),
         get.heatmap(pid),
         get.baseline(pid),
      ]);
      boot.daily = daily;
      boot.baseline = baseline;

      const st = await get.status();
      el("door-status").update(st);
      el("door-hero").update(ev.events);
      el("door-timeline").update(ev.events);
      el("door-hours").update({ daily, periods });
      el("door-band").update(daily);
      el("door-weekday").update(byWd);
      el("door-hour").update(byHr);
      el("door-heatmap").update(heat);
      el("door-hour-weekday").update(heat);
      el("door-log").update(ev.events);

      const stamp = window.DOOR_MOCK?.generated_at || now();
      $("#genStamp").textContent = "data generated " + new Date(stamp).toLocaleString();
      $("#liveLabel").textContent = "live · " + fmtTime(now());
   } catch (e) {
      console.error("init failed", e);
      $("#liveLabel").textContent = "load error";
   }

   setInterval(tick, CONFIG.POLL_MS);
}

if (document.readyState === "loading") {
   document.addEventListener("DOMContentLoaded", init);
} else {
   init();
}
