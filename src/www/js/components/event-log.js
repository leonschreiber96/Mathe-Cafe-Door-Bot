import { BaseFigure } from "./base-figure.js";
import { fmtDateTime, fmtDur } from "../core/format.js";
import { intervals, now } from "../core/data-service.js";

function badgeCls(s) {
   const l = s.toLowerCase();
   return l === "open"
      ? "text-open border-open bg-opendim"
      : l === "closed"
        ? "text-closed border-closed bg-closeddim"
        : "text-unknown border-line bg-unknowndim";
}

export class EventLog extends BaseFigure {
   connectedCallback() {
      super.connectedCallback?.();
      this._onData = (e) => this.update(e.detail.openEvents30Days);
      window.addEventListener("door:data", this._onData);
      if (window.fullData) this.update(window.fullData.openEvents30Days);
   }

   disconnectedCallback() {
      window.removeEventListener("door:data", this._onData);
   }

   bodyHTML() {
      return `<div data-list class="text-[12px] max-h-[260px] overflow-auto scroll-thin"></div>`;
   }

   update(openEvents30Days) {
      const chronological = [...openEvents30Days].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      const ints = intervals(chronological, now()).slice().reverse();
      this.$("[data-list]").innerHTML = ints
         .slice(0, 60)
         .map((it) => {
            const dur = it.end != null ? (it.end - it.start) / 1000 : null;
            const durTxt = dur != null && dur > 0 ? fmtDur(dur) : "";
            return `<div class="grid grid-cols-[auto_70px_1fr] gap-2.5 py-[5px] px-0.5 border-b border-linesoft items-center last:border-0">
         <span class="text-inkfaint text-[11px]">${fmtDateTime(it.start)}</span>
         <span class="font-mono text-[10px] px-1.5 py-px border text-center tracking-[.3px] ${badgeCls(it.status)}">${it.status}</span>
         <span class="text-inkdim text-[11px]">${durTxt ? `held ${durTxt}` : ""}</span>
       </div>`;
         })
         .join("");
   }
}

customElements.define("door-log", EventLog);
