import { ChartFigure } from "./base-figure.js";
import { COL, gridScale, baseOpts } from "../core/chart-theme.js";
import { hatch } from "../core/printed-patterns.js";

/* Fig: session retention — f(x) = share of open sessions that lasted at least x.
 * A survival curve: starts at 100%, steps monotonically down, hits 0% at the
 * longest session. Backend supplies the exact step points { minutes, pct }.
 *
 * The x-axis is toggleable. Linear is the default (it reads as "the shape of a
 * normal day"), but real durations span seconds to ~22h, so most of the curve's
 * structure sits in the first few percent of a linear axis — the log view is
 * what makes the short-session end legible. */

const SEC = 1 / 60; // one second, in minutes

/* Human duration stops for the log axis, in minutes. Chart.js would otherwise
 * tick every power-of-ten multiple and the labels collide into mush. */
const LOG_TICKS = [SEC * 5, SEC * 15, 1, 5, 15, 60, 240, 720]; // 5s…12h

/* Round tick spacings for the linear axis, in minutes (1min … 24h). */
const LINEAR_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 240, 360, 720, 1440];
const linearStep = (max) => LINEAR_STEPS.find((s) => max / s <= 7) ?? 1440;
const multiplesUpTo = (step, max) => Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);

/* Compact duration label for ticks/tooltips: 5s · 90s · 12min · 2.5h */
function fmtLen(min) {
   if (min <= 0) return "0";
   if (min < 1) return `${Math.round(min * 60)}s`;
   if (min < 60) return `${min < 10 ? Math.round(min * 10) / 10 : Math.round(min)}min`;
   const h = min / 60;
   return `${h < 10 ? Math.round(h * 10) / 10 : Math.round(h)}h`;
}

export class SessionRetentionChart extends ChartFigure {
   constructor() {
      super();
      // Set before connect: the base class calls afterRender() (which paints the
      // toggle) from within its connectedCallback.
      this._scale = "linear"; // linear by default; log is opt-in per the toggle
      this._data = [];
   }

   connectedCallback() {
      super.connectedCallback?.();
      this._onData = (e) => this.update(e.detail.sessionRetention);
      window.addEventListener("door:data", this._onData);
      if (window.fullData) this.update(window.fullData.sessionRetention);
   }

   disconnectedCallback() {
      window.removeEventListener("door:data", this._onData);
   }

   /* canvas + a small "linear | log" scale toggle above it */
   bodyHTML() {
      return `
      <div class="flex justify-end mb-1.5">
        <div class="label flex items-center gap-1.5" data-toggle>
          <span>x-axis</span>
          <button data-scale="linear" class="underline underline-offset-2">linear</button>
          <span class="text-inkfaint">|</span>
          <button data-scale="log" class="hover:text-inkdim">log</button>
        </div>
      </div>
      ${super.bodyHTML()}`;
   }

   afterRender() {
      this._paintToggle();
      this.$("[data-toggle]").addEventListener("click", (e) => {
         const btn = e.target.closest("[data-scale]");
         if (!btn || btn.dataset.scale === this._scale) return;
         this._scale = btn.dataset.scale;
         this._paintToggle();
         this.update(this._data); // re-render with the other axis type
      });
   }

   _paintToggle() {
      for (const b of this.querySelectorAll("[data-scale]")) {
         const on = b.dataset.scale === this._scale;
         b.classList.toggle("underline", on);
         b.classList.toggle("underline-offset-2", on);
         b.classList.toggle("text-ink", on);
         b.classList.toggle("hover:text-inkdim", !on);
      }
   }

   update(points) {
      this._data = points || [];
      const log = this._scale === "log";

      // A log axis cannot plot x = 0 — that drops the curve's left anchor and
      // any zero-length blips, so the log view starts at the shortest session
      // that *can* be plotted. Pinning the axis min to it (rather than a fixed
      // floor) keeps the curve flush with the left edge.
      const data = (log ? this._data.filter((p) => p.minutes > 0) : this._data).map((p) => ({
         x: p.minutes,
         y: p.pct * 100,
      }));
      const xMin = data.length ? data[0].x : SEC; // shortest session (log view)
      const xMax = data.length ? data[data.length - 1].x : 60; // longest session

      const cfg = {
         type: "line",
         data: {
            datasets: [
               {
                  data,
                  borderColor: COL.open,
                  backgroundColor: hatch(COL.open, 1, 6, 0.8),
                  borderWidth: 1.4,
                  pointRadius: 0,
                  stepped: "before",
                  fill: true,
               },
            ],
         },
         options: baseOpts({
            // pointRadius 0 needs an index-mode hover or tooltips never fire
            interaction: { mode: "index", intersect: false },
            scales: {
               x: gridScale({
                  type: log ? "logarithmic" : "linear",
                  min: log ? xMin : 0,
                  max: xMax,
                  // Both axes get hand-picked stops. Chart.js would tick the log
                  // scale at every power-of-ten multiple (labels collide into
                  // mush), and pinning min+max above stops it honouring
                  // ticks.stepSize on the linear one (it lands on 4.2h/8.4h).
                  afterBuildTicks: (a) => {
                     a.ticks = (log ? LOG_TICKS.filter((v) => v >= a.min) : multiplesUpTo(linearStep(a.max), a.max))
                        .filter((v) => v <= a.max)
                        .map((value) => ({ value }));
                  },
                  ticks: {
                     color: COL.inkdim,
                     autoSkip: false,
                     callback: (v) => fmtLen(v),
                  },
               }),
               y: gridScale({
                  min: 0,
                  max: 100,
                  ticks: { color: COL.inkdim, stepSize: 25, callback: (v) => v + "%" },
               }),
            },
            plugins: {
               legend: { display: false },
               tooltip: {
                  callbacks: {
                     title: (i) => `at least ${fmtLen(i[0].parsed.x)}`,
                     label: (i) => `${i.parsed.y.toFixed(1)} % of sessions`,
                  },
               },
            },
         }),
      };
      this.upsert(cfg);
   }
}

customElements.define("door-retention", SessionRetentionChart);
