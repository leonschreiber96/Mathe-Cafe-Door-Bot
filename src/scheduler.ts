import { type Logger } from "./logger.js";
import { fetchAndStoreShiftPlan } from "./shiftPlanService.js";
import { fetchAndStoreSemesters } from "./semesterService.js";

/* Periodically re-crawls the shift plan and the academic semester dates, stores
 * any changes, and pings the admin chat:
 *   - on failure (network/parse), with the reason;
 *   - on a detected change / newly-published data, with a short summary;
 *   - silently (log only) when nothing changed.
 *
 * Intervals are configurable via env (defaults: shift plan daily, semesters
 * weekly). Each scan also runs once shortly after boot. */

const SHIFT_PLAN_SCAN_MS = Number(process.env.SHIFT_PLAN_SCAN_MS ?? 24 * 60 * 60 * 1000);
const SEMESTER_SCAN_MS = Number(process.env.SEMESTER_SCAN_MS ?? 7 * 24 * 60 * 60 * 1000);

type Deps = {
   logger: Logger;
   notifyAdmin: (text: string) => Promise<void>;
};

async function scanShiftPlan({ logger, notifyAdmin }: Deps): Promise<void> {
   try {
      const { changed, plan } = await fetchAndStoreShiftPlan();
      if (changed) {
         logger.info("Shift plan change detected — stored new snapshot");
         const assigned = Object.values(plan)
            .flatMap((day) => Object.values(day))
            .filter((v) => v !== null).length;
         await notifyAdmin(`📅 Shift plan changed — stored a new snapshot (${assigned} slots assigned).`);
      } else {
         logger.debug("Shift plan scan: no change");
      }
   } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error(`Shift plan scan failed: ${reason}`);
      await notifyAdmin(`⚠️ Shift plan crawl failed: ${reason}`);
   }
}

async function scanSemesters({ logger, notifyAdmin }: Deps): Promise<void> {
   try {
      const results = await fetchAndStoreSemesters();
      const changed = results.filter((r) => r.status !== "unchanged");
      if (changed.length) {
         const summary = changed.map((r) => `${r.label} (${r.status})`).join(", ");
         logger.info(`Semester dates changed: ${summary}`);
         await notifyAdmin(`🎓 Academic period data updated: ${summary}`);
      } else {
         logger.debug("Semester scan: no change");
      }
   } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error(`Semester scan failed: ${reason}`);
      await notifyAdmin(`⚠️ Academic period crawl failed: ${reason}`);
   }
}

export function startScheduler(deps: Deps): void {
   // Run shortly after boot (don't block startup), then on the configured cadence.
   setTimeout(() => void scanShiftPlan(deps), 5_000);
   setTimeout(() => void scanSemesters(deps), 10_000);

   setInterval(() => void scanShiftPlan(deps), SHIFT_PLAN_SCAN_MS);
   setInterval(() => void scanSemesters(deps), SEMESTER_SCAN_MS);

   deps.logger.info(
      `Scheduler started (shift plan every ${Math.round(SHIFT_PLAN_SCAN_MS / 3_600_000)}h, ` +
         `semesters every ${Math.round(SEMESTER_SCAN_MS / 3_600_000)}h)`,
   );
}
