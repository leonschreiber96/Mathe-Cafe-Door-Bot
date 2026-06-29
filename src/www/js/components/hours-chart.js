import { ChartFigure } from "./base-figure.js";
import { COL, PERIOD_COL, gridScale, baseOpts } from "../core/chart-theme.js";
import { hatch } from "../core/printed-patterns.js";

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

   // openByDate covers every day of the current period (excluded days = null gap)
   update({ openByDate, currentPeriod }) {
      this._render(openByDate || [], currentPeriod);
   }

   _render(ds, currentPeriod) {
      const col = PERIOD_COL[currentPeriod?.type] || COL.open;

      // "YYYY-MM-DD" → German "DD.MM." (axis) / "DD.MM.YYYY" (tooltip)
      const deShort = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
      const deFull = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

      const cfg = {
         type: "bar",
         data: {
            labels: ds.map((d) => deShort(d.date)),
            datasets: [
               {
                  data: ds.map((d) => d.hours),
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
                     title: (i) => deFull(ds[i[0].dataIndex].date),
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
