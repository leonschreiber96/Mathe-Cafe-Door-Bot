/* components/timeline-strip.js — <door-timeline> (Fig. 2) */
import { BaseFigure } from "./base-figure.js";
import { dayStartMs } from "../core/format.js";

export class TimelineStrip extends BaseFigure {
   bodyHTML() {
      return `
      <div data-track class="relative h-[42px] rounded-[7px] overflow-hidden border border-line bg-closeddim"></div>
      <div data-axis class="flex justify-between text-[9.5px] text-inkfaint mt-1.5">
         <span>00</span>
         <span>04</span>
         <span>08</span>
         <span>12</span>
         <span>16</span>
         <span>20</span>
         <span>24</span>
      </div>
      <div class="flex gap-3.5 text-[10.5px] text-inkdim mt-1">
        <span class="inline-flex items-center gap-1.5"><i class="w-2.5 h-2.5 rounded-[3px] inline-block bg-open"></i>open</span>
        <span class="inline-flex items-center gap-1.5"><i class="w-2.5 h-2.5 rounded-[3px] inline-block bg-closed"></i>closed</span>
        <span class="inline-flex items-center gap-1.5"><i class="w-2.5 h-2.5 rounded-[3px] inline-block bg-unknown"></i>unknown</span>
      </div>`;
   }

   connectedCallback() {
      super.connectedCallback?.();

      this._onData = (e) => this.update(e.detail.openEvents30Days);
      window.addEventListener("door:data", this._onData);

      if (window.fullData) this.update(window.fullData.openEvents30Days);
   }

   disconnectedCallback() {
      window.removeEventListener("door:data", this._onData);
   }

   todaySegments(events, ref) {
      const dayStart = new Date(ref);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(ref);
      dayEnd.setHours(24, 0, 0, 0);

      const toFrac = (date) => (date - dayStart) / (dayEnd - dayStart);

      // Oldest-first events that touch today
      const sorted = [...events]
         .map((e) => ({ ...e, timestamp: new Date(e.timestamp) }))
         .filter((e) => e.timestamp < dayEnd)
         .reverse();

      // Find carry-in: last event before today
      // Ensure you're finding the LAST event before dayStart (most recent)
      const carryIn = sorted.filter((e) => e.timestamp < dayStart).at(-1); // last = most recent before today

      // Events that actually fall within today
      const todayEvts = sorted.filter((e) => e.timestamp >= dayStart);

      // Build anchor points: [dayStart with carry-in status, ...today's events]
      const anchors = [];
      if (carryIn) anchors.push({ timestamp: dayStart, status: carryIn.status });
      anchors.push(...todayEvts);

      const isToday = dayStart.toDateString() === ref.toDateString();
      const effectiveEnd = isToday ? ref : dayEnd;

      return anchors.map((anchor, i) => ({
         status: anchor.status,
         startFrac: toFrac(anchor.timestamp),
         endFrac: toFrac(anchors[i + 1]?.timestamp ?? effectiveEnd),
      }));
   }

   nowFracOfDay(ref) {
      return (ref.getTime() - dayStartMs(ref)) / (24 * 3600e3);
   }

   update(events) {
      const refTime = new Date();
      const track = this.$("[data-track]");
      track.innerHTML = "";

      console.log(this.todaySegments(events, refTime));

      for (const s of this.todaySegments(events, refTime)) {
         if (s.status === "closed") continue;
         const el = document.createElement("div");
         el.className = `tl-seg ${s.status.toLowerCase()}`;
         el.style.left = s.startFrac * 100 + "%";
         el.style.width = (s.endFrac - s.startFrac) * 100 + "%";
         track.appendChild(el);
      }
      const nl = document.createElement("div");
      nl.className = "tl-now";
      nl.style.left = this.nowFracOfDay(refTime) * 100 + "%";
      track.appendChild(nl);
   }
}
