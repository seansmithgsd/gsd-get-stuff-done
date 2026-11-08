// ---------------------------------------------------------------- storage, rotting piles, guards, harvester stats
// What doesn't fit in storage sits in piles near the edge of your plot: piles rot (food fast), take up land,
// draw deer, and are what other players' harvesters go for (2× from piles, ½× from storage).
const STORE_RES = ['wood', 'stone', 'iron', 'coal', 'steel', 'planks', 'gears'];
const PILE_RES = ['food', ...STORE_RES];
const TC_STORE = 200;                                     // the Town Center holds this much of each
const STORE_CAP = [0, 500, 1000, 2000, 3500, 5000];       // per storage building, by level (level 5 = 10× level 1)
const STORE_MAX_LVL = 5;
const PILE_PER_TILE = 300, PILE_MAX_TILES = 12;
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
let PILES = [], PILE_AT = new Map(), pileKeys = '';
function layoutPiles() {
  if (!S || !MAP) return;
  const taken = new Set(S.buildings.map(b => b.j * W + b.i)), out = [], ring = edgeRing();
  PILE_RES.forEach((k, ri) => {
    const p = pileOf(k); if (p <= 0) return;
    const n = Math.min(PILE_MAX_TILES, Math.ceil(p / PILE_PER_TILE));
    let pos = ri * 14, placed = 0, tries = 0;
    while (placed < n && tries++ < ring.length) {
      const [i, j] = ring[pos++ % ring.length], key = j * W + i;
      if (taken.has(key) || near(i, j, TCI, TCJ) < 3) continue;
      taken.add(key); out.push({ k, i, j, amt: Math.round(p / n) }); placed++;
    }
  });
  PILES = out; PILE_AT = new Map(out.map(p => [p.j * W + p.i, p]));
  const keys = out.map(p => p.j * W + p.i).join(',');
  if (keys !== pileKeys) { pileKeys = keys; layerDirty = true; }
}
function pileAt(i, j) { return i >= 0 && i < W && j >= 0 && j < H ? PILE_AT.get(j * W + i) || null : null; }
const PILE_COL = { food: ['#fca5a5', '#dc2626', '#7f1d1d'], wood: ['#d6a46a', '#8b5a2b', '#4a2a10'], stone: ['#e5e7eb', '#9aa3ab', '#4b5563'], iron: ['#cbd5e1', '#6b7a8a', '#334155'],
  coal: ['#6b7280', '#2b2b2b', '#030712'], steel: ['#f1f5f9', '#a5b4c4', '#475569'], planks: ['#fde68a', '#d4a056', '#7c4a1e'], gears: ['#e5e7eb', '#64748b', '#1e293b'] };
function drawPile(x, y, k, amt) {
  const c = PILE_COL[k] || PILE_COL.stone, s = .55 + Math.min(1, amt / PILE_PER_TILE) * .6, n = 3 + Math.min(5, Math.floor(amt / 60));
  mx.fillStyle = 'rgba(0,0,0,.25)'; mx.beginPath(); mx.ellipse(x + 3, y + 2, 24 * s, 9 * s, 0, 0, 7); mx.fill();
  for (let q = 0; q < n; q++) {
    const a = q * 2.399, rr = (q / n) * 12 * s, px = x + Math.cos(a) * rr, py = y - 2 - q * 2.2 * s + Math.sin(a) * rr * .45;
    mx.fillStyle = rg(mx, px - 3, py - 4, 9 * s, c[0], c[1], c[2]); mx.beginPath(); mx.ellipse(px, py, 10 * s, 6.5 * s, 0, 0, 7); mx.fill();
  }
}
function pileObjects(objs, t, vw, vh) {
  for (const p of PILES) {
    const [x, y] = iso(p.i, p.j); if (x < -60 || x > vw + 60 || y < -40 || y > vh + 40) continue;
    objs.push({ d: p.i + p.j, f: () => drawPile(x, y, p.k, p.amt) });
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
  let h = `<div class="d">Holds ${STORE_CAP[lvl].toLocaleString()} ${what} (level ${lvl}/${STORE_MAX_LVL}).</div>`;
  if (up) return h + `<div class="small">Upgrading to level ${lvl + 1}…</div>`;
  if (lvl >= STORE_MAX_LVL) return h + '<div class="small">Max level.</div>';
  const c = storageUpCost(b), ok = canPay(c) && free().length;
  return h + `<div class="cost">${costHTML(c)} · ${fmt(D.time * (lvl + 1))} → holds ${STORE_CAP[lvl + 1].toLocaleString()}</div>
    <div style="margin-top:6px"><button class="btn go" data-supg="${b.id}" ${ok ? '' : 'disabled'}>Upgrade to level ${lvl + 1}</button>${ok ? '' : whyHTML(!free().length ? 'Every AI worker is already building' : 'Need ' + shortBy(c).join(', '))}</div>`;
}
function storageUpCost(b) { const D = BLD[b.type], m = Math.pow(2, b.lvl || 1), c = {}; for (const k in D.cost) c[k] = Math.round(D.cost[k] * m); return buildCost(b.type, c); }
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
