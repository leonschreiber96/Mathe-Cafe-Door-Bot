/* components/status-card.js — <door-status>
 *
 * The live "is the door open right now?" card (top-left of the hero row).
 * Owns a stamped ink lamp, the big status word, the "since …" line, and two
 * inset stats (first open today, open streak). Logic-only update(status).
 */
import { fmtTime } from "../core/format.js";
import { now } from "../core/data-service.js";

export class StatusCard extends HTMLElement {
  connectedCallback() {
    if (this._built) return;
    this._built = true;
    this.dataset.st = "unknown";
    this.classList.add("rounded-panel", "sheet", "p-4", "flex", "flex-col", "gap-[14px]", "min-w-0");
    this.innerHTML = `
      <div class="flex items-center gap-[14px]">
        <div class="lamp w-[54px] h-[54px] rounded-[3px] grid place-items-center shrink-0"></div>
        <div>
          <div class="word font-serif text-[30px] font-semibold leading-none tracking-tight" data-word>—</div>
          <div class="text-[11.5px] text-inkdim mt-1" data-since>connecting…</div>
        </div>
      </div>
      <div class="flex gap-2.5">
        <div class="flex-1 border border-linesoft bg-panel2 px-2.5 py-2.5">
          <div class="label">First open today</div>
          <div class="font-mono text-[16px] mt-[3px]" data-first>—</div>
        </div>
        <div class="flex-1 border border-linesoft bg-panel2 px-2.5 py-2.5">
          <div class="label">Open streak</div>
          <div class="font-mono text-[16px] mt-[3px]" data-streak>— <small class="text-[10px] text-inkdim">days</small></div>
        </div>
      </div>`;
  }

  update(st) {
    if (!st) { this.dataset.st = "unknown"; return; }
    this.dataset.st = st.status;
    this.querySelector("[data-word]").textContent = st.status.toUpperCase();

    const since = new Date(st.since);
    const mins = Math.round((now().getTime() - since) / 60000);
    const dur = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
    this.querySelector("[data-since]").innerHTML = `since <b>${fmtTime(since)}</b> · ${dur}`;
    this.querySelector("[data-first]").textContent = st.first_open_today ? fmtTime(st.first_open_today) : "not yet";
    this.querySelector("[data-streak]").innerHTML =
      `${st.open_streak_days} <small class="text-[10px] text-inkdim">days</small>`;
  }
}
