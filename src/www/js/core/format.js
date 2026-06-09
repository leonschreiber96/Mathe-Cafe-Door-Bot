/* core/format.js — timezone-aware formatting + weekday constants.
 * Pure functions only — no DOM, no fetching.
 */
import { CONFIG } from "../config.js";

const ZONE = CONFIG.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

export const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const WEEKDAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = [
   "January",
   "February",
   "March",
   "April",
   "May",
   "June",
   "July",
   "August",
   "September",
   "October",
   "November",
   "December",
];

/* ── zone helpers ───────────────────────────────────────────────────────── */

/* Returns the individual date/time parts of a timestamp in the door zone. */
function zoneParts(d) {
   const ms = d instanceof Date ? d.getTime() : new Date(d).getTime();
   const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
   }).formatToParts(ms);
   const get = (type) => Number(parts.find((p) => p.type === type)?.value);
   return {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour: get("hour"),
      minute: get("minute"),
      second: get("second"),
   };
}

/* Start-of-day in the door zone, as epoch ms. */
export function dayStartMs(d) {
   const { year, month, day } = zoneParts(d);
   return new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00`).getTime();
}

/* Weekday in door zone, Mon=0 … Sun=6. */
export function zonedWeekday(d) {
   const ms = d instanceof Date ? d.getTime() : new Date(d).getTime();
   // getDay() on a UTC-midnight date derived from the zoned ISO date
   const { year, month, day } = zoneParts(ms);
   const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun
   return (jsDay + 6) % 7;
}

/* Hour-of-day as a float (e.g. 13.5) in door zone. */
export function zonedHourFloat(d) {
   const { hour, minute } = zoneParts(d);
   return hour + minute / 60;
}

/* ISO date string (YYYY-MM-DD) for an epoch-ms instant, in door zone. */
export function isoDay(ms) {
   const { year, month, day } = zoneParts(ms);
   return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/* ── display formatters ─────────────────────────────────────────────────── */

export const fmtTime = (d) =>
   new Intl.DateTimeFormat([], {
      timeZone: ZONE,
      hour: "2-digit",
      minute: "2-digit",
   }).format(new Date(d));

export const fmtDateTime = (d) =>
   new Intl.DateTimeFormat([], {
      timeZone: ZONE,
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
   }).format(new Date(d));

export const fmtDur = (sec) => {
   const h = Math.floor(sec / 3600);
   const m = Math.floor((sec % 3600) / 60);
   return `${h}h ${String(m).padStart(2, "0")}m`;
};

export const minToHHMM = (min) => {
   if (min == null) return "—";
   const h = Math.floor(min / 60);
   const m = Math.round(min % 60);
   return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
