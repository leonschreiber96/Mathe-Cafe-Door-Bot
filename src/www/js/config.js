/* config.js — edit this once to point the dashboard at your real backend.
 *
 * This is an ES module: everything else imports { CONFIG } from here.
 */
export const CONFIG = {
   API_BASE: "/mathe-door-dashboard/api/dashboard", // your backend, e.g. "https://door.example.org/api"
   POLL_MS: 15000, // live refresh interval (ms)
   TZ: "Europe/Berlin", // the door's timezone. All day-boundaries, weekday and
   // hour-of-day maths use this zone (not the viewer's),
   // so the dashboard reads identically anywhere.
};
