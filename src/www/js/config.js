/* config.js — edit this once to point the dashboard at your real backend.
 *
 * This is an ES module: everything else imports { CONFIG } from here.
 */
export const CONFIG = {
   API_BASE: "/api", // your backend, e.g. "https://door.example.org/api"
   POLL_MS: 15000, // live refresh interval (ms)
   USE_MOCK: false, // true = use bundled js/mock-data.js; false = fetch API_BASE
   ROLLING_WINDOW_MIN: 90, // window for the rolling open-rate hero line (Fig. 1)
   TZ: "Europe/Berlin", // the door's timezone. All day-boundaries, weekday and
   // hour-of-day maths use this zone (not the viewer's),
   // so the dashboard reads identically anywhere.
};
