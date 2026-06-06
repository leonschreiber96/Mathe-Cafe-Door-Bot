/* DoorWatch dashboard rendering.
 *
 * All visualizations are derived client-side from a single event log:
 *   eventLog: [{ timestamp: ISO string, status: "OPEN"|"CLOSED"|"UNKNOWN"|"OFFLINE" }, ...]
 * plus a precomputed KPI object from the backend.
 *
 * The door is considered "open" only during OPEN intervals; CLOSED, UNKNOWN
 * and OFFLINE all count as not-open for duration math.
 */

const NAVY = "#003380";
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/* ---------- small helpers ---------- */

const pad2 = (n) => String(n).padStart(2, "0");
const fmtClock = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const startOfDay = (d) => {
   const x = new Date(d);
   x.setHours(0, 0, 0, 0);
   return x;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
const fmtShortDate = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;

const svgEl = (tag, attrs = {}, text) => {
   const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
   for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
   if (text != null) el.textContent = text;
   return el;
};

/* Build a fresh <svg> with a viewBox; returns {svg, W, H}. */
const makeSvg = (W, H) => {
   const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMidYMid meet" });
   return { svg, W, H };
};

/* ---------- core: turn events into OPEN intervals ---------- */

/* Returns sorted intervals [{start: Date, end: Date}] where the door was OPEN.
 * The final OPEN interval (if the door is currently open) ends at `now`. */
function buildOpenIntervals(events, now) {
   const sorted = [...events].sort((a, b) => a.t - b.t);
   const intervals = [];
   let openStart = null;
   for (const e of sorted) {
      if (e.status === "OPEN") {
         if (openStart === null) openStart = e.t;
      } else if (openStart !== null) {
         if (e.t > openStart) intervals.push({ start: openStart, end: e.t });
         openStart = null;
      }
   }
   if (openStart !== null && now > openStart) {
      intervals.push({ start: openStart, end: now });
   }
   return intervals;
}

/* Sum open ms per local day across a set of intervals (splits at midnight). */
function openMsByDay(intervals) {
   const map = new Map();
   for (const { start, end } of intervals) {
      let cursor = new Date(start);
      while (cursor < end) {
         const dEnd = startOfDay(cursor);
         dEnd.setDate(dEnd.getDate() + 1);
         const segEnd = end < dEnd ? end : dEnd;
         const key = dayKey(cursor);
         map.set(key, (map.get(key) || 0) + (segEnd - cursor));
         cursor = segEnd;
      }
   }
   return map;
}

/* ---------- topbar + KPIs ---------- */

function renderTopbar(state) {
   const { events, now } = state;
   const last = events[events.length - 1];
   const statusWord = last ? last.status[0] + last.status.slice(1).toLowerCase() : "Unknown";
   document.getElementById("status-label").textContent = `Status: ${statusWord}`;

   // "Last Closed / Last Opened" depending on current state.
   let label = "Last change: —";
   if (last) {
      if (last.status === "OPEN") {
         label = `Open since: ${fmtClock(last.t)}`;
      } else {
         const verb = last.status === "CLOSED" ? "Last Closed" : `Last ${statusWord}`;
         label = `${verb}: ${fmtClock(last.t)}`;
      }
   }
   document.getElementById("last-change").textContent = label;
   document.getElementById("today-date").textContent = fmtDate(now);
}

function renderKpis(kpis) {
   const openTodayEl = document.getElementById("kpi-open-today");
   const noteEl = document.getElementById("kpi-open-today-note");
   openTodayEl.textContent = `${(kpis.openToday ?? 0).toFixed(1)}h`;
   noteEl.textContent = `${kpis.openTodayPercent ?? 0}% of today`;

   const fo = kpis.firstOpened;
   document.getElementById("kpi-first-opened").textContent = fo ? `${pad2(fo.h)}:${pad2(fo.m)}` : "—";

   document.getElementById("kpi-avg-daily").textContent = `${(kpis.avgDailyOpen ?? 0).toFixed(1)}h`;
   document.getElementById("kpi-opening-streak").textContent = `${kpis.openingStreak ?? 0} days`;
}

/* ---------- Figure 1: daily open-duration bars ---------- */

function renderDailyBars(state) {
   const { intervals, now } = state;
   const W = 700,
      H = 320;
   const m = { top: 16, right: 16, bottom: 34, left: 40 };
   const { svg } = makeSvg(W, H);

   // Last 30 days inclusive of today.
   const days = [];
   const today0 = startOfDay(now);
   for (let i = 29; i >= 0; i--) {
      const d = new Date(today0);
      d.setDate(d.getDate() - i);
      days.push(d);
   }
   const byDay = openMsByDay(intervals);
   const hours = days.map((d) => (byDay.get(dayKey(d)) || 0) / HOUR_MS);
   const maxH = Math.max(4, Math.ceil(Math.max(...hours) / 4) * 4);

   const plotW = W - m.left - m.right;
   const plotH = H - m.top - m.bottom;
   const x = (i) => m.left + (i + 0.5) * (plotW / days.length);
   const bw = (plotW / days.length) * 0.7;
   const y = (h) => m.top + plotH - (h / maxH) * plotH;

   // Y grid + ticks (0..maxH step 4)
   for (let t = 0; t <= maxH; t += 4) {
      const yy = y(t);
      svg.appendChild(svgEl("line", { x1: m.left, y1: yy, x2: W - m.right, y2: yy, class: "grid-line" }));
      svg.appendChild(svgEl("text", { x: m.left - 6, y: yy + 4, "text-anchor": "end", class: "tick-text" }, String(t)));
   }
   // Axis lines
   svg.appendChild(svgEl("line", { x1: m.left, y1: m.top, x2: m.left, y2: m.top + plotH, class: "ax-line" }));
   svg.appendChild(svgEl("line", { x1: m.left, y1: m.top + plotH, x2: W - m.right, y2: m.top + plotH, class: "ax-line" }));
   svg.appendChild(svgEl("text", { x: 12, y: m.top + plotH / 2, transform: `rotate(-90 12 ${m.top + plotH / 2})`, "text-anchor": "middle", class: "axis-title" }, "Hours"));

   // Bars
   hours.forEach((h, i) => {
      if (h <= 0) return;
      const isToday = i === days.length - 1;
      svg.appendChild(
         svgEl("rect", {
            x: x(i) - bw / 2,
            y: y(h),
            width: bw,
            height: m.top + plotH - y(h),
            class: isToday ? "bar-today" : "bar",
         }),
      );
   });

   // X tick labels every ~4 days
   days.forEach((d, i) => {
      if (i % 4 !== 0 && i !== days.length - 1) return;
      svg.appendChild(svgEl("text", { x: x(i), y: H - 12, "text-anchor": "middle", class: "tick-text" }, fmtShortDate(d)));
   });

   const host = document.getElementById("fig-daily");
   host.replaceChildren(svg);
}

/* ---------- Figure 2: cumulative open time today ---------- */

function renderCumulativeToday(state) {
   const { intervals, now } = state;
   const W = 700,
      H = 320;
   const m = { top: 16, right: 16, bottom: 34, left: 44 };
   const { svg } = makeSvg(W, H);

   const today0 = startOfDay(now);
   const dayEnd = new Date(today0);
   dayEnd.setDate(dayEnd.getDate() + 1);

   // Clip intervals to today, build a step series of cumulative open-hours.
   const todays = intervals
      .map(({ start, end }) => ({
         start: new Date(Math.max(start.getTime(), today0.getTime())),
         end: new Date(Math.min(end.getTime(), now.getTime())),
      }))
      .filter((iv) => iv.end > iv.start)
      .sort((a, b) => a.start - b.start);

   // Points: (time, cumulativeHours). Flat between intervals.
   const pts = [{ t: today0.getTime(), v: 0 }];
   let cum = 0;
   for (const iv of todays) {
      pts.push({ t: iv.start.getTime(), v: cum }); // flat up to open
      cum += (iv.end - iv.start) / HOUR_MS;
      pts.push({ t: iv.end.getTime(), v: cum }); // rise during open
   }
   pts.push({ t: now.getTime(), v: cum });

   const maxV = Math.max(1, Math.ceil(cum));
   const plotW = W - m.left - m.right;
   const plotH = H - m.top - m.bottom;
   const x = (t) => m.left + ((t - today0.getTime()) / DAY_MS) * plotW;
   const y = (v) => m.top + plotH - (v / maxV) * plotH;

   // Y grid/ticks
   const stepY = maxV <= 8 ? 1 : Math.ceil(maxV / 8);
   for (let t = 0; t <= maxV; t += stepY) {
      const yy = y(t);
      svg.appendChild(svgEl("line", { x1: m.left, y1: yy, x2: W - m.right, y2: yy, class: "grid-line" }));
      svg.appendChild(svgEl("text", { x: m.left - 6, y: yy + 4, "text-anchor": "end", class: "tick-text" }, `${t}h`));
   }
   // X ticks every 3 hours
   for (let hh = 0; hh <= 24; hh += 3) {
      const xx = x(today0.getTime() + hh * HOUR_MS);
      svg.appendChild(svgEl("text", { x: xx, y: H - 12, "text-anchor": "middle", class: "tick-text" }, `${pad2(hh % 24)}:00`));
   }
   svg.appendChild(svgEl("line", { x1: m.left, y1: m.top, x2: m.left, y2: m.top + plotH, class: "ax-line" }));
   svg.appendChild(svgEl("line", { x1: m.left, y1: m.top + plotH, x2: W - m.right, y2: m.top + plotH, class: "ax-line" }));
   svg.appendChild(svgEl("text", { x: 12, y: m.top + plotH / 2, transform: `rotate(-90 12 ${m.top + plotH / 2})`, "text-anchor": "middle", class: "axis-title" }, "Hours"));

   // Area + line
   const linePts = pts.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
   const areaPts = `${x(pts[0].t).toFixed(1)},${y(0).toFixed(1)} ${linePts} ${x(pts[pts.length - 1].t).toFixed(1)},${y(0).toFixed(1)}`;
   svg.appendChild(svgEl("polygon", { points: areaPts, class: "series-area" }));
   svg.appendChild(svgEl("polyline", { points: linePts, class: "series-line" }));

   document.getElementById("fig-cumulative").replaceChildren(svg);
}

/* ---------- Figure 3: 24h x 30d heatmap ---------- */

function renderHeatmap(state) {
   const { intervals, now } = state;
   const W = 700,
      H = 320;
   const m = { top: 22, right: 12, bottom: 14, left: 52 };
   const { svg } = makeSvg(W, H);

   const today0 = startOfDay(now);
   const days = [];
   for (let i = 29; i >= 0; i--) {
      const d = new Date(today0);
      d.setDate(d.getDate() - i);
      days.push(d);
   }

   // grid[dayIndex][hour] = open fraction 0..1
   const grid = days.map(() => new Array(24).fill(0));
   for (const { start, end } of intervals) {
      let cursor = new Date(start);
      while (cursor < end) {
         const cellEnd = new Date(cursor);
         cellEnd.setMinutes(60, 0, 0); // next hour boundary
         const segEnd = end < cellEnd ? end : cellEnd;
         const di = days.findIndex((d) => dayKey(d) === dayKey(cursor));
         if (di >= 0) {
            const hr = cursor.getHours();
            grid[di][hr] += (segEnd - cursor) / HOUR_MS;
         }
         cursor = segEnd;
      }
   }

   const plotW = W - m.left - m.right;
   const plotH = H - m.top - m.bottom;
   const cw = plotW / 24;
   const ch = plotH / days.length;

   // Hour labels (top) every 6h
   for (let hh = 0; hh <= 18; hh += 6) {
      svg.appendChild(svgEl("text", { x: m.left + hh * cw, y: m.top - 8, "text-anchor": "start", class: "tick-text" }, pad2(hh)));
   }
   // Day labels (left) every 5 days
   days.forEach((d, i) => {
      if (i % 5 !== 0) return;
      svg.appendChild(svgEl("text", { x: m.left - 6, y: m.top + i * ch + ch / 2 + 3, "text-anchor": "end", class: "tick-text" }, `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`));
   });

   // Cells
   for (let di = 0; di < days.length; di++) {
      for (let hr = 0; hr < 24; hr++) {
         const frac = Math.max(0, Math.min(1, grid[di][hr]));
         // light grey when closed -> navy when fully open
         const fill = frac <= 0.001 ? "#ececec" : `rgba(0,51,128,${(0.18 + frac * 0.82).toFixed(3)})`;
         svg.appendChild(
            svgEl("rect", {
               x: m.left + hr * cw + 0.5,
               y: m.top + di * ch + 0.5,
               width: Math.max(0, cw - 1),
               height: Math.max(0, ch - 1),
               fill,
            }),
         );
      }
   }

   document.getElementById("fig-heatmap").replaceChildren(svg);
}

/* ---------- Figure 4: first-open / last-close scatter ---------- */

function renderScatter(state) {
   const { intervals, now } = state;
   const W = 700,
      H = 320;
   const m = { top: 30, right: 16, bottom: 34, left: 48 };
   const { svg } = makeSvg(W, H);

   const today0 = startOfDay(now);
   const days = [];
   for (let i = 29; i >= 0; i--) {
      const d = new Date(today0);
      d.setDate(d.getDate() - i);
      days.push(d);
   }

   // Per day: earliest open start, latest open end (as fractional hours).
   const byDay = new Map();
   for (const { start, end } of intervals) {
      // attribute the interval to its start day for "first open",
      // and to the day of `end` for "last close"
      const sKey = dayKey(start);
      const eKey = dayKey(end);
      const sHr = start.getHours() + start.getMinutes() / 60;
      const eHr = end.getHours() + end.getMinutes() / 60 || 24;
      const sRec = byDay.get(sKey) || {};
      if (sRec.first == null || sHr < sRec.first) sRec.first = sHr;
      byDay.set(sKey, sRec);
      const eRec = byDay.get(eKey) || {};
      if (eRec.last == null || eHr > eRec.last) eRec.last = eHr;
      byDay.set(eKey, eRec);
   }

   const plotW = W - m.left - m.right;
   const plotH = H - m.top - m.bottom;
   const x = (i) => m.left + (i + 0.5) * (plotW / days.length);
   const y = (hr) => m.top + plotH - (hr / 24) * plotH;

   // Y grid/ticks every 6h
   for (let hh = 0; hh <= 24; hh += 6) {
      const yy = y(hh);
      svg.appendChild(svgEl("line", { x1: m.left, y1: yy, x2: W - m.right, y2: yy, class: "grid-line" }));
      svg.appendChild(svgEl("text", { x: m.left - 6, y: yy + 4, "text-anchor": "end", class: "tick-text" }, `${pad2(hh)}:00`));
   }
   svg.appendChild(svgEl("line", { x1: m.left, y1: m.top, x2: m.left, y2: m.top + plotH, class: "ax-line" }));
   svg.appendChild(svgEl("line", { x1: m.left, y1: m.top + plotH, x2: W - m.right, y2: m.top + plotH, class: "ax-line" }));

   // X tick labels every 5 days
   days.forEach((d, i) => {
      if (i % 5 !== 0) return;
      svg.appendChild(svgEl("text", { x: x(i), y: H - 12, "text-anchor": "middle", class: "tick-text" }, fmtShortDate(d)));
   });

   // Legend
   svg.appendChild(svgEl("circle", { cx: m.left + 4, cy: 12, r: 4, fill: NAVY }));
   svg.appendChild(svgEl("text", { x: m.left + 14, y: 16, class: "legend-text" }, "First open"));
   svg.appendChild(svgEl("circle", { cx: m.left + 110, cy: 12, r: 4, fill: "#fff", stroke: NAVY, "stroke-width": 1.5 }));
   svg.appendChild(svgEl("text", { x: m.left + 120, y: 16, class: "legend-text" }, "Last close"));

   // Points
   days.forEach((d, i) => {
      const rec = byDay.get(dayKey(d));
      if (!rec) return;
      if (rec.first != null) svg.appendChild(svgEl("circle", { cx: x(i), cy: y(rec.first), r: 4, fill: NAVY }));
      if (rec.last != null) svg.appendChild(svgEl("circle", { cx: x(i), cy: y(rec.last), r: 4, fill: "#fff", stroke: NAVY, "stroke-width": 1.5 }));
   });

   document.getElementById("fig-scatter").replaceChildren(svg);
}

/* ---------- entry point called by api.js ---------- */

function renderDashboard(payload) {
   const events = (payload.eventLog || []).map((e) => ({ t: new Date(e.timestamp), status: e.status }));
   const now = payload.timestamp ? new Date(payload.timestamp) : new Date();
   const intervals = buildOpenIntervals(events, now);
   const state = { events, intervals, now };

   renderTopbar(state);
   renderKpis(payload.kpis || {});
   renderDailyBars(state);
   renderCumulativeToday(state);
   renderHeatmap(state);
   renderScatter(state);
}

window.renderDashboard = renderDashboard;
