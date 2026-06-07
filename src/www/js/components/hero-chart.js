/* components/hero-chart.js — <door-hero> (Fig. 1)
 *
 * Rolling open-rate line for the last 24 h: each point is the % of a trailing
 * window (CONFIG.ROLLING_WINDOW_MIN) the door was open. A recent-activity rate,
 * not a forecast. Printed look: diagonal-hatch area fill, dashed gridlines.
 * Logic-only: update(events).
 */
import { ChartFigure } from "./base-figure.js";
import { CONFIG } from "../config.js";
import { COL, gridScale, baseOpts } from "../core/chart-theme.js";
import { hatch } from "../core/printed-patterns.js";
import { rollingOpenRate, now } from "../core/data-service.js";
import { fmtTime } from "../core/format.js";

export class HeroChart extends ChartFigure {
  canvasHeight() { return 200; }

  bodyHTML() {
    const win = CONFIG.ROLLING_WINDOW_MIN;
    // canvas + an explanatory caption that reflects the configured window
    return super.bodyHTML() + `
      <p class="mt-2.5 text-[10.5px] leading-snug text-inkfaint italic font-serif">
        Share of each trailing ${win}-min window the door was open (open minutes ÷
        minutes with a known status). A recent-activity rate, not a forecast.</p>`;
  }

  update(events) {
    const ref = now();
    const pts = rollingOpenRate(events, ref, 24, CONFIG.ROLLING_WINDOW_MIN, 10);
    const hasTimeScale = window.Chart._adapters && window.Chart._adapters._date;
    const labels = pts.map((p) => p.t);
    const data = pts.map((p) => p.pct);

    const cfg = {
      type: "line",
      data: {
        labels: hasTimeScale ? labels : labels.map((d) => fmtTime(d)),
        datasets: [{
          data, borderColor: COL.open, borderWidth: 1.6, fill: true,
          backgroundColor: hatch(COL.open, 1, 6, 0.8),
          tension: 0.35, pointRadius: 0, spanGaps: true,
        }],
      },
      options: baseOpts({
        adapters: { date: { zone: CONFIG.TZ } },
        scales: {
          x: hasTimeScale
            ? gridScale({ type: "time", min: ref.getTime() - 24 * 3600e3, max: ref.getTime(),
                time: { unit: "hour", displayFormats: { hour: "HH:mm" } },
                ticks: { color: COL.inkdim, maxTicksLimit: 8 } })
            : gridScale({ ticks: { color: COL.inkdim, maxTicksLimit: 8,
                callback: (v, i) => i % 18 === 0 ? fmtTime(labels[i]) : "" } }),
          y: gridScale({ min: 0, max: 100, ticks: { color: COL.inkdim, callback: (v) => v + "%", stepSize: 25 } }),
        },
        plugins: { legend: { display: false }, tooltip: { callbacks: {
          title: (items) => fmtTime(items[0].parsed.x),
          label: (it) => it.parsed.y == null ? "no data" : `${it.parsed.y.toFixed(0)}% open`,
        } } },
      }),
    };
    this.upsert(cfg);
  }
}
