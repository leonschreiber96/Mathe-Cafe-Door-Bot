/* components/weekday-chart.js — <door-weekday> (Fig. 6)
 *
 * Average open-% by weekday over the whole current period. Hatched bars;
 * weekends use crosshatch to read apart. Logic-only: update(byWeekday).
 */
import { ChartFigure } from "./base-figure.js";
import { COL, gridScale, baseOpts } from "../core/chart-theme.js";
import { hatch, crosshatch } from "../core/printed-patterns.js";
import { WD, WD_LONG } from "../core/format.js";

export class WeekdayChart extends ChartFigure {
  update(byWeekday) {
    const w = byWeekday.weekdays;
    const cfg = {
      type: "bar",
      data: {
        labels: WD,
        datasets: [{
          data: w.map((x) => x.open_pct),
          backgroundColor: w.map((x) => x.weekday >= 5 ? crosshatch(COL.open, 5, 0.8) : hatch(COL.open, 1, 4, 0.9)),
          borderColor: COL.open, borderWidth: 0.8, borderRadius: 0, barPercentage: 0.7,
        }],
      },
      options: baseOpts({
        scales: {
          x: gridScale({ grid: { display: false }, ticks: { color: COL.inkdim } }),
          y: gridScale({ beginAtZero: true, max: 100, ticks: { color: COL.inkdim, callback: (v) => v + "%", stepSize: 25 } }),
        },
        plugins: { legend: { display: false }, tooltip: { callbacks: {
          title: (i) => WD_LONG[i[0].dataIndex],
          label: (i) => `${i.parsed.y.toFixed(1)}% open · ${w[i.dataIndex].avg_open_hours.toFixed(1)} h/day`,
        } } },
      }),
    };
    this.upsert(cfg);
  }
}
