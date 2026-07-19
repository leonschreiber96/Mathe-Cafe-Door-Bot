import { Database } from "./database.js";
import { Logger } from "./logger.js";

type DoorStatus = "OPEN" | "CLOSED" | "UNKNOWN" | "OFFLINE";

// A reading must repeat this many consecutive polls before it's treated as a
// real state change (hysteresis / debounce). This rides out a flaky sensor or
// API — a single timeout or momentary glitch never flips the door or notifies
// anyone. Configurable via STATUS_CONFIRMATIONS; at the 10s poll cadence the
// default (3) means genuine changes are confirmed within ~30s.
const REQUIRED_CONFIRMATIONS = Math.max(1, Number(process.env.STATUS_CONFIRMATIONS) || 3);

class DoorService {
   // The last status we've *committed* — written to the DB and reported to
   // callers. Only a debounced reading ever becomes the confirmed status.
   private _confirmedStatus: DoorStatus = "UNKNOWN";
   // The last OPEN/CLOSED we told subscribers about. UNKNOWN/OFFLINE never
   // update this, so a brief outage between two CLOSED periods is silent.
   private _lastNotifiedStatus: "OPEN" | "CLOSED" | null = null;
   // A pending reading that hasn't yet been seen enough times to confirm.
   private _candidate: { status: DoorStatus; eventTime: Date; streak: number } | null = null;
   private _lastApiTimestamp: Date | null = null; // from API response, not our clock

   private _pollingInterval?: number;
   private _isPolling: boolean = false;
   private _timeoutObject?: NodeJS.Timeout;

   private _logger: Logger;
   private _db: Database;

   private _statusChangeSubscribers: { id: number; handler: (status: DoorStatus) => void }[] = [];

   public readonly _doorApiUrl: string;

   constructor(apiUrl: string, logger: Logger, database: Database) {
      this._doorApiUrl = apiUrl;
      this._logger = logger;
      this._db = database;

      process.once("SIGINT", () => this.shutdown("SIGINT"));
      process.once("SIGTERM", () => this.shutdown("SIGTERM"));
      process.once("uncaughtException", (err) => {
         this._logger.error(`Uncaught exception: ${err.message}`);
         this.shutdown("uncaughtException");
         process.exit(1);
      });
   }

   get isPolling() {
      return this._isPolling;
   }

   get pollingInterval() {
      return this._pollingInterval;
   }

   public onStatusChange(handler: (status: DoorStatus) => void): number {
      const ids = this._statusChangeSubscribers.map((x) => x.id);
      const maxId = ids.sort().reverse()[0] || 0;
      const id = maxId + 1;
      this._statusChangeSubscribers.push({ id, handler });
      return id;
   }

   public offStatusChange(id: number): void {
      const index = this._statusChangeSubscribers.findIndex((x) => x.id === id);
      if (index !== -1) {
         this._statusChangeSubscribers.splice(index, 1);
      }
   }

   public async initialize(): Promise<void> {
      const last = this._db.getLastDoorStatus();

      if (last) {
         this._confirmedStatus = last.status;
         // Seed the notified state so we don't re-announce the same OPEN/CLOSED
         // right after a restart.
         this._lastNotifiedStatus = last.status === "OPEN" || last.status === "CLOSED" ? last.status : null;
         this._lastApiTimestamp = last.status === "OFFLINE" ? null : last.eventTime;
         this._logger.info(`Restored last known status "${last.status}" from DB`);
      }

      // If the last recorded status wasn't OFFLINE, the process didn't shut down cleanly.
      // Write an OFFLINE row now to make the gap explicit in the DB.
      if (!process.env.DEVELOPMENT && (!last || last.status !== "OFFLINE")) {
         const now = new Date();
         this._db.saveDoorStatus("OFFLINE", now);
         this._confirmedStatus = "OFFLINE"; // so the first confirmed reading records the recovery
         this._logger.warn(`No clean shutdown detected — wrote OFFLINE at ${now.toISOString()}`);
      }
   }

   public startPolling(interval: number) {
      this._isPolling = true;
      this._pollingInterval = interval;
      this.updateDoorStatus();
      this._timeoutObject = setInterval(this.updateDoorStatus.bind(this), interval);
   }

   public stopPolling() {
      if (this._timeoutObject) {
         clearInterval(this._timeoutObject);
         this._timeoutObject = undefined;
      }
      this._isPolling = false;
      this._pollingInterval = undefined;
      this._db.saveDoorStatus("OFFLINE", new Date());
      this._logger.info("Polling stopped → saved OFFLINE status");
   }

   public getStatus(): { status: DoorStatus; lastUpdated: Date | null } {
      return {
         status: this._confirmedStatus,
         lastUpdated: this._lastApiTimestamp,
      };
   }

   private shutdown(signal: string) {
      this._logger.info(`Received ${signal}, shutting down...`);
      this.stopPolling();
   }

   private async fetchStatusFromApi(): Promise<{ status: DoorStatus; timestamp: Date }> {
      this._logger.debug("Pulling door status...");
      const response = await fetch(this._doorApiUrl, {
         signal: AbortSignal.timeout(Math.round(this.pollingInterval! * 0.9)),
      });
      if (!response.ok) {
         throw new Error(`Received bad status code ${response.status} (${response.statusText})`);
      }

      const raw: { status: string; timestamp: string } = await response.json();
      this._logger.debug(`Received status ${raw.status}`);
      return {
         status: raw.status.toUpperCase() as DoorStatus,
         timestamp: new Date(raw.timestamp),
      };
   }

   private async updateDoorStatus(): Promise<void> {
      let reading: DoorStatus;
      let eventTime: Date;

      try {
         const { status, timestamp: apiTimestamp } = await this.fetchStatusFromApi();

         // Guard: clock skew / backward-drifting API timestamp. Drop the poll
         // entirely so it doesn't count toward a confirmation.
         if (this._lastApiTimestamp !== null && apiTimestamp < this._lastApiTimestamp) {
            this._logger.warn(
               `API timestamp went backward ` +
                  `(${apiTimestamp.toISOString()} < ${this._lastApiTimestamp.toISOString()}), ignoring poll`,
            );
            return;
         }

         this._lastApiTimestamp = apiTimestamp;
         reading = status;
         eventTime = apiTimestamp;
      } catch (err: unknown) {
         if (err instanceof Error && err.name === "TimeoutError") {
            this._logger.error("Failed to fetch door status: Request timed out!");
         } else if (err instanceof Error) {
            this._logger.error(`Failed to fetch door status: ${err.message}`);
         } else {
            this._logger.error(`Failed to fetch door status: ${String(err)}`);
         }
         // A failed poll is an UNKNOWN reading like any other — it must clear the
         // confirmation bar before it flips the door, so a single blip is a no-op.
         reading = "UNKNOWN";
         eventTime = new Date();
      }

      this.registerReading(reading, eventTime);
   }

   /* Debounce a single poll reading. Only once the same status has been seen
      REQUIRED_CONFIRMATIONS times in a row does it get committed — written to the
      DB and (for OPEN/CLOSED) fanned out to subscribers. This is what stops a
      flaky sensor from logging churn and spamming notifications. */
   private registerReading(reading: DoorStatus, eventTime: Date): void {
      if (this._candidate && this._candidate.status === reading) {
         this._candidate.streak += 1;
      } else {
         // New candidate — keep the *first* time we saw it as the event time, so
         // the recorded change reflects when it actually began, not when it was
         // confirmed REQUIRED_CONFIRMATIONS polls later.
         this._candidate = { status: reading, eventTime, streak: 1 };
      }

      if (this._candidate.streak < REQUIRED_CONFIRMATIONS) return;
      if (this._candidate.status === this._confirmedStatus) return; // already committed

      this.commitStatus(this._candidate.status, this._candidate.eventTime);
   }

   private commitStatus(status: DoorStatus, eventTime: Date): void {
      this._confirmedStatus = status;
      this._db.saveDoorStatus(status, eventTime);
      this._logger.info(`Door status confirmed → ${status} at ${eventTime.toISOString()}`);

      // Only notify on genuine OPEN⇄CLOSED changes. Transient UNKNOWN/OFFLINE
      // are recorded but never announced, and we never repeat the same state —
      // so an outage between two CLOSED periods stays silent.
      if ((status === "OPEN" || status === "CLOSED") && this._lastNotifiedStatus !== status) {
         this._lastNotifiedStatus = status;
         this._statusChangeSubscribers.forEach((sub) => sub.handler(status));
      }
   }
}

export type { DoorStatus };
export default DoorService;
