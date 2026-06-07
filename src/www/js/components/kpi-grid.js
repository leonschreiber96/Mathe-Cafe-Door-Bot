/* components/kpi-grid.js — <door-kpis>
 *
 * The four summary cards under the hero. Each card is a printed stat with a
 * delta badge comparing today against the current-period baseline (open hours
 * so far, first open, period average, open days in the last 7).
 * Logic-only: update({ status, baseline, daily }).
 */
import { WD_LONG, fmtTime, minToHHMM } from "../core/format.js";
import { todayVsBaseline, now } from "../core/data-service.js";

/* a colour-coded delta pill (▲ up / ▼ down / — flat) */
function badge(arrow, text, cls) {
  const color = cls === "up" ? "text-open border-open bg-opendim"
    : cls === "down" ? "text-closed border-closed bg-closeddim"
    : "text-inkdim border-line bg-panel2";
  return `<span class="font-mono inline-flex items-center gap-1.5 mt-2 text-[11px] px-1.5 py-0.5 border ${color}">
    <span class="text-[10px]">${arrow}</span> ${text}</span>`;
}

function pctBadge(deltaPct) {
  const up = deltaPct > 1.5, down = deltaPct < -1.5;
  const cls = up ? "up" : down ? "down" : "flat";
  const arrow = up ? "▲" : down ? "▼" : "—";
  return badge(arrow, `${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(0)}%`, cls);
}

function card({ label, value, sub, badge: b, ctx }) {
  return `<div class="rounded-panel sheet px-[14px] py-[13px]">
    <div class="label">${label}</div>
    <div class="font-serif font-semibold text-[28px] text-ink mt-1.5 leading-none border-b border-linesoft pb-2">${value}${sub ? ` <small class="font-mono font-normal text-[12px] text-inkdim">${sub}</small>` : ""}</div>
    ${b || ""}
    ${ctx ? `<div class="text-[10px] text-inkfaint mt-2 italic font-serif">${ctx}</div>` : ""}
  </div>`;
}

export class KpiGrid extends HTMLElement {
  connectedCallback() {
    this.classList.add("grid", "gap-[14px]", "grid-cols-2", "lg:grid-cols-4");
  }

  update({ status: st, baseline, daily }) {
    const ref = now();
    const cmp = todayVsBaseline(st, baseline, ref);
    const wdLong = WD_LONG[(ref.getDay() + 6) % 7];

    // 1. open hours so far today vs usual BY THIS TIME
    const openH = (st?.open_seconds_today || 0) / 3600;
    let c1Badge = "", c1Ctx = `usual ${wdLong} this period`;
    if (cmp.openHours) {
      c1Badge = pctBadge(cmp.openHours.deltaPct);
      c1Ctx = cmp.openHours.byNow
        ? `vs ${cmp.openHours.baseline.toFixed(1)} h usual by now · ${wdLong}`
        : `vs ${cmp.openHours.baseline.toFixed(1)} h usual ${wdLong}`;
    }

    // 2. first open vs usual
    const c2v = st?.first_open_today ? fmtTime(st.first_open_today) : "—";
    let c2Badge = "", c2Ctx = `usual ${wdLong} this period`;
    if (cmp.firstOpen) {
      const dm = cmp.firstOpen.deltaMin, later = dm > 0;
      const cls = Math.abs(dm) < 8 ? "flat" : later ? "down" : "up";
      const arrow = Math.abs(dm) < 8 ? "—" : later ? "▲" : "▼";
      c2Badge = badge(arrow, `${later ? "+" : ""}${dm} min`, cls);
      c2Ctx = `${later ? `${dm} min later` : `${-dm} min earlier`} than usual (${minToHHMM(cmp.firstOpen.baseline)})`;
    }

    // 3. period average open hours/day
    const avg = baseline?.avg_open_hours_per_day;

    // 4. open days in the last 7
    const last7 = daily.days.slice(-7);
    const openDays = last7.filter((d) => d.open_hours > 0.25).length;

    this.innerHTML = [
      card({ label: "Open so far today", value: openH.toFixed(1), sub: "h", badge: c1Badge, ctx: c1Ctx }),
      card({ label: "First open", value: c2v, badge: c2Badge, ctx: c2Ctx }),
      card({ label: "Avg / day · period", value: avg != null ? avg.toFixed(1) : "—", sub: "h", ctx: "this semester / break" }),
      card({ label: "Open days · 7 d", value: `${openDays}`, sub: "/ 7", ctx: "days with any open time" }),
    ].join("");
  }
}
