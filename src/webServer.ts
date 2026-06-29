import express from "express";
import path from "path";
import database from "./database.js";
import { getCurrentShift, getStoredPlanAsOf } from "./shiftPlanService.js";
import { fileURLToPath } from "url";
import { Request, Response } from "express";

const DB = database;
const WEB_SERVER_PORT = Number(process.env.WEB_SERVER_PORT) || 3000;

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.static(path.join(__dirname, "www")));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "www", "index.html")));

app.get("/api/dashboard", (req: Request, res: Response) => {
   try {
      // Time-travel: ?date=YYYY-MM-DD renders the dashboard as if it were the end
      // of that day. Clamped to "now" so today behaves like the live view. The
      // current shift is meaningless in the past, so it's only sent for today.
      const dateParam = typeof req.query.date === "string" ? req.query.date : undefined;
      const now = new Date();
      let asOf = now;
      let isToday = true;

      if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
         const endOfDay = new Date(`${dateParam}T23:59:59.999`);
         if (!Number.isNaN(endOfDay.getTime())) {
            asOf = endOfDay < now ? endOfDay : now;
            isToday = dateParam === now.toLocaleDateString("sv");
         }
      }

      res.json({
         ...DB.getDashboardData(asOf, getStoredPlanAsOf(asOf)),
         asOf: asOf.toISOString(),
         isToday,
         currentShift: isToday ? getCurrentShift() : null,
      });
   } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
   }
});

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
