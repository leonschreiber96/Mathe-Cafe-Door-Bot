import TelegramBot from "./bot.js";
import database from "./database.js";
import DoorService from "./doorService.js";
import logger from "./logger.js";
import webServer from "./webServer.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_URL = process.env.DOOR_API_URL;
const IS_DEV = process.env.DEVELOPMENT === "1";

if (!BOT_TOKEN) {
   throw new Error("No bot token provided. Terminating...");
} else {
   console.log("✅ Bot token detected");
}

if (!API_URL) {
   throw new Error("No Mathe Cafe door api url provided. Terminating...");
} else {
   console.log("✅ Mathe Cafe door api url detected");
}

if (IS_DEV) console.log("💻 Starting in DEVELOPMENT mode (DEBUG messages active)");
else console.log("🚀 Starting in PRODUCTION mode (no DEBUG messages)");

const LOGGER = logger;
const DB = database;
const DOOR_SERVICE = new DoorService(API_URL, LOGGER, DB);
DOOR_SERVICE.initialize();
const BOT = new TelegramBot(BOT_TOKEN, LOGGER, DB, DOOR_SERVICE);

BOT.start();
console.log("🤖 Bot successfully started");

DOOR_SERVICE.startPolling(10_000);

const WEB_SERVER = webServer;
WEB_SERVER.listen();
