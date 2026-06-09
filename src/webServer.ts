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

app.use(express.static(path.join(__dirname, "www")));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "www", "index.html")));
app.get("/api/dashboard", getDashboardData);
app.get("/api/status", getStatus);
app.get("/api/events", getEvents);
app.get("/api/semesters", getSemesters);
app.get("/api/aggregate/daily", getAggregateDaily);
app.get("/api/aggregate/by-weekday", getAggregateByWeekday);
app.get("/api/aggregate/by-hour", getAggregateByHour);
app.get("/api/aggregate/heatmap", getAggregateHeatmap);
app.get("/api/aggregate/baseline", getAggregateBaseline);

app.get("/dev", (_: Request, res) => {
   res.json({
      openingStreak: 8, // 8 consecutive days the café opened — realistic for mid-semester

      currentPeriod: {
         type: "semester",
         label: "SS 2026",
      },

      // Last 30 days of door events — most recent first, as of June 9, 2026
      // Captures natural open/close cycles (a few sessions per day on busy days)
      openEvents30Days: [
         // June 9 (today, Monday) — currently open since morning
         { timestamp: "2026-06-09T16:30:00.000Z", status: "OPEN" },
         { timestamp: "2026-06-09T15:23:23.000Z", status: "CLOSED" },
         { timestamp: "2026-06-09T10:54:00.000Z", status: "OPEN" },
         { timestamp: "2026-06-09T10:23:23.000Z", status: "CLOSED" },
         { timestamp: "2026-06-09T09:14:00.000Z", status: "OPEN" },

         // June 8 (Sunday) — short opening, rare
         { timestamp: "2026-06-08T13:45:00.000Z", status: "CLOSED" },
         { timestamp: "2026-06-08T11:02:00.000Z", status: "OPEN" },

         // June 7 (Saturday) — closed all day
         // June 6 (Friday) — typical long day
         { timestamp: "2026-06-06T18:53:00.000Z", status: "CLOSED" },
         { timestamp: "2026-06-06T08:41:00.000Z", status: "OPEN" },

         // June 5 (Thursday) — two sessions
         { timestamp: "2026-06-05T19:10:00.000Z", status: "CLOSED" },
         { timestamp: "2026-06-05T13:30:00.000Z", status: "OPEN" },
         { timestamp: "2026-06-05T12:55:00.000Z", status: "CLOSED" },
         { timestamp: "2026-06-05T09:03:00.000Z", status: "OPEN" },

         // June 4 (Wednesday)
         { timestamp: "2026-06-04T18:20:00.000Z", status: "CLOSED" },
         { timestamp: "2026-06-04T08:55:00.000Z", status: "OPEN" },

         // June 3 (Tuesday)
         { timestamp: "2026-06-03T19:47:00.000Z", status: "CLOSED" },
         { timestamp: "2026-06-03T09:22:00.000Z", status: "OPEN" },

         // June 2 (Monday)
         { timestamp: "2026-06-02T18:05:00.000Z", status: "CLOSED" },
         { timestamp: "2026-06-02T08:50:00.000Z", status: "OPEN" },

         // May 30 (Friday)
         { timestamp: "2026-05-30T17:30:00.000Z", status: "CLOSED" },
         { timestamp: "2026-05-30T09:15:00.000Z", status: "OPEN" },

         // May 29 (Thursday) — two sessions
         { timestamp: "2026-05-29T19:00:00.000Z", status: "CLOSED" },
         { timestamp: "2026-05-29T14:10:00.000Z", status: "OPEN" },
         { timestamp: "2026-05-29T12:40:00.000Z", status: "CLOSED" },
         { timestamp: "2026-05-29T08:58:00.000Z", status: "OPEN" },

         // May 28 (Wednesday)
         { timestamp: "2026-05-28T18:45:00.000Z", status: "CLOSED" },
         { timestamp: "2026-05-28T09:00:00.000Z", status: "OPEN" },

         // May 27 (Tuesday — holiday Pfingstdienstag, closed)
         // May 26 (Whit Monday — public holiday, closed)
         // May 25 (Sunday), May 24 (Saturday) — closed

         // May 23 (Friday)
         { timestamp: "2026-05-23T17:55:00.000Z", status: "CLOSED" },
         { timestamp: "2026-05-23T09:30:00.000Z", status: "OPEN" },

         // May 22 (Thursday)
         { timestamp: "2026-05-22T18:30:00.000Z", status: "CLOSED" },
         { timestamp: "2026-05-22T09:10:00.000Z", status: "OPEN" },

         // May 21 (Wednesday)
         { timestamp: "2026-05-21T17:00:00.000Z", status: "CLOSED" },
         { timestamp: "2026-05-21T10:05:00.000Z", status: "OPEN" },

         // May 20 (Tuesday)
         { timestamp: "2026-05-20T19:15:00.000Z", status: "CLOSED" },
         { timestamp: "2026-05-20T09:45:00.000Z", status: "OPEN" },

         // May 19 (Monday)
         { timestamp: "2026-05-19T17:40:00.000Z", status: "CLOSED" },
         { timestamp: "2026-05-19T09:00:00.000Z", status: "OPEN" },
      ],

      // Opening heatmap: 7 days (Mon–Sun) × 24 hours
      // Values = % of weeks in the semester the café was open at that hour on that day
      openingHeatmap: [
         // Monday
         [0, 0, 0, 0, 0, 0, 0, 5, 30, 75, 88, 90, 85, 88, 87, 84, 80, 70, 55, 35, 18, 8, 2, 0],
         // Tuesday
         [0, 0, 0, 0, 0, 0, 0, 8, 35, 78, 90, 91, 87, 90, 88, 85, 82, 73, 58, 40, 20, 10, 3, 0],
         // Wednesday
         [0, 0, 0, 0, 0, 0, 0, 6, 28, 72, 85, 89, 83, 86, 84, 80, 77, 68, 50, 30, 15, 7, 2, 0],
         // Thursday
         [0, 0, 0, 0, 0, 0, 0, 8, 33, 76, 87, 90, 84, 88, 85, 82, 79, 71, 56, 38, 19, 9, 2, 0],
         // Friday
         [0, 0, 0, 0, 0, 0, 0, 5, 25, 65, 80, 84, 78, 81, 79, 72, 65, 50, 35, 18, 8, 3, 1, 0],
         // Saturday
         [0, 0, 0, 0, 0, 0, 0, 0, 5, 18, 30, 35, 28, 25, 20, 15, 10, 5, 2, 0, 0, 0, 0, 0],
         // Sunday
         [0, 0, 0, 0, 0, 0, 0, 0, 2, 8, 14, 18, 15, 12, 8, 5, 2, 0, 0, 0, 0, 0, 0, 0],
      ],

      // openByWeekday: total opening sessions per weekday [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
      // SS 2026 started ~April 1 — about 10 weeks in, ~50 weekdays
      openByWeekday: [38, 78, 78, 56, 35, 7, 3],

      // openByHour: total times café was open during each hour of day (0–23)
      openByHour: [0, 0, 0, 0, 0, 0, 1, 12, 55, 78, 78, 66, 82, 91, 93, 95, 87, 76, 43, 21, 23, 12, 4, 1],

      // openByWeekdayXHour: [7 days][24 hours] — cross-tab of weekday × hour opening counts
      openByWeekdayXHour: [
         // Monday
         [0, 0, 0, 0, 0, 0, 0, 3, 14, 29, 36, 38, 35, 37, 36, 34, 33, 28, 22, 14, 7, 3, 1, 0],
         // Tuesday
         [0, 0, 0, 0, 0, 0, 0, 4, 16, 31, 38, 40, 37, 39, 37, 35, 34, 30, 24, 16, 8, 4, 1, 0],
         // Wednesday
         [0, 0, 0, 0, 0, 0, 0, 3, 12, 28, 34, 37, 33, 35, 34, 32, 31, 27, 20, 12, 6, 3, 1, 0],
         // Thursday
         [0, 0, 0, 0, 0, 0, 0, 4, 15, 30, 36, 39, 34, 38, 36, 34, 32, 29, 23, 15, 7, 3, 1, 0],
         // Friday
         [0, 0, 0, 0, 0, 0, 0, 2, 11, 26, 33, 35, 31, 33, 32, 29, 26, 20, 14, 7, 3, 1, 0, 0],
         // Saturday
         [0, 0, 0, 0, 0, 0, 0, 0, 2, 7, 12, 14, 11, 10, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0],
         // Sunday
         [0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 5, 7, 6, 5, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0],
      ],
   });
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
