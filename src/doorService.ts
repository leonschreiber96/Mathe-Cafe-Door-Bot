import { Database } from "./database.js";
import { Logger } from "./logger.js";

type DoorStatus = "OPEN" | "CLOSED" | "UNKNOWN" | "OFFLINE";

class DoorService {
   private _lastStatus: DoorStatus = "UNKNOWN";
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
         this._lastStatus = last.status;
         this._lastApiTimestamp = last.status === "OFFLINE" ? null : last.eventTime;
         this._logger.info(`Restored last known status "${last.status}" from DB`);
      }

      // If the last recorded status wasn't OFFLINE, the process didn't shut down cleanly.
      // Write an OFFLINE row now to make the gap explicit in the DB.
      if (!process.env.DEVELOPMENT && (!last || last.status !== "OFFLINE")) {
         const now = new Date();
         this._db.saveDoorStatus("OFFLINE", now);
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
         status: this._lastStatus,
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

   private transitionToUnknown(): void {
      if (this._lastStatus !== "UNKNOWN") {
         const now = new Date();
         this._db.saveDoorStatus("UNKNOWN", now);
         this._lastStatus = "UNKNOWN";
         this._lastApiTimestamp = null; // reset: next good response must always log a transition
         this._logger.info(`Door status → UNKNOWN at ${now.toISOString()}`);
      }
   }

   private async updateDoorStatus(): Promise<void> {
      try {
         const { status, timestamp: apiTimestamp } = await this.fetchStatusFromApi();

         // Guard: clock skew / backward-drifting API timestamp
         if (this._lastApiTimestamp !== null && apiTimestamp < this._lastApiTimestamp) {
            this._logger.warn(
               `API timestamp went backward ` +
                  `(${apiTimestamp.toISOString()} < ${this._lastApiTimestamp.toISOString()}), ignoring poll`,
            );
            return;
         }

         const statusChanged = status !== this._lastStatus;
         const timestampChanged =
            this._lastApiTimestamp !== null && apiTimestamp.getTime() !== this._lastApiTimestamp.getTime();
         const isRecoveryPoll = this._lastApiTimestamp === null;

         if (statusChanged || isRecoveryPoll) {
            this._db.saveDoorStatus(status, apiTimestamp);

            if (statusChanged) {
               this._statusChangeSubscribers.forEach((sub) => {
                  sub.handler(status);
               });
            }

            this._logger.info(
               isRecoveryPoll && !statusChanged
                  ? `Door status recovered → ${status} at ${apiTimestamp.toISOString()}`
                  : `Door status → ${status} at ${apiTimestamp.toISOString()}`,
            );
         } else if (timestampChanged) {
            this._logger.debug(
               `API timestamp reset for ${status}: ` +
                  `${this._lastApiTimestamp!.toISOString()} → ${apiTimestamp.toISOString()}, no real change`,
            );
         }
         // Else: status and timestamp identical — silent, no DB write

         this._lastStatus = status;
         this._lastApiTimestamp = apiTimestamp;
      } catch (err: unknown) {
         if (err instanceof Error) {
            if (err.name === "TimeoutError") {
               this._logger.error("Failed to fetch door status: Request timed out!");
            } else {
               this._logger.error(`Failed to fetch door status: ${err.message}`);
            }
            this.transitionToUnknown();
         }
      }
   }
}

export type { DoorStatus };
export default DoorService;
