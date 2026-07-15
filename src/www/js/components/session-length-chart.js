import { ChartFigure } from "./base-figure.js";
import { COL, gridScale, baseOpts } from "../core/chart-theme.js";
import { hatch } from "../core/printed-patterns.js";

/* Fig: how the period's total open time is distributed across session lengths.
 * Backend supplies pre-binned { label, hours, count } buckets; the bar is the
 * summed hours, so a swarm of accidental seconds-long sessions stays flat. */
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
                  data: data.map((b) => b.hours),
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
               y: gridScale({ beginAtZero: true, ticks: { color: COL.inkdim, callback: (v) => v + "h" } }),
            },
            plugins: {
               legend: { display: false },
               tooltip: {
                  callbacks: {
                     title: (i) => `${data[i[0].dataIndex].label} sessions`,
                     label: (i) => {
                        const b = data[i.dataIndex];
                        return `${b.hours.toFixed(1)} h open · ${b.count} ${b.count === 1 ? "session" : "sessions"}`;
                     },
                  },
               },
            },
         }),
      };
      this.upsert(cfg);
   }
}

customElements.define("door-session", SessionLengthChart);
