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
   CREATE INDEX IF NOT EXISTS idx_door_status_lookup ON door_status(status, inserted_at DESC);
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

type EventRow = {
   status: ApiDoorStatus;
   event_time: string;
};

type EventWithNext = {
   status: ApiDoorStatus;
   event_time: string;
   next_event_time: string | null;
};

const SEMESTER_PERIODS: SemesterPeriod[] = [
   { id: "ws25-lecture", type: "lecture", label: "WS 2025/26 Lecture", from: "2025-10-13", to: "2026-02-14" },
   { id: "ws25-break", type: "break", label: "Winter Break", from: "2026-02-15", to: "2026-04-12" },
   { id: "ss26-lecture", type: "lecture", label: "SS 2026 Lecture", from: "2026-04-13", to: "2026-07-18" },
];

function normalizeStatus(status: string): ApiDoorStatus {
   const s = status.toLowerCase();
   if (s === "open") return "open";
   if (s === "closed") return "closed";
   return "unknown";
}

function denormalizeStatus(status: DoorStatus | ApiDoorStatus): string {
   return String(status).toUpperCase();
}

function iso(date: Date): string {
   return date.toISOString();
}

function dateKeyLocal(date: Date): string {
   const y = date.getFullYear();
   const m = String(date.getMonth() + 1).padStart(2, "0");
   const d = String(date.getDate()).padStart(2, "0");
   return `${y}-${m}-${d}`;
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

function minutesAfterMidnight(date: Date): number {
   return date.getHours() * 60 + date.getMinutes();
}

function clampInterval(start: Date, end: Date, min: Date, max: Date): [Date, Date] | null {
   const s = new Date(Math.max(start.getTime(), min.getTime()));
   const e = new Date(Math.min(end.getTime(), max.getTime()));
   return e > s ? [s, e] : null;
}

function periodDateRange(period: SemesterPeriod): { start: Date; endExclusive: Date } {
   const start = new Date(`${period.from}T00:00:00`);
   const endExclusive = new Date(`${period.to}T00:00:00`);
   endExclusive.setDate(endExclusive.getDate() + 1);
   return { start, endExclusive };
}

function findPeriodById(periodId: string): SemesterPeriod {
   const period = SEMESTER_PERIODS.find((p) => p.id === periodId);
   if (!period) throw new Error(`Unknown period_id: ${periodId}`);
   return period;
}

function findPeriodForDate(date: Date): SemesterPeriod | null {
   return (
      SEMESTER_PERIODS.find((p) => {
         const { start, endExclusive } = periodDateRange(p);
         return date >= start && date < endExclusive;
      }) ?? null
   );
}

function getCurrentPeriodId(): string | null {
   const current = findPeriodForDate(new Date());
   return current?.id ?? null;
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

function getEventsInWindow(days: number): EventRow[] {
   return db
      .prepare(
         `
         SELECT LOWER(status) AS status, event_time
         FROM door_status
         WHERE event_time >= datetime('now', '-' || ? || ' days')
         ORDER BY event_time ASC
      `,
      )
      .all(days.toString()) as EventRow[];
}

function buildDailyRollupForRange(rangeStart: Date, rangeEnd: Date) {
   const rows = getAllEventsWithNext();
   const now = new Date();

   const daily = new Map<
      string,
      {
         openMs: number;
         unknownMs: number;
         firstOpen: Date | null;
         lastClose: Date | null;
      }
   >();

   function ensureDay(key: string) {
      if (!daily.has(key)) {
         daily.set(key, { openMs: 0, unknownMs: 0, firstOpen: null, lastClose: null });
      }
      return daily.get(key)!;
   }

   for (const row of rows) {
      const start = new Date(row.event_time);
      const end = row.next_event_time ? new Date(row.next_event_time) : now;
      if (end <= rangeStart || start >= rangeEnd) continue;

      let cursor = new Date(Math.max(start.getTime(), rangeStart.getTime()));
      const cappedEnd = new Date(Math.min(end.getTime(), rangeEnd.getTime()));

      while (cursor < cappedEnd) {
         // const dayStart = startOfLocalDay(cursor);
         const dayEnd = endOfLocalDay(cursor);
         const sliceEnd = new Date(Math.min(dayEnd.getTime(), cappedEnd.getTime()));
         const key = dateKeyLocal(cursor);
         const entry = ensureDay(key);
         const ms = sliceEnd.getTime() - cursor.getTime();

         if (row.status === "open") {
            entry.openMs += ms;
            if (!entry.firstOpen || cursor < entry.firstOpen) entry.firstOpen = new Date(cursor);
         } else if (row.status === "unknown") {
            entry.unknownMs += ms;
         }

         if (row.status === "closed") {
            entry.lastClose = new Date(sliceEnd);
         }

         cursor = sliceEnd;
      }
   }

   return daily;
}

function buildPeriodSlices(periodId: string) {
   const period = findPeriodById(periodId);
   const { start, endExclusive } = periodDateRange(period);
   const now = new Date();
   const effectiveEnd = new Date(Math.min(endExclusive.getTime(), now.getTime()));
   const rows = getAllEventsWithNext();

   const weekdayOpenMs = Array<number>(7).fill(0);
   const weekdayKnownMs = Array<number>(7).fill(0);
   const weekdayDayCount = Array<number>(7).fill(0);
   const weekdayFirstOpenMins: number[][] = Array.from({ length: 7 }, () => []);
   const hourlyOpenMs = Array<number>(24).fill(0);
   const hourlyKnownMs = Array<number>(24).fill(0);
   const heatOpenMs = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
   const heatKnownMs = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
   const byWeekdayCumOpenHours = Array.from({ length: 7 }, () => Array<number>(25).fill(0));

   const dayStats = new Map<
      string,
      {
         weekday: number;
         openMs: number;
         firstOpen: Date | null;
      }
   >();

   for (let day = new Date(start); day < effectiveEnd; day = addDays(day, 1)) {
      const key = dateKeyLocal(day);
      dayStats.set(key, { weekday: weekdayMon0(day), openMs: 0, firstOpen: null });
      weekdayDayCount[weekdayMon0(day)] += 1;
   }

   for (const row of rows) {
      const startTime = new Date(row.event_time);
      const endTime = row.next_event_time ? new Date(row.next_event_time) : now;
      const clamped = clampInterval(startTime, endTime, start, effectiveEnd);
      if (!clamped) continue;
      let [cursor, cappedEnd] = clamped;

      while (cursor < cappedEnd) {
         const nextHour = new Date(cursor);
         nextHour.setMinutes(0, 0, 0);
         nextHour.setHours(nextHour.getHours() + 1);

         const nextDay = endOfLocalDay(cursor);
         const sliceEnd = new Date(Math.min(cappedEnd.getTime(), nextHour.getTime(), nextDay.getTime()));
         const ms = sliceEnd.getTime() - cursor.getTime();
         const dayKey = dateKeyLocal(cursor);
         const dayEntry = dayStats.get(dayKey);
         const weekday = weekdayMon0(cursor);
         const hour = cursor.getHours();

         if (row.status !== "unknown") {
            weekdayKnownMs[weekday] += ms;
            hourlyKnownMs[hour] += ms;
            heatKnownMs[weekday][hour] += ms;
         }

         if (row.status === "open") {
            weekdayOpenMs[weekday] += ms;
            hourlyOpenMs[hour] += ms;
            heatOpenMs[weekday][hour] += ms;
            if (dayEntry) {
               dayEntry.openMs += ms;
               if (!dayEntry.firstOpen || cursor < dayEntry.firstOpen) dayEntry.firstOpen = new Date(cursor);
            }
         }

         cursor = sliceEnd;
      }
   }

   for (const [, stat] of dayStats) {
      if (stat.firstOpen) {
         weekdayFirstOpenMins[stat.weekday].push(minutesAfterMidnight(stat.firstOpen));
      }
   }

   for (let day = new Date(start); day < effectiveEnd; day = addDays(day, 1)) {
      const weekday = weekdayMon0(day);
      const dayStart = startOfLocalDay(day);
      const dayEnd = endOfLocalDay(day);

      for (const row of rows) {
         const startTime = new Date(row.event_time);
         const endTime = row.next_event_time ? new Date(row.next_event_time) : now;
         if (row.status !== "open") continue;
         const clamped = clampInterval(startTime, endTime, dayStart, dayEnd);
         if (!clamped) continue;
         const [s, e] = clamped;

         for (let boundary = 0; boundary <= 24; boundary++) {
            const boundaryTime = new Date(dayStart);
            boundaryTime.setHours(boundary, 0, 0, 0);
            const usedEnd = new Date(Math.min(e.getTime(), boundaryTime.getTime()));
            const usedMs = Math.max(0, usedEnd.getTime() - s.getTime());
            byWeekdayCumOpenHours[weekday][boundary] += usedMs / 3_600_000;
         }
      }
   }

   const avgOpenHoursPerDay =
      dayStats.size > 0 ? [...dayStats.values()].reduce((sum, d) => sum + d.openMs, 0) / 3_600_000 / dayStats.size : 0;

   const byWeekdayAvgOpenHours = weekdayOpenMs.map((ms, i) =>
      weekdayDayCount[i] > 0 ? ms / 3_600_000 / weekdayDayCount[i] : 0,
   );

   // ✅ Declared before avgFirstOpenCandidates which depends on it
   const byWeekdayFirstOpenMin = weekdayFirstOpenMins.map((vals) =>
      vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
   );

   const avgFirstOpenCandidates = byWeekdayFirstOpenMin.filter((v): v is number => v !== null);
   const avgFirstOpenMin =
      avgFirstOpenCandidates.length > 0
         ? Math.round(avgFirstOpenCandidates.reduce((a, b) => a + b, 0) / avgFirstOpenCandidates.length)
         : null;

   for (let wd = 0; wd < 7; wd++) {
      if (weekdayDayCount[wd] > 0) {
         for (let i = 0; i < 25; i++) {
            byWeekdayCumOpenHours[wd][i] = Number((byWeekdayCumOpenHours[wd][i] / weekdayDayCount[wd]).toFixed(3));
         }
      }
   }

   return {
      periodId,
      weekdayOpenMs,
      weekdayKnownMs,
      weekdayDayCount,
      hourlyOpenMs,
      hourlyKnownMs,
      heatOpenMs,
      heatKnownMs,
      avgOpenHoursPerDay,
      byWeekdayAvgOpenHours,
      avgFirstOpenMin,
      byWeekdayFirstOpenMin,
      byWeekdayCumOpenHours,
   };
}

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
         denormalizeStatus(status),
         eventTime.toISOString(),
      );
   },

   getLastDoorStatus: (): { status: DoorStatus; insertedAt: Date } | null => {
      const row = db.prepare("SELECT status, inserted_at FROM door_status ORDER BY inserted_at DESC LIMIT 1").get() as
         | { status: string; inserted_at: string }
         | undefined;

      if (!row) return null;
      return { status: row.status as DoorStatus, insertedAt: new Date(row.inserted_at) };
   },

   getEventHistory(days: number): { timestamp: string; status: DoorStatus }[] {
      const rows = db
         .prepare(
            "SELECT status, event_time from door_status where event_time >= datetime('now', '-' || ? || ' days') ORDER BY event_time",
         )
         .all(days.toString()) as { status: string; event_time: string }[];

      return rows.map(({ status, event_time }) => ({ timestamp: event_time, status: status as DoorStatus }));
   },

   getDailyKpis(): {
      openToday: number;
      openTodayPercent: number;
      firstOpened: { h: number; m: number } | null;
      avgDailyOpen: number;
      openingStreak: number;
   } {
      const rows = db
         .prepare(
            `
         SELECT
            LOWER(status) AS status,
            event_time,
            LEAD(event_time) OVER (ORDER BY event_time) AS next_event_time
         FROM door_status
         WHERE event_time >= datetime('now', '-31 days')
         ORDER BY event_time ASC
      `,
         )
         .all() as { status: ApiDoorStatus; event_time: string; next_event_time: string | null }[];

      const nowMs = Date.now();
      const todayStart = startOfLocalDay(new Date());

      let todayOpenMs = 0;
      let firstOpenedToday: Date | null = null;

      for (const row of rows) {
         if (row.status !== "open") continue;
         const start = new Date(row.event_time);
         const end = row.next_event_time ? new Date(row.next_event_time) : new Date();

         const clampedStart = new Date(Math.max(start.getTime(), todayStart.getTime()));
         const clampedEnd = new Date(Math.min(end.getTime(), nowMs));
         if (clampedEnd > clampedStart) {
            todayOpenMs += clampedEnd.getTime() - clampedStart.getTime();
            if (!firstOpenedToday || clampedStart < firstOpenedToday) {
               firstOpenedToday = clampedStart;
            }
         }
      }

      const todayOpenHours = todayOpenMs / 3_600_000;
      const hoursElapsedToday = (nowMs - todayStart.getTime()) / 3_600_000;
      const todayOpenPercent = hoursElapsedToday > 0 ? Math.round((todayOpenHours / hoursElapsedToday) * 100) : 0;

      const openByDay = new Map<string, number>();

      for (const row of rows) {
         if (row.status !== "open") continue;
         const start = new Date(row.event_time);
         const end = row.next_event_time ? new Date(row.next_event_time) : new Date();

         let cursor = new Date(start);
         while (cursor < end) {
            const key = dateKeyLocal(cursor);
            const dayEnd = endOfLocalDay(cursor);
            const intervalEnd = new Date(Math.min(end.getTime(), dayEnd.getTime()));
            const ms = intervalEnd.getTime() - cursor.getTime();
            openByDay.set(key, (openByDay.get(key) ?? 0) + ms);
            cursor = intervalEnd;
         }
      }

      const totalOpenMs30d = [...openByDay.values()].reduce((a, b) => a + b, 0);
      const openDayCount = openByDay.size;
      const avgDailyOpenHours30d = openDayCount > 0 ? totalOpenMs30d / 3_600_000 / openDayCount : 0;

      let openingStreak = 0;
      const today = new Date();
      for (let i = 0; i < 30; i++) {
         const d = addDays(today, -i);
         const key = dateKeyLocal(d);
         if (openByDay.has(key)) openingStreak++;
         else break;
      }

      return {
         openToday: Math.round(todayOpenHours * 10) / 10,
         openTodayPercent: todayOpenPercent,
         firstOpened: firstOpenedToday ? { h: firstOpenedToday.getHours(), m: firstOpenedToday.getMinutes() } : null,
         avgDailyOpen: Math.round(avgDailyOpenHours30d * 10) / 10,
         openingStreak,
      };
   },

   getLiveStatus(): {
      status: ApiDoorStatus;
      since: string | null;
      server_time: string;
      first_open_today: string | null;
      open_streak_days: number;
      open_seconds_today: number;
   } {
      const rows = getAllEventsWithNext();
      const now = new Date();
      const last = rows.at(-1);

      const todayStart = startOfLocalDay(now);
      let openSecondsToday = 0;
      let firstOpenToday: string | null = null;

      const openByDay = new Map<string, boolean>();

      for (const row of rows) {
         const start = new Date(row.event_time);
         const end = row.next_event_time ? new Date(row.next_event_time) : now;

         if (row.status === "open") {
            let cursor = new Date(start);
            while (cursor < end) {
               const key = dateKeyLocal(cursor);
               openByDay.set(key, true);
               const dayEnd = endOfLocalDay(cursor);
               const intervalEnd = new Date(Math.min(end.getTime(), dayEnd.getTime()));
               if (cursor < dayEnd && intervalEnd > cursor && key === dateKeyLocal(now)) {
                  openSecondsToday += Math.floor((intervalEnd.getTime() - cursor.getTime()) / 1000);
                  if (!firstOpenToday) firstOpenToday = iso(cursor < todayStart ? todayStart : cursor);
               }
               cursor = intervalEnd;
            }
         }
      }

      let openStreakDays = 0;
      for (let i = 0; i < 365; i++) {
         const d = addDays(now, -i);
         const key = dateKeyLocal(d);
         if (openByDay.has(key)) openStreakDays++;
         else break;
      }

      return {
         status: last ? normalizeStatus(last.status) : "unknown",
         since: last ? last.event_time : null,
         server_time: iso(now),
         first_open_today: firstOpenToday,
         open_streak_days: openStreakDays,
         open_seconds_today: openSecondsToday,
      };
   },

   getEventsWindow(days: number): {
      range: { from: string; to: string };
      events: { event_time: string; status: ApiDoorStatus }[];
   } {
      const events = getEventsInWindow(days).map((r) => ({
         event_time: r.event_time,
         status: normalizeStatus(r.status),
      }));

      const from = addDays(startOfLocalDay(new Date()), -(days - 1));
      const to = new Date();

      return {
         range: { from: iso(from), to: iso(to) },
         events,
      };
   },

   getSemesters(): { current_period_id: string | null; periods: SemesterPeriod[] } {
      return {
         current_period_id: getCurrentPeriodId(),
         periods: SEMESTER_PERIODS,
      };
   },

   getAggregateDaily(days: number): {
      days: {
         date: string;
         weekday: number;
         open_hours: number;
         first_open: string | null;
         last_close: string | null;
         period_id: string | null;
      }[];
   } {
      const end = new Date();
      const start = addDays(startOfLocalDay(end), -(days - 1));
      const rollup = buildDailyRollupForRange(start, end);

      const out = [];
      for (let day = new Date(start); day <= end; day = addDays(day, 1)) {
         const key = dateKeyLocal(day);
         const stat = rollup.get(key) ?? { openMs: 0, unknownMs: 0, firstOpen: null, lastClose: null };
         const period = findPeriodForDate(day);

         out.push({
            date: key,
            weekday: weekdayMon0(day),
            open_hours: Number((stat.openMs / 3_600_000).toFixed(2)),
            first_open: stat.firstOpen ? iso(stat.firstOpen) : null,
            last_close: stat.lastClose ? iso(stat.lastClose) : null,
            period_id: period?.id ?? null,
         });
      }

      return { days: out };
   },

   getAggregateByWeekday(periodId: string): {
      period_id: string;
      weekdays: { weekday: number; open_pct: number; avg_open_hours: number }[];
   } {
      const agg = buildPeriodSlices(periodId);
      return {
         period_id: periodId,
         weekdays: Array.from({ length: 7 }, (_, weekday) => ({
            weekday,
            open_pct:
               agg.weekdayKnownMs[weekday] > 0
                  ? Number(((agg.weekdayOpenMs[weekday] / agg.weekdayKnownMs[weekday]) * 100).toFixed(1))
                  : 0,
            avg_open_hours: Number(agg.byWeekdayAvgOpenHours[weekday].toFixed(1)),
         })),
      };
   },

   getAggregateByHour(periodId: string): {
      period_id: string;
      hours: { hour: number; open_pct: number }[];
   } {
      const agg = buildPeriodSlices(periodId);
      return {
         period_id: periodId,
         hours: Array.from({ length: 24 }, (_, hour) => ({
            hour,
            open_pct:
               agg.hourlyKnownMs[hour] > 0
                  ? Number(((agg.hourlyOpenMs[hour] / agg.hourlyKnownMs[hour]) * 100).toFixed(1))
                  : 0,
         })),
      };
   },

   getAggregateHeatmap(periodId: string): {
      period_id: string;
      matrix: number[][];
   } {
      const agg = buildPeriodSlices(periodId);
      return {
         period_id: periodId,
         matrix: agg.heatOpenMs.map((row, weekday) =>
            row.map((openMs, hour) =>
               agg.heatKnownMs[weekday][hour] > 0
                  ? Number(((openMs / agg.heatKnownMs[weekday][hour]) * 100).toFixed(1))
                  : 0,
            ),
         ),
      };
   },

   getAggregateBaseline(periodId: string): {
      period_id: string;
      avg_open_hours_per_day: number;
      by_weekday_avg_open_hours: number[];
      avg_first_open_min: number | null;
      by_weekday_first_open_min: (number | null)[];
      by_weekday_cum_open_hours: number[][];
   } {
      const agg = buildPeriodSlices(periodId);
      return {
         period_id: periodId,
         avg_open_hours_per_day: Number(agg.avgOpenHoursPerDay.toFixed(1)),
         by_weekday_avg_open_hours: agg.byWeekdayAvgOpenHours.map((v) => Number(v.toFixed(1))),
         avg_first_open_min: agg.avgFirstOpenMin,
         by_weekday_first_open_min: agg.byWeekdayFirstOpenMin,
         by_weekday_cum_open_hours: agg.byWeekdayCumOpenHours,
      };
   },
};

export type Database = typeof database;
export default database;
