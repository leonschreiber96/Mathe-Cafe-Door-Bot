import { Context, Telegraf } from "telegraf";
import { type Logger } from "./logger.js";
import { Database } from "./database.js";
import DoorService, { DoorStatus } from "./doorService.js";

import * as cheerio from "cheerio";

type Slot = "08-10" | "10-12" | "12-14" | "14-16" | "16-18" | "18-20";
type Weekday = "monday" | "tuesday" | "wednesday" | "thursday" | "friday";

type TimeSlots = {
   [K in Slot]: string | null;
};

type ShiftPlan = {
   [K in Weekday]: TimeSlots;
};

class TelegramBot {
   private _logger: Logger;
   private _db: Database;
   private _bot: Telegraf;
   private _doorService: DoorService;
   private _shiftPlan?: ShiftPlan;

   constructor(botToken: string, logger: Logger, database: Database, doorService: DoorService) {
      this._logger = logger;
      this._db = database;
      this._doorService = doorService;

      this._bot = new Telegraf(botToken);
      this._bot.command("start", this.cmdStartHandler.bind(this));
      this._bot.command("subscribe", this.cmdSubscribeHandler.bind(this));
      this._bot.command("unsubscribe", this.cmdUnsubscribeHandler.bind(this));
      this._bot.command("status", this.cmdStatusHandler.bind(this));
      this._bot.command("schichtplan", this.cmdGetShiftPlan.bind(this));
   }

   public start() {
      this._bot.launch();
      this._doorService.onStatusChange(this.notifySubscribers.bind(this));
      process.once("SIGINT", () => this._bot.stop("SIGINT"));
      process.once("SIGTERM", () => this._bot.stop("SIGTERM"));
   }

   private notifySubscribers(status: DoorStatus) {
      const emoji = { OPEN: "🟢", UNKNOWN: "🟡", CLOSED: "🔴", OFFLINE: "🫥" };
      const text = `${emoji[status]} Cafe door is now: ${status}`;

      const subscribers = this._db.listSubscribers();
      for (const chatId of subscribers) {
         this._bot.telegram.sendMessage(chatId, text).catch((err) => {
            this._logger.error(`Failed to notify ${chatId}: ${err.message}`);
         });
      }
   }

   private cmdStartHandler(ctx: Context) {
      ctx.reply(
         `Hello! I will notify you when the cafe door opens or closes.
Use /subscribe to receive notifications and /unsubscribe to stop.
Use /status to check the current state.
Use /schichtplan to see today's shifts.`,
      );
   }

   private async getShiftPlan(): Promise<ShiftPlan> {
      const res = await fetch("https://wiki.mathe-cafe.de/en/schichtplan");
      if (!res.ok) {
         throw new Error(`Failed to fetch shift plan: ${res.status} ${res.statusText}`);
      }

      const html = await res.text();
      const $ = cheerio.load(html);

      const emptyDay = (): TimeSlots => ({
         "08-10": null,
         "10-12": null,
         "12-14": null,
         "14-16": null,
         "16-18": null,
         "18-20": null,
      });

      const plan: ShiftPlan = {
         monday: emptyDay(),
         tuesday: emptyDay(),
         wednesday: emptyDay(),
         thursday: emptyDay(),
         friday: emptyDay(),
      };

      const dayMap: Record<string, Weekday> = {
         Montag: "monday",
         Dienstag: "tuesday",
         Mittwoch: "wednesday",
         Donnerstag: "thursday",
         Freitag: "friday",
      };

      const slotMap: Record<string, Slot> = {
         "8h": "08-10",
         "10h": "10-12",
         "12h": "12-14",
         "14h": "14-16",
         "16h": "16-18",
         "18h": "18-20",
      };

      const table = $(".table-container table").first();
      if (!table.length) {
         throw new Error("Shift plan table not found");
      }

      const headers = table
         .find("thead th")
         .toArray()
         .map((th) => $(th).text().trim());

      table.find("tbody tr").each((_, tr) => {
         const cells = $(tr)
            .find("td")
            .toArray()
            .map((td) => $(td).text().replace(/\s+/g, " ").trim());

         const timeLabel = cells[0];
         const slot = slotMap[timeLabel];
         if (!slot) return;

         for (let col = 1; col < cells.length; col++) {
            const header = headers[col];
            const day = dayMap[header];
            if (!day) continue;

            const rawValue = cells[col];
            plan[day][slot] = rawValue.length > 0 ? rawValue : null;
         }
      });

      return plan;
   }

   private getBerlinWeekday(): Weekday | null {
      const weekday = new Intl.DateTimeFormat("en-US", {
         weekday: "short",
         timeZone: "Europe/Berlin",
      }).format(new Date());

      const weekdayMap: Record<string, Weekday | null> = {
         Mon: "monday",
         Tue: "tuesday",
         Wed: "wednesday",
         Thu: "thursday",
         Fri: "friday",
         Sat: null,
         Sun: null,
      };

      return weekdayMap[weekday] ?? null;
   }

   private escapeHtml(text: string): string {
      return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
   }

   private async cmdGetShiftPlan(ctx: Context) {
      try {
         if (!this._shiftPlan) {
            this._shiftPlan = await this.getShiftPlan();
         }

         const dayKey = this.getBerlinWeekday();

         const weekdayLabelMap: Record<Weekday, string> = {
            monday: "Montag",
            tuesday: "Dienstag",
            wednesday: "Mittwoch",
            thursday: "Donnerstag",
            friday: "Freitag",
         };

         if (!dayKey) {
            await ctx.reply("Heute gibt es keinen regulären Schichtplan 🎉");
            return;
         }

         const dayPlan = this._shiftPlan[dayKey];

         const shifts = (Object.entries(dayPlan) as [Slot, string | null][])
            .filter(([, value]) => value !== null)
            .map(([slot, value]) => `• <code>${slot}</code> — ${this.escapeHtml(value!)}`);

         const message =
            shifts.length > 0
               ? [`📅 <b>Schichten heute (${weekdayLabelMap[dayKey]})</b>`, "", ...shifts].join("\n")
               : `📅 <b>Schichten heute (${weekdayLabelMap[dayKey]})</b>\n\nKeine Schichten eingetragen.`;

         await ctx.reply(message, {
            parse_mode: "HTML",
         });
      } catch (err) {
         const message = err instanceof Error ? err.message : String(err);
         this._logger.error(`Failed to get shift plan: ${message}`);
         await ctx.reply("Konnte den Schichtplan gerade nicht laden.");
      }
   }

   private cmdSubscribeHandler(ctx: Context) {
      const user = ctx.message?.from;
      if (!user?.id) {
         ctx.reply("Could not determine your user id. Please contact the bot admin @leonschreiber96");
         return;
      }

      if (this._db.isSubscribed(user.id)) {
         ctx.reply("You are already subscribed. If this is a mistake, please contact the bot admin @leonschreiber96");
      } else {
         let username = "";
         if (user.username) username = user.username;
         else if (user.first_name || user.last_name) username = `${user.first_name} ${user.last_name}`.trim();

         this._db.subscribe({ username, chatId: user.id });
         ctx.reply("Subscribed to door notifications. You will receive updates.");
      }
   }

   private cmdUnsubscribeHandler(ctx: Context) {
      const user = ctx.message?.from;
      if (!user?.id) {
         ctx.reply("Could not determine your user id. Please contact the bot admin @leonschreiber96");
         return;
      }

      if (!this._db.isSubscribed(user.id)) {
         ctx.reply("You are not subscribed. If this is a mistake, please contact the bot admin @leonschreiber96");
      } else {
         this._db.unsubscribe(user.id);
         ctx.reply("Unsubscribed. You will no longer receive updates.");
      }
   }

   private cmdStatusHandler(ctx: Context) {
      const status = this._doorService.getStatus();
      const emoji = { OPEN: "🟢", UNKNOWN: "🟡", CLOSED: "🔴", OFFLINE: "🫥" };
      const text = `${emoji[status.status]} Cafe door is now: ${status.status} (last update: ${status.lastUpdated?.toLocaleTimeString()})`;

      ctx.reply(text).catch((err) => {
         this._logger.error(`Failed to send status to ${ctx.message?.from.id}: ${err.message}`);
      });
   }
}

export default TelegramBot;
