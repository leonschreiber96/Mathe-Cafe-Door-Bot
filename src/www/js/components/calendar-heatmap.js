import { BaseFigure } from "./base-figure.js";
import { WEEKDAYS_SHORT, WEEKDAYS_LONG, MONTHS_SHORT } from "../core/format.js";

/* Fig: a calendar grid (one cell per day across the current period, weeks as
 * rows) shaded by hours the door was open that day — a chronological view of the
 * café's rhythm, gaps and streaks. Pure HTML/CSS, no canvas. */

function heatColor(hours, max) {
   const t = Math.max(0, Math.min(1, hours / max));
   const r = Math.round(246 + (31 - 246) * t);
   const g = Math.round(241 + (122 - 241) * t);
   const b = Math.round(228 + (82 - 228) * t);
   return `rgb(${r},${g},${b})`;
}

const parse = (s) => new Date(s + "T00:00:00");
const mon0 = (d) => (d.getDay() + 6) % 7;

export class CalendarHeatmap extends BaseFigure {
   bodyHTML() {
      return `
      <div data-grid class="cal"></div>
      <div class="flex items-center gap-1.5 text-[9.5px] text-inkfaint mt-2.5">
        <span>0h</span><div data-scale class="flex gap-0.5"></div><span data-max>—</span>
        <span class="ml-2">hours open per day</span>
      </div>`;
   }

   connectedCallback() {
      super.connectedCallback?.();
      this._onData = (e) => this.update(e.detail.openByDate);
      window.addEventListener("door:data", this._onData);
      if (window.fullData) this.update(window.fullData.openByDate);
   }

   disconnectedCallback() {
      window.removeEventListener("door:data", this._onData);
   }

   update(days) {
      const data = days || [];
      if (!data.length) {
         this.$("[data-grid]").innerHTML = "";
         return;
      }

      // excluded days (e.g. Christmas) come through as hours === null → gap cells
      const hoursVals = data.map((d) => d.hours).filter((h) => h != null);
      const scaleMax = Math.max(6, Math.ceil(hoursVals.length ? Math.max(...hoursVals) : 0));

      // group into Monday-aligned weeks (rows); pad the first week's lead-in
      const weeks = [];
      let week = new Array(mon0(parse(data[0].date))).fill(null);
      for (const d of data) {
         week.push(d);
         if (week.length === 7) (weeks.push(week), (week = []));
      }
      if (week.length) {
         while (week.length < 7) week.push(null);
         weeks.push(week);
      }

      // header row: blank label cell + weekday names
      let html = `<div></div>`;
      for (let wd = 0; wd < 7; wd++) html += `<div class="head">${WEEKDAYS_SHORT[wd]}</div>`;

      // one grid row per week, labelled with the month when it changes
      let lastMonth = -1;
      for (const w of weeks) {
         const firstReal = w.find((c) => c);
         const m = firstReal ? parse(firstReal.date).getMonth() : lastMonth;
         html += `<div class="rowlabel">${m !== lastMonth ? MONTHS_SHORT[m] : ""}</div>`;
         lastMonth = m;

         for (let wd = 0; wd < 7; wd++) {
            const cell = w[wd];
            if (!cell) {
               html += `<div class="cell empty"></div>`;
               continue;
            }
            if (cell.hours == null) {
               html += `<div class="cell gap" title="${cell.date} · break (excluded)"></div>`;
               continue;
            }
            const title = `${WEEKDAYS_LONG[wd]}, ${cell.date} · ${cell.hours.toFixed(1)}h`;
            html += `<div class="cell" style="background:${heatColor(cell.hours, scaleMax)}" title="${title}"></div>`;
         }
      }

      this.$("[data-grid]").innerHTML = html;
      this.$("[data-max]").textContent = `${scaleMax}h`;
      this.$("[data-scale]").innerHTML = [0, 0.25, 0.5, 0.75, 1]
         .map(
            (f) =>
               `<i class="w-[13px] h-[13px] rounded-[2px] inline-block" style="background:${heatColor(f * scaleMax, scaleMax)}"></i>`,
         )
         .join("");
   }
}

customElements.define("door-calendar", CalendarHeatmap);
