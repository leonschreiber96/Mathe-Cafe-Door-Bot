import express from "express";
import path from "path";
import database from "./database.js";
import { fileURLToPath } from "url";
import { Request, Response } from "express";

const DB = database;
const WEB_SERVER_PORT = Number(process.env.WEB_SERVER_PORT) || 3000;
const HISTORY_DAYS = 30;

function getDashboardData(_: Request, res: Response) {
   try {
      const eventLog = DB.getEventHistory(HISTORY_DAYS);
      const kpis = DB.getDailyKpis();
      res.json({ timestamp: new Date().toISOString(), days: HISTORY_DAYS, eventLog, kpis });
   } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
   }
}

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "www")));
app.use("/api/dashboard", getDashboardData);

const webServer = {
   listen: () => {
      app.listen(WEB_SERVER_PORT, () => {
         console.log(`🌐 Web server is running on port ${WEB_SERVER_PORT}`);
      });
   },
};

type WebServer = typeof webServer;

export type { WebServer };
export default webServer;
