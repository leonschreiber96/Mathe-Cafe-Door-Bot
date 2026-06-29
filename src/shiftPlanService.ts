import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import database from "./database.js";

/* The café shift plan: a fixed grid of 2-hour slots (08:00–20:00) on weekdays,
 * scraped from the wiki. This module owns fetching, parsing, persistence and the
 * "which shift is on right now?" lookup. The DB keeps a historical change-log
 * (see `shift_plans` in database.ts). */

export type Slot = "08-10" | "10-12" | "12-14" | "14-16" | "16-18" | "18-20";
export type Weekday = "monday" | "tuesday" | "wednesday" | "thursday" | "friday";
export type TimeSlots = { [K in Slot]: string | null };
export type ShiftPlan = { [K in Weekday]: TimeSlots };

const DB = database;
const SHIFT_PLAN_URL = process.env.SHIFT_PLAN_URL ?? "https://wiki.mathe-cafe.de/en/schichtplan";
const TIMEZONE = process.env.TIMEZONE ?? "Europe/Berlin";

const emptyDay = (): TimeSlots => ({
   "08-10": null,
   "10-12": null,
   "12-14": null,
   "14-16": null,
   "16-18": null,
   "18-20": null,
});

/* Fetch and parse the live shift plan from the wiki. Throws on network/parse
 * failure so the scheduler can surface it to the admin. */
export async function fetchShiftPlan(): Promise<ShiftPlan> {
   const res = await fetch(SHIFT_PLAN_URL);
   if (!res.ok) {
      throw new Error(`Failed to fetch shift plan: ${res.status} ${res.statusText}`);
   }

   const $ = cheerio.load(await res.text());

   const plan: ShiftPlan = {
      monday: emptyDay(),
      tuesday: emptyDay(),
      wednesday: emptyDay(),
      thursday: emptyDay(),
      friday: emptyDay(),
   };

   const dayMap: Record<string, Weekday> = {
      Montag: "monday",
      Dienstag: "tuesday",
      Mittwoch: "wednesday",
      Donnerstag: "thursday",
      Freitag: "friday",
   };

   const slotMap: Record<string, Slot> = {
      "8h": "08-10",
      "10h": "10-12",
      "12h": "12-14",
      "14h": "14-16",
      "16h": "16-18",
      "18h": "18-20",
   };

   const table = $(".table-container table").first();
   if (!table.length) {
      throw new Error("Shift plan table not found");
   }

   const headers = table
      .find("thead th")
      .toArray()
      .map((th) => $(th).text().trim());

   table.find("tbody tr").each((_, tr) => {
      const cells = $(tr)
         .find("td")
         .toArray()
         .map((td) => $(td).text().replace(/\s+/g, " ").trim());

      const slot = slotMap[cells[0]];
      if (!slot) return;

      for (let col = 1; col < cells.length; col++) {
         const day = dayMap[headers[col]];
         if (!day) continue;
         plan[day][slot] = cells[col].length > 0 ? cells[col] : null;
      }
   });

   return plan;
}

/* Fetch the plan and append a new historical snapshot iff it changed. */
export async function fetchAndStoreShiftPlan(): Promise<{ changed: boolean; plan: ShiftPlan }> {
   const plan = await fetchShiftPlan();
   const planJson = JSON.stringify(plan);
   const hash = createHash("sha256").update(planJson).digest("hex");
   const changed = DB.saveShiftPlanIfChanged(planJson, hash);
   return { changed, plan };
}

/* The latest stored plan, or null if we've never successfully fetched one. */
export function getStoredPlan(): ShiftPlan | null {
   const latest = DB.getLatestShiftPlan();
   return latest ? (JSON.parse(latest.planJson) as ShiftPlan) : null;
}

/* The plan in effect at a given instant (for historical / time-travel views).
   Falls back to null when no snapshot predates it. */
export function getStoredPlanAsOf(asOf: Date): ShiftPlan | null {
   const row = DB.getShiftPlanAsOf(asOf);
   return row ? (JSON.parse(row.planJson) as ShiftPlan) : null;
}

function berlinNow(): { weekday: Weekday | null; hour: number } {
   const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TIMEZONE,
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
   }).formatToParts(new Date());

   const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
   const hour = Number(parts.find((p) => p.type === "hour")?.value);
   const map: Record<string, Weekday | null> = {
      Mon: "monday",
      Tue: "tuesday",
      Wed: "wednesday",
      Thu: "thursday",
      Fri: "friday",
      Sat: null,
      Sun: null,
   };
   return { weekday: map[wd] ?? null, hour };
}

function hourToSlot(hour: number): Slot | null {
   if (hour >= 8 && hour < 10) return "08-10";
   if (hour >= 10 && hour < 12) return "10-12";
   if (hour >= 12 && hour < 14) return "12-14";
   if (hour >= 14 && hour < 16) return "14-16";
   if (hour >= 16 && hour < 18) return "16-18";
   if (hour >= 18 && hour < 20) return "18-20";
   return null;
}

/* The shift on right now, in the door's timezone. Returns null outside the
 * regular Mon–Fri 08:00–20:00 grid (the café may still be open without a shift);
 * `name` is null when the current slot exists but nobody is assigned. */
export function getCurrentShift(): { slot: Slot; name: string | null } | null {
   const plan = getStoredPlan();
   if (!plan) return null;
   const { weekday, hour } = berlinNow();
   if (!weekday) return null;
   const slot = hourToSlot(hour);
   if (!slot) return null;
   return { slot, name: plan[weekday][slot] };
}
