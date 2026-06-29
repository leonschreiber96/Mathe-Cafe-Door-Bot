import { ChartFigure } from "./base-figure.js";
import { COL, gridScale, baseOpts } from "../core/chart-theme.js";
import { hatch } from "../core/printed-patterns.js";

/* Fig: distribution of the time of day the café first opens. One count per day
 * (in the current period), bucketed by the hour of its first opening. */
export class FirstOpenChart extends ChartFigure {
   connectedCallback() {
      super.connectedCallback?.();
      this._onData = (e) => this.update(e.detail.firstOpenHistogram);
      window.addEventListener("door:data", this._onData);
      if (window.fullData) this.update(window.fullData.firstOpenHistogram);
   }

   disconnectedCallback() {
      window.removeEventListener("door:data", this._onData);
   }

   update(histogram) {
      const counts = histogram || [];
      // trim to the range of hours that actually have data (padded by one),
      // falling back to typical café hours when there's nothing yet.
      const nonZero = counts.map((c, h) => (c > 0 ? h : -1)).filter((h) => h >= 0);
      const lo = nonZero.length ? Math.max(0, Math.min(...nonZero) - 1) : 7;
      const hi = nonZero.length ? Math.min(23, Math.max(...nonZero) + 1) : 19;

      const hours = [];
      for (let h = lo; h <= hi; h++) hours.push(h);

      const cfg = {
         type: "bar",
         data: {
            labels: hours.map((h) => String(h).padStart(2, "0")),
            datasets: [
               {
                  data: hours.map((h) => counts[h] ?? 0),
                  backgroundColor: hatch(COL.open, 1, 4, 0.9),
                  borderColor: COL.open,
                  borderWidth: 0.8,
                  borderRadius: 0,
                  barPercentage: 0.92,
                  categoryPercentage: 0.95,
               },
            ],
         },
         options: baseOpts({
            scales: {
               x: gridScale({ grid: { display: false }, ticks: { color: COL.inkdim, maxTicksLimit: 14 } }),
               y: gridScale({ beginAtZero: true, ticks: { color: COL.inkdim, precision: 0 } }),
            },
            plugins: {
               legend: { display: false },
               tooltip: {
                  callbacks: {
                     title: (i) => `${hours[i[0].dataIndex]}:00 – ${hours[i[0].dataIndex]}:59`,
                     label: (i) => `${i.parsed.y} ${i.parsed.y === 1 ? "day" : "days"}`,
                  },
               },
            },
         }),
      };
      this.upsert(cfg);
   }
}

customElements.define("door-first-open", FirstOpenChart);
