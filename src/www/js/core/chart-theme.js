/* core/chart-theme.js — Chart.js look & feel for the printed-paper aesthetic.
 *
 * The palette is read from the CSS custom properties in css/theme.css so there
 * is ONE source of truth for colour. Exposes:
 *   COL / PERIOD_COL / WD_COL  — resolved colours for series
 *   gridScale()                — dashed ruled gridlines + hairline axis
 *   baseOpts()                 — shared chart options (paper tooltip, no legend)
 *   applyChartDefaults()       — global Chart.defaults (call once at boot)
 */

const Chart = window.Chart; // UMD global from the CDN

/* read a CSS custom property off :root, e.g. cssVar("--open") */
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* Resolved palette. Built lazily on first import (after the stylesheet loads). */
export const COL = {
   open: cssVar("--open"),
   closed: cssVar("--closed"),
   unknown: cssVar("--unknown"),
   ink: cssVar("--ink"),
   inkdim: cssVar("--ink-dim"),
   inkfaint: cssVar("--ink-faint"),
   grid: cssVar("--grid"),
   gridSoft: cssVar("--grid-soft"),
   line: cssVar("--line"),
   paper: cssVar("--paper"),
   paper2: cssVar("--paper-2"),
};

/* muted ink shades for per-day period colouring (Fig. 3) */
export const PERIOD_COL = {
   lecture: cssVar("--open"),
   break: cssVar("--wd-sat"),
   exam: cssVar("--wd-thu"),
};

/* per-weekday series inks Mon..Sun (Fig. 8) */
export const WD_COL = [
   cssVar("--wd-mon"),
   cssVar("--wd-tue"),
   cssVar("--wd-wed"),
   cssVar("--wd-thu"),
   cssVar("--wd-fri"),
   cssVar("--wd-sat"),
   cssVar("--wd-sun"),
];

/* Dashed ruled gridlines + hairline axis border + ink ticks: "graph paper". */
export function gridScale(extra = {}) {
   return Object.assign(
      {
         grid: { color: COL.gridSoft, drawTicks: false, lineWidth: 1, borderDash: [2, 3] },
         border: { color: COL.line, width: 1 },
         ticks: { color: COL.inkdim, maxRotation: 0 },
      },
      extra,
   );
}

/* Shared chart options: responsive, no built-in legend, paper-style tooltip. */
export function baseOpts(extra = {}) {
   return Object.assign(
      {
         responsive: true,
         maintainAspectRatio: false,
         plugins: {
            legend: { display: false },
            tooltip: {
               backgroundColor: COL.paper,
               borderColor: COL.ink,
               borderWidth: 1,
               titleColor: COL.ink,
               bodyColor: COL.inkdim,
               padding: 8,
               displayColors: false,
               cornerRadius: 0,
               titleFont: { weight: "700" },
            },
         },
      },
      extra,
   );
}

/* Global Chart.js defaults. Call once at boot.
 * NOTE on animation: we want a "mostly static" feel but must NOT replace the
 * whole animation object — doing so strips the tooltip's opacity transition and
 * tooltips render invisible. Instead zero the durations and disable property
 * tweening, leaving interaction transitions intact. */
export function applyChartDefaults() {
   Chart.defaults.font.family = "'JetBrains Mono', ui-monospace, monospace";
   Chart.defaults.font.size = 10;
   Chart.defaults.color = COL.inkdim;
}
