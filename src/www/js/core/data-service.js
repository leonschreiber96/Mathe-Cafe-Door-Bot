/* core/data-service.js — the data layer.
 *
 * Two responsibilities, no DOM:
 *   1. Async getters that return the same shape whether in mock or live mode.
 *      (mock mode reads window.DOOR_MOCK; live mode fetches CONFIG.API_BASE.)
 *   2. Pure compute helpers that turn raw door events into the derived series
 *      the figures need (status snapshot, rolling open-rate, today segments,
 *      KPI deltas) — all scoped to the door's timezone and the active period.
 *
 * Swap CONFIG.USE_MOCK to false (and set API_BASE) to hit a real backend; the
 * component layer doesn't change.
 */
import { CONFIG } from "../config.js";
import { dayStartMs, isoDay, zonedWeekday, zonedHourFloat } from "./format.js";

/* ── low-level fetch ────────────────────────────────────────────────────── */
async function api(path) {
   const r = await fetch(CONFIG.API_BASE + path, { headers: { Accept: "application/json" } });
   if (!r.ok) throw new Error(`${path} -> ${r.status}`);
   return r.json();
}

/* ── endpoint getters (mock | live) ─────────────────────────────────────── */
export const get = {
   semesters: () => (CONFIG.USE_MOCK ? M().semesters : api("/semesters")),
   events: () => (CONFIG.USE_MOCK ? M().events : api("/events?days=30")),
   daily: () => (CONFIG.USE_MOCK ? M().daily : api("/aggregate/daily?days=30")),
   byWeekday: (pid) => (CONFIG.USE_MOCK ? M().by_weekday : api("/aggregate/by-weekday?period_id=" + pid)),
   byHour: (pid) => (CONFIG.USE_MOCK ? M().by_hour : api("/aggregate/by-hour?period_id=" + pid)),
   heatmap: (pid) => (CONFIG.USE_MOCK ? M().heatmap : api("/aggregate/heatmap?period_id=" + pid)),
   baseline: (pid) => (CONFIG.USE_MOCK ? M().baseline : api("/aggregate/baseline?period_id=" + pid)),
};

/* fraction of the door-zone day elapsed at `ref` (for the now-line) */
export function nowFracOfDay(ref) {
   return (ref.getTime() - dayStartMs(ref)) / (24 * 3600e3);
}

/* ── KPI deltas vs. the current-period baseline ─────────────────────────── */
/* All comparisons are scoped to the CURRENT period via the baseline endpoint —
 * never across semester/break boundaries. */
export function todayVsBaseline(status, baseline, ref) {
   const wd = zonedWeekday(ref); // Mon=0, door zone
   const out = {};

   // Open hours today vs usual this-weekday-this-period. Fair mid-day comparison:
   // compare against the usual open-hours accrued BY THIS TIME (interpolated
   // cumulative curve), not the whole day.
   const openHoursToday = (status?.open_seconds_today || 0) / 3600;
   const fullDayUsual = baseline?.by_weekday_avg_open_hours?.[wd];
   const cum = baseline?.by_weekday_cum_open_hours?.[wd]; // 25 values, idx 0..24
   if (cum && cum.length === 25) {
      const hoursNow = zonedHourFloat(ref);
      const i = Math.floor(hoursNow),
         frac = hoursNow - i;
      const usualByNow = cum[i] + (cum[Math.min(24, i + 1)] - cum[i]) * frac;
      out.openHours = {
         value: openHoursToday,
         baseline: usualByNow,
         fullDayBaseline: fullDayUsual,
         deltaPct: usualByNow > 0.1 ? ((openHoursToday - usualByNow) / usualByNow) * 100 : 0,
         byNow: true,
      };
   } else if (fullDayUsual != null && fullDayUsual > 0) {
      out.openHours = {
         value: openHoursToday,
         baseline: fullDayUsual,
         deltaPct: ((openHoursToday - fullDayUsual) / fullDayUsual) * 100,
         byNow: false,
      };
   }

   // First-open today vs usual (minutes after midnight, door zone). + = later.
   if (status?.first_open_today && baseline?.by_weekday_first_open_min?.[wd] != null) {
      const foMin = Math.round(zonedHourFloat(status.first_open_today) * 60);
      const usualMin = baseline.by_weekday_first_open_min[wd];
      out.firstOpen = {
         value: foMin,
         baseline: usualMin,
         deltaMin: foMin - usualMin,
         deltaPct: usualMin > 0 ? ((foMin - usualMin) / usualMin) * 100 : 0,
      };
   }
   return out;
}
