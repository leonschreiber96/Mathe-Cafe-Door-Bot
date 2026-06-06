// Dev-only seed script: generates ~30 days of realistic door events into the
// SQLite DB so the dashboard can be developed/tested without a live sensor.
// Usage: node seed-dev.mjs   (requires Node 22+ for node:sqlite)
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";

mkdirSync("data", { recursive: true });
const db = new DatabaseSync("data/mathe-cafe.db");
db.exec(`PRAGMA journal_mode = WAL`);
db.exec(`
   CREATE TABLE IF NOT EXISTS door_status (
      inserted_at TEXT PRIMARY KEY,
      status      TEXT NOT NULL,
      event_time  TEXT NOT NULL
   );
`);
db.exec(`DELETE FROM door_status`);

const insert = db.prepare(
   "INSERT OR IGNORE INTO door_status (inserted_at, status, event_time) VALUES (?, ?, ?)",
);

// Deterministic PRNG so the seed is reproducible.
let s = 1234567;
const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const jitter = (base, spread) => base + (rand() - 0.5) * spread;

const events = [];
const push = (status, d) => events.push({ status, t: new Date(d) });

const now = new Date();
const today = new Date(now);
today.setHours(0, 0, 0, 0);

for (let i = 29; i >= 0; i--) {
   const day = new Date(today);
   day.setDate(day.getDate() - i);
   const dow = day.getDay();

   // Skip a few days entirely to break the streak / create gaps.
   if ((i === 18 || i === 19 || i === 26) && dow !== 0) {
      // closed all day -> no OPEN events
   }

   // Most days: one or two open windows.
   const openHour = jitter(dow === 6 || dow === 0 ? 11 : 9, 1.5); // weekends open later
   const firstOpen = new Date(day);
   firstOpen.setHours(Math.floor(openHour), Math.floor((openHour % 1) * 60), 0, 0);

   // Some days closed (weekends sometimes, plus the gap days above).
   const closedDay =
      i === 18 || i === 19 || i === 26 || (dow === 0 && rand() < 0.7);
   if (closedDay) {
      push("CLOSED", new Date(day.getTime() + 8 * 3600e3));
      continue;
   }

   push("OPEN", firstOpen);

   // Optional midday close/reopen (lunch) on ~40% of days.
   if (rand() < 0.4) {
      const lunchStart = new Date(firstOpen.getTime() + jitter(3.5, 1) * 3600e3);
      push("CLOSED", lunchStart);
      push("OPEN", new Date(lunchStart.getTime() + jitter(0.75, 0.5) * 3600e3));
   }

   // Close in the evening. Total open duration ~7-15h.
   const openDuration = jitter(10, 6) * 3600e3;
   let closeTime = new Date(firstOpen.getTime() + openDuration);
   // For "today", don't close in the future — leave it open if close would be future.
   if (i === 0 && closeTime.getTime() > now.getTime()) {
      // leave open (no closing event today yet)
   } else {
      push("CLOSED", closeTime);
   }

   // Rare sensor blip -> OFFLINE then recovery (adds realism to event log).
   if (rand() < 0.12) {
      const blip = new Date(firstOpen.getTime() + jitter(2, 1) * 3600e3);
      push("OFFLINE", blip);
      push("OPEN", new Date(blip.getTime() + jitter(0.2, 0.1) * 3600e3));
   }
}

// Sort by time and collapse consecutive duplicate statuses (DB only stores transitions).
events.sort((a, b) => a.t - b.t);
let last = null;
let insertedAtBase = events.length ? events[0].t.getTime() : Date.now();
let n = 0;
for (const e of events) {
   if (e.status === last) continue;
   last = e.status;
   // inserted_at just needs to be unique & monotonic; use event time + tiny offset.
   const insertedAt = new Date(e.t.getTime() + n * 1000).toISOString();
   insert.run(insertedAt, e.status, e.t.toISOString());
   n++;
}

const count = db.prepare("SELECT COUNT(*) AS c FROM door_status").get().c;
const lastRow = db
   .prepare("SELECT status, event_time FROM door_status ORDER BY event_time DESC LIMIT 1")
   .get();
console.log(`Seeded ${count} transition events. Last: ${lastRow.status} @ ${lastRow.event_time}`);
db.close();
