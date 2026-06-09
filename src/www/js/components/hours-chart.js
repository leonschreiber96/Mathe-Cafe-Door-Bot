import { ChartFigure } from "./base-figure.js";
import { COL, PERIOD_COL, gridScale, baseOpts } from "../core/chart-theme.js";
import { hatch } from "../core/printed-patterns.js";
import { dailyOpenHours } from "../core/data-service.js";

export class HoursChart extends ChartFigure {
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
      const days = dailyOpenHours(events);
      // periods hardcoded for now — wire up when period data exists in the API
      const periods = [{ id: "lecture", type: "lecture", label: "SS 2026" }];
      this._render({ daily: { days }, periods });
   }

   _render({ daily, periods }) {
      const ds = daily.days;
      const typeOf = (pid) => periods?.find((p) => p.id === pid)?.type || "lecture";
      const labelOf = (pid) => periods?.find((p) => p.id === pid)?.label || pid;

      const cfg = {
         type: "bar",
         data: {
            labels: ds.map((d) => d.date.slice(5)),
            datasets: [
               {
                  data: ds.map((d) => d.open_hours),
                  backgroundColor: ds.map((d) => hatch(PERIOD_COL[typeOf(d.period_id)] || COL.open, 1, 4, 0.9)),
                  borderColor: ds.map((d) => PERIOD_COL[typeOf(d.period_id)] || COL.open),
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
                     label: (i) => `${i.parsed.y.toFixed(1)} h open · ${labelOf(ds[i.dataIndex].period_id)}`,
                  },
               },
            },
         }),
      };
      this.upsert(cfg);
   }
}
