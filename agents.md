This project, "Mathe-Cafe-Door-Bot," is a Node.js/TypeScript application designed to monitor the status of a "Mathe Cafe Door" and provide updates via a Telegram bot and a web dashboard.

Here's a summary of its functionality:

*   **Door Status Monitoring:** The `DoorService` polls an external API for the door's status (OPEN, CLOSED, UNKNOWN, OFFLINE) and logs changes.
*   **Telegram Bot:** A `Telegraf` bot allows users to subscribe/unsubscribe to door status notifications and query the current status. It notifies subscribers of any changes.
*   **Data Persistence:** A SQLite database (`src/database.ts`) stores subscriber information, historical door status events, and application logs. It also calculates Key Performance Indicators (KPIs) related to door open times and streaks.
*   **Web Dashboard:** An `Express.js` web server (`src/webServer.ts`) serves a simple dashboard (`src/www/`) that displays the historical door events and calculated KPIs.
*   **Logging:** A custom logger (`src/logger.ts`) handles application logging, persisting logs to the database in production.

The project uses `nodemon` and `tsx` for development and relies on environment variables for configuration (e.g., `BOT_TOKEN`, `DOOR_API_URL`).