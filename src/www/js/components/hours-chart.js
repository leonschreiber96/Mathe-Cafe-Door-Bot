import { ChartFigure } from "./base-figure.js";
import { COL, PERIOD_COL, gridScale, baseOpts } from "../core/chart-theme.js";
import { hatch } from "../core/printed-patterns.js";

function dailyOpenHours(events) {
   const sorted = [...events]
      .map((e) => ({ ...e, timestamp: new Date(e.timestamp) }))
      .sort((a, b) => a.timestamp - b.timestamp);

   const dates = [...new Set(sorted.map((e) => e.timestamp.toISOString().slice(0, 10)))];

   return dates.map((date) => {
      const dayStart = new Date(date + "T00:00:00");
      const dayEnd = new Date(date + "T24:00:00");
      const isToday = date === new Date().toISOString().slice(0, 10);
      const effectiveEnd = isToday ? new Date() : dayEnd;

      const carryIn = sorted.filter((e) => e.timestamp < dayStart).at(-1);
      const dayEvts = sorted.filter((e) => e.timestamp >= dayStart && e.timestamp < dayEnd);

      const anchors = [];
      if (carryIn) anchors.push({ timestamp: dayStart, status: carryIn.status });
      anchors.push(...dayEvts);

      let openMs = 0;
      for (let i = 0; i < anchors.length; i++) {
         if (anchors[i].status !== "OPEN") continue;
         const start = anchors[i].timestamp;
         const end = anchors[i + 1]?.timestamp ?? effectiveEnd;
         openMs += end - start;
      }

      return { date, open_hours: openMs / 3_600_000 };
   });
}

export class HoursChart extends ChartFigure {
   connectedCallback() {
      super.connectedCallback?.();
      this._onData = (e) => this.update(e.detail);
      window.addEventListener("door:data", this._onData);
      if (window.fullData) this.update(window.fullData);
   }

   disconnectedCallback() {
      window.removeEventListener("door:data", this._onData);
   }

   update({ openEvents30Days, currentPeriod }) {
      this._render(dailyOpenHours(openEvents30Days), currentPeriod);
   }

   _render(ds, currentPeriod) {
      const col = PERIOD_COL[currentPeriod?.type] || COL.open;

      const cfg = {
         type: "bar",
         data: {
            labels: ds.map((d) => d.date.slice(5)),
            datasets: [
               {
                  data: ds.map((d) => d.open_hours),
                  backgroundColor: ds.map(() => hatch(col, 1, 4, 0.9)),
                  borderColor: ds.map(() => col),
                  borderWidth: 0.8,
                  borderRadius: 0,
                  barPercentage: 0.92,
                  categoryPercentage: 0.95,
               },
            ],
         },
         options: baseOpts({
            scales: {
               x: gridScale({ ticks: { color: COL.inkdim, maxTicksLimit: 10 }, grid: { display: false } }),
               y: gridScale({ beginAtZero: true, ticks: { color: COL.inkdim, callback: (v) => v + "h" } }),
            },
            plugins: {
               legend: { display: false },
               tooltip: {
                  callbacks: {
                     title: (i) => ds[i[0].dataIndex].date,
                     label: (i) => `${i.parsed.y.toFixed(1)} h open · ${currentPeriod?.label ?? ""}`,
                  },
               },
            },
         }),
      };
      this.upsert(cfg);
   }
}

customElements.define("door-hours", HoursChart);
