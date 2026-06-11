import { DatabaseSync } from "node:sqlite";
import { DoorStatus } from "./doorService.js";

const db = new DatabaseSync("src/data/mathe-cafe.db");
db.exec(`PRAGMA journal_mode = WAL`);

db.exec(`
  CREATE TABLE IF NOT EXISTS subscribers (
    id                INTEGER PRIMARY KEY,
    chat_id           INTEGER NOT NULL UNIQUE,
    username          TEXT NOT NULL,
    subscription_date TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS door_status (
    inserted_at TEXT PRIMARY KEY,
    status      TEXT NOT NULL,
    event_time  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS logs (
    timestamp TEXT PRIMARY KEY,
    level     TEXT NOT NULL,
    message   TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
  CREATE INDEX IF NOT EXISTS idx_door_status_event_time ON door_status(event_time);
`);

type ApiDoorStatus = "open" | "closed" | "unknown";
type PeriodType = "lecture" | "break" | "exam";

type SemesterPeriod = {
   id: string;
   type: PeriodType;
   label: string;
   from: string; // YYYY-MM-DD inclusive
   to: string; // YYYY-MM-DD inclusive
};

type EventWithNext = {
   status: ApiDoorStatus;
   event_time: string;
   next_event_time: string | null;
};

const SEMESTER_PERIODS: SemesterPeriod[] = [
   { id: "ws25-lecture", type: "lecture", label: "WS 2025/26", from: "2025-10-13", to: "2026-02-14" },
   { id: "ws25-break", type: "break", label: "Winter Break", from: "2026-02-15", to: "2026-04-12" },
   { id: "ss26-lecture", type: "lecture", label: "SS 2026", from: "2026-04-13", to: "2026-07-18" },
];

/* ── helpers ────────────────────────────────────────────────────────────── */

function denormalizeStatus(status: DoorStatus): string {
   return String(status).toUpperCase();
}

function dateKeyLocal(date: Date): string {
   return date.toLocaleDateString("sv"); // YYYY-MM-DD in local time
}

function startOfLocalDay(date: Date): Date {
   const d = new Date(date);
   d.setHours(0, 0, 0, 0);
   return d;
}

function endOfLocalDay(date: Date): Date {
   const d = startOfLocalDay(date);
   d.setDate(d.getDate() + 1);
   return d;
}

function addDays(date: Date, days: number): Date {
   const d = new Date(date);
   d.setDate(d.getDate() + days);
   return d;
}

function weekdayMon0(date: Date): number {
   return (date.getDay() + 6) % 7;
}

function findPeriodForDate(date: Date): SemesterPeriod | null {
   return (
      SEMESTER_PERIODS.find((p) => {
         const start = new Date(p.from + "T00:00:00");
         const end = new Date(p.to + "T00:00:00");
         end.setDate(end.getDate() + 1);
         return date >= start && date < end;
      }) ?? null
   );
}

function getAllEventsWithNext(): EventWithNext[] {
   return db
      .prepare(
         `
    SELECT
      LOWER(status) AS status,
      event_time,
      LEAD(event_time) OVER (ORDER BY event_time) AS next_event_time
    FROM door_status
    ORDER BY event_time ASC
  `,
      )
      .all() as EventWithNext[];
}

/* ── dashboard aggregate ────────────────────────────────────────────────── */

function buildDashboardData() {
   const now = new Date();
   const currentPeriod = findPeriodForDate(now);

   const currentStatusRow = db
      .prepare(
         `
    SELECT
      UPPER(status) AS status,
      event_time AS timestamp
    FROM door_status
    ORDER BY inserted_at DESC
    LIMIT 1
  `,
      )
      .get() as { status: string; timestamp: string } | undefined;

   // ── openEvents30Days ──────────────────────────────────────────────────
   const eventRows = db
      .prepare(
         `
    SELECT UPPER(status) AS status, event_time AS timestamp
    FROM door_status
    WHERE event_time >= datetime('now', '-30 days')
    ORDER BY event_time DESC
  `,
      )
      .all() as { status: string; timestamp: string }[];

   // ── openingStreak ─────────────────────────────────────────────────────
   const allRows = getAllEventsWithNext();
   const openByDay = new Set<string>();

   for (const row of allRows) {
      if (row.status !== "open") continue;
      const start = new Date(row.event_time);
      const end = row.next_event_time ? new Date(row.next_event_time) : now;
      let cursor = new Date(start);
      while (cursor < end) {
         openByDay.add(dateKeyLocal(cursor));
         cursor = endOfLocalDay(cursor);
      }
   }

   let openingStreak = 0;
   for (let i = 0; i < 365; i++) {
      if (openByDay.has(dateKeyLocal(addDays(now, -i)))) openingStreak++;
      else break;
   }

   // ── period slices (heatmap / by-weekday / by-hour) ────────────────────
   const periodStart = currentPeriod ? new Date(currentPeriod.from + "T00:00:00") : addDays(startOfLocalDay(now), -90);
   const periodEnd = new Date(
      Math.min(
         currentPeriod
            ? new Date(currentPeriod.to + "T00:00:00").setDate(new Date(currentPeriod.to + "T00:00:00").getDate() + 1)
            : Infinity,
         now.getTime(),
      ),
   );

   const openMs7x24 = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
   const knownMs7x24 = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
   const openMsWd = Array<number>(7).fill(0);
   const knownMsWd = Array<number>(7).fill(0);
   const openMsHr = Array<number>(24).fill(0);
   const knownMsHr = Array<number>(24).fill(0);

   for (const row of allRows) {
      const rStart = new Date(row.event_time);
      const rEnd = row.next_event_time ? new Date(row.next_event_time) : now;

      // clamp to period
      const s = new Date(Math.max(rStart.getTime(), periodStart.getTime()));
      const e = new Date(Math.min(rEnd.getTime(), periodEnd.getTime()));
      if (e <= s) continue;

      let cursor = new Date(s);
      while (cursor < e) {
         // advance to next hour or day boundary, whichever is sooner
         const nextHour = new Date(cursor);
         nextHour.setMinutes(0, 0, 0);
         nextHour.setHours(nextHour.getHours() + 1);
         const nextDay = endOfLocalDay(cursor);
         const sliceEnd = new Date(Math.min(e.getTime(), nextHour.getTime(), nextDay.getTime()));
         const ms = sliceEnd.getTime() - cursor.getTime();
         const wd = weekdayMon0(cursor);
         const hr = cursor.getHours();

         if (row.status !== "unknown") {
            knownMs7x24[wd][hr] += ms;
            knownMsWd[wd] += ms;
            knownMsHr[hr] += ms;
         }
         if (row.status === "open") {
            openMs7x24[wd][hr] += ms;
            openMsWd[wd] += ms;
            openMsHr[hr] += ms;
         }

         cursor = sliceEnd;
      }
   }

   const pct = (open: number, known: number) => (known > 0 ? Math.round((open / known) * 100) : 0);

   const openingHeatmap = openMs7x24.map((row, wd) => row.map((ms, hr) => pct(ms, knownMs7x24[wd][hr])));
   const openByWeekday = openMsWd.map((ms, wd) => pct(ms, knownMsWd[wd]));
   const openByHour = openMsHr.map((ms, hr) => pct(ms, knownMsHr[hr]));
   const openByWeekdayXHour = openMs7x24.map((row, wd) => row.map((ms, hr) => pct(ms, knownMs7x24[wd][hr])));

   return {
      currentStatus: currentStatusRow ?? null,
      openingStreak,
      currentPeriod: currentPeriod
         ? { type: currentPeriod.type, label: currentPeriod.label }
         : { type: "unknown", label: "Unknown Period" },
      openEvents30Days: eventRows,
      openingHeatmap,
      openByWeekday,
      openByHour,
      openByWeekdayXHour,
   };
}

/* ── public interface ───────────────────────────────────────────────────── */

const database = {
   listSubscribers: (): number[] => {
      const rows = db.prepare("SELECT chat_id FROM subscribers").all() as { chat_id: number }[];
      return rows.map((r) => r.chat_id);
   },

   subscribe: (user: { username: string; chatId: number }): void => {
      db.prepare("INSERT OR IGNORE INTO subscribers (chat_id, username, subscription_date) VALUES (?, ?, ?)").run(
         user.chatId,
         user.username,
         new Date().toISOString(),
      );
   },

   unsubscribe: (userId: number): void => {
      db.prepare("DELETE FROM subscribers WHERE chat_id = ?").run(userId);
   },

   isSubscribed: (userId: number): boolean => {
      return db.prepare("SELECT 1 FROM subscribers WHERE chat_id = ?").get(userId) !== undefined;
   },

   saveLog: (level: "INFO" | "WARN" | "ERROR", message: string, isoDate: string): void => {
      db.prepare("INSERT OR IGNORE INTO logs (timestamp, level, message) VALUES (?, ?, ?)").run(
         isoDate,
         level,
         message,
      );
   },

   saveDoorStatus: (status: DoorStatus, eventTime: Date): void => {
      db.prepare("INSERT OR IGNORE INTO door_status (inserted_at, status, event_time) VALUES (?, ?, ?)").run(
         new Date().toISOString(),
         denormalizeStatus(status),
         eventTime.toISOString(),
      );
   },

   getLastDoorStatus: (): { status: DoorStatus; insertedAt: Date; eventTime: Date } | null => {
      const row = db
         .prepare("SELECT status, inserted_at, event_time FROM door_status ORDER BY inserted_at DESC LIMIT 1")
         .get() as { status: string; inserted_at: string; event_time: string } | undefined;

      if (!row) return null;

      return {
         status: row.status as DoorStatus,
         insertedAt: new Date(row.inserted_at),
         eventTime: new Date(row.event_time),
      };
   },

   getDashboardData: buildDashboardData,
};

export type Database = typeof database;
export default database;
