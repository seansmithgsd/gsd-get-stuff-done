// ---------------------------------------------------------------- storage, rotting piles, guards, harvester stats
// What doesn't fit in storage sits in piles near the edge of your plot: piles rot (food fast), take up land,
// draw deer, and are what other players' harvesters go for (2× from piles, ½× from storage).
const STORE_RES = ['wood', 'stone', 'iron', 'coal', 'steel', 'planks', 'gears'];
const PILE_RES = ['food', ...STORE_RES];
const TC_STORE = 200;                                     // the Town Center holds this much of each
// storage levels: 5 per Age (Stone/Bronze/Iron/Industrial/Digital = up to 25); each level holds 50% more, and costs 50% more to reach
const capAt = lvl => Math.round(500 * Math.pow(1.5, lvl - 1));
const STORE_CAP = new Proxy([], { get: (t, k) => (/^\d+$/.test(k) ? capAt(+k) : t[k]) });
const storeMaxLvl = () => 5 * (1 + ['age6', 'age7', 'age8', 'age9'].filter(a => U(a)).length);
const PILE_PER_TILE = 300;   // one more row/column of footprint per this much (squared)
const ROT = { food: .05 / 60, other: .02 / 3600 };        // food piles lose 5% a minute, others 2% an hour
const storeType = k => k === 'food' ? 'grainstore' : 'storehouse';
function storeCap(k) {
  if (!PILE_RES.includes(k)) return Infinity;
  let c = TC_STORE; for (const b of S.buildings) if (b.type === storeType(k) && b.done) c += STORE_CAP[b.lvl || 1];
  return c;
}
const pileOf = k => Math.max(0, Math.floor((S.res[k] || 0) - storeCap(k)));
const storedOf = k => Math.min(Math.floor(S.res[k] || 0), storeCap(k));
function rotPiles(dt) {
  const A = S.acc || (S.acc = {});
  for (const k of PILE_RES) {
    const p = pileOf(k); if (p <= 0) continue;
    A['rot_' + k] = (A['rot_' + k] || 0) + p * (k === 'food' ? ROT.food : ROT.other) * dt;
    const w = Math.floor(A['rot_' + k]); if (w) { A['rot_' + k] -= w; S.res[k] = Math.max(storeCap(k), S.res[k] - w); }
  }
}

// ---------------------------------------------------------------- pile layout: hugging the plot edge, growing inward
function edgeRing() {
  if (edgeRing.c) return edgeRing.c;
  const out = [];
  for (let r = 0; r < 5; r++) {
    for (let i = r; i < W - r; i++) out.push([i, H - 1 - r]);
    for (let j = H - 2 - r; j >= r; j--) out.push([W - 1 - r, j]);
    for (let i = W - 2 - r; i >= r; i--) out.push([i, r]);
    for (let j = r + 1; j < H - 1 - r; j++) out.push([r, j]);
  }
  return (edgeRing.c = out);
}
// one pile per resource, against the plot edge; its footprint grows (1×1 → 2×2 → … 5×5) and the heap keeps getting taller
let PILES = [], PILE_AT = new Map(), pileKeys = '';
const pileSide = amt => Math.min(5, Math.max(1, Math.ceil(Math.sqrt(amt / PILE_PER_TILE))));
function pileBlock(i, j, side) {
  // a side×side block touching the plot edge at (i, j), growing inward
  let i0 = i, j0 = j;
  if (j === H - 1) j0 = H - side; if (i === W - 1) i0 = W - side;
  i0 = clamp(i0, 0, W - side); j0 = clamp(j0, 0, H - side);
  const tiles = []; for (let b = 0; b < side; b++) for (let a = 0; a < side; a++) tiles.push([i0 + a, j0 + b]);
  return { i0, j0, tiles };
}
function layoutPiles() {
  if (!S || !MAP) return;
  const taken = new Set(S.buildings.map(b => b.j * W + b.i)), out = [], ring = edgeRing().slice(0, 2 * (W + H) - 4);
  PILE_RES.forEach((k, ri) => {
    const p = pileOf(k); if (p <= 0) return;
    const side = pileSide(p);
    for (let n = 0; n < ring.length; n++) {
      const [i, j] = ring[(ri * 13 + n) % ring.length], B = pileBlock(i, j, side);
      if (B.tiles.some(([a, b]) => taken.has(b * W + a) || near(a, b, TCI, TCJ) < 3)) continue;
      B.tiles.forEach(([a, b]) => taken.add(b * W + a));
      out.push({ k, i: B.i0, j: B.j0, side, amt: p, tiles: B.tiles }); break;
    }
  });
  PILES = out; PILE_AT = new Map(); for (const p of out) for (const [a, b] of p.tiles) PILE_AT.set(b * W + a, p);
  const keys = out.map(p => [p.k, p.i, p.j, p.side].join(':')).join(',');
  if (keys !== pileKeys) { pileKeys = keys; layerDirty = true; }
}
function pileAt(i, j) { return i >= 0 && i < W && j >= 0 && j < H ? PILE_AT.get(j * W + i) || null : null; }
const PILE_COL = { food: ['#fca5a5', '#dc2626', '#7f1d1d'], wood: ['#d6a46a', '#8b5a2b', '#4a2a10'], stone: ['#e5e7eb', '#9aa3ab', '#4b5563'], iron: ['#cbd5e1', '#6b7a8a', '#334155'],
  coal: ['#6b7280', '#2b2b2b', '#030712'], steel: ['#f1f5f9', '#a5b4c4', '#475569'], planks: ['#fde68a', '#d4a056', '#7c4a1e'], gears: ['#e5e7eb', '#64748b', '#1e293b'] };
// one mound: footprint from the block size, height keeps rising with the amount
function drawPile(x, y, k, amt, side) {
  side = side || 1;
  const c = PILE_COL[k] || PILE_COL.stone, rx = side * TW * .42, ry = side * TH * .42;
  const h = Math.min(side * 34 + 30, 10 + Math.sqrt(amt) * 1.1);
  mx.fillStyle = 'rgba(0,0,0,.28)'; mx.beginPath(); mx.ellipse(x + 4, y + 3, rx * 1.05, ry * 1.05, 0, 0, 7); mx.fill();
  const layers = 6 + Math.min(10, side * 2);
  for (let q = 0; q < layers; q++) {
    const f = q / layers, w = rx * (1 - f * .82), hh = ry * (1 - f * .82), py = y - h * f;
    mx.fillStyle = rg(mx, x - w * .35, py - hh * .5, w * 1.1, c[0], c[1], c[2]);
    mx.beginPath(); mx.ellipse(x, py, w, hh, 0, 0, 7); mx.fill();
  }
  // lumps on the surface so it reads as a heap of stuff
  for (let q = 0; q < 6 + side * 4; q++) {
    const a = q * 2.399, f = (q * .61) % 1, rr = rx * (1 - f) * .8, px = x + Math.cos(a) * rr, py = y - h * f * .9 + Math.sin(a) * ry * (1 - f) * .6;
    mx.fillStyle = rg(mx, px - 2, py - 2, 6, c[0], c[1], c[2]); mx.beginPath(); mx.ellipse(px, py, 5 + side, 3.5 + side * .6, 0, 0, 7); mx.fill();
  }  // label: resource name + amount above the mound
  const z = typeof ZM === 'number' ? ZM : 1, label = `${k[0].toUpperCase() + k.slice(1)} ${Math.round(amt).toLocaleString()}`;
  LABEL_Q.push({ x, y: y - h - 10 / z, label, col: c[0] });   // drawn after everything so trees never cover it
}
let LABEL_Q = [];
function flushLabels() {
  const z = typeof ZM === 'number' ? ZM : 1;
  mx.font = `bold ${Math.round(12 / z)}px system-ui`; mx.textAlign = 'center'; mx.textBaseline = 'alphabetic';
  for (const L of LABEL_Q) {
    const tw = mx.measureText(L.label).width;
    mx.fillStyle = 'rgba(15,27,61,.85)'; mx.beginPath(); mx.roundRect(L.x - tw / 2 - 6 / z, L.y - 13 / z, tw + 12 / z, 18 / z, 6 / z); mx.fill();
    mx.fillStyle = L.col; mx.fillText(L.label, L.x, L.y);
  }
  LABEL_Q = [];
}
const pileCenter = p => [p.i + (p.side - 1) / 2, p.j + (p.side - 1) / 2];
function pileObjects(objs, t, vw, vh) {
  for (const p of PILES) {
    const [ci, cj] = pileCenter(p), [x, y] = iso(ci, cj); if (x < -200 || x > vw + 200 || y < -200 || y > vh + 200) continue;
    objs.push({ d: p.i + p.j + 2 * (p.side - 1), f: () => drawPile(x, y, p.k, p.amt, p.side) });
  }
}

// ---------------------------------------------------------------- food piles draw deer
function deerLure(d) {
  const food = PILES.filter(p => p.k === 'food'); if (!food.length || Math.random() < .5) return;
  const p = food[(Math.random() * food.length) | 0];
  d.ti = clamp(p.i + (Math.random() - .5) * 3, 1, W - 2); d.tj = clamp(p.j + (Math.random() - .5) * 3, 1, H - 2);
}
function spawnLuredDeer() {
  const want = (typeof deerCount === 'function' ? deerCount() : 7) + 1 + Math.min(6, Math.floor(pileOf('food') / 150));
  while (DEER.length < want) {
    const e = edgeRing()[(Math.random() * W * 2) | 0];
    DEER.push({ i: e[0] + .5, j: e[1] + .5, ti: e[0] + .5, tj: e[1] + .5, wait: Math.random() * 2 });
  }
}

// ---------------------------------------------------------------- storage buildings: capacity + 5 levels
function storageSheet(b) {
  if (b.type !== 'storehouse' && b.type !== 'grainstore') return '';
  const lvl = b.lvl || 1, D = BLD[b.type], up = S.workers.find(w => w.task && w.task.kind === 'build' && w.task.bid === b.id);
  const what = b.type === 'grainstore' ? 'food' : 'each of wood, stone, iron, coal, steel, planks, gears';
  let h = `<div class="d">Holds ${STORE_CAP[lvl].toLocaleString()} ${what} (level ${lvl}/${storeMaxLvl()}).</div>`;
  if (up) return h + `<div class="small">Upgrading to level ${lvl + 1}…</div>`;
  if (lvl >= storeMaxLvl()) return h + `<div class="small">${storeMaxLvl() >= 25 ? 'Max level.' : 'Max level for this Age — the next Age unlocks 5 more.'}</div>`;
  const c = storageUpCost(b), ok = canPay(c) && free().length;
  return h + `<div class="cost">${costHTML(c)} · ${fmt(D.time * (lvl + 1))} → holds ${STORE_CAP[lvl + 1].toLocaleString()}</div>
    <div style="margin-top:6px"><button class="btn go" data-supg="${b.id}" ${ok ? '' : 'disabled'}>Upgrade to level ${lvl + 1}</button>${ok ? '' : whyHTML(!free().length ? 'Every AI worker is already building' : 'Need ' + shortBy(c).join(', '))}</div>`;
}
function storageUpCost(b) { const D = BLD[b.type], m = Math.pow(1.5, b.lvl || 1), c = {}; for (const k in D.cost) c[k] = Math.round(D.cost[k] * m); return buildCost(b.type, c); }
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-supg]'); if (!btn || btn.disabled) return;
  const b = S.buildings.find(x => x.id === +btn.dataset.supg); if (!b) return;
  const c = storageUpCost(b), w = idle()[0] || free()[0];
  if (!w || !canPay(c)) return;
  pay(c);
  w.task = { kind: 'build', bid: b.id, up: true, dur: BLD[b.type].time * ((b.lvl || 1) + 1), prog: 0, target: [b.i, b.j] }; w.repeat = false;
  toast(`${w.name} is upgrading the ${BLD[b.type].n}`); closeSheet(); save(); refresh(true);
});

// ---------------------------------------------------------------- guards + harvesters
const guards = () => S.workers.filter(w => w.task && w.task.kind === 'guard').length;
const guardLvl = () => U('guardtrain') + (typeof hasB === 'function' && hasB('watchtower') ? 1 : 0);
function harvStats() {
  const L = U('harvtrain'), tool = U('hauler') ? 3 : U('wagon') ? 2 : U('wheelbarrow') ? 1 : 0;
  const carryMul = [1, 2, 3, 5][tool], speedMul = [1, 1, 1.25, 1.5][tool] * (1 + .1 * L);
  return { carry: Math.round(20 * (1 + .5 * L) * carryMul), speed: speedMul, load: Math.round(20 / (1 + .1 * L)), power: L + tool, tool };
}

// keep piles, deer and storage numbers current
setInterval(() => { if (typeof S !== 'undefined' && S && typeof MAP !== 'undefined' && MAP) { layoutPiles(); spawnLuredDeer(); } }, 1000);

// Build tab: each Storehouse / Granary you own, with its level and an Upgrade button (same as tapping it in the village)
function storageRows(type) {
  if (type !== 'storehouse' && type !== 'grainstore') return '';
  return S.buildings.filter(b => b.type === type && b.done).map((b, n) => {
    const lvl = b.lvl || 1, up = S.workers.find(w => w.task && w.task.kind === 'build' && w.task.bid === b.id);
    if (up || lvl >= storeMaxLvl()) return `<div class="row" style="margin-top:6px"><div class="d">#${n + 1} · level ${lvl} · holds ${STORE_CAP[lvl].toLocaleString()}${up ? ' · upgrading…' : ' · max for this Age'}</div></div>`;
    const c = storageUpCost(b), ok = canPay(c) && free().length;
    return `<div class="row" style="margin-top:6px"><div><div class="d">#${n + 1} · level ${lvl} · holds ${STORE_CAP[lvl].toLocaleString()} → ${STORE_CAP[lvl + 1].toLocaleString()}</div><div class="cost">${costHTML(c)} · ${fmt(BLD[b.type].time * (lvl + 1))}</div></div><button class="btn sm" data-supg="${b.id}" ${ok ? '' : 'disabled'}>Upgrade</button></div>`;
  }).join('');
}
