/* components/hours-chart.js — <door-hours> (Fig. 3)
 *
 * Hours the door was open per day for the last 30 days, as printed hatched
 * columns. Bar hue encodes the period type (lecture / break / exam).
 * Logic-only: update({ daily, periods }).
 */
import { ChartFigure } from "./base-figure.js";
import { COL, PERIOD_COL, gridScale, baseOpts } from "../core/chart-theme.js";
import { hatch } from "../core/printed-patterns.js";

export class HoursChart extends ChartFigure {
  update({ daily, periods }) {
    const ds = daily.days;
    const typeOf = (pid) => periods?.find((p) => p.id === pid)?.type || "lecture";
    const labelOf = (pid) => periods?.find((p) => p.id === pid)?.label || pid;

    const cfg = {
      type: "bar",
      data: {
        labels: ds.map((d) => d.date.slice(5)),
        datasets: [{
          data: ds.map((d) => d.open_hours),
          backgroundColor: ds.map((d) => hatch(PERIOD_COL[typeOf(d.period_id)] || COL.open, 1, 4, 0.9)),
          borderColor: ds.map((d) => PERIOD_COL[typeOf(d.period_id)] || COL.open),
          borderWidth: 0.8, borderRadius: 0, barPercentage: 0.92, categoryPercentage: 0.95,
        }],
      },
      options: baseOpts({
        scales: {
          x: gridScale({ ticks: { color: COL.inkdim, maxTicksLimit: 10 }, grid: { display: false } }),
          y: gridScale({ beginAtZero: true, ticks: { color: COL.inkdim, callback: (v) => v + "h" } }),
        },
        plugins: { legend: { display: false }, tooltip: { callbacks: {
          title: (i) => ds[i[0].dataIndex].date,
          label: (i) => `${i.parsed.y.toFixed(1)} h open · ${labelOf(ds[i.dataIndex].period_id)}`,
        } } },
      }),
    };
    this.upsert(cfg);
  }
}
