/* components/status-card.js — <door-status>
 *
 * The live "is the door open right now?" card (top-left of the hero row).
 * Owns a stamped ink lamp, the big status word, the "since …" line, and two
 * inset stats (first open today, open streak). Logic-only update(status).
 */

export class StatusCard extends HTMLElement {
   connectedCallback() {
      if (this._built) return;
      this._built = true;
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

      this._onData = (e) => this.update(e.detail);
      window.addEventListener("door:data", this._onData);
      if (window.fullData) this.update(window.fullData);
   }

   disconnectedCallback() {
      window.removeEventListener("door:data", this._onData);
   }

   updateStatus(lastEvent) {
      // Status word
      this.dataset.st = lastEvent.status.toLowerCase();
      this.querySelector("[data-word]").textContent = lastEvent.status.toUpperCase();

      // Time since last event
      const msSince = new Date() - lastEvent.timestamp;
      const totalMins = Math.floor(msSince / 60_000);
      const hours = Math.floor(totalMins / 60);
      const mins = totalMins % 60;

      const lastEventTimeText = lastEvent.timestamp.toLocaleTimeString("de-DE", {
         hour: "2-digit",
         minute: "2-digit",
      });
      const timeElapsedText = hours > 0 ? `${hours} h ${mins} min` : `${mins} min`;

      this.querySelector("[data-since]").innerHTML = `since <b>${lastEventTimeText}</b> · ${timeElapsedText}`;
   }

   update(fullData) {
      const lastEvent = fullData.openEvents30Days[0];
      this.updateStatus(lastEvent);

      const todayStr = new Date().toLocaleDateString("sv");
      const eventsToday = fullData.openEvents30Days.filter((x) => x.timestamp.toLocaleDateString("sv") === todayStr);
      const firstOpenToday = eventsToday.find((x) => x.status === "OPEN");
      const hasAnyEventToday = eventsToday.length > 0;
      const isCurrentlyOpen = lastEvent.status === "OPEN";

      let firstText;
      if (firstOpenToday) {
         firstText = firstOpenToday.timestamp.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
      } else if (!hasAnyEventToday && isCurrentlyOpen) {
         firstText = "still open";
      } else {
         firstText = "not yet";
      }

      this.querySelector("[data-first]").textContent = firstText;
      this.querySelector("[data-streak]").textContent = `🔥 ${fullData.openingStreak} days`;
   }
}
