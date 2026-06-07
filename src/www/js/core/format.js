/* core/format.js — timezone-aware formatting + weekday constants.
 *
 * All clock/date formatting is rendered in the DOOR's timezone (CONFIG.TZ) so
 * the dashboard reads identically regardless of the viewer's browser zone.
 * Pure functions only — no DOM, no fetching.
 */
import { CONFIG } from "../config.js";

const luxon = window.luxon; // UMD global from the CDN
const DT = luxon ? luxon.DateTime : null;
const ZONE = CONFIG.TZ || "local";

export const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const WD_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/* Date | iso | DateTime -> luxon DateTime pinned to the door zone. */
export function zoned(d) {
   if (DT && d && d.isLuxonDateTime) return d.setZone(ZONE);
   const ms = d instanceof Date ? d.getTime() : new Date(d).getTime();
   return DT ? DT.fromMillis(ms, { zone: ZONE }) : null;
}

/* start-of-day in the door zone, as epoch ms */
export function dayStartMs(d) {
   if (!DT) {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return x.getTime();
   }
   return zoned(d).startOf("day").toMillis();
}

/* weekday in door zone, Mon=0 … Sun=6 */
export function zonedWeekday(d) {
   return DT ? zoned(d).weekday - 1 : (new Date(d).getDay() + 6) % 7;
}

/* hour-of-day as a float (e.g. 13.5) in door zone */
export function zonedHourFloat(d) {
   const z = zoned(d);
   return DT ? z.hour + z.minute / 60 : new Date(d).getHours() + new Date(d).getMinutes() / 60;
}

/* ISO date string (YYYY-MM-DD) for an epoch-ms instant, in door zone */
export function isoDay(ms) {
   return DT ? DT.fromMillis(ms, { zone: ZONE }).toISODate() : new Date(ms).toISOString().slice(0, 10);
}

/* ── display formatters ─────────────────────────────────────────────────── */

export const fmtTime = (d) =>
   DT
      ? zoned(d).toLocaleString(luxon.DateTime.TIME_SIMPLE)
      : new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export const fmtDateTime = (d) =>
   DT
      ? zoned(d).toFormat("LLL dd, HH:mm")
      : new Date(d).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export const fmtDur = (sec) => {
   const h = Math.floor(sec / 3600),
      m = Math.floor((sec % 3600) / 60);
   return `${h}h ${String(m).padStart(2, "0")}m`;
};

export const minToHHMM = (min) => {
   if (min == null) return "—";
   const h = Math.floor(min / 60),
      m = Math.round(min % 60);
   return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

/* Pin luxon's default zone once, so Chart.js time axes + tooltips agree. */
export function pinTimezone() {
   if (DT && CONFIG.TZ) luxon.Settings.defaultZone = CONFIG.TZ;
}
