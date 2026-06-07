/* components/timeline-strip.js — <door-timeline> (Fig. 2)
 *
 * A 24-hour bar of today (door zone). The track base is "closed"; open spans
 * are painted as solid ink segments, with a thin "now" marker line.
 * Logic-only: update(events).
 */
import { BaseFigure } from "./base-figure.js";
import { todaySegments, nowFracOfDay, now } from "../core/data-service.js";

export class TimelineStrip extends BaseFigure {
  bodyHTML() {
    return `
      <div data-track class="relative h-[42px] rounded-[7px] overflow-hidden border border-line bg-closeddim"></div>
      <div data-axis class="flex justify-between text-[9.5px] text-inkfaint mt-1.5"></div>
      <div class="flex gap-3.5 text-[10.5px] text-inkdim mt-1">
        <span class="inline-flex items-center gap-1.5"><i class="w-2.5 h-2.5 rounded-[3px] inline-block bg-open"></i>open</span>
        <span class="inline-flex items-center gap-1.5"><i class="w-2.5 h-2.5 rounded-[3px] inline-block bg-closed"></i>closed</span>
        <span class="inline-flex items-center gap-1.5"><i class="w-2.5 h-2.5 rounded-[3px] inline-block bg-unknown"></i>unknown</span>
      </div>`;
  }

  afterRender() {
    // static axis ticks, painted once
    this.$("[data-axis]").innerHTML =
      ["00", "04", "08", "12", "16", "20", "24"].map((h) => `<span>${h}</span>`).join("");
  }

  update(events) {
    const ref = now();
    const track = this.$("[data-track]");
    track.innerHTML = "";
    for (const s of todaySegments(events, ref)) {
      if (s.status === "closed") continue; // closed = the track base
      const el = document.createElement("div");
      el.className = `tl-seg ${s.status}`;
      el.style.left = (s.startFrac * 100) + "%";
      el.style.width = ((s.endFrac - s.startFrac) * 100) + "%";
      track.appendChild(el);
    }
    const nl = document.createElement("div");
    nl.className = "tl-now";
    nl.style.left = (nowFracOfDay(ref) * 100) + "%";
    track.appendChild(nl);
  }
}
