import { ChartFigure } from "./base-figure.js";
import { COL, gridScale, baseOpts } from "../core/chart-theme.js";
import { hatch } from "../core/printed-patterns.js";

/* Fig: distribution of how long each open session lasts (current period).
 * Backend supplies pre-binned { label, count } buckets. */
export class SessionLengthChart extends ChartFigure {
   connectedCallback() {
      super.connectedCallback?.();
      this._onData = (e) => this.update(e.detail.sessionLengths);
      window.addEventListener("door:data", this._onData);
      if (window.fullData) this.update(window.fullData.sessionLengths);
   }

   disconnectedCallback() {
      window.removeEventListener("door:data", this._onData);
   }

   update(bins) {
      const data = bins || [];
      const cfg = {
         type: "bar",
         data: {
            labels: data.map((b) => b.label),
            datasets: [
               {
                  data: data.map((b) => b.count),
                  backgroundColor: hatch(COL.open, 1, 4, 0.9),
                  borderColor: COL.open,
                  borderWidth: 0.8,
                  borderRadius: 0,
                  barPercentage: 0.8,
               },
            ],
         },
         options: baseOpts({
            scales: {
               x: gridScale({ grid: { display: false }, ticks: { color: COL.inkdim } }),
               y: gridScale({ beginAtZero: true, ticks: { color: COL.inkdim, precision: 0 } }),
            },
            plugins: {
               legend: { display: false },
               tooltip: {
                  callbacks: {
                     title: (i) => `${data[i[0].dataIndex].label} sessions`,
                     label: (i) => `${i.parsed.y} ${i.parsed.y === 1 ? "session" : "sessions"}`,
                  },
               },
            },
         }),
      };
      this.upsert(cfg);
   }
}

customElements.define("door-session", SessionLengthChart);
