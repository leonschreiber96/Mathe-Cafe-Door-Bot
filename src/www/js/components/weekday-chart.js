import { ChartFigure } from "./base-figure.js";
import { COL, gridScale, baseOpts } from "../core/chart-theme.js";
import { hatch, crosshatch } from "../core/printed-patterns.js";
import { WD, WD_LONG } from "../core/format.js";

export class WeekdayChart extends ChartFigure {
   connectedCallback() {
      super.connectedCallback?.();
      this._onData = (e) => this.update(e.detail.openByWeekday);
      window.addEventListener("door:data", this._onData);
      if (window.fullData) this.update(window.fullData.openByWeekday);
   }

   disconnectedCallback() {
      window.removeEventListener("door:data", this._onData);
   }

   update(openByWeekday) {
      const w = openByWeekday.map((open_pct, weekday) => ({ weekday, open_pct }));
      const cfg = {
         type: "bar",
         data: {
            labels: WD,
            datasets: [
               {
                  data: w.map((x) => x.open_pct),
                  backgroundColor: w.map((x) =>
                     x.weekday >= 5 ? crosshatch(COL.open, 5, 0.8) : hatch(COL.open, 1, 4, 0.9),
                  ),
                  borderColor: COL.open,
                  borderWidth: 0.8,
                  borderRadius: 0,
                  barPercentage: 0.7,
               },
            ],
         },
         options: baseOpts({
            scales: {
               x: gridScale({ grid: { display: false }, ticks: { color: COL.inkdim } }),
               y: gridScale({
                  beginAtZero: true,
                  max: 100,
                  ticks: { color: COL.inkdim, callback: (v) => v + "%", stepSize: 25 },
               }),
            },
            plugins: {
               legend: { display: false },
               tooltip: {
                  callbacks: {
                     title: (i) => WD_LONG[i[0].dataIndex],
                     label: (i) => `${i.parsed.y.toFixed(1)}% open`,
                  },
               },
            },
         }),
      };
      this.upsert(cfg);
   }
}

customElements.define("door-weekday", WeekdayChart);
