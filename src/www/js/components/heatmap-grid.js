import { BaseFigure } from "./base-figure.js";
import { WEEKDAYS_SHORT, WEEKDAYS_LONG } from "../core/format.js";

function heatColor(pct) {
   const t = Math.max(0, Math.min(1, pct / 100));
   const r = Math.round(246 + (31 - 246) * t);
   const g = Math.round(241 + (122 - 241) * t);
   const b = Math.round(228 + (82 - 228) * t);
   return `rgb(${r},${g},${b})`;
}

export class HeatmapGrid extends BaseFigure {
   bodyHTML() {
      return `
      <div data-grid class="heat"></div>
      <div class="flex items-center gap-1.5 text-[9.5px] text-inkfaint mt-2.5">
        <span>0%</span><div data-scale class="flex gap-0.5"></div><span>100%</span>
        <span class="ml-2">share of hour the door was open</span>
      </div>`;
   }

   afterRender() {
      this.$("[data-scale]").innerHTML = [0, 20, 40, 60, 80, 100]
         .map((p) => `<i class="w-[13px] h-[13px] rounded-[2px] inline-block" style="background:${heatColor(p)}"></i>`)
         .join("");
   }

   connectedCallback() {
      super.connectedCallback?.();
      this._onData = (e) => this.update(e.detail.openingHeatmap);
      window.addEventListener("door:data", this._onData);
      if (window.fullData) this.update(window.fullData.openingHeatmap);
   }

   disconnectedCallback() {
      window.removeEventListener("door:data", this._onData);
   }

   update(matrix) {
      let html = `<div></div>`;
      for (let hr = 0; hr < 24; hr++)
         html += `<div class="text-[8.5px] text-inkfaint text-center">${hr % 3 === 0 ? hr : ""}</div>`;
      for (let wd = 0; wd < 7; wd++) {
         html += `<div class="text-[10px] text-inkdim pr-1 text-right">${WEEKDAYS_SHORT[wd]}</div>`;
         for (let hr = 0; hr < 24; hr++) {
            const v = matrix[wd][hr];
            html += `<div class="cell" style="background:${heatColor(v)}" title="${WEEKDAYS_LONG[wd]} ${String(hr).padStart(2, "0")}:00 · ${v.toFixed(0)}% open"></div>`;
         }
      }
      this.$("[data-grid]").innerHTML = html;
   }
}

customElements.define("door-heatmap", HeatmapGrid);
