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

function getStatus(_: Request, res: Response) {
   try {
      res.json(DB.getLiveStatus());
   } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
   }
}

function getEvents(req: Request, res: Response) {
   try {
      const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
      res.json(DB.getEventsWindow(days));
   } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
   }
}

function getSemesters(_: Request, res: Response) {
   try {
      res.json(DB.getSemesters());
   } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
   }
}

function getAggregateDaily(req: Request, res: Response) {
   try {
      const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
      res.json(DB.getAggregateDaily(days));
   } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
   }
}

function getAggregateByWeekday(req: Request, res: Response) {
   try {
      const periodId = String(req.query.period_id ?? "");
      if (!periodId) {
         res.status(400).json({ error: "period_id is required" });
         return;
      }
      res.json(DB.getAggregateByWeekday(periodId));
   } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
   }
}

function getAggregateByHour(req: Request, res: Response) {
   try {
      const periodId = String(req.query.period_id ?? "");
      if (!periodId) {
         res.status(400).json({ error: "period_id is required" });
         return;
      }
      res.json(DB.getAggregateByHour(periodId));
   } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
   }
}

function getAggregateHeatmap(req: Request, res: Response) {
   try {
      const periodId = String(req.query.period_id ?? "");
      if (!periodId) {
         res.status(400).json({ error: "period_id is required" });
         return;
      }
      res.json(DB.getAggregateHeatmap(periodId));
   } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
   }
}

function getAggregateBaseline(req: Request, res: Response) {
   try {
      const periodId = String(req.query.period_id ?? "");
      if (!periodId) {
         res.status(400).json({ error: "period_id is required" });
         return;
      }
      res.json(DB.getAggregateBaseline(periodId));
   } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
   }
}

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Create a router that handles all routes relative to the mount point
const router = express.Router();

// Static files — serves www/index.html at /mathe-door-dashboard/
router.use(express.static(path.join(__dirname, "www")));

// API routes — all paths here are relative to /mathe-door-dashboard
router.get("/api/dashboard", getDashboardData);
router.get("/api/status", getStatus);
router.get("/api/events", getEvents);
router.get("/api/semesters", getSemesters);
router.get("/api/aggregate/daily", getAggregateDaily);
router.get("/api/aggregate/by-weekday", getAggregateByWeekday);
router.get("/api/aggregate/by-hour", getAggregateByHour);
router.get("/api/aggregate/heatmap", getAggregateHeatmap);
router.get("/api/aggregate/baseline", getAggregateBaseline);

// Mount everything under /mathe-door-dashboard
app.use("/mathe-door-dashboard", router);

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
