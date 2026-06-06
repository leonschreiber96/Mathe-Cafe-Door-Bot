import { DatabaseSync } from "node:sqlite";
import { DoorStatus } from "./doorService.js";

const db = new DatabaseSync("data/mathe-cafe.db");
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
   CREATE INDEX IF NOT EXISTS idx_door_status_lookup ON door_status(status, inserted_at DESC);
`);

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
      const row = db.prepare("SELECT 1 FROM subscribers WHERE chat_id = ?").get(userId);
      return row !== undefined;
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
         status,
         eventTime.toISOString(),
      );
   },
   getLastDoorStatus: (): { status: DoorStatus; insertedAt: Date } | null => {
      const row = db.prepare("SELECT status, inserted_at FROM door_status ORDER BY inserted_at DESC LIMIT 1").get() as
         | { status: DoorStatus; inserted_at: string }
         | undefined;

      if (!row) return null;
      return { status: row.status, insertedAt: new Date(row.inserted_at) };
   },
   getEventHistory(days: number): { timestamp: Date; status: DoorStatus }[] | null {
      const row = db
         .prepare(
            "SELECT status, event_time from door_status where event_time >= datetime('now', '-' || ? || ' days') ORDER BY event_time",
         )
         .all(days.toString()) as { status: DoorStatus; event_time: string }[] | undefined;

      if (!row) return null;
      return row.map(({ status, event_time }) => ({ timestamp: new Date(event_time), status }));
   },
   getDailyKpis(): {
      openToday: number;
      firstOpened: string;
      currentShift: string;
      openingStreak: number;
   } {
      // Fetch all events from last 31 days (extra day for streak boundary)
      const rows = db
         .prepare(
            `
         SELECT
            status,
            event_time,
            LEAD(event_time) OVER (ORDER BY event_time) AS next_event_time
         FROM door_status
         WHERE event_time >= datetime('now', '-31 days')
         ORDER BY event_time ASC
      `,
         )
         .all() as { status: DoorStatus; event_time: string; next_event_time: string | null }[];

      const nowMs = Date.now();
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // --- KPI 1 & 2: Today open hours + first opened ---
      let todayOpenMs = 0;
      let firstOpenedToday: Date | null = null;

      for (const row of rows) {
         if (row.status !== "OPEN") continue;
         const start = new Date(row.event_time);
         const end = row.next_event_time ? new Date(row.next_event_time) : new Date();

         // Clamp interval to today
         const clampedStart = new Date(Math.max(start.getTime(), todayStart.getTime()));
         const clampedEnd = new Date(Math.min(end.getTime(), nowMs));
         if (clampedEnd > clampedStart) {
            todayOpenMs += clampedEnd.getTime() - clampedStart.getTime();
            if (!firstOpenedToday || start < firstOpenedToday) {
               firstOpenedToday = start >= todayStart ? start : clampedStart;
            }
         }
      }

      const todayOpenHours = todayOpenMs / 3_600_000;
      // const hoursElapsedToday = (nowMs - todayStart.getTime()) / 3_600_000;
      // const todayOpenPercent = Math.round((todayOpenHours / hoursElapsedToday) * 100);

      // --- KPI 3: Avg daily open hours over last 30 days ---
      const openByDay = new Map<string, number>(); // "YYYY-MM-DD" → ms open

      for (const row of rows) {
         if (row.status !== "OPEN") continue;
         const start = new Date(row.event_time);
         const end = row.next_event_time ? new Date(row.next_event_time) : new Date();

         // Split interval across day boundaries
         let cursor = new Date(start);
         while (cursor < end) {
            const dayKey = cursor.toISOString().slice(0, 10);
            const dayEnd = new Date(cursor);
            dayEnd.setHours(24, 0, 0, 0);
            const intervalEnd = new Date(Math.min(end.getTime(), dayEnd.getTime()));
            const ms = intervalEnd.getTime() - cursor.getTime();
            openByDay.set(dayKey, (openByDay.get(dayKey) ?? 0) + ms);
            cursor = intervalEnd;
         }
      }

      // const totalOpenMs30d = [...openByDay.values()].reduce((a, b) => a + b, 0);
      // const avgDailyOpenHours30d = totalOpenMs30d / 3_600_000 / 30;

      // --- KPI 4: Active streak (consecutive days with any open time) ---
      let openingStreak = 0;
      const today = new Date();
      for (let i = 0; i < 30; i++) {
         const d = new Date(today);
         d.setDate(d.getDate() - i);
         const key = d.toISOString().slice(0, 10);
         if (openByDay.has(key)) {
            openingStreak++;
         } else {
            break; // streak broken
         }
      }

      return {
         openToday: Math.round(todayOpenHours * 10) / 10,
         firstOpened: `${firstOpenedToday?.getHours()}:${firstOpenedToday?.getMinutes()}`,
         currentShift: "Futschi Friday",
         openingStreak,
      };
   },
};

export type Database = typeof database;
export default database;
