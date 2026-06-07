/* core/printed-patterns.js — "printed" canvas fills.
 *
 * Builds small repeating canvas tiles (CanvasPattern) used as Chart.js fill
 * colours so areas and bars look hand-plotted / screen-printed rather than flat.
 * Tiles are cached by key so we never rebuild one on a chart update.
 */

const cache = {};

function tile(key, size, draw) {
  if (cache[key]) return cache[key];
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const x = c.getContext("2d");
  draw(x, size);
  return (cache[key] = x.createPattern(c, "repeat"));
}

/* Single-direction diagonal hatch. dir: 1 = "/", -1 = "\". */
export function hatch(color, dir = 1, gap = 5, lw = 1) {
  return tile(`h:${color}:${dir}:${gap}:${lw}`, gap, (x, s) => {
    x.strokeStyle = color; x.lineWidth = lw;
    x.beginPath();
    if (dir > 0) {
      x.moveTo(-1, 1);     x.lineTo(1, -1);
      x.moveTo(0, s);      x.lineTo(s, 0);
      x.moveTo(s - 1, s + 1); x.lineTo(s + 1, s - 1);
    } else {
      x.moveTo(-1, s - 1); x.lineTo(1, s + 1);
      x.moveTo(0, 0);      x.lineTo(s, s);
      x.moveTo(s - 1, -1); x.lineTo(s + 1, 1);
    }
    x.stroke();
  });
}

/* Crosshatch = both diagonals. */
export function crosshatch(color, gap = 5, lw = 0.9) {
  return tile(`x:${color}:${gap}:${lw}`, gap, (x, s) => {
    x.strokeStyle = color; x.lineWidth = lw;
    x.beginPath();
    x.moveTo(0, s);      x.lineTo(s, 0);
    x.moveTo(-1, 1);     x.lineTo(1, -1);
    x.moveTo(s - 1, s + 1); x.lineTo(s + 1, s - 1);
    x.moveTo(0, 0);      x.lineTo(s, s);
    x.moveTo(-1, s - 1); x.lineTo(1, s + 1);
    x.moveTo(s - 1, -1); x.lineTo(s + 1, 1);
    x.stroke();
  });
}

/* Stipple = scattered dots, for very light area washes. */
export function stipple(color, gap = 4, r = 0.7) {
  return tile(`s:${color}:${gap}:${r}`, gap, (x, s) => {
    x.fillStyle = color;
    x.beginPath(); x.arc(s / 2, s / 2, r, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2);         x.fill();
  });
}
