// Shared between the game client (copied into game.js) and the world server. Keep both copies identical.
// World layout: every village is a 32x24 block centred on its plot; plots sit on a 48x40-tile grid.
// Land outside villages is shared wild land, generated from the tile coordinates alone.
// A village grows 4 tiles on every side per Age (a = Ages researched, 0..4): 32×24 → 64×56. Plots sit 64×56 apart,
// centred on the Town Center at (gx·PX, gy·PY), so even a Digital Age village never reaches its neighbours.
export const PX = 64, PY = 56, ZONE = 4, WORLD_VER = 2;
export const vdim = a => { a = Math.max(0, Math.min(4, a | 0)); return { vw: 32 + 8 * a, vh: 24 + 8 * a, ti: 16 + 4 * a, tj: 12 + 4 * a }; };
export const VW = 32, VH = 24, VTCI = 16, VTCJ = 12;   // an Age-0 village
export const plotOrigin = (gx, gy, a = 0) => { const d = vdim(a); return [gx * PX - d.ti, gy * PY - d.tj]; };
export const plotOf = (x, y) => [Math.floor((x + PX / 2) / PX), Math.floor((y + PY / 2) / PY)];
export const inPlot = (x, y, gx, gy, a = 0) => { const [ox, oy] = plotOrigin(gx, gy, a), d = vdim(a); return x >= ox && x < ox + d.vw && y >= oy && y < oy + d.vh; };
export const zoneOrigin = (zx, zy) => [zx * ZONE * PX - PX / 2, zy * ZONE * PY - PY / 2];
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

// ---------------------------------------------------------------- golems (world server simulates; clients draw)
// One golem per village in the zone at most. Made of a pile resource; eats piles of its own kind on village outskirts.
export const GOLEM_TYPES = ['wood', 'planks', 'stone', 'coal', 'iron', 'steel', 'gears', 'wires'];
export const GOLEM_AXE = ['wood', 'planks'];                 // everything else needs picks
export const GOLEM_IND = ['gears'], GOLEM_DIG = ['wires'];   // immune until Industrial / Digital Age
export const GOLEM_START = 10000, GOLEM_EAT = 10 / 60, GOLEM_GROW = .5, GOLEM_SPEED = .25;   // per second; tiles per second
export const GOLEM_HIT = 5, HIT_MS = 2000, SOLDIER_HP = 50, SOLDIER_HIT = 5, SOLDIER_SPEED = 1;
export const golemLoot = mx => Math.round(7500 + mx * .5);
export const golemXp = mx => Math.round(mx / 100);
export const soldierMaxHp = lvl => Math.round(SOLDIER_HP * (1 + .1 * (lvl | 0)));
export const golemPos = (g, now) => { const dx = g.tx - g.x, dy = g.ty - g.y, L = Math.hypot(dx, dy), d = Math.min(L, Math.max(0, now - g.t0) / 1000 * g.sp); return L ? [g.x + dx / L * d, g.y + dy / L * d] : [g.x, g.y]; };
