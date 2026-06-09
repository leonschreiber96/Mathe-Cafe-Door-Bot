import { ChartFigure } from "./base-figure.js";
import { COL, gridScale, baseOpts } from "../core/chart-theme.js";
import { stipple } from "../core/printed-patterns.js";
import { minToHHMM } from "../core/format.js";
import { dailyStats } from "../core/data-service.js";

const toHours = (iso) => {
   if (!iso) return null;
   const d = new Date(iso);
   return d.getHours() + d.getMinutes() / 60;
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
      this._render({ days: dailyStats(events) });
   }

   _render(daily) {
      const ds = daily.days;
      const first = ds.map((d) => toHours(d.first_open));
      const last = ds.map((d) => toHours(d.last_close));

      const cfg = {
         type: "line",
         data: {
            labels: ds.map((d) => d.date.slice(5)),
            datasets: [
               {
                  label: "last close",
                  data: last,
                  borderColor: COL.closed,
                  borderWidth: 1.4,
                  pointRadius: 0,
                  tension: 0.25,
                  fill: "+1",
                  backgroundColor: stipple(COL.inkdim, 4, 0.6),
                  spanGaps: true,
               },
               {
                  label: "first open",
                  data: first,
                  borderColor: COL.open,
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
