import database from "./database.js";

const DB = database;
const IS_DEV = process.env.DEVELOPMENT === "1";

const logger = {
   debug: (msg: string) => {
      if (IS_DEV) console.log(`[DEBUG] ${new Date().toISOString()} ${msg}`);
   },
   info: (msg: string) => {
      const ts = new Date().toISOString();
      console.log(`[INFO]  ${ts} ${msg}`);
      if (!IS_DEV) DB.saveLog("INFO", msg, ts);
   },
   warn: (msg: string) => {
      const ts = new Date().toISOString();
      console.warn(`[WARN]  ${new Date().toISOString()} ${msg}`);
      if (!IS_DEV) DB.saveLog("WARN", msg, ts);
   },
   error: (msg: string) => {
      const ts = new Date().toISOString();
      console.error(`[ERROR] ${new Date().toISOString()} ${msg}`);
      if (!IS_DEV) DB.saveLog("ERROR", msg, ts);
   },
};

type Logger = typeof logger;

export type { Logger };
export default logger;
