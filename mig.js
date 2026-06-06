import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, "src", "data/mathe-cafe.db"));
const entries = JSON.parse(readFileSync(join(__dirname, "history.json"), "utf-8"));

// Sort ascending by timestamp (paranoia — should already be sorted)
entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

const insert = db.prepare("INSERT OR IGNORE INTO door_status (inserted_at, status, event_time) VALUES (?, ?, ?)");

let lastStatus = null;
let written = 0;

db.exec("BEGIN");
for (const entry of entries) {
   const status = entry.status.toUpperCase();
   const ts = new Date(entry.timestamp).toISOString();

   if (status !== lastStatus) {
      insert.run(ts, status, ts);
      lastStatus = status;
      written++;
   }
}
db.exec("COMMIT");

console.log(`✅ Migrated ${written} status change events (from ${entries.length} raw entries)`);
