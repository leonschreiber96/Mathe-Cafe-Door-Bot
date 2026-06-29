import { Context, Telegraf } from "telegraf";
import { type Logger } from "./logger.js";
import { Database } from "./database.js";
import DoorService, { DoorStatus } from "./doorService.js";
import { fetchAndStoreShiftPlan, getStoredPlan, type Slot, type Weekday } from "./shiftPlanService.js";

const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

class TelegramBot {
   private _logger: Logger;
   private _db: Database;
   private _bot: Telegraf;
   private _doorService: DoorService;

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

   /* Send a message to the configured admin chat (crawler health, change
      notices). No-op with a warning when ADMIN_CHAT_ID is unset. */
   public async notifyAdmin(text: string): Promise<void> {
      if (!ADMIN_CHAT_ID) {
         this._logger.warn(`notifyAdmin called but ADMIN_CHAT_ID is not set. Message: ${text}`);
         return;
      }
      try {
         await this._bot.telegram.sendMessage(ADMIN_CHAT_ID, text);
      } catch (err) {
         this._logger.error(`Failed to notify admin: ${err instanceof Error ? err.message : String(err)}`);
      }
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
         // Read the persisted plan; fall back to a live fetch if we've never crawled.
         let plan = getStoredPlan();
         if (!plan) {
            plan = (await fetchAndStoreShiftPlan()).plan;
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

         const dayPlan = plan[dayKey];

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
