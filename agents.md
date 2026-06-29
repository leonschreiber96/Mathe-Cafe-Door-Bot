This project, "Mathe-Cafe-Door-Bot," is a Node.js/TypeScript application designed to monitor the status of a "Mathe Cafe Door" and provide updates via a Telegram bot and a web dashboard.

Here's a summary of its functionality:

*   **Door Status Monitoring:** The `DoorService` polls an external API for the door's status (OPEN, CLOSED, UNKNOWN, OFFLINE) and logs changes.
*   **Telegram Bot:** A `Telegraf` bot allows users to subscribe/unsubscribe to door status notifications and query the current status. It notifies subscribers of any changes.
*   **Data Persistence:** A SQLite database (`src/database.ts`) stores subscriber information, historical door status events, and application logs. It also calculates Key Performance Indicators (KPIs) related to door open times and streaks.
*   **Web Dashboard:** An `Express.js` web server (`src/webServer.ts`) serves a simple dashboard (`src/www/`) that displays the historical door events and calculated KPIs.
*   **Logging:** A custom logger (`src/logger.ts`) handles application logging, persisting logs to the database in production.

The project uses `nodemon` and `tsx` for development and relies on environment variables for configuration (e.g., `BOT_TOKEN`, `DOOR_API_URL`).

# Hand-Off 2026-06-29
## What is already working
- reading the door status
- sending change-notifications to the subscribers
- telegram chat commands for users
- showing the dashboard website and populating with the data
- logging as described above
- data persistence as described above
## Open Stuff
1. opening often spills over to the next day (e.g. fridays we close after midnight), which brings all kinds of weird behavior.
- opening streak stays alive, even if in reality nobody opens up the next day
-  the fig. 3 graph (First Open → Last Close) lookes very weird on days, where open and close are not strictly within the day itself (00:00 - 24:00)
- solution idea: custom, configurable day durations (default: days go from 03:00 - 03:00)
- even with configurable day durations it should recognize when a day spilled over and treat it differently for the statistics that i described above.
2. UI behavior
- Opening hour heatmap does not scale well to mobile devices. the heatmap spills over the card at some point and on mobile phones you have to scroll to the right to see it all
- Fig 6 (Open by Hour of Day) doesnt let me hover and inspect the hourly values
3. Getting current shift plan feature is wip
- currently it just works in the telegram bot and is implemented there. it should be in the data persistence. shift plans should be saved, also historically. shift plans always have the same 2-h slot pattern from 08:00 - 20:00.
- Todays shift plan should be on the dashboard website (at least show which shift it is currently, or if there is no official shift at all). cafe can still be open if there is no official shift.
- shift plan usually doesnt change during a semester, but potentially can. so scan for shift plan changes every x time units (can be configured in .env, defaults to 1 day)
4. Current academic period feature is not really implemented
- the dashbaord is supposed to have statistics for the currently ongoing academic period, not all time. I hard-coded some stuff for that, but the period isn't actually fetched
- The period can be fetched from https://www.tu.berlin/studieren/bewerben-und-einschreiben/fristen-termine
- the website contains a lot of other stuff as well. You are interested in the <table>s with headings like "Wintersemester 2025/2026" or similar. 
- the tables look like this: <table class="ce-table table-headerposition-0 table--striped table--full"><tbody><tr><td>Dauer des Semesters:</td><td>01.10.2025 bis 31.03.2026</td></tr><tr><td>Vorlesungszeit:</td><td>13.10.2025 bis 14.02.2026</td></tr><tr><td>Vorlesungsfreie Zeit:</td><td>22.12.2025 bis 03.01.2026 sowie an gesetzlichen Feiertagen</td></tr><tr><td>Rückmeldefrist:</td><td>bis 19.07.2025</td></tr><tr><td>Antragsfrist für Urlaubssemester:</td><td>bis 15.11.2025</td></tr><tr><td>Antragsfrist für Teilzeitstudium:</td><td>bis 15.11.2025</td></tr></tbody></table>.
- You can extract the dates from these tables and check what the current period is
- Here is a breakdown of how to interpret these tables (not trivial)
   - "Dauer des Semesters": This is the full duration of the semester. This is mostly a bureaucratic distinction around the edges.
   - Semester breaks partly the end of one semester (the part after the end of "Vorlesungszeit" until the end of "Dauer des Semesters") and partly the start of the next one (the part from the beginning of "Dauer des Semesters" until "Vorlesungszeit"). Still, semester breaks are the functional unit in which students think, rather than the official semester start and end dates.
   - "Vorlesungsfreie Zeit" should only be populated in winter semesters and is the time where the university is closed over the christmas period. this should also be its own thing and not be connected to the rest of the semester
- The dashboard should show only the data for the current period. Periods being one of the following
   - "Vorlesungsfreie Zeit", i.e. christmas break
   - current semester (inside "Vorlesungszeit")
   - current semester break (between end of one semester's "Vorlesungszeit", before start of new semester's "Vorlesungszeit")
- Read the web page yourself to see what i mean and figure out any potential issues with this plan
- semester periods dont change once being planned and published. but you dont know exactly when the new periods are published on the page. so scan every x time units for newly published semester period plans (defaults to once a week).
5. Notifying me about admin stuff
- the data crawling stuff should notify me when anything goes wrong. For that purpose i want to specify an admin chat id in the .env file and that should be notified by the telegram bot when either the acydemic period crawling or the shift plan crawling fails and what the reason was.
- when a new academic period duration has been published or y change in shift plan was detected, but everything went smoothly, still notify me about that
