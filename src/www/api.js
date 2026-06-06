/* Fetches dashboard data from the same origin that served the page
 * (so it works behind any host/port, e.g. the Raspberry Pi) and hands
 * it to the renderer. Refreshes periodically. */

const DASHBOARD_ENDPOINT = "/api/dashboard";
const REFRESH_MS = 60_000;

async function loadDashboard() {
   try {
      const res = await fetch(DASHBOARD_ENDPOINT, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      window.renderDashboard(data);
   } catch (err) {
      console.error("Failed to load dashboard data:", err);
      const note = document.getElementById("footnote");
      if (note) note.textContent = `Note. Could not load dashboard data (${err.message}).`;
   }
}

loadDashboard();
setInterval(loadDashboard, REFRESH_MS);
