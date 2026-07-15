import { DatabaseSync } from "node:sqlite";
import { DoorStatus } from "./doorService.js";
import type { ShiftPlan, Slot } from "./shiftPlanService.js";

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

  -- Historical snapshots of the scraped shift plan. A new row is appended only
  -- when the content hash changes, so the table is a change-log over time.
  CREATE TABLE IF NOT EXISTS shift_plans (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    fetched_at   TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    plan_json    TEXT NOT NULL
  );

  -- Academic terms scraped from the TU Berlin dates page. Keyed by the human
  -- label ("Wintersemester 2025/2026"); dates are YYYY-MM-DD or NULL.
  CREATE TABLE IF NOT EXISTS semesters (
    label          TEXT PRIMARY KEY,
    dauer_from     TEXT,
    dauer_to       TEXT,
    vorlesung_from TEXT,
    vorlesung_to   TEXT,
    vlfrei_from    TEXT,
    vlfrei_to      TEXT,
    fetched_at     TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
  CREATE INDEX IF NOT EXISTS idx_door_status_event_time ON door_status(event_time);
`);

// Logical-day cutoff: a "day" runs from DAY_START_HOUR to DAY_START_HOUR (default 03:00),
// so e.g. a Friday opening that closes after midnight still belongs to Friday. Applied to
// the opening streak only — the hour-of-day / weekday heatmaps stay on true clock hours.
const DAY_START_HOUR = Number(process.env.DAY_START_HOUR ?? 3);

type ApiDoorStatus = "open" | "closed" | "unknown";
type PeriodType = "lecture" | "break" | "exam" | "vacation";

type SemesterPeriod = {
   id: string;
   type: PeriodType;
   label: string;
   from: string; // YYYY-MM-DD inclusive
   to: string; // YYYY-MM-DD inclusive
   exclude?: { from: string; to: string }; // YYYY-MM-DD inclusive gap (e.g. Christmas) carved out of stats
};

type SemesterRow = {
   label: string;
   dauer_from: string | null;
   dauer_to: string | null;
   vorlesung_from: string | null;
   vorlesung_to: string | null;
   vlfrei_from: string | null;
   vlfrei_to: string | null;
   fetched_at: string;
};

export type SemesterInput = Omit<SemesterRow, "fetched_at">;

type EventWithNext = {
   status: ApiDoorStatus;
   event_time: string;
   next_event_time: string | null;
};

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

/* Logical-day helpers (cutoff at DAY_START_HOUR, see note above). */
function logicalDayStart(date: Date): Date {
   const d = new Date(date);
   if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1);
   d.setHours(DAY_START_HOUR, 0, 0, 0);
   return d;
}

function logicalDayEnd(date: Date): Date {
   const d = logicalDayStart(date);
   d.setDate(d.getDate() + 1);
   return d;
}

function logicalDateKey(date: Date): string {
   return dateKeyLocal(logicalDayStart(date));
}

function isoShiftDay(iso: string, delta: number): string {
   const d = new Date(iso + "T00:00:00");
   d.setDate(d.getDate() + delta);
   return dateKeyLocal(d);
}

/* "Wintersemester 2025/2026" → "WS 2025/26"; "Sommersemester 2026" → "SS 2026". */
function shortSemesterLabel(label: string): string {
   const m = label.match(/(Winter|Sommer)semester\s+(\d{4})(?:\/(\d{2,4}))?/i);
   if (!m) return label;
   if (/^winter/i.test(m[1])) {
      const y2 = m[3] ? m[3].slice(-2) : String(Number(m[2]) + 1).slice(-2);
      return `WS ${m[2]}/${y2}`;
   }
   return `SS ${m[2]}`;
}

/* Read stored semesters and derive the functional periods students think in:
 * lecture time (the whole Vorlesungszeit, with the Christmas break carved out of
 * its stats as a gap), the Christmas break itself (Vorlesungsfreie Zeit), and the
 * semester break between one semester's lecture time and the next's. Empty until
 * the first crawl populates the semesters table — callers handle a null period. */
function buildPeriods(): SemesterPeriod[] {
   const rows = getStoredSemesters().filter((r) => r.vorlesung_from && r.vorlesung_to);
   if (!rows.length) return [];

   rows.sort((a, b) => (a.vorlesung_from! < b.vorlesung_from! ? -1 : 1));
   const periods: SemesterPeriod[] = [];

   rows.forEach((s, idx) => {
      const short = shortSemesterLabel(s.label);
      const vFrom = s.vorlesung_from!;
      const vTo = s.vorlesung_to!;
      const hasXmas = s.vlfrei_from && s.vlfrei_to && s.vlfrei_from >= vFrom && s.vlfrei_to <= vTo;

      // Lecture spans the whole Vorlesungszeit; Christmas is excluded from its
      // stats (a gap) but is still its own period, listed first so a Christmas
      // date resolves to it rather than to the lecture span.
      if (hasXmas) {
         periods.push({ id: `${s.label}-xmas`, type: "vacation", label: "Christmas Break", from: s.vlfrei_from!, to: s.vlfrei_to! });
         periods.push({ id: `${s.label}-lec`, type: "lecture", label: short, from: vFrom, to: vTo, exclude: { from: s.vlfrei_from!, to: s.vlfrei_to! } });
      } else {
         periods.push({ id: `${s.label}-lec`, type: "lecture", label: short, from: vFrom, to: vTo });
      }

      const next = rows[idx + 1];
      if (next?.vorlesung_from) {
         const bFrom = isoShiftDay(vTo, 1);
         const bTo = isoShiftDay(next.vorlesung_from, -1);
         if (bFrom <= bTo) {
            periods.push({ id: `${s.label}-break`, type: "break", label: `Break → ${shortSemesterLabel(next.label)}`, from: bFrom, to: bTo });
         }
      }
   });

   return periods;
}

function findPeriodForDate(date: Date): SemesterPeriod | null {
   const within = (from: string, to: string) => {
      const start = new Date(from + "T00:00:00");
      const end = new Date(to + "T00:00:00");
      end.setDate(end.getDate() + 1);
      return date >= start && date < end;
   };
   return (
      buildPeriods().find((p) => within(p.from, p.to) && !(p.exclude && within(p.exclude.from, p.exclude.to))) ?? null
   );
}

function getStoredSemesters(): SemesterRow[] {
   return db.prepare("SELECT * FROM semesters").all() as SemesterRow[];
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

function buildDashboardData(asOf: Date = new Date(), shiftPlan: ShiftPlan | null = null) {
   // `now` is the reference instant the whole dashboard is computed against. It
   // defaults to the real clock, but the web server can pass a past instant to
   // render the dashboard "as if it were that day" (time-travel via ?date=).
   const now = asOf;
   const currentPeriod = findPeriodForDate(now);

   const currentStatusRow = db
      .prepare(
         `
    SELECT
      UPPER(status) AS status,
      event_time AS timestamp
    FROM door_status
    WHERE event_time <= ?
    ORDER BY event_time DESC, inserted_at DESC
    LIMIT 1
  `,
      )
      .get(now.toISOString()) as { status: string; timestamp: string } | undefined;

   // ── openEvents30Days (the 30 days up to the reference instant) ─────────
   const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
   const eventRows = db
      .prepare(
         `
    SELECT UPPER(status) AS status, event_time AS timestamp
    FROM door_status
    WHERE event_time >= ? AND event_time <= ?
    ORDER BY event_time DESC
  `,
      )
      .all(since30.toISOString(), now.toISOString()) as { status: string; timestamp: string }[];

   // ── openingStreak — keyed by logical day ──────────────────────────────
   const allRows = getAllEventsWithNext();
   const openByDay = new Set<string>();

   for (const row of allRows) {
      if (row.status !== "open") continue;
      const start = new Date(row.event_time);
      if (start >= now) continue;
      const end = new Date(
         Math.min(row.next_event_time ? new Date(row.next_event_time).getTime() : now.getTime(), now.getTime()),
      );

      // mark every logical day this open interval touches
      let dayCursor = new Date(start);
      while (dayCursor < end) {
         openByDay.add(logicalDateKey(dayCursor));
         dayCursor = logicalDayEnd(dayCursor);
      }
   }

   // A logical day with no open event breaks the streak. Today's logical day may
   // not have opened yet, so don't let it break the streak before the day is out.
   let openingStreak = 0;
   for (let i = 0; i < 365; i++) {
      const key = dateKeyLocal(addDays(logicalDayStart(now), -i));
      if (openByDay.has(key)) openingStreak++;
      else if (i === 0) continue;
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

   // A period can carve out a gap (e.g. Christmas) that is excluded from its stats.
   const excludeStart = currentPeriod?.exclude ? new Date(currentPeriod.exclude.from + "T00:00:00").getTime() : null;
   const excludeEnd = currentPeriod?.exclude
      ? (() => {
           const d = new Date(currentPeriod.exclude!.to + "T00:00:00");
           d.setDate(d.getDate() + 1);
           return d.getTime();
        })()
      : null;
   const inExclude = (ms: number) => excludeStart !== null && ms >= excludeStart && ms < excludeEnd!;

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

         if (!inExclude(cursor.getTime())) {
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
         }

         cursor = sliceEnd;
      }
   }

   const pct = (open: number, known: number) => (known > 0 ? Math.round((open / known) * 100) : 0);

   const openingHeatmap = openMs7x24.map((row, wd) => row.map((ms, hr) => pct(ms, knownMs7x24[wd][hr])));
   const openByWeekday = openMsWd.map((ms, wd) => pct(ms, knownMsWd[wd]));
   const openByHour = openMsHr.map((ms, hr) => pct(ms, knownMsHr[hr]));
   const openByWeekdayXHour = openMs7x24.map((row, wd) => row.map((ms, hr) => pct(ms, knownMs7x24[wd][hr])));

   // ── calendar: open hours per calendar day across the period ───────────
   const calMs = new Map<string, number>();
   for (const row of allRows) {
      if (row.status !== "open") continue;
      const s = new Date(Math.max(new Date(row.event_time).getTime(), periodStart.getTime()));
      const rEndMs = row.next_event_time ? new Date(row.next_event_time).getTime() : now.getTime();
      const e = new Date(Math.min(rEndMs, periodEnd.getTime()));
      let cursor = new Date(s);
      while (cursor < e) {
         const segEnd = new Date(Math.min(e.getTime(), endOfLocalDay(cursor).getTime()));
         if (!inExclude(cursor.getTime())) {
            const key = dateKeyLocal(cursor);
            calMs.set(key, (calMs.get(key) ?? 0) + (segEnd.getTime() - cursor.getTime()));
         }
         cursor = segEnd;
      }
   }
   const openByDate: { date: string; hours: number | null }[] = [];
   for (let d = startOfLocalDay(periodStart); d <= periodEnd; d = addDays(d, 1)) {
      const key = dateKeyLocal(d);
      // excluded days (e.g. Christmas) render as a gap, not a zero-hour day
      const hours = inExclude(d.getTime()) ? null : +((calMs.get(key) ?? 0) / 3_600_000).toFixed(2);
      openByDate.push({ date: key, hours });
   }

   // ── shift coverage: was the door actually open during scheduled shifts? ─
   // Reuses the period weekday×hour open/known matrices. For every scheduled
   // (weekday, 2h slot) in the latest shift plan, % = open time / known time.
   const SLOT_HOURS: Record<Slot, [number, number]> = {
      "08-10": [8, 10],
      "10-12": [10, 12],
      "12-14": [12, 14],
      "14-16": [14, 16],
      "16-18": [16, 18],
      "18-20": [18, 20],
   };
   const PLAN_WEEKDAYS: (keyof ShiftPlan)[] = ["monday", "tuesday", "wednesday", "thursday", "friday"];
   const slots = Object.keys(SLOT_HOURS) as Slot[];
   const shiftAdherence = {
      slots,
      // grid[slotIndex][weekdayIndex] = { name (assignee or null), pct (open %, or null) }
      grid: slots.map((slot) => {
         const [h0, h1] = SLOT_HOURS[slot];
         return PLAN_WEEKDAYS.map((wdName, wd) => {
            const name = shiftPlan ? (shiftPlan[wdName]?.[slot] ?? null) : null;
            let openMs = 0;
            let knownMs = 0;
            for (let h = h0; h < h1; h++) {
               openMs += openMs7x24[wd][h];
               knownMs += knownMs7x24[wd][h];
            }
            return { name, pct: knownMs > 0 ? Math.round((openMs / knownMs) * 100) : null };
         });
      }),
   };

   // ── first-open time per day (logical day) → hour-of-day histogram ──────
   const firstOpenByDay = new Map<string, number>();
   const sessionBins = [
      { label: "<1h", max: 1 },
      { label: "1–2h", max: 2 },
      { label: "2–3h", max: 3 },
      { label: "3–4h", max: 4 },
      { label: "4–6h", max: 6 },
      { label: "6–8h", max: 8 },
      { label: "8h+", max: Infinity },
   ];
   const sessionLengths = sessionBins.map((b) => ({ label: b.label, hours: 0, count: 0 }));
   const sessionMinutes: number[] = [];

   for (const row of allRows) {
      if (row.status !== "open") continue;
      const start = new Date(row.event_time);
      if (start < periodStart || start >= periodEnd || inExclude(start.getTime())) continue;

      // first-open of its logical day, as a clock hour (00–23)
      const dayStart = logicalDayStart(start);
      const hourFloat = DAY_START_HOUR + (start.getTime() - dayStart.getTime()) / 3_600_000;
      const key = dateKeyLocal(dayStart);
      const prev = firstOpenByDay.get(key);
      if (prev === undefined || hourFloat < prev) firstOpenByDay.set(key, hourFloat);

      // session length of this open interval (capped at the reference instant)
      const end = Math.min(row.next_event_time ? new Date(row.next_event_time).getTime() : now.getTime(), now.getTime());
      const hours = (end - start.getTime()) / 3_600_000;
      const bin = sessionLengths[sessionBins.findIndex((b) => hours < b.max)];
      bin.hours += hours;
      bin.count++;
      sessionMinutes.push(hours * 60);
   }

   for (const b of sessionLengths) b.hours = Math.round(b.hours * 10) / 10;

   // ── session retention: f(x) = share of sessions that lasted at least x ──
   // Exact survival curve (complementary CDF), not a binned approximation: one
   // point per distinct duration, so the step heights are the real quantiles.
   // Sorted ascending, the count of sessions >= durations[i] is simply n - i.
   // A trailing (max, 0) point makes the curve reach 0% at the longest session.
   sessionMinutes.sort((a, b) => a - b);
   const n = sessionMinutes.length;
   const round2 = (v: number) => Math.round(v * 100) / 100;
   const sessionRetention: { minutes: number; pct: number }[] = [];
   if (n > 0) {
      if (sessionMinutes[0] > 0) sessionRetention.push({ minutes: 0, pct: 1 });
      for (let i = 0; i < n; ) {
         const d = sessionMinutes[i];
         sessionRetention.push({ minutes: round2(d), pct: Math.round(((n - i) / n) * 10000) / 10000 });
         while (i < n && sessionMinutes[i] === d) i++;
      }
      sessionRetention.push({ minutes: round2(sessionMinutes[n - 1]), pct: 0 });
   }

   const firstOpenHistogram = Array<number>(24).fill(0);
   for (const h of firstOpenByDay.values()) firstOpenHistogram[Math.floor(h) % 24]++;

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
      openByDate,
      shiftAdherence,
      firstOpenHistogram,
      sessionLengths,
      sessionRetention,
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

   // ── shift plans ────────────────────────────────────────────────────────
   /* Append a snapshot only if it differs from the latest one (by effective
      date). Returns true when a new snapshot was written (i.e. the plan changed).
      Ordered by fetched_at, not id, so back-dated historical rows never count as
      "latest". */
   saveShiftPlanIfChanged: (planJson: string, contentHash: string): boolean => {
      const latest = db
         .prepare("SELECT content_hash FROM shift_plans ORDER BY fetched_at DESC, id DESC LIMIT 1")
         .get() as { content_hash: string } | undefined;
      if (latest?.content_hash === contentHash) return false;
      db.prepare("INSERT INTO shift_plans (fetched_at, content_hash, plan_json) VALUES (?, ?, ?)").run(
         new Date().toISOString(),
         contentHash,
         planJson,
      );
      return true;
   },

   getLatestShiftPlan: (): { planJson: string; fetchedAt: Date } | null => {
      const row = db
         .prepare("SELECT plan_json, fetched_at FROM shift_plans ORDER BY fetched_at DESC, id DESC LIMIT 1")
         .get() as { plan_json: string; fetched_at: string } | undefined;
      return row ? { planJson: row.plan_json, fetchedAt: new Date(row.fetched_at) } : null;
   },

   /* The plan in effect at a given instant: the newest snapshot whose effective
      date (fetched_at) is at or before it. Null if none predates it. */
   getShiftPlanAsOf: (asOf: Date): { planJson: string; fetchedAt: Date } | null => {
      const row = db
         .prepare("SELECT plan_json, fetched_at FROM shift_plans WHERE fetched_at <= ? ORDER BY fetched_at DESC, id DESC LIMIT 1")
         .get(asOf.toISOString()) as { plan_json: string; fetched_at: string } | undefined;
      return row ? { planJson: row.plan_json, fetchedAt: new Date(row.fetched_at) } : null;
   },

   // ── semesters ──────────────────────────────────────────────────────────
   /* Insert or update a scraped semester. Returns whether it was new, changed
      (dates differ from what we had), or unchanged. */
   upsertSemester: (s: SemesterInput): "new" | "updated" | "unchanged" => {
      const existing = db.prepare("SELECT * FROM semesters WHERE label = ?").get(s.label) as SemesterRow | undefined;
      const same =
         existing &&
         existing.dauer_from === s.dauer_from &&
         existing.dauer_to === s.dauer_to &&
         existing.vorlesung_from === s.vorlesung_from &&
         existing.vorlesung_to === s.vorlesung_to &&
         existing.vlfrei_from === s.vlfrei_from &&
         existing.vlfrei_to === s.vlfrei_to;
      if (same) return "unchanged";

      db.prepare(
         `INSERT INTO semesters
            (label, dauer_from, dauer_to, vorlesung_from, vorlesung_to, vlfrei_from, vlfrei_to, fetched_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(label) DO UPDATE SET
            dauer_from = excluded.dauer_from, dauer_to = excluded.dauer_to,
            vorlesung_from = excluded.vorlesung_from, vorlesung_to = excluded.vorlesung_to,
            vlfrei_from = excluded.vlfrei_from, vlfrei_to = excluded.vlfrei_to,
            fetched_at = excluded.fetched_at`,
      ).run(
         s.label,
         s.dauer_from,
         s.dauer_to,
         s.vorlesung_from,
         s.vorlesung_to,
         s.vlfrei_from,
         s.vlfrei_to,
         new Date().toISOString(),
      );
      return existing ? "updated" : "new";
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
