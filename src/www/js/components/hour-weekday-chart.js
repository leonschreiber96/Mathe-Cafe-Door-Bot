import { ChartFigure } from "./base-figure.js";
import { COL, WD_COL, gridScale, baseOpts } from "../core/chart-theme.js";
import { WEEKDAYS_SHORT } from "../core/format.js";

export class HourWeekdayChart extends ChartFigure {
   canvasHeight() {
      return 300;
   }

   connectedCallback() {
      super.connectedCallback?.();
      this._onData = (e) => this.update(e.detail.openByWeekdayXHour);
      window.addEventListener("door:data", this._onData);
      if (window.fullData) this.update(window.fullData.openByWeekdayXHour);
   }

   disconnectedCallback() {
      window.removeEventListener("door:data", this._onData);
   }

   update(openByWeekdayXHour) {
      const labels = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
      const datasets = WEEKDAYS_SHORT.map((wd, i) => ({
         label: wd,
         data: openByWeekdayXHour[i].slice(0, 24),
         borderColor: WD_COL[i],
         backgroundColor: WD_COL[i],
         borderWidth: 1.4,
         borderDash: i >= 5 ? [5, 3] : [],
         tension: 0.35,
         pointRadius: 0,
         pointHoverRadius: 4,
         fill: false,
      }));

      const cfg = {
         type: "line",
         data: { labels, datasets },
         options: baseOpts({
            interaction: { mode: "index", intersect: false },
            scales: {
               x: gridScale({
                  grid: { display: false },
                  ticks: { color: COL.inkdim, maxTicksLimit: 12 },
                  title: { display: true, text: "hour of day", color: COL.inkfaint, font: { size: 9 } },
               }),
               y: gridScale({
                  beginAtZero: true,
                  max: 100,
                  ticks: { color: COL.inkdim, callback: (v) => v + "%", stepSize: 25 },
               }),
            },
            plugins: {
               legend: {
                  display: true,
                  position: "top",
                  align: "end",
                  labels: {
                     color: COL.inkdim,
                     boxWidth: 10,
                     boxHeight: 10,
                     usePointStyle: true,
                     pointStyle: "rectRounded",
                     padding: 10,
                     font: { size: 10 },
                  },
               },
               tooltip: {
                  callbacks: {
                     title: (i) =>
                        `${parseInt(labels[i[0].dataIndex], 10)}:00 – ${parseInt(labels[i[0].dataIndex], 10)}:59`,
                     label: (it) => ` ${it.dataset.label}: ${it.parsed.y.toFixed(1)}% open`,
                  },
               },
            },
         }),
      };
      this.upsert(cfg);
   }
}

customElements.define("door-hour-weekday", HourWeekdayChart);
