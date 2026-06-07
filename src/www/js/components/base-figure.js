/* components/base-figure.js — shared base for every figure panel.
 *
 * A figure is a "sheet of paper" card with a small header (Fig. N label, title,
 * an optional right-aligned note) and a body. Subclasses describe themselves
 * declaratively via attributes in the HTML:
 *
 *   <door-hero fig="1" heading="Rolling open rate · last 90 min"
 *              note="trailing 90-min window · last 24 h"></door-hero>
 *
 * and implement two things:
 *   bodyHTML()        -> the inner markup for the card body (run once on connect)
 *   update(payload)   -> imperative, logic-only refresh with new data
 *
 * Subclasses never re-render the whole card on update — they mutate only the
 * pieces that changed (a canvas chart, a list, a value). That keeps each
 * component a single-purpose logic chunk, as requested.
 *
 * Light DOM (no shadow root) on purpose: Tailwind utility classes and the
 * global paper theme must reach inside, and the Tailwind Play CDN can't style
 * shadow trees.
 */
export class BaseFigure extends HTMLElement {
  connectedCallback() {
    if (this._built) return;       // guard against re-entrancy
    this._built = true;
    this.classList.add("rounded-panel", "sheet", "min-w-0");
    this.innerHTML = `
      ${this.headerHTML()}
      <div class="p-[14px]">${this.bodyHTML()}</div>`;
    this.afterRender?.();
  }

  headerHTML() {
    const fig = this.getAttribute("fig");
    const heading = this.getAttribute("heading") || "";
    const note = this.getAttribute("note");
    return `
      <div class="flex items-baseline justify-between gap-2 px-[14px] py-2.5 border-b border-linesoft">
        <div>
          ${fig ? `<div class="label !text-[10px]">Fig. ${fig}</div>` : ""}
          <h2 class="font-serif font-medium text-[14px] m-0">${heading}</h2>
        </div>
        ${note ? `<div class="text-[10.5px] caption font-serif" data-note>${note}</div>` : ""}
      </div>`;
  }

  /* override in subclasses */
  bodyHTML() { return ""; }

  /* convenience: scoped query inside this element */
  $(sel) { return this.querySelector(sel); }

  /* update the right-aligned header note text, if present */
  setNote(text) { const n = this.$("[data-note]"); if (n) n.textContent = text; }
}

/* Mixin-style helper for chart figures: manages one <canvas> and upserts a
 * Chart.js instance in place (create on first paint, mutate after). */
export class ChartFigure extends BaseFigure {
  constructor() { super(); this._chart = null; }

  /* height in px for the canvas; subclasses may override via `height` attr */
  canvasHeight() { return Number(this.getAttribute("height")) || 220; }

  bodyHTML() {
    return `<div class="relative w-full min-w-0">
      <canvas data-canvas class="!w-full" style="height:${this.canvasHeight()}px"></canvas>
    </div>`;
  }

  /* create-or-update the chart with a full Chart.js config */
  upsert(config) {
    if (this._chart) {
      this._chart.data = config.data;
      this._chart.options = config.options;
      this._chart.update("none");
    } else {
      this._chart = new window.Chart(this.$("[data-canvas]"), config);
    }
    return this._chart;
  }

  get chart() { return this._chart; }
}
