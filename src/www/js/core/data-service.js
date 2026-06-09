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

const M = () => window.DOOR_MOCK; // bundled mock payload (mock-data.js)

/* ── low-level fetch ────────────────────────────────────────────────────── */
async function api(path) {
   const r = await fetch(CONFIG.API_BASE + path, { headers: { Accept: "application/json" } });
   if (!r.ok) throw new Error(`${path} -> ${r.status}`);
   return r.json();
}

/* "Now" reference. Live mode = real wall clock. Mock mode = the mock's
 * generated_at, so the bundled events line up with the windows charts ask for. */
export function now() {
   if (CONFIG.USE_MOCK && M() && M().generated_at) return new Date(M().generated_at);
   return new Date();
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
   async status() {
      if (!CONFIG.USE_MOCK) return api("/status");
      const ev = (await get.events()).events;
      return computeStatusFromEvents(ev, now());
   },
};
// Returns [{ date, open_hours, period_id, first_open, last_close }, ...]
export function dailyStats(events) {
   const sorted = [...events]
      .map((e) => ({ ...e, timestamp: new Date(e.timestamp) }))
      .sort((a, b) => a.timestamp - b.timestamp);

   // Collect all dates that appear in the events
   const dates = [...new Set(sorted.map((e) => e.timestamp.toISOString().slice(0, 10)))];

   return dates.map((date) => {
      const dayStart = new Date(date + "T00:00:00");
      const dayEnd = new Date(date + "T24:00:00");
      const isToday = date === new Date().toISOString().slice(0, 10);
      const effectiveEnd = isToday ? new Date() : dayEnd;

      const carryIn = sorted.filter((e) => e.timestamp < dayStart).at(-1);
      const dayEvts = sorted.filter((e) => e.timestamp >= dayStart && e.timestamp < dayEnd);

      const anchors = [];
      if (carryIn) anchors.push({ timestamp: dayStart, status: carryIn.status });
      anchors.push(...dayEvts);

      let openMs = 0;
      let first_open = null;
      let last_close = null;

      for (let i = 0; i < anchors.length; i++) {
         const start = anchors[i].timestamp;
         const end = anchors[i + 1]?.timestamp ?? effectiveEnd;
         const status = anchors[i].status;

         if (status === "OPEN") {
            openMs += end - start;
            if (!first_open) first_open = start.toISOString();
            last_close = end.toISOString(); // updated each open segment
         }
      }

      return {
         date,
         open_hours: openMs / 3_600_000,
         period_id: "lecture",
         first_open, // ISO string or null if never opened
         last_close, // ISO string of when last open segment ended
      };
   });
}

// Returns [{ date: "2026-06-09", open_hours: 5.3 }, ...]
export function dailyOpenHours(events) {
   const map = new Map();

   const sorted = [...events]
      .map((e) => ({ ...e, timestamp: new Date(e.timestamp) }))
      .sort((a, b) => a.timestamp - b.timestamp);

   // Group events by date
   const byDate = new Map();
   for (const e of sorted) {
      const key = e.timestamp.toISOString().slice(0, 10);
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(e);
   }

   for (const [date, evts] of byDate) {
      const dayStart = new Date(date + "T00:00:00");
      const dayEnd = new Date(date + "T24:00:00");
      const isToday = date === new Date().toISOString().slice(0, 10);
      const effectiveEnd = isToday ? new Date() : dayEnd;

      // Build anchors same as todaySegments
      const allSorted = [...events]
         .map((e) => ({ ...e, timestamp: new Date(e.timestamp) }))
         .sort((a, b) => a.timestamp - b.timestamp);

      const carryIn = allSorted.filter((e) => e.timestamp < dayStart).at(-1);
      const dayEvts = allSorted.filter((e) => e.timestamp >= dayStart && e.timestamp < dayEnd);

      const anchors = [];
      if (carryIn) anchors.push({ timestamp: dayStart, status: carryIn.status });
      anchors.push(...dayEvts);

      let openMs = 0;
      for (let i = 0; i < anchors.length; i++) {
         if (anchors[i].status !== "OPEN") continue;
         const start = anchors[i].timestamp;
         const end = anchors[i + 1]?.timestamp ?? effectiveEnd;
         openMs += end - start;
      }

      map.set(date, openMs / 3_600_000);
   }

   return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, open_hours]) => ({ date, open_hours, period_id: "lecture" }));
}

/* ── interval helpers ───────────────────────────────────────────────────── */
/* Turn change-events into [{start,end,status}]; last interval runs to `until`. */
export function intervals(events, until) {
   const out = [];
   for (let i = 0; i < events.length; i++) {
      const start = events[i].timestamp;
      const end = i + 1 < events.length ? events[i + 1].timestamp : until;
      out.push({ start, end, status: events[i].status });
   }
   return out;
}

/* ── live status snapshot (mock mode) ───────────────────────────────────── */
export function computeStatusFromEvents(events, ref) {
   if (!events.length) return null;

   // current = last event at/before now
   let cur = events[0];
   for (const e of events) {
      if (new Date(e.event_time) <= ref) cur = e;
      else break;
   }
   const since = new Date(cur.event_time);

   // first open today + accumulated open seconds today (door-zone day)
   const dayStart = dayStartMs(ref);
   const nowMs = ref.getTime();
   const ints = intervals(events, ref);
   let firstOpen = null,
      openSec = 0;
   for (const it of ints) {
      const sMs = it.start.getTime(),
         eMs = it.end.getTime();
      if (eMs <= dayStart || sMs >= nowMs) continue;
      const s = Math.max(sMs, dayStart),
         e = Math.min(eMs, nowMs);
      if (e <= s) continue;
      if (it.status === "open") {
         if (!firstOpen) firstOpen = new Date(s);
         openSec += (e - s) / 1000;
      }
   }

   // opening streak: consecutive door-zone days (incl. today) with >=1 open
   const dayHasOpen = {};
   for (const it of ints) {
      if (it.status === "open") dayHasOpen[isoDay(it.start.getTime())] = true;
   }
   let streak = 0,
      probeMs = dayStart;
   if (!dayHasOpen[isoDay(probeMs)]) probeMs -= 86400e3; // not opened yet today
   while (dayHasOpen[isoDay(probeMs)]) {
      streak++;
      probeMs -= 86400e3;
   }

   return {
      status: cur.status,
      since: since.toISOString(),
      server_time: ref.toISOString(),
      first_open_today: firstOpen ? firstOpen.toISOString() : null,
      open_streak_days: streak,
      open_seconds_today: Math.round(openSec),
   };
}

/* ── rolling open-rate series (Fig. 1 hero) ─────────────────────────────── */
/* Sample the last `hoursBack` hours every `stepMin`; each point = % of the
 * trailing `windowMin` that was open (open ÷ known-status minutes). */
export function rollingOpenRate(events, ref, hoursBack, windowMin, stepMin) {
   const ints = intervals(events, ref);
   const start = new Date(ref.getTime() - hoursBack * 3600e3);
   const pts = [];
   const stepMs = stepMin * 60e3,
      winMs = windowMin * 60e3;
   for (let t = start.getTime(); t <= ref.getTime(); t += stepMs) {
      const wEnd = t,
         wStart = t - winMs;
      let openMs = 0,
         totMs = 0;
      for (const it of ints) {
         const s = Math.max(it.start.getTime(), wStart);
         const e = Math.min(it.end.getTime(), wEnd);
         if (e <= s || it.status === "unknown") continue;
         totMs += e - s;
         if (it.status === "open") openMs += e - s;
      }
      pts.push({ t: new Date(t), pct: totMs > 0 ? (openMs / totMs) * 100 : null });
   }
   return pts;
}

/* ── today's 24h timeline segments (door-zone day) ──────────────────────── */
export function todaySegments(events, ref) {
   const dayStart = dayStartMs(ref);
   const dayEnd = dayStart + 24 * 3600e3;
   const ints = intervals(events, ref);
   const segs = [];
   for (const it of ints) {
      const sMs = Math.max(it.start.getTime(), dayStart);
      const eMs = Math.min(it.end.getTime(), dayEnd);
      if (eMs <= sMs) continue;
      segs.push({
         startFrac: (sMs - dayStart) / (24 * 3600e3),
         endFrac: (eMs - dayStart) / (24 * 3600e3),
         status: it.status,
      });
   }
   return segs;
}

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
