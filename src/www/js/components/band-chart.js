import { ChartFigure } from "./base-figure.js";
import { COL, gridScale, baseOpts } from "../core/chart-theme.js";
import { stipple } from "../core/printed-patterns.js";
import { minToHHMM } from "../core/format.js";

/**
 * @param {{status: string, timestamp: Date}[]} events
 */
function dailyStats(events) {
   const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
   const dates = [...new Set(sorted.map((e) => e.timestamp.toLocaleDateString("sv")))];

   return dates.map((date) => {
      const dayStart = new Date(date + "T00:00:00");
      const dayEnd = new Date(date + "T24:00:00");
      const isToday = date === new Date().toLocaleDateString("sv");

      const carryIn = sorted.filter((e) => e.timestamp < dayStart).at(-1);
      const dayEvts = sorted.filter((e) => e.timestamp >= dayStart && e.timestamp < dayEnd);

      const anchors = [];
      if (carryIn) anchors.push({ timestamp: dayStart, status: carryIn.status });
      anchors.push(...dayEvts);

      let openMs = 0,
         first_open = null,
         last_close = null;

      for (let i = 0; i < anchors.length; i++) {
         const start = anchors[i].timestamp;
         const end = anchors[i + 1]?.timestamp ?? (isToday ? new Date() : dayEnd);
         if (anchors[i].status === "OPEN") {
            openMs += end - start;
            if (!first_open) first_open = start;
            last_close = end;
         }
      }

      return { date, open_hours: openMs / 3_600_000, first_open, last_close };
   });
}

// store Dates directly — no ISO round-trip needed
const toHours = (d) => {
   if (!d) return null;
   const h = d.getHours() + d.getMinutes() / 60;
   return h === 0 ? 24 : h; // midnight clamp for spill-over days
};

export class BandChart extends ChartFigure {
   connectedCallback() {
      super.connectedCallback?.();
      this._onData = (e) => this.update(e.detail.openEvents30Days);
      window.addEventListener("door:data", this._onData);
      if (window.fullData) this.update(window.fullData.openEvents30Days);
   }

   disconnectedCallback() {
      window.removeEventListener("door:data", this._onData);
   }

   update(events) {
      this._render(dailyStats(events));
   }

   _render(ds) {
      const first = ds.map((d) => toHours(d.first_open));
      const last = ds.map((d) => toHours(d.last_close));

      const cfg = {
         type: "line",
         data: {
            labels: ds.map((d) => d.date.slice(5)),
            datasets: [
               {
                  label: "first open",
                  data: first,
                  borderColor: COL.open,
                  borderWidth: 1.4,
                  pointRadius: 0,
                  tension: 0.25,
                  fill: "+1",
                  backgroundColor: stipple(COL.inkdim, 4, 0.6),
                  spanGaps: true,
               },
               {
                  label: "last close",
                  data: last,
                  borderColor: COL.closed,
                  borderWidth: 1.4,
                  pointRadius: 0,
                  tension: 0.25,
                  spanGaps: true,
               },
            ],
         },
         options: baseOpts({
            scales: {
               x: gridScale({ ticks: { color: COL.inkdim, maxTicksLimit: 10 }, grid: { display: false } }),
               y: gridScale({
                  min: 6,
                  max: 24,
                  ticks: { color: COL.inkdim, callback: (v) => String(v).padStart(2, "0") + ":00", stepSize: 3 },
               }),
            },
            plugins: {
               legend: { display: false },
               tooltip: {
                  mode: "index",
                  intersect: false,
                  callbacks: {
                     title: (i) => ds[i[0].dataIndex].date,
                     label: (i) => `${i.dataset.label}: ${i.parsed.y == null ? "—" : minToHHMM(i.parsed.y * 60)}`,
                  },
               },
            },
         }),
      };
      this.upsert(cfg);
   }
}

customElements.define("door-band", BandChart);
