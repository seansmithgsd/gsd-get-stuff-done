// Shared between the game client (copied into game.js) and the world server. Keep both copies identical.
// World layout: every village is a 32x24 block centred on its plot; plots sit on a 48x40-tile grid.
// Land outside villages is shared wild land, generated from the tile coordinates alone.
export const VW = 32, VH = 24, VTCI = 16, VTCJ = 12, PX = 48, PY = 40, ZONE = 4;
export const plotOrigin = (gx, gy) => [gx * PX - VTCI, gy * PY - VTCJ];
export const plotOf = (x, y) => [Math.floor((x + VTCI) / PX), Math.floor((y + VTCJ) / PY)];
export const inPlot = (x, y, gx, gy) => { const [ox, oy] = plotOrigin(gx, gy); return x >= ox && x < ox + VW && y >= oy && y < oy + VH; };
export const zoneOf = (gx, gy) => [Math.floor(gx / ZONE), Math.floor(gy / ZONE)];
export function hsh(x, y, s) { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hsh(xi, yi, s), b = hsh(xi + 1, yi, s), c = hsh(xi, yi + 1, s), d = hsh(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// natural resource on a wild tile: forests, rock outcrops, berry patches, rare gold
export function wildAt(x, y) {
  const r = hsh(x, y, 7), f = vnoise(x / 9, y / 9, 1), s = vnoise(x / 6, y / 6, 2);
  if (f > .62 && r < (f - .55) * 1.6) return { n: 'tree', amt: 8 + Math.floor(hsh(x, y, 8) * 12) };
  if (s > .7 && r < (s - .62) * 1.3) return { n: hsh(x, y, 9) < .06 ? 'goldrock' : 'rock', amt: 10 + Math.floor(hsh(x, y, 10) * 15) };
  if (r > .992) return { n: 'bush', amt: 4 + Math.floor(hsh(x, y, 11) * 6) };
  return null;
}
export const wildGrass = (x, y) => vnoise(x / 5, y / 5, 3);
export const REGROW_MS = 30 * 60 * 1000;
