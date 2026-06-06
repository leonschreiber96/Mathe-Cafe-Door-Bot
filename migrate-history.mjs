/* One-off migration: legacy per-minute poll log -> transitions-only SQLite DB.
 *
 * The legacy history.json is a single huge JSON array of
 *   { "timestamp": "ISO+00:00", "status": "open"|"closed"|"unknown" }
 * polled roughly every minute regardless of whether anything changed.
 *
 * The live app's `door_status` table only records *transitions*
 * (see src/database.ts saveDoorStatus). This script collapses the poll
 * log into transition rows that match that schema/semantics:
 *
 *   door_status(inserted_at TEXT PK, status TEXT, event_time TEXT)
 *     - status:     uppercased ("OPEN" | "CLOSED" | "UNKNOWN")
 *     - event_time: ISO timestamp of the first poll showing the new status
 *     - inserted_at: same instant (unique PK; de-duped if needed)
 *
 * Usage:
 *   node migrate-history.mjs <path-to-history.json> [output.db]
 *
 * Requires Node 22+ (node:sqlite). Streams the input so the 21 MB file
 * never has to be parsed all at once.
 */
import { createReadStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const INPUT = process.argv[2];
const OUTPUT = process.argv[3] || "src/data/mathe-cafe.db";

if (!INPUT) {
   console.error("Usage: node migrate-history.mjs <history.json> [output.db]");
   process.exit(1);
}

mkdirSync(dirname(OUTPUT), { recursive: true });
const db = new DatabaseSync(OUTPUT);
db.exec(`PRAGMA journal_mode = WAL`);
db.exec(`
   CREATE TABLE IF NOT EXISTS door_status (
      inserted_at TEXT PRIMARY KEY,
      status      TEXT NOT NULL,
      event_time  TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_door_status_lookup ON door_status(status, inserted_at DESC);
`);

const insert = db.prepare(
   "INSERT OR IGNORE INTO door_status (inserted_at, status, event_time) VALUES (?, ?, ?)",
);

const STATUS_MAP = { open: "OPEN", closed: "CLOSED", unknown: "UNKNOWN", offline: "OFFLINE" };

// Match one record's timestamp + status without parsing the whole array.
// Records look like: {"timestamp": "2025-10-30T22:51:03.594638+00:00", "status": "closed"}
const RECORD_RE = /\{\s*"timestamp"\s*:\s*"([^"]+)"\s*,\s*"status"\s*:\s*"([^"]+)"\s*\}/g;

let prevStatus = null;
let transitions = 0;
let totalRecords = 0;
const usedInsertedAt = new Set(); // guarantee PK uniqueness across same-ms collisions
let carry = ""; // buffer fragment spanning chunk boundaries

function flush(buf, isFinal) {
   RECORD_RE.lastIndex = 0;
   let lastMatchEnd = 0;
   let m;
   while ((m = RECORD_RE.exec(buf)) !== null) {
      lastMatchEnd = RECORD_RE.lastIndex;
      totalRecords++;
      const ts = m[1];
      const rawStatus = m[2].toLowerCase();
      const status = STATUS_MAP[rawStatus] || rawStatus.toUpperCase();

      if (status !== prevStatus) {
         // Transition observed at this poll's timestamp.
         let insertedAt = ts;
         // Ensure PK uniqueness (extremely unlikely collisions, but be safe).
         while (usedInsertedAt.has(insertedAt)) {
            insertedAt = insertedAt + "Z"; // perturb without breaking ISO ordering meaningfully
         }
         usedInsertedAt.add(insertedAt);
         insert.run(insertedAt, status, ts);
         transitions++;
         prevStatus = status;
      }
   }
   // Keep the trailing unmatched fragment (a record split across chunks) for next time.
   return isFinal ? "" : buf.slice(lastMatchEnd);
}

const stream = createReadStream(INPUT, { encoding: "utf8", highWaterMark: 1 << 20 });

db.exec("BEGIN");
stream.on("data", (chunk) => {
   carry += chunk;
   carry = flush(carry, false);
});
stream.on("end", () => {
   flush(carry, true);
   db.exec("COMMIT");

   const count = db.prepare("SELECT COUNT(*) AS c FROM door_status").get().c;
   const first = db.prepare("SELECT status, event_time FROM door_status ORDER BY event_time ASC LIMIT 1").get();
   const last = db.prepare("SELECT status, event_time FROM door_status ORDER BY event_time DESC LIMIT 1").get();
   const byStatus = db.prepare("SELECT status, COUNT(*) AS c FROM door_status GROUP BY status").all();

   console.log(`Read ${totalRecords.toLocaleString()} poll records.`);
   console.log(`Wrote ${transitions.toLocaleString()} transition rows (DB now has ${count}).`);
   console.log(`Range: ${first?.event_time} (${first?.status}) -> ${last?.event_time} (${last?.status})`);
   console.log("By status:", byStatus.map((r) => `${r.status}=${r.c}`).join(", "));
   db.close();
});
stream.on("error", (err) => {
   console.error("Stream error:", err.message);
   try {
      db.exec("ROLLBACK");
   } catch {}
   process.exit(1);
});
