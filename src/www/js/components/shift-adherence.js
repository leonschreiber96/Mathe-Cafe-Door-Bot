import { BaseFigure } from "./base-figure.js";
import { WEEKDAYS_SHORT, WEEKDAYS_LONG } from "../core/format.js";

/* Fig: shift coverage — for each scheduled shift slot (weekday × 2h) in the
 * latest plan, what share of that slot the door was actually open during the
 * current period. Unscheduled slots are blank. Pure HTML/CSS grid. */

function heatColor(pct) {
   const t = Math.max(0, Math.min(1, pct / 100));
   const r = Math.round(246 + (31 - 246) * t);
   const g = Math.round(241 + (122 - 241) * t);
   const b = Math.round(228 + (82 - 228) * t);
   return `rgb(${r},${g},${b})`;
}

export class ShiftAdherence extends BaseFigure {
   bodyHTML() {
      return `
      <div data-grid class="shiftgrid"></div>
      <div class="flex items-center gap-1.5 text-[9.5px] text-inkfaint mt-2.5">
        <span>0%</span><div data-scale class="flex gap-0.5"></div><span>100%</span>
        <span class="ml-2">share of scheduled shift the door was open · blank = no shift</span>
      </div>`;
   }

   afterRender() {
      this.$("[data-scale]").innerHTML = [0, 20, 40, 60, 80, 100]
         .map((p) => `<i class="w-[13px] h-[13px] rounded-[2px] inline-block" style="background:${heatColor(p)}"></i>`)
         .join("");
   }

   connectedCallback() {
      super.connectedCallback?.();
      this._onData = (e) => this.update(e.detail.shiftAdherence);
      window.addEventListener("door:data", this._onData);
      if (window.fullData) this.update(window.fullData.shiftAdherence);
   }

   disconnectedCallback() {
      window.removeEventListener("door:data", this._onData);
   }

   update(adherence) {
      const grid = this.$("[data-grid]");
      if (!adherence || !adherence.slots) {
         grid.innerHTML = `<div class="text-[11px] text-inkfaint">No shift plan available yet.</div>`;
         return;
      }

      // header: blank corner + weekday names (Mon–Fri)
      let html = `<div></div>`;
      for (let wd = 0; wd < 5; wd++) html += `<div class="head">${WEEKDAYS_SHORT[wd]}</div>`;

      adherence.slots.forEach((slot, si) => {
         html += `<div class="rowlabel">${slot.replace("-", "–")}</div>`;
         for (let wd = 0; wd < 5; wd++) {
            const { name, pct } = adherence.grid[si][wd];
            if (!name) {
               html += `<div class="cell none"></div>`;
               continue;
            }
            const bg = pct == null ? "var(--paper-2)" : heatColor(pct);
            const ink = pct != null && pct > 55 ? "var(--paper)" : "var(--ink)";
            const label = pct == null ? "—" : `${pct}%`;
            const title = `${WEEKDAYS_LONG[wd]} ${slot} · ${name} · ${pct == null ? "no data" : pct + "% open"}`;
            html += `<div class="cell" style="background:${bg};color:${ink}" title="${title}">${label}</div>`;
         }
      });

      grid.innerHTML = html;
   }
}

customElements.define("door-shift-adherence", ShiftAdherence);
