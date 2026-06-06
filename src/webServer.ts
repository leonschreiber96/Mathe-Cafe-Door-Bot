import express from "express";
import path from "path";
import database from "./database.js";
import { fileURLToPath } from "url";
import { Request, Response, NextFunction } from "express";

const DB = database;
const WEB_SERVER_PORT = process.env.WEB_SERVER_PORT;

function getDashboardData(_: Request, res: Response, next: NextFunction) {
   const eventLog = DB.getEventHistory(30);
   const kpis = DB.getDailyKpis();
   res.json({ timestamp: new Date().toISOString(), eventLog, kpis });
   next();
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
