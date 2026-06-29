import * as cheerio from "cheerio";
import database, { type SemesterInput } from "./database.js";

/* Scrapes the TU Berlin "Fristen & Termine" page for semester dates and stores
 * them. The dashboard derives its "current period" (lecture time / Christmas
 * break / semester break) from these rows — see buildPeriods() in database.ts.
 *
 * The page lists each semester as an HTML <table> whose first cell labels the
 * row ("Dauer des Semesters", "Vorlesungszeit", "Vorlesungsfreie Zeit") and the
 * semester name ("Wintersemester 2025/2026") sits in a preceding heading. This
 * markup is brittle; parse failures are thrown so the scheduler can alert the
 * admin. */

const DB = database;
const SEMESTER_DATES_URL =
   process.env.SEMESTER_DATES_URL ?? "https://www.tu.berlin/studieren/bewerben-und-einschreiben/fristen-termine";

export type SemesterScanResult = { label: string; status: "new" | "updated" | "unchanged" };

/* "01.10.2025 bis 31.03.2026 sowie …" → { from: "2025-10-01", to: "2026-03-31" }. */
function parseRange(text: string | undefined): { from: string; to: string } | null {
   if (!text) return null;
   const m = text.match(/(\d{2})\.(\d{2})\.(\d{4})\s+bis\s+(\d{2})\.(\d{2})\.(\d{4})/);
   if (!m) return null;
   return { from: `${m[3]}-${m[2]}-${m[1]}`, to: `${m[6]}-${m[5]}-${m[4]}` };
}

/* Parse the page into semester records. Exported for testing/manual runs. */
export function parseSemesters(html: string): SemesterInput[] {
   const $ = cheerio.load(html);
   const out: SemesterInput[] = [];
   let lastLabel: string | null = null;

   $("h1, h2, h3, h4, table").each((_, el) => {
      if (el.tagName === "table") {
         const rows: Record<string, string> = {};
         $(el)
            .find("tr")
            .each((__, tr) => {
               const cells = $(tr)
                  .find("td, th")
                  .toArray()
                  .map((c) => $(c).text().replace(/\s+/g, " ").trim());
               if (cells.length >= 2) {
                  const key = cells[0].replace(/:$/, "").trim();
                  rows[key] = cells[1];
               }
            });

         if (!("Dauer des Semesters" in rows) && !("Vorlesungszeit" in rows)) return;

         const dauer = parseRange(rows["Dauer des Semesters"]);
         const vorlesung = parseRange(rows["Vorlesungszeit"]);
         const vlfrei = parseRange(rows["Vorlesungsfreie Zeit"]);

         out.push({
            label: lastLabel ?? "Unbekanntes Semester",
            dauer_from: dauer?.from ?? null,
            dauer_to: dauer?.to ?? null,
            vorlesung_from: vorlesung?.from ?? null,
            vorlesung_to: vorlesung?.to ?? null,
            vlfrei_from: vlfrei?.from ?? null,
            vlfrei_to: vlfrei?.to ?? null,
         });
      } else {
         const t = $(el).text().replace(/\s+/g, " ").trim();
         if (/(Winter|Sommer)semester\s+\d{4}/i.test(t)) lastLabel = t;
      }
   });

   return out;
}

/* Fetch, parse and upsert all semesters. Throws on network/parse failure. */
export async function fetchAndStoreSemesters(): Promise<SemesterScanResult[]> {
   const res = await fetch(SEMESTER_DATES_URL);
   if (!res.ok) {
      throw new Error(`Failed to fetch semester dates: ${res.status} ${res.statusText}`);
   }

   const semesters = parseSemesters(await res.text());
   if (!semesters.length) {
      throw new Error("No semester tables found on the dates page");
   }

   return semesters.map((s) => ({ label: s.label, status: DB.upsertSemester(s) }));
}
