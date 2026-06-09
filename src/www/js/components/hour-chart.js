import { ChartFigure } from "./base-figure.js";
import { COL, gridScale, baseOpts } from "../core/chart-theme.js";
import { hatch } from "../core/printed-patterns.js";

export class HourChart extends ChartFigure {
   connectedCallback() {
      super.connectedCallback?.();
      this._onData = (e) => this.update(e.detail.openByHour);
      window.addEventListener("door:data", this._onData);
      if (window.fullData) this.update(window.fullData.openByHour);
   }

   disconnectedCallback() {
      window.removeEventListener("door:data", this._onData);
   }

   update(openByHour) {
      this._render(openByHour.map((open_pct, hour) => ({ hour, open_pct })));
   }

   _render(h) {
      const cfg = {
         type: "line",
         data: {
            labels: h.map((x) => String(x.hour).padStart(2, "0")),
            datasets: [
               {
                  data: h.map((x) => x.open_pct),
                  borderColor: COL.open,
                  borderWidth: 1.6,
                  fill: true,
                  backgroundColor: hatch(COL.open, 1, 6, 0.8),
                  tension: 0.4,
                  pointRadius: 0,
               },
            ],
         },
         options: baseOpts({
            scales: {
               x: gridScale({ grid: { display: false }, ticks: { color: COL.inkdim, maxTicksLimit: 12 } }),
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
                     title: (i) => `${h[i[0].dataIndex].hour}:00 – ${h[i[0].dataIndex].hour}:59`,
                     label: (i) => `${i.parsed.y.toFixed(1)}% open`,
                  },
               },
            },
         }),
      };
      this.upsert(cfg);
   }
}

customElements.define("door-hour", HourChart);
