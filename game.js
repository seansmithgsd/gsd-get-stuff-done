/* GSD: Get Stuff Done — v0.1
   Puzzle wins recruit AI workers. Workers gather food/materials and build.
   All visuals are code-drawn. Guest progress is saved on this device. */
'use strict';

// ---------------------------------------------------------------- utils
const $ = s => document.querySelector(s);
const mod = (a, n) => ((a % n) + n) % n;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = t => 1 - Math.pow(1 - t, 3);
function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function fmt(sec) { sec = Math.max(0, Math.ceil(sec)); const m = Math.floor(sec / 60), r = sec % 60; return m ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`; }
const DPR = Math.min(2, window.devicePixelRatio || 1);

// ---------------------------------------------------------------- tuning
const EAT_EVERY = 60;        // seconds per food per worker
const STARVE_SPEED = 0.5;    // work speed with no food
const SPEED_PER_MOVE = 20;   // speedup seconds per leftover puzzle move
const WINS_PER_WORKER = 2;
const MORE_MOVES_COST = 100;  // copper value for +5 moves on a failed puzzle
const MAX_OFFLINE = 3 * 86400;

const RES = [
  { k: 'food', n: 'Food', c: '#c0392b' },
  { k: 'wood', n: 'Wood', c: '#8b5a2b' },
  { k: 'stone', n: 'Stone', c: '#9aa3ab' },
  { k: 'copper', n: 'Copper', c: '#c86f33' },
  { k: 'silver', n: 'Silver', c: '#d8dde2' },
  { k: 'gold', n: 'Gold', c: '#e8b923' },
];

const BLD = {
  tc:     { n: 'Town Center', tier: 0, house: 2 },
  hut:    { n: 'Hut', tier: 1, time: 60, house: 3, repeat: true, desc: 'Houses 3 AI workers' },
  hunt:   { n: 'Hunting Post', tier: 1, time: 45, cost: { wood: 10, money: 2 }, desc: 'Unlocks hunting deer (+6 food)' },
  quarry: { n: 'Quarry', tier: 1, time: 75, cost: { wood: 20, money: 4 }, desc: 'Unlocks stone from rocks' },
  lumber: { n: 'Lumber Camp', tier: 2, time: 90, req: ['hut'], cost: { wood: 25, stone: 8, money: 5 }, desc: 'Doubles wood per trip' },
  farm:   { n: 'Farm Plot', tier: 2, time: 90, req: ['hunt'], cost: { wood: 20, stone: 6, money: 5 }, desc: 'Steady food (+5 per harvest)' },
  kiln:   { n: 'Charcoal Kiln', tier: 3, time: 120, req: ['lumber'], cost: { wood: 30, stone: 15, money: 8 }, desc: 'Wood + Wood → Coal' },
  smelter: { n: 'Smelter', tier: 4, time: 180, req: ['kiln', 'mine'], cost: { wood: 40, stone: 40, money: 15 }, desc: 'Iron + Coal → Steel' },
  mint:   { n: 'Mint', tier: 4, time: 180, req: ['mine'], cost: { stone: 50, iron: 10, money: 20 }, desc: 'Strikes gold: 1 steel → 1 gold' },
  townhall: { n: 'Town Hall', tier: 5, time: 300, house: 5, req: ['smelter', 'mint'], cost: { wood: 80, stone: 60, steel: 10, money: 40 }, desc: 'Houses 5 more AI workers; orb rank (multiplayer)' },
  mine:   { n: 'Mine', tier: 3, time: 150, req: ['quarry', 'farm'], cost: { wood: 30, stone: 20, money: 10 }, desc: 'Iron and copper; silver every 3rd trip' },
};
const FUTURE = [];
const TASKS = {
  berries: { n: 'Pick berries', node: 'bush', time: 20, gain: { food: 3 } },
  hunt:    { n: 'Hunt deer', node: 'deer', time: 30, gain: { food: 6 }, req: 'hunt' },
  farm:    { n: 'Harvest farm', node: 'farm', time: 25, gain: { food: 5 }, req: 'farm' },
  chop:    { n: 'Chop wood', node: 'tree', time: 20, gain: { wood: 3 }, boost: 'lumber' },
  stone:   { n: 'Quarry stone', node: 'rock', time: 30, gain: { stone: 2 }, req: 'quarry' },
  coal:    { n: 'Burn charcoal', node: 'kiln', time: 30, cost: { wood: 2 }, gain: { coal: 1 }, req: 'kiln' },
  smelt:   { n: 'Smelt steel', node: 'smelter', time: 35, cost: { iron: 1, coal: 1 }, gain: { steel: 1 }, req: 'smelter' },
  strike:  { n: 'Strike gold', node: 'mint', time: 45, cost: { steel: 1 }, gain: { gold: 1 }, req: 'mint' },
  mine:    { n: 'Mine ore', node: 'mine', time: 40, gain: { iron: 2, copper: 1 }, req: 'mine' },
};
const NODE_TASK = { bush: 'berries', tree: 'chop', rock: 'stone', deer: 'hunt', farm: 'farm', kiln: 'coal', mine: 'mine', smelter: 'smelt', mint: 'strike' };
const NODE_NAME = { bush: 'Berry bush', tree: 'Tree', rock: 'Rock', deer: 'Deer', farm: 'Farm Plot', kiln: 'Charcoal Kiln', mine: 'Mine', smelter: 'Smelter', mint: 'Mint' };
const BNODE = ['farm', 'kiln', 'mine', 'smelter', 'mint'];   // buildings workers gather at

// ---------------------------------------------------------------- state
const SAVE_KEY = 'gsd-get-stuff-done-v1';
const W = 32, H = 24, TCI = 16, TCJ = 12;
let S, ME = null, dirty = false, applied = [];

function newState() {
  return {
    v: 1, t: Date.now(), seed: (Math.random() * 1e9) | 0,
    res: { food: 10, wood: 12, stone: 0, iron: 0, coal: 0, steel: 0, copper: 6, silver: 0, gold: 0 },
    bank: 0, level: 1, wins: 0, recruit: 0, waiting: 0, eatAcc: 0, nextId: 1,
    workers: [], buildings: [{ id: 0, type: 'tc', i: TCI, j: TCJ, done: true }],
  };
}
function load() {
  try { const raw = localStorage.getItem(SAVE_KEY); if (raw) { const s = JSON.parse(raw); if (s && s.v === 1) { for (const k of ['iron', 'coal', 'steel']) if (s.res[k] == null) s.res[k] = 0; return s; } } } catch (e) {}
  return newState();
}
function save() { S.t = Date.now(); dirty = true; try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {} }

const hasB = t => S.buildings.some(b => b.type === t && b.done);
const countB = t => S.buildings.filter(b => b.type === t).length;
const housing = () => S.buildings.reduce((a, b) => a + (b.done ? (BLD[b.type].house || 0) : 0), 0);
const starving = () => S.workers.length > 0 && S.res.food <= 0;
const idle = () => S.workers.filter(w => !w.task);
const free = () => S.workers.filter(w => !w.task || w.task.kind !== 'build'); // can be pulled onto a build
const wallet = () => S.res.copper + 3 * S.res.silver + 10 * S.res.gold;

function costOf(type) {
  if (type === 'hut') { const n = countB('hut'); return { wood: 15 + 8 * n, money: 3 + 2 * n }; }
  return BLD[type].cost;
}
function canPay(c) {
  for (const k in c) { if (k === 'money') { if (wallet() < c.money) return false; } else if ((S.res[k] || 0) < c[k]) return false; }
  return true;
}
function pay(c) {
  for (const k in c) {
    if (k !== 'money') { S.res[k] -= c[k]; continue; }
    const R = S.res; let v = c.money;
    while (R.copper < v) { if (R.silver > 0) { R.silver--; R.copper += 3; } else if (R.gold > 0) { R.gold--; R.copper += 10; } else break; }
    R.copper -= v;
  }
}
function costHTML(c) {
  return Object.entries(c).map(([k, v]) => {
    const have = k === 'money' ? wallet() : (S.res[k] || 0);
    const label = k === 'money' ? 'coin' : k;
    return `<span class="${have < v ? 'no' : ''}">${v} ${label}</span>`;
  }).join(' · ');
}

// ---------------------------------------------------------------- map
let MAP, DEER = [];
function near(i, j, a, b) { let di = Math.abs(mod(i, W) - a); di = Math.min(di, W - di); return Math.max(di, Math.abs(j - b)); }
function genMap(seed) {
  const r = rng(seed);
  const node = new Array(W * H).fill(null), g = [];
  for (let k = 0; k < W * H; k++) g[k] = r();
  const place = (type, clusters, size, spread) => {
    for (let c = 0; c < clusters; c++) {
      const ci = (r() * W) | 0, cj = (r() * H) | 0;
      for (let n = 0; n < size; n++) {
        const i = mod(ci + Math.round((r() - .5) * spread * 2), W), j = Math.round(cj + (r() - .5) * spread * 2);
        if (j < 0 || j >= H || near(i, j, TCI, TCJ) < 3) continue;
        node[j * W + i] = type;
      }
    }
  };
  place('tree', 16, 10, 2.5); place('bush', 9, 3, 1.2); place('rock', 8, 3, 1.2);
  const set = (di, dj, t) => { node[(TCJ + dj) * W + mod(TCI + di, W)] = t; };
  [[4, -1], [4, 0], [5, -1]].forEach(([a, b]) => set(a, b, 'bush'));
  [[-4, -2], [-5, -2], [-4, -1], [-5, -1], [-5, 0], [-6, -1]].forEach(([a, b]) => set(a, b, 'tree'));
  [[1, 5], [2, 5], [2, 6]].forEach(([a, b]) => set(a, b, 'rock'));
  MAP = { node, g };
  const rd = rng(seed ^ 0x5bd1e995);
  DEER = [];
  for (let k = 0; k < 7; k++) {
    let i, j;
    do { i = rd() * W; j = 1 + rd() * (H - 2); } while (near(Math.floor(i), Math.floor(j), TCI, TCJ) < 4);
    DEER.push({ i, j, ti: i, tj: j, wait: rd() * 3 });
  }
  DEER.push({ i: TCI + 6.5, j: TCJ + 2.5, ti: TCI + 6.5, tj: TCJ + 2.5, wait: 1 });
}
function nodeAt(i, j) { if (j < 0 || j >= H) return null; return MAP.node[j * W + mod(i, W)]; }
function bAt(i, j) { const mi = mod(i, W); return S.buildings.find(b => b.i === mi && b.j === j); }
function unwrapNear(i, ref) { let d = i - ref; d = mod(d + W / 2, W) - W / 2; return ref + d; }

const SLOTS = [[2, 0], [0, 2], [-2, 0], [0, -2], [2, 2], [-2, 2], [2, -2], [-2, -2], [3, 1], [1, 3], [-3, 1], [1, -3], [3, -1], [-1, 3], [-3, -1], [-1, -3], [4, 2], [2, 4], [-4, 2], [2, -4]];
function findSlot() {
  for (const [di, dj] of SLOTS) {
    const i = mod(TCI + di, W), j = TCJ + dj;
    if (!bAt(i, j)) return [i, j];
  }
  return null;
}
function pickTarget(kind) {
  const T = TASKS[kind];
  if (BNODE.includes(T.node)) { const b = S.buildings.find(x => x.type === T.node && x.done); return b ? [unwrapNear(b.i, TCI), b.j] : null; }
  if (T.node === 'deer') {
    let best = null, bd = 1e9;
    for (const d of DEER) { const ui = unwrapNear(d.i, TCI); const dd = Math.hypot(ui - TCI, d.j - TCJ); if (dd < bd) { bd = dd; best = [ui, d.j]; } }
    return best;
  }
  let best = null, bd = 1e9;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (MAP.node[j * W + i] !== T.node || bAt(i, j)) continue;
    const ui = unwrapNear(i, TCI), dd = Math.hypot(ui - TCI, j - TCJ);
    if (dd < bd) { bd = dd; best = [ui, j]; }
  }
  return best;
}

// ---------------------------------------------------------------- simulation
let floaters = [];
function addWorker() {
  const n = S.workers.length + 1;
  const w = { id: S.nextId++, name: `AI Worker ${n}`, task: null, repeat: true, hue: (n * 67) % 360 };
  S.workers.push(w);
  autoAssign(w);
}
// new workers head straight to the closest open resource
function autoAssign(w) {
  let best = null, bd = 1e9;
  for (const kind of Object.keys(TASKS)) {
    if (!taskOpen(kind) || TASKS[kind].cost) continue;
    const t = pickTarget(kind), d = Math.hypot(t[0] - TCI, t[1] - TCJ);
    if (d < bd) { bd = d; best = { kind, target: t }; }
  }
  if (best) { w.task = { kind: best.kind, dur: TASKS[best.kind].time, prog: 0, target: best.target }; w.repeat = true; }
}
function taskYield(kind) {
  const T = TASKS[kind], m = T.boost && hasB(T.boost) ? 2 : 1, out = {};
  for (const k in T.gain) out[k] = T.gain[k] * m;
  return out;
}
function finishTask(w, quiet) {
  const t = w.task;
  if (t.kind === 'build') {
    const b = S.buildings.find(x => x.id === t.bid);
    if (b) { b.done = true; if (!quiet) toast(`${BLD[b.type].n} complete`); }
    w.task = null; return;
  }
  if (t.kind === 'raid') { w.task = null; resolveRaid(w, t); return; }
  const y = taskYield(t.kind);
  if (t.kind === 'mine') { w.mineN = (w.mineN || 0) + 1; if (w.mineN % 3 === 0) y.silver = 1; }
  for (const k in y) S.res[k] = (S.res[k] || 0) + y[k];
  if (!quiet && t.target) floaters.push({ i: t.target[0], j: t.target[1], text: Object.entries(y).map(([k, v]) => `+${v} ${k}`).join(' '), age: 0 });
  const carry = t.prog - t.dur;
  const TC = TASKS[t.kind].cost;
  if (w.repeat && taskOpen(t.kind) && (!TC || canPay(TC))) {
    if (TC) pay(TC);
    w.task = { kind: t.kind, dur: TASKS[t.kind].time, prog: Math.max(0, carry), target: TASKS[t.kind].node === 'deer' ? pickTarget(t.kind) : t.target };
  } else w.task = null;
}
function taskOpen(kind) { const T = TASKS[kind]; return (!T.req || hasB(T.req)) && !!pickTarget(kind); }
function tick(dt, quiet) {
  if (S.workers.length) {
    S.eatAcc += dt * S.workers.length;
    while (S.eatAcc >= EAT_EVERY) { S.eatAcc -= EAT_EVERY; if (S.res.food > 0) S.res.food--; }
  }
  const sp = starving() ? STARVE_SPEED : 1;
  for (const w of S.workers) {
    if (!w.task) continue;
    w.task.prog += dt * sp;
    if (w.task.prog >= w.task.dur) finishTask(w, quiet);
  }
  while (S.waiting > 0 && S.workers.length < housing()) { S.waiting--; addWorker(); if (!quiet) toast('A waiting AI worker moved in'); }
}
function catchUp(sec, report) {
  sec = Math.min(sec, MAX_OFFLINE);
  const before = { ...S.res };
  let r = sec;
  while (r > 0) { const d = Math.min(1, r); tick(d, true); r -= d; }
  if (report && sec > 30) {
    const lines = RES.map(x => [x.n, S.res[x.k] - before[x.k]]).filter(x => x[1] !== 0).map(([n, v]) => `<li>${v > 0 ? '+' : ''}${v} ${n}</li>`);
    if (lines.length) modal(`<h2>While you were away</h2><div class="small">${fmt(sec)} passed</div><ul>${lines.join('')}</ul><div class="btns"><button class="btn" data-close>OK</button></div>`);
  }
}

// ---------------------------------------------------------------- actions
function assign(kind) {
  const T = TASKS[kind], w = idle()[0];
  if (!w) return toast('No idle AI workers — win puzzles to recruit more');
  if (T.req && !hasB(T.req)) return toast(`Build a ${BLD[T.req].n} first`);
  const target = pickTarget(kind);
  if (!target) return toast('Nothing to gather');
  if (T.cost && !canPay(T.cost)) return toast('Not enough: needs ' + Object.entries(T.cost).map(([k, v]) => v + ' ' + k).join(', '));
  if (T.cost) pay(T.cost);
  w.task = { kind, dur: T.time, prog: 0, target }; w.repeat = true;
  save(); refresh();
}
function startBuild(type) {
  const D = BLD[type], c = costOf(type), w = idle()[0] || free()[0];
  if (!D.repeat && countB(type)) return;
  if (D.req && !D.req.every(hasB)) return toast('Locked');
  if (!canPay(c)) return toast('Not enough resources');
  if (!w) return toast('All AI workers are already building');
  const slot = findSlot(); if (!slot) return toast('No room near the Town Center');
  pay(c);
  const b = { id: S.nextId++, type, i: slot[0], j: slot[1], done: false };
  S.buildings.push(b); MAP.node[b.j * W + b.i] = null;
  w.task = { kind: 'build', bid: b.id, dur: D.time, prog: 0, target: [unwrapNear(b.i, TCI), b.j] };
  w.repeat = false;
  toast(`${w.name} is building a ${D.n}`);
  save(); refresh();
}
function useSpeed(id) {
  const w = S.workers.find(x => x.id === id); if (!w || !w.task || S.bank <= 0) return;
  const sp = starving() ? STARVE_SPEED : 1;
  const need = (w.task.dur - w.task.prog) / sp;
  const use = Math.min(S.bank, need);
  S.bank -= use; w.task.prog += use * sp;
  if (w.task.prog >= w.task.dur - 1e-6) { w.task.prog = w.task.dur; finishTask(w, false); }
  save(); refresh();
}
function stopTask(id) {
  const w = S.workers.find(x => x.id === id); if (!w || !w.task) return;
  if (w.task.kind === 'build') return toast('Builds can\'t be cancelled');
  w.task = null; save(); refresh();
}

// ---------------------------------------------------------------- UI shell
let view = 'village';
function toast(msg) {
  const d = document.createElement('div'); d.textContent = msg; $('#toast').appendChild(d);
  setTimeout(() => d.remove(), 2400);
}
function modal(html) { const m = $('#modal'); m.innerHTML = `<div class="box">${html}</div>`; m.hidden = false; }
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }
$('#modal').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.close !== undefined) closeModal();
  if (b.dataset.act) { closeModal(); ACTS[b.dataset.act](b.dataset.arg); }
});
function setView(v) {
  view = v;
  document.querySelectorAll('.view').forEach(e => e.classList.toggle('active', e.id === 'v-' + v));
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  closeSheet();
  if (v === 'puzzle' && !P) startLevel();
  if (v === 'puzzle') sizeBoard();
  if (v === 'village') sizeMap();
  if (v === 'orb') loadOrb();
  refresh(true);
}
document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => setView(b.dataset.v)));

function layout() {
  document.documentElement.style.setProperty('--toph', $('#top').offsetHeight + 'px');
  document.documentElement.style.setProperty('--navh', $('#tabs').offsetHeight + 'px');
  sizeMap(); sizeBoard();
}
window.addEventListener('resize', layout);
if (window.ResizeObserver) { const ro = new ResizeObserver(() => layout()); ro.observe($('#top')); ro.observe($('#tabs')); }

function hud() {
  const R = S.res;
  const it = (c, label, v, warn) => `<span class="r${warn ? ' warn' : ''}"><i style="background:${c}"></i>${label} <b>${v}</b></span>`;
  $('#res').innerHTML =
    it('#c0392b', 'Food', R.food, starving() || (R.food <= 2 && S.workers.length)) + it('#8b5a2b', 'Wood', R.wood) + it('#9aa3ab', 'Stone', R.stone) + it('#6b7a8a', 'Iron', R.iron || 0) + it('#2b2b2b', 'Coal', R.coal || 0) + it('#a5b4c4', 'Steel', R.steel || 0) +
    it('#c86f33', 'Copper', R.copper) + it('#d8dde2', 'Silver', R.silver) + it('#e8b923', 'Gold', R.gold) +
    `<span class="r">Speedup <b>${fmt(S.bank)}</b></span><span class="r">Workers <b>${S.workers.length}/${housing()}</b>${S.waiting ? ` <b>(+${S.waiting} waiting)</b>` : ''}</span>`;
  const n = idle().length, tb = document.querySelector('#tabs [data-v=workers]');
  tb.innerHTML = 'Workers' + (n ? `<span class="dot">${n}</span>` : '');
}

let sig = '';
function refresh(force) {
  hud();
  if (view === 'village') renderHint(force);
  if (view === 'build') renderBuild(force);
  if (view === 'workers') renderWorkers(force);
  if (view === 'orb') renderOrb(force);
  if (view === 'puzzle') renderPuzzleHead();
}
function renderHint(force) {
  let html = '';
  if (!S.workers.length) {
    const left = WINS_PER_WORKER - S.recruit;
    html = `<div class="card"><div class="t">Recruit your first AI worker</div><div class="d">Win ${left} more puzzle${left > 1 ? 's' : ''}.</div><div style="margin-top:6px"><button class="btn go" data-go="puzzle">Play puzzle</button></div></div>`;
  } else if (starving()) {
    html = `<div class="card"><div class="t" style="color:var(--red)">Out of food — workers at half speed</div><div class="d">Tap a berry bush to gather food.</div></div>`;
  } else if (idle().length) {
    html = `<div class="card"><div class="t">${idle().length} idle AI worker${idle().length > 1 ? 's' : ''}</div><div class="d">Tap a tree, berry bush, rock or deer.</div></div>`;
  }
  const s = 'h' + html;
  if (s !== sig || force) { sig = s; $('#hint').innerHTML = html; }
}
$('#hint').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) setView(b.dataset.go); });

function renderBuild(force) {
  const s = 'b' + JSON.stringify([S.res, S.buildings.map(b => b.type + b.done), free().length]);
  if (s === sig && !force) return; sig = s;
  let html = '<h2>Tech Tree</h2>';
  for (let tier = 1; tier <= 5; tier++) {
    html += `<h3>Tier ${tier}</h3>`;
    for (const [k, D] of Object.entries(BLD)) {
      if (D.tier !== tier) continue;
      const c = costOf(k), built = countB(k), locked = D.req && !D.req.every(hasB);
      const doneOnce = !D.repeat && built;
      let btn;
      if (doneOnce) btn = `<button class="btn sm alt" disabled>${hasB(k) ? 'Built' : 'Building'}</button>`;
      else btn = `<button class="btn sm" data-build="${k}" ${locked || !canPay(c) || !free().length ? 'disabled' : ''}>Build</button>`;
      html += `<div class="card${locked ? ' locked' : ''}"><div class="row"><div><div class="t">${D.n}${D.repeat && built ? ` <span class="small">×${built}</span>` : ''}</div><div class="d">${D.desc}</div>
        <div class="cost">${locked ? 'Requires ' + D.req.map(r => BLD[r].n).join(', ') : costHTML(c) + ` · ${fmt(D.time)}`}</div></div>${btn}</div></div>`;
    }
    for (const f of FUTURE.filter(f => f.tier === tier)) {
      html += `<div class="card locked"><div class="row"><div><div class="t">${f.n}</div><div class="d">${f.desc}</div><div class="cost">Requires ${f.req}</div></div><span class="small">Coming soon</span></div></div>`;
    }
  }
  if (!free().length) html += `<div class="foot">Building needs an AI worker that isn't already building.</div>`;
  $('#v-build').innerHTML = html;
}
$('#v-build').addEventListener('click', e => { const b = e.target.closest('[data-build]'); if (b && !b.disabled) startBuild(b.dataset.build); });

function taskLabel(t) { if (t.kind === 'raid') return 'Harvesting ' + t.name + "'s village"; if (t.kind === 'build') { const b = S.buildings.find(x => x.id === t.bid); return 'Building ' + (b ? BLD[b.type].n : ''); } return TASKS[t.kind].n; }
function renderWorkers(force) {
  const s = 'w' + JSON.stringify([S.workers.map(w => [w.id, w.task && w.task.kind, w.repeat]), S.bank > 0, starving(), S.waiting, housing(), S.recruit]);
  if (s !== sig || force) {
    sig = s;
    let html = `<h2>AI Workers <span class="small">${S.workers.length}/${housing()} housed</span></h2>`;
    if (starving()) html += `<div class="card"><div class="t" style="color:var(--red)">No food — everyone works at half speed</div></div>`;
    if (S.waiting) html += `<div class="card"><div class="d">${S.waiting} recruited worker${S.waiting > 1 ? 's' : ''} waiting for housing — build a Hut.</div></div>`;
    html += `<div class="small">Next recruit: ${S.recruit}/${WINS_PER_WORKER} puzzle wins · Food use: ${S.workers.length}/min</div>`;
    for (const w of S.workers) {
      html += `<div class="card"><div class="row"><div style="flex:1"><div class="t"><span style="color:hsl(${w.hue},55%,35%)">●</span> ${w.name}</div>
        <div class="d">${w.task ? taskLabel(w.task) : 'Idle'} <span data-time="${w.id}"></span></div>
        ${w.task ? `<div class="bar${starving() ? ' hungry' : ''}"><b data-bar="${w.id}"></b></div>` : ''}</div>
        <div style="display:flex;flex-direction:column;gap:4px">
        ${w.task ? `<button class="btn sm go" data-speed="${w.id}" ${S.bank > 0 ? '' : 'disabled'}>⏱ Speed up</button>` : ''}
        ${w.task && w.task.kind !== 'build' ? `<button class="btn sm alt" data-stop="${w.id}">Stop</button>` : ''}
        </div></div>
        ${!w.task ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">${Object.keys(TASKS).filter(k => !TASKS[k].req || hasB(TASKS[k].req)).map(k => `<button class="btn sm" data-task="${k}">${TASKS[k].n}</button>`).join('')}</div>` : ''}
        ${w.task && w.task.kind !== 'build' ? `<label class="small"><input type="checkbox" data-rep="${w.id}" ${w.repeat ? 'checked' : ''}> Repeat</label>` : ''}
        </div>`;
    }
    if (!S.workers.length) html += `<div class="card"><div class="d">No AI workers yet. Win ${WINS_PER_WORKER} puzzles to recruit one.</div></div>`;
    html += `<div class="foot">${ME ? `Signed in as <b>${esc(ME.name)}</b> — progress saves to your account.` : 'Guest save on this device only. Sign in on the Orb tab to keep it.'}<br>
      <a href="https://gsdconsultantsllc.com" target="_blank" rel="noopener">GSD Consultants, LLC</a> · v0.2<br><br>
      <button class="btn sm alt" data-reset>Reset progress</button></div>`;
    $('#v-workers').innerHTML = html;
  }
  const sp = starving() ? STARVE_SPEED : 1;
  for (const w of S.workers) {
    if (!w.task) continue;
    const b = document.querySelector(`[data-bar="${w.id}"]`); if (b) b.style.width = (100 * w.task.prog / w.task.dur).toFixed(1) + '%';
    const tm = document.querySelector(`[data-time="${w.id}"]`); if (tm) tm.textContent = '· ' + fmt((w.task.dur - w.task.prog) / sp);
  }
}
$('#v-workers').addEventListener('click', e => {
  const t = e.target;
  if (t.dataset.speed) useSpeed(+t.dataset.speed);
  else if (t.dataset.stop) stopTask(+t.dataset.stop);
  else if (t.dataset.task) assign(t.dataset.task);
  else if (t.dataset.reset !== undefined) modal(`<h2>Reset progress?</h2><p>This wipes this device's save.</p><div class="btns"><button class="btn alt" data-close>Cancel</button><button class="btn" data-act="reset">Reset</button></div>`);
});
$('#v-workers').addEventListener('change', e => {
  const id = +e.target.dataset.rep; if (!id) return;
  const w = S.workers.find(x => x.id === id); if (w) { w.repeat = e.target.checked; save(); }
});

// tap sheet on village map
function openSheet(html) { const s = $('#sheet'); s.innerHTML = `<button class="btn sm alt x" data-x>✕</button>` + html; s.hidden = false; }
function closeSheet() { $('#sheet').hidden = true; }
$('#sheet').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.x !== undefined) return closeSheet();
  if (b.dataset.task) { assign(b.dataset.task); closeSheet(); }
  if (b.dataset.go) { setView(b.dataset.go); }
});
// tap a resource: the closest non-building worker drops what it's doing and goes there
function sendClosest(i, j) {
  const b = bAt(i, j);
  let kind = b ? (b.done && BNODE.includes(b.type) ? b.type : null) : nodeAt(i, j);
  const deer = DEER.find(d => Math.floor(mod(d.i, W)) === mod(i, W) && Math.floor(d.j) === j);
  if (deer && !b) kind = 'deer';
  if (!kind) return false;
  const tk = NODE_TASK[kind], T = TASKS[tk];
  if (T.req && !hasB(T.req)) return false;           // locked: show the sheet instead
  const target = deer ? [unwrapNear(deer.i, TCI), deer.j] : [unwrapNear(i, TCI), j];
  let best = null, bd = 1e9;
  S.workers.forEach((w, k) => {
    if (w.task && (w.task.kind === 'build' || w.task.kind === 'raid')) return;
    const p = workerPos(w, k).p, d = Math.hypot(unwrapNear(p[0], target[0]) - target[0], p[1] - target[1]);
    if (d < bd) { bd = d; best = w; }
  });
  if (!best) { toast(S.workers.length ? 'All AI workers are building' : 'No AI workers yet — win puzzles to recruit'); return true; }
  if (T.cost && !canPay(T.cost)) { toast('Not enough: needs ' + Object.entries(T.cost).map(([k, v]) => v + ' ' + k).join(', ')); return true; }
  if (T.cost) pay(T.cost);
  best.task = { kind: tk, dur: T.time, prog: 0, target }; best.repeat = true;
  toast(`${best.name} → ${T.n}`);
  closeSheet(); save(); refresh(true);
  return true;
}
function tileSheet(i, j) {
  const b = bAt(i, j);
  let kind = b ? (b.done && BNODE.includes(b.type) ? b.type : null) : nodeAt(i, j);
  const deer = DEER.find(d => Math.floor(mod(d.i, W)) === mod(i, W) && Math.floor(d.j) === j);
  if (deer && !b) kind = 'deer';
  if (b && !kind) {
    const D = BLD[b.type];
    return openSheet(`<div class="t">${D.n}</div><div class="d">${b.done ? (D.desc || 'Your base. Houses 2 AI workers.') : 'Under construction'}</div>`);
  }
  if (!kind) return closeSheet();
  const tk = NODE_TASK[kind], T = TASKS[tk], y = taskYield(tk), locked = T.req && !hasB(T.req);
  openSheet(`<div class="t">${NODE_NAME[kind]}</div>
    <div class="d">${T.n}: ${T.cost ? Object.entries(T.cost).map(([k, v]) => `${v} ${k}`).join(', ') + ' → ' : ''}${Object.entries(y).map(([k, v]) => `+${v} ${k}`).join(', ')}${tk === 'mine' ? ', +1 silver every 3rd trip' : ''} every ${fmt(T.time)}</div>
    <div style="margin-top:8px">${locked ? `<span class="small">Requires ${BLD[T.req].n}</span> <button class="btn sm" data-go="build">Tech tree</button>`
      : idle().length ? `<button class="btn go" data-task="${tk}">Send AI worker</button>` : `<span class="small">No idle workers.</span> <button class="btn sm" data-go="puzzle">Win puzzles to recruit</button>`}</div>`);
}

// ---------------------------------------------------------------- village rendering
const TW = 64, TH = 32;
const mapC = $('#map'), mx = mapC.getContext('2d');
let cw = 0, ch = 0, camX = (TCI - TCJ) * TW / 2, camY = (TCI + TCJ) * TH / 2;
function sizeMap() {
  const r = mapC.getBoundingClientRect(); if (!r.width) return;
  cw = r.width; ch = r.height; mapC.width = cw * DPR; mapC.height = ch * DPR;
}
const iso = (i, j) => [(i - j) * TW / 2 - camX + cw / 2, (i + j) * TH / 2 - camY + ch / 2];

function grassColor(i, j) {
  const g = MAP.g[j * W + mod(i, W)];
  const near = Math.hypot(unwrapNear(i, TCI) - TCI, j - TCJ);
  if (near < 2.2) return `hsl(36,${30 + g * 10}%,${46 + g * 6}%)`;
  return `hsl(${88 + g * 18},${38 + g * 10}%,${34 + g * 8}%)`;
}
function diamond(x, y, fill) {
  mx.beginPath(); mx.moveTo(x, y - TH / 2); mx.lineTo(x + TW / 2, y); mx.lineTo(x, y + TH / 2); mx.lineTo(x - TW / 2, y); mx.closePath();
  mx.fillStyle = fill; mx.fill();
}
function drawTree(x, y, g) {
  mx.fillStyle = '#5b3a1e'; mx.fillRect(x - 3, y - 14, 6, 14);
  const s = 0.85 + g * 0.3;
  mx.fillStyle = '#1f4d22'; mx.beginPath(); mx.moveTo(x, y - 50 * s); mx.lineTo(x + 16 * s, y - 16); mx.lineTo(x - 16 * s, y - 16); mx.fill();
  mx.fillStyle = '#2b6a2c'; mx.beginPath(); mx.moveTo(x, y - 58 * s); mx.lineTo(x + 12 * s, y - 32 * s); mx.lineTo(x - 12 * s, y - 32 * s); mx.fill();
}
function drawBush(x, y) {
  mx.fillStyle = '#2f6b2b'; mx.beginPath(); mx.ellipse(x, y - 8, 15, 10, 0, 0, Math.PI * 2); mx.fill();
  mx.fillStyle = '#d0263a';
  [[-7, -10], [3, -13], [8, -6], [-2, -5], [-9, -4]].forEach(([a, b]) => { mx.beginPath(); mx.arc(x + a, y + b, 2.4, 0, 7); mx.fill(); });
}
function drawRock(x, y) {
  mx.fillStyle = '#7d858c'; mx.beginPath(); mx.moveTo(x - 16, y - 2); mx.lineTo(x - 10, y - 16); mx.lineTo(x + 4, y - 20); mx.lineTo(x + 15, y - 8); mx.lineTo(x + 12, y + 2); mx.closePath(); mx.fill();
  mx.fillStyle = '#a3abb2'; mx.beginPath(); mx.moveTo(x - 10, y - 16); mx.lineTo(x + 4, y - 20); mx.lineTo(x + 2, y - 9); mx.closePath(); mx.fill();
}
function drawDeer(x, y, t) {
  const bob = Math.sin(t * 6) * 1;
  mx.fillStyle = '#8a5a2b'; mx.beginPath(); mx.ellipse(x, y - 10 + bob, 9, 5, 0, 0, 7); mx.fill();
  mx.fillRect(x - 7, y - 7, 2, 7); mx.fillRect(x + 5, y - 7, 2, 7);
  mx.beginPath(); mx.ellipse(x + 9, y - 16 + bob, 4, 3, -0.5, 0, 7); mx.fill();
  mx.strokeStyle = '#4a3220'; mx.lineWidth = 1.5; mx.beginPath(); mx.moveTo(x + 9, y - 19 + bob); mx.lineTo(x + 7, y - 25 + bob); mx.moveTo(x + 10, y - 19 + bob); mx.lineTo(x + 13, y - 24 + bob); mx.stroke();
}
function isoBox(x, y, w, h, top, left, right) {
  const hw = w * TW / 2, hh = w * TH / 2;
  mx.fillStyle = left; mx.beginPath(); mx.moveTo(x - hw, y); mx.lineTo(x, y + hh); mx.lineTo(x, y + hh - h); mx.lineTo(x - hw, y - h); mx.fill();
  mx.fillStyle = right; mx.beginPath(); mx.moveTo(x + hw, y); mx.lineTo(x, y + hh); mx.lineTo(x, y + hh - h); mx.lineTo(x + hw, y - h); mx.fill();
  mx.fillStyle = top; mx.beginPath(); mx.moveTo(x, y - hh - h); mx.lineTo(x + hw, y - h); mx.lineTo(x, y + hh - h); mx.lineTo(x - hw, y - h); mx.fill();
}
function roof(x, y, w, h, peak, c1, c2) {
  const hw = w * TW / 2, hh = w * TH / 2, top = y - h;
  mx.fillStyle = c1; mx.beginPath(); mx.moveTo(x - hw, top); mx.lineTo(x, top + hh); mx.lineTo(x, top - peak + hh * .0); mx.fill();
  mx.beginPath(); mx.moveTo(x - hw, top); mx.lineTo(x, top - hh); mx.lineTo(x, top - peak); mx.fill();
  mx.fillStyle = c2; mx.beginPath(); mx.moveTo(x + hw, top); mx.lineTo(x, top + hh); mx.lineTo(x, top - peak); mx.fill();
  mx.beginPath(); mx.moveTo(x + hw, top); mx.lineTo(x, top - hh); mx.lineTo(x, top - peak); mx.fill();
}
function buildProgress(b) {
  for (const w of S.workers) if (w.task && w.task.kind === 'build' && w.task.bid === b.id) return w.task.prog / w.task.dur;
  return 0;
}
function drawBuilding(b, x, y, t) {
  if (!b.done) {
    const p = buildProgress(b);
    mx.strokeStyle = '#6b4a2e'; mx.lineWidth = 2;
    mx.strokeRect(x - 18, y - 30, 36, 30);
    mx.beginPath(); mx.moveTo(x - 18, y - 30); mx.lineTo(x + 18, y); mx.moveTo(x + 18, y - 30); mx.lineTo(x - 18, y); mx.stroke();
    mx.fillStyle = 'rgba(0,0,0,.5)'; mx.fillRect(x - 20, y + 6, 40, 5);
    mx.fillStyle = '#e8b923'; mx.fillRect(x - 20, y + 6, 40 * p, 5);
    return;
  }
  switch (b.type) {
    case 'tc':
      isoBox(x, y, 1.6, 26, '#c9b48a', '#a58c62', '#8a7350');
      roof(x, y, 1.6, 26, 34, '#7b2e22', '#5e2219');
      mx.fillStyle = '#4a3220'; mx.fillRect(x - 1, y - 92, 2, 34);
      mx.fillStyle = '#e8b923'; mx.beginPath(); mx.moveTo(x + 1, y - 92); mx.lineTo(x + 16 + Math.sin(t * 3) * 2, y - 87); mx.lineTo(x + 1, y - 82); mx.fill();
      break;
    case 'hut':
      isoBox(x, y, .8, 14, '#b89a6a', '#9a7c50', '#7f6440');
      roof(x, y, .8, 14, 20, '#c9a24a', '#a8822e');
      break;
    case 'hunt':
      isoBox(x, y, .8, 12, '#9c7a4e', '#7e5f3a', '#664a2b');
      roof(x, y, .8, 12, 14, '#6b4a2e', '#553a22');
      mx.strokeStyle = '#d8c69a'; mx.lineWidth = 2; mx.beginPath(); mx.arc(x + 14, y - 22, 6, -1.2, 1.2); mx.stroke();
      break;
    case 'quarry':
      isoBox(x, y, .9, 8, '#8f969c', '#737a80', '#5d6368');
      drawRock(x - 6, y - 6); mx.strokeStyle = '#4a3220'; mx.lineWidth = 2; mx.beginPath(); mx.moveTo(x + 8, y - 4); mx.lineTo(x + 14, y - 22); mx.stroke();
      break;
    case 'lumber':
      isoBox(x, y, .9, 12, '#a07a4c', '#7f5e36', '#664a2b');
      roof(x, y, .9, 12, 12, '#5c3d22', '#47301a');
      mx.fillStyle = '#8b5a2b'; for (let k = 0; k < 3; k++) mx.fillRect(x + 10, y - 4 - k * 4, 16, 3);
      break;
    case 'smelter':
      isoBox(x, y, .9, 16, '#7d858c', '#5d6368', '#4a4f53');
      mx.fillStyle = '#3a3f43'; mx.fillRect(x + 6, y - 44, 8, 26);
      mx.fillStyle = '#f97316'; mx.beginPath(); mx.arc(x - 6, y - 4, 4 + Math.sin(t * 6) * 1, 0, 7); mx.fill();
      mx.fillStyle = 'rgba(80,80,80,.45)';
      for (let k = 0; k < 3; k++) { const p = (t * .6 + k / 3) % 1; mx.beginPath(); mx.arc(x + 10 + p * 6, y - 48 - p * 24, 4 + p * 6, 0, 7); mx.fill(); }
      break;
    case 'mint':
      isoBox(x, y, .9, 16, '#e5e7eb', '#cbd5e1', '#94a3b8');
      roof(x, y, .9, 16, 14, '#e8b923', '#c9971a');
      mx.fillStyle = '#e8b923'; mx.beginPath(); mx.arc(x, y - 40, 5, 0, 7); mx.fill();
      break;
    case 'townhall':
      isoBox(x, y, 1, 30, '#f1f5f9', '#cbd5e1', '#94a3b8');
      roof(x, y, 1, 30, 26, '#1e40af', '#172554');
      mx.fillStyle = '#4a3220'; mx.fillRect(x - 1, y - 84, 2, 28);
      mx.fillStyle = '#fbbf24'; mx.beginPath(); mx.moveTo(x + 1, y - 84); mx.lineTo(x + 14 + Math.sin(t * 3) * 2, y - 79); mx.lineTo(x + 1, y - 74); mx.fill();
      break;
    case 'kiln':
      isoBox(x, y, .8, 18, '#9aa3ab', '#7d858c', '#646b71');
      mx.fillStyle = '#5d6368'; mx.beginPath(); mx.arc(x, y - 18, 13, Math.PI, 0); mx.fill();
      mx.fillStyle = '#f97316'; mx.fillRect(x - 4, y - 8, 8, 6);
      mx.fillStyle = 'rgba(80,80,80,.45)';
      for (let k = 0; k < 3; k++) { const p = (t * .5 + k / 3) % 1; mx.beginPath(); mx.arc(x + 4 + p * 8, y - 32 - p * 26, 4 + p * 6, 0, 7); mx.fill(); }
      break;
    case 'mine':
      mx.fillStyle = '#6b6f73'; mx.beginPath(); mx.moveTo(x - 26, y + 2); mx.lineTo(x - 14, y - 24); mx.lineTo(x + 6, y - 30); mx.lineTo(x + 26, y - 6); mx.lineTo(x + 20, y + 6); mx.closePath(); mx.fill();
      mx.fillStyle = '#1a1a1a'; mx.beginPath(); mx.arc(x, y - 4, 9, Math.PI, 0); mx.lineTo(x + 9, y); mx.lineTo(x - 9, y); mx.fill();
      mx.strokeStyle = '#8b5a2b'; mx.lineWidth = 3; mx.beginPath(); mx.moveTo(x - 10, y); mx.lineTo(x - 10, y - 14); mx.lineTo(x + 10, y - 14); mx.lineTo(x + 10, y); mx.stroke();
      break;
    case 'farm':
      diamond(x, y, '#8a6b35');
      mx.strokeStyle = '#d4b23f'; mx.lineWidth = 2;
      for (let k = -2; k <= 2; k++) { mx.beginPath(); mx.moveTo(x - 20 + Math.abs(k) * 4 + k * 4, y + k * 4 - 6); mx.lineTo(x + 4 + k * 8, y + k * 4 + 6); mx.stroke(); }
      break;
  }
}
function drawWorker(x, y, w, t, working) {
  const bob = working ? Math.abs(Math.sin(t * 8 + w.id)) * 3 : Math.sin(t * 3 + w.id) * .8;
  mx.fillStyle = 'rgba(0,0,0,.25)'; mx.beginPath(); mx.ellipse(x, y, 6, 3, 0, 0, 7); mx.fill();
  mx.fillStyle = `hsl(${w.hue},55%,42%)`; mx.fillRect(x - 4, y - 14 - bob, 8, 11);
  mx.fillStyle = '#e8c39a'; mx.beginPath(); mx.arc(x, y - 18 - bob, 4, 0, 7); mx.fill();
  mx.fillStyle = '#cfd8dc'; mx.fillRect(x - 3, y - 19 - bob, 6, 2); // visor: AI worker
  if (starving()) { mx.fillStyle = '#ff6b5b'; mx.font = 'bold 10px Georgia'; mx.textAlign = 'center'; mx.fillText('!', x, y - 26); }
}
function workerPos(w, k) {
  const t = w.task;
  const home = [TCI + Math.cos(k * 2.1) * 1.1 + .5, TCJ + 1.3 + Math.sin(k * 2.1) * .5 + .5];
  if (!t || !t.target) return { p: home, working: false };
  const tgt = [t.target[0] + .5, t.target[1] + .5 + (t.kind === 'build' ? .4 : .45)];
  const f = t.prog / t.dur, lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  if (t.kind === 'build') return f < .1 ? { p: lerp(home, tgt, f / .1), working: false } : { p: tgt, working: true };
  if (f < .2) return { p: lerp(home, tgt, f / .2), working: false };
  if (f > .85) return { p: lerp(tgt, home, (f - .85) / .15), working: false };
  return { p: tgt, working: true };
}
function updateDeer(dt) {
  for (const d of DEER) {
    if (d.wait > 0) { d.wait -= dt; continue; }
    const dx = d.ti - d.i, dy = d.tj - d.j, L = Math.hypot(dx, dy);
    if (L < .05) { d.wait = 2 + Math.random() * 4; d.ti = d.i + (Math.random() - .5) * 3; d.tj = clamp(d.j + (Math.random() - .5) * 3, 1, H - 2); continue; }
    const s = Math.min(L, dt * .5); d.i += dx / L * s; d.j += dy / L * s;
  }
}
function drawMap(now) {
  const t = now / 1000;
  mx.setTransform(DPR, 0, 0, DPR, 0, 0);
  mx.fillStyle = '#0b4a8f'; mx.fillRect(0, 0, cw, ch);
  const objs = [];
  const cI = (camX / (TW / 2) + camY / (TH / 2)) / 2;
  for (let j = 0; j < H; j++) {
    const lo = Math.ceil(Math.max(j + (camX - cw / 2 - TW) / (TW / 2), (camY - ch / 2 - TH * 3) / (TH / 2) - j));
    const hi = Math.floor(Math.min(j + (camX + cw / 2 + TW) / (TW / 2), (camY + ch / 2 + TH * 4) / (TH / 2) - j));
    for (let i = lo; i <= hi; i++) {
      const [x, y] = iso(i, j);
      diamond(x, y, grassColor(i, j));
      const b = bAt(i, j), n = nodeAt(i, j), g = MAP.g[j * W + mod(i, W)];
      if (b) objs.push({ d: i + j, f: () => drawBuilding(b, x, y, t) });
      else if (n === 'tree') objs.push({ d: i + j, f: () => drawTree(x, y, g) });
      else if (n === 'bush') objs.push({ d: i + j, f: () => drawBush(x, y) });
      else if (n === 'rock') objs.push({ d: i + j, f: () => drawRock(x, y) });
    }
  }
  // world edge (poles of the orb)
  mx.fillStyle = 'rgba(29,59,82,.0)';
  for (const d of DEER) {
    const ui = unwrapNear(d.i, cI);
    const [x, y] = iso(ui - .5, d.j - .5);
    objs.push({ d: ui + d.j, f: () => drawDeer(x, y, t) });
  }
  S.workers.forEach((w, k) => {
    if (w.task && w.task.kind === 'raid') return; // off across the orb
    const { p, working } = workerPos(w, k);
    const ui = unwrapNear(p[0], cI);
    const [x, y] = iso(ui - .5, p[1] - .5);
    objs.push({ d: ui + p[1] - .4, f: () => drawWorker(x, y, w, t, working) });
  });
  objs.sort((a, b) => a.d - b.d).forEach(o => o.f());
  mx.textAlign = 'center'; mx.font = 'bold 13px Georgia';
  floaters = floaters.filter(f => f.age < 1.6);
  for (const f of floaters) {
    const ui = unwrapNear(f.i, cI); const [x, y] = iso(ui, f.j);
    mx.globalAlpha = 1 - f.age / 1.6; mx.fillStyle = '#fff3c4'; mx.strokeStyle = '#2b1d10'; mx.lineWidth = 3;
    mx.strokeText(f.text, x, y - 30 - f.age * 25); mx.fillText(f.text, x, y - 30 - f.age * 25); mx.globalAlpha = 1;
  }
}
// pan + tap
(() => {
  let down = null;
  mapC.addEventListener('pointerdown', e => { mapC.setPointerCapture(e.pointerId); down = { x: e.clientX, y: e.clientY, cx: camX, cy: camY, moved: false }; });
  mapC.addEventListener('pointermove', e => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (Math.hypot(dx, dy) > 8) down.moved = true;
    if (down.moved) {
      camX = down.cx - dx; camY = clamp(down.cy - dy, 0, (W + H) * TH / 2);
      // keep camX inside one wrap so numbers stay small
      const span = W * TW / 2; while (camX - camY * 2 > span * 1.5) camX -= span, camY -= span / 2; while (camX - camY * 2 < -span * 1.5) camX += span, camY += span / 2;
    }
  });
  mapC.addEventListener('pointerup', e => {
    if (!down) return;
    if (!down.moved) {
      const r = mapC.getBoundingClientRect();
      const wx = e.clientX - r.left - cw / 2 + camX, wy = e.clientY - r.top - ch / 2 + camY;
      const fi = (wx / (TW / 2) + wy / (TH / 2)) / 2, fj = (wy / (TH / 2) - wx / (TW / 2)) / 2;
      // objects are drawn above their tile: test tile under tap and the one just below it
      const cands = [[Math.floor(fi + .5), Math.floor(fj + .5)], [Math.floor(fi), Math.floor(fj)], [Math.floor(fi + 1), Math.floor(fj + 1)]];
      let hit = null;
      for (const [i, j] of cands) { if (j < 0 || j >= H) continue; if (bAt(i, j) || nodeAt(i, j) || DEER.some(d => Math.floor(mod(d.i, W)) === mod(i, W) && Math.floor(d.j) === j)) { hit = [i, j]; break; } }
      if (hit) { if (!sendClosest(hit[0], hit[1])) tileSheet(hit[0], hit[1]); } else closeSheet();
    }
    down = null;
  });
})();

// ---------------------------------------------------------------- puzzle
const N = 8, TYPES = 5;
const TILE_NAME = ['Berries', 'Wood', 'Stone', 'Coins', 'Leaves'];
const boardC = $('#board'), bx = boardC.getContext('2d');
let P = null, CS = 48;

function levelDef(n) {
  const r = rng(n * 7919 + 13);
  const moves = Math.max(15, 22 - Math.floor(n / 2));
  const goalCount = n < 3 ? 1 : 2;
  const pool = [0, 1, 2, 3, 4], goals = {};
  for (let g = 0; g < goalCount; g++) {
    const t = pool.splice((r() * pool.length) | 0, 1)[0];
    const base = Math.min(40, 12 + n * 2);
    goals[t] = goalCount === 2 ? Math.round(base * .75) : base;
  }
  return { n, moves, goals };
}
const cell = (t, s = null) => ({ t, s, ox: 0, oy: 0, a: 1, sc: 1 });
const rndType = () => (Math.random() * TYPES) | 0;
function newBoard() {
  let b;
  do {
    b = [];
    for (let y = 0; y < N; y++) {
      b[y] = [];
      for (let x = 0; x < N; x++) {
        let t;
        do { t = rndType(); } while ((x >= 2 && b[y][x - 1].t === t && b[y][x - 2].t === t) || (y >= 2 && b[y - 1][x].t === t && b[y - 2][x].t === t) ||
          (x >= 1 && y >= 1 && b[y][x - 1].t === t && b[y - 1][x].t === t && b[y - 1][x - 1].t === t));
        b[y][x] = cell(t);
      }
    }
  } while (!hasMoves(b));
  return b;
}
function startLevel() {
  const L = levelDef(S.level);
  P = { L, b: newBoard(), moves: L.moves, left: { ...L.goals }, score: 0, busy: false, over: false, sel: null };
  sizeBoard(); renderPuzzleHead(); drawBoard();
}
function sizeBoard() {
  const wrap = $('#pz-wrap'); if (!$('#v-puzzle').offsetWidth || !wrap.offsetWidth) return;
  const avail = Math.min(wrap.clientWidth - 8, wrap.clientHeight - 8);
  CS = Math.floor(Math.max(160, avail) / N);
  boardC.style.width = boardC.style.height = CS * N + 'px';
  boardC.width = boardC.height = CS * N * DPR;
  drawBoard();
}
function findRuns(b) {
  const runs = [];
  for (let y = 0; y < N; y++) { let x = 0; while (x < N) { const t = b[y][x] ? b[y][x].t : -2; let e = x + 1; if (t >= 0) while (e < N && b[y][e] && b[y][e].t === t) e++; if (t >= 0 && e - x >= 3) { const cs = []; for (let k = x; k < e; k++) cs.push([k, y]); runs.push({ dir: 'h', cells: cs, t }); } x = e; } }
  for (let x = 0; x < N; x++) { let y = 0; while (y < N) { const t = b[y][x] ? b[y][x].t : -2; let e = y + 1; if (t >= 0) while (e < N && b[e][x] && b[e][x].t === t) e++; if (t >= 0 && e - y >= 3) { const cs = []; for (let k = y; k < e; k++) cs.push([x, k]); runs.push({ dir: 'v', cells: cs, t }); } y = e; } }
  // 2x2 squares -> propeller
  for (let y = 0; y < N - 1; y++) for (let x = 0; x < N - 1; x++) {
    const q = b[y][x]; if (!q || q.t < 0) continue; const t = q.t;
    const same = (X, Y) => b[Y][X] && b[Y][X].t === t;
    if (same(x + 1, y) && same(x, y + 1) && same(x + 1, y + 1)) runs.push({ dir: 'sq', cells: [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]], t });
  }
  return runs;
}
function groupRuns(runs) {
  const groups = [];
  for (const r of runs) {
    const keys = r.cells.map(c => c[0] + ',' + c[1]);
    let into = null;
    for (const g of groups) {
      if (g.dead || g.t !== r.t || !keys.some(k => g.keys.has(k))) continue;
      if (!into) { into = g; g.runs.push(r); keys.forEach(k => g.keys.add(k)); }
      else { g.runs.forEach(x => into.runs.push(x)); g.keys.forEach(k => into.keys.add(k)); g.dead = true; }
    }
    if (!into) groups.push({ t: r.t, runs: [r], keys: new Set(keys) });
  }
  return groups.filter(g => !g.dead);
}
function specialFor(g) {
  const lines = g.runs.filter(r => r.dir !== 'sq');
  const max = lines.length ? Math.max(...lines.map(r => r.cells.length)) : 0;
  const hv = lines.some(r => r.dir === 'h') && lines.some(r => r.dir === 'v');
  if (max >= 5) return 'c';
  if (hv) return 'b';
  if (max === 4) return lines.find(r => r.cells.length === 4).dir;
  if (g.runs.some(r => r.dir === 'sq')) return 'p';
  return null;
}
function hasMoves(b) {
  const sw = (x1, y1, x2, y2) => { const t = b[y1][x1]; b[y1][x1] = b[y2][x2]; b[y2][x2] = t; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const x2 = x + dx, y2 = y + dy; if (x2 >= N || y2 >= N) continue;
      const A = b[y][x], B = b[y2][x2];
      if (A.s || B.s) return true;
      sw(x, y, x2, y2); const ok = findRuns(b).length > 0; sw(x, y, x2, y2);
      if (ok) return true;
    }
  }
  return false;
}
function anim(ms, fn) {
  return new Promise(res => {
    const st = performance.now();
    const f = now => { const t = Math.min(1, (now - st) / ms); fn(t); drawBoard(); if (t < 1) requestAnimationFrame(f); else res(); };
    requestAnimationFrame(f);
  });
}
async function animSwap(a, b) {
  const A = P.b[a[1]][a[0]], B = P.b[b[1]][b[0]];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  await anim(140, t => { const e = ease(t); A.ox = dx * e; A.oy = dy * e; B.ox = -dx * e; B.oy = -dy * e; });
  A.ox = A.oy = B.ox = B.oy = 0;
  P.b[a[1]][a[0]] = B; P.b[b[1]][b[0]] = A;
}
function triggerArea(c, x, y) {
  const out = [];
  if (c.s === 'h') for (let i = 0; i < N; i++) out.push(i + ',' + y);
  else if (c.s === 'v') for (let j = 0; j < N; j++) out.push(x + ',' + j);
  else if (c.s === 'b') { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < N && Y < N) out.push(X + ',' + Y); } }
  else if (c.s === 'c') {
    let t = c.target;
    if (t == null || t < 0) { const cnt = [0, 0, 0, 0, 0]; P.b.forEach(r => r.forEach(q => { if (q && q.t >= 0) cnt[q.t]++; })); t = cnt.indexOf(Math.max(...cnt)); }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (P.b[j][i] && P.b[j][i].t === t) out.push(i + ',' + j);
  }
  return out;
}
// propeller: pick the cell that helps the level goals most
function goalHits(keys) {
  let n = 0;
  for (const k of keys) { const [x, y] = k.split(',').map(Number), q = P.b[y][x]; if (q && q.t >= 0 && P.left[q.t] > 0) n++; }
  return n;
}
function bestTarget(claimed, carry) {
  let best = [], bs = -1;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = x + ',' + y, q = P.b[y][x];
    if (!q || claimed.has(k)) continue;
    let sc;
    if (carry) { const area = triggerArea({ s: carry }, x, y); sc = goalHits(area) + area.length * .01; }
    else if (q.s && q.s !== 'p') sc = goalHits(triggerArea(q, x, y)) + .5;
    else sc = (q.t >= 0 && P.left[q.t] > 0) ? 1 : .1;
    if (sc > bs + 1e-9) { bs = sc; best = [[x, y]]; } else if (Math.abs(sc - bs) < 1e-9) best.push([x, y]);
  }
  return best.length ? best[(Math.random() * best.length) | 0] : null;
}
// clears run in phases: a propeller's 4 neighbours clear first, then it flies, then its target clears
async function clearCells(start, spawns = []) {
  const queue = [...start].map(k => [k, 0]), phaseOf = new Map(), flights = [];
  while (queue.length) {
    const [k, ph] = queue.pop(); if (phaseOf.has(k)) continue; phaseOf.set(k, ph);
    const [x, y] = k.split(',').map(Number), c = P.b[y][x];
    if (!c || !c.s) continue;
    if (c.s === 'p') {
      addFx({ type: 'p', x, y, dur: 450 });
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < N && Y < N && !phaseOf.has(X + ',' + Y)) queue.push([X + ',' + Y, ph]); }
      const claimed = new Set([...phaseOf.keys(), ...queue.map(q => q[0])]);
      const tg = bestTarget(claimed, c.carry);
      if (tg) {
        if (c.carry) P.b[tg[1]][tg[0]].s = c.carry;
        flights.push({ x0: x, y0: y, x1: tg[0], y1: tg[1], p: 0, carry: c.carry, ph: ph + 1 });
        queue.push([tg[0] + ',' + tg[1], ph + 1]);
      }
    } else {
      const area = triggerArea(c, x, y);
      if (c.s === 'h' || c.s === 'v') { addFx({ type: c.s, x, y, dur: 520 }); shake = Math.max(shake, 5); }
      else if (c.s === 'b') { addFx({ type: 'b', x, y, dur: 600 }); shake = Math.max(shake, 10); }
      else if (c.s === 'c') { addFx({ type: 'c', x, y, dur: 650, targets: area.map(k => k.split(',').map(Number)) }); addFx({ type: 'flash', x, y, dur: 300 }); shake = Math.max(shake, 12); }
      area.forEach(q => { if (!phaseOf.has(q)) queue.push([q, ph]); });
    }
  }
  const maxPh = Math.max(0, ...phaseOf.values());
  for (let ph = 0; ph <= maxPh; ph++) {
    const fl = flights.filter(f => f.ph === ph);
    if (fl.length) { P.fly = fl; await anim(380, t => fl.forEach(f => f.p = ease(t))); P.fly = null; }
    const cells = [...phaseOf].filter(([, p]) => p === ph).map(([k]) => k.split(',').map(Number)).filter(([x, y]) => P.b[y][x]);
    if (!cells.length) continue;
    for (const [x, y] of cells) { const c = P.b[y][x]; if (c.t >= 0 && P.left[c.t] > 0) P.left[c.t]--; P.score += 10; burst(x, y, c.t >= 0 ? TILE_COL[c.t] : '#fde047', c.s ? 16 : 7, c.s ? 1.4 : 1); }
    P.destroyed = (P.destroyed || 0) + cells.length;
    await anim(170, t => { for (const [x, y] of cells) { const c = P.b[y][x]; c.a = 1 - t; c.sc = 1 + .25 * t; } });
    for (const [x, y] of cells) P.b[y][x] = null;
    renderPuzzleHead();
  }
  for (const sp of spawns) { const [x, y] = sp.pos; P.b[y][x] = cell(sp.t, sp.s); }
  renderPuzzleHead();
}
async function gravity() {
  const moving = [];
  for (let x = 0; x < N; x++) {
    let w = N - 1;
    for (let y = N - 1; y >= 0; y--) { const c = P.b[y][x]; if (c) { if (w !== y) { P.b[w][x] = c; P.b[y][x] = null; c.oy = y - w; moving.push(c); } w--; } }
    const holes = w + 1;
    for (let y = w; y >= 0; y--) { const c = cell(rndType()); c.oy = -holes; P.b[y][x] = c; moving.push(c); }
  }
  moving.forEach(c => c.o0 = c.oy);
  await anim(230, t => { const e = ease(t); moving.forEach(c => c.oy = c.o0 * (1 - e)); });
  moving.forEach(c => c.oy = 0);
}
async function resolve(pref) {
  for (;;) {
    const groups = groupRuns(findRuns(P.b));
    if (!groups.length) break;
    const clear = new Set(), spawns = [];
    for (const g of groups) {
      g.keys.forEach(k => clear.add(k));
      const s = specialFor(g);
      if (!s) continue;
      let pos = null;
      if (pref) for (const p of pref) if (g.keys.has(p[0] + ',' + p[1])) { pos = p; break; }
      if (!pos) { const lr = g.runs.reduce((a, r) => r.cells.length > a.cells.length ? r : a); pos = lr.cells[lr.cells.length >> 1]; }
      spawns.push({ pos, s, t: (s === 'c' || s === 'p') ? -1 : g.t });
    }
    await clearCells(clear, spawns);
    await gravity();
    pref = null;
  }
  if (!hasMoves(P.b)) { toast('No moves — shuffling'); P.b = newBoard(); drawBoard(); }
}
async function trySwap(a, b) {
  if (P.busy || P.over) return;
  P.busy = true; P.sel = null;
  const A = P.b[a[1]][a[0]], B = P.b[b[1]][b[0]];
  await animSwap(a, b);
  if (A.s === 'c' || B.s === 'c') {
    P.moves--;
    if (A.s === 'c' && B.s === 'c') { const all = []; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) all.push(i + ',' + j); A.s = B.s = null; await clearCells(all); }
    else { const bomb = A.s === 'c' ? A : B, other = bomb === A ? B : A; bomb.target = other.t; await clearCells([a[0] + ',' + a[1], b[0] + ',' + b[1]]); }
    await gravity(); await resolve(null);
  } else if (A.s === 'p' || B.s === 'p') {
    P.moves--;
    // after the swap, A sits at b and B sits at a
    const start = [];
    if (A.s === 'p') { if (B.s && B.s !== 'p') { A.carry = B.s; B.s = null; } start.push(b[0] + ',' + b[1]); }
    if (B.s === 'p') { if (A.s && A.s !== 'p') { B.carry = A.s; A.s = null; } start.push(a[0] + ',' + a[1]); }
    await clearCells(start);
    await gravity(); await resolve(null);
  } else if (A.s || B.s) {
    // any special fires when moved — no match needed
    P.moves--;
    const start = [];
    if (A.s) start.push(b[0] + ',' + b[1]);
    if (B.s) start.push(a[0] + ',' + a[1]);
    await clearCells(start);
    await gravity(); await resolve(null);
  } else if (!findRuns(P.b).length) {
    await animSwap(b, a);
  } else {
    P.moves--;
    await resolve([b, a]);
  }
  P.busy = false;
  renderPuzzleHead(); drawBoard();
  checkEnd();
}
// double-tap a special to fire it in place (costs a move)
async function fireSpecial(pos) {
  if (P.busy || P.over) return;
  const c = P.b[pos[1]][pos[0]]; if (!c || !c.s) return;
  P.busy = true; P.sel = null; P.moves--;
  await clearCells([pos[0] + ',' + pos[1]]);
  await gravity(); await resolve(null);
  P.busy = false;
  renderPuzzleHead(); drawBoard();
  checkEnd();
}
function checkEnd() {
  if (P.over) return;
  const won = Object.values(P.left).every(v => v <= 0);
  if (won) return win();
  if (P.moves <= 0) lose();
}
// leftover specials all fire after a win: 1 copper per tile destroyed
async function finale() {
  const start = P.destroyed || 0;
  for (let round = 0; round < 12; round++) {
    const keys = [];
    P.b.forEach((row, y) => row.forEach((c, x) => { if (c && c.s) keys.push(x + ',' + y); }));
    if (!keys.length) break;
    if (round === 0) toast('Leftover specials firing!');
    await clearCells(keys);
    await gravity(); await resolve(null);
  }
  return (P.destroyed || 0) - start;
}
async function win() {
  P.over = true; P.busy = true;
  const bonus = await finale();
  P.busy = false; drawBoard();
  const extra = P.moves, stars = 1 + (extra >= 3 ? 1 : 0) + (extra >= 6 ? 1 : 0);
  const rw = { copper: 3 + bonus, silver: stars - 1, gold: S.level % 5 === 0 ? 1 : 0 };
  S.res.copper += rw.copper; S.res.silver += rw.silver; S.res.gold += rw.gold;
  const speed = extra * SPEED_PER_MOVE; S.bank += speed;
  S.level++; S.wins++; S.recruit++;
  let recruit = '';
  if (S.recruit >= WINS_PER_WORKER) {
    S.recruit = 0;
    if (S.workers.length < housing()) { addWorker(); recruit = `<li><b>New AI worker recruited!</b></li>`; }
    else { S.waiting++; recruit = `<li><b>New AI worker</b> — waiting for housing (build a Hut)</li>`; }
  } else recruit = `<li>${S.recruit}/${WINS_PER_WORKER} wins toward next AI worker</li>`;
  save(); refresh();
  modal(`<h2>Puzzle complete</h2><div class="stars">${[1, 2, 3].map(s => `<span class="${s <= stars ? '' : 'off'}">★</span>`).join('')}</div>
    <ul>${bonus ? `<li>Leftover specials destroyed ${bonus} tiles → +${bonus} copper</li>` : ''}<li>+${rw.copper} copper total${rw.silver ? `, +${rw.silver} silver` : ''}${rw.gold ? ', +1 gold' : ''}</li>
    ${extra ? `<li>${extra} moves left → +${fmt(speed)} speedup</li>` : ''}${recruit}</ul>
    <div class="btns"><button class="btn alt" data-act="village">Village</button><button class="btn go" data-act="next">Next puzzle</button></div>`);
}
function lose() {
  P.over = true;
  modal(`<h2>Out of moves</h2><p>${Object.entries(P.left).filter(([, v]) => v > 0).map(([t, v]) => `${v} ${TILE_NAME[t]}`).join(', ')} left.</p>
    <div class="btns"><button class="btn" data-act="more" ${wallet() >= MORE_MOVES_COST ? '' : 'disabled'}>+5 moves (${MORE_MOVES_COST} copper)</button></div>
    <div class="small" style="margin-top:4px">You have ${wallet()} coin value (copper ${S.res.copper}, silver ×3, gold ×10)</div>
    <div class="btns"><button class="btn alt" data-act="village">Village</button><button class="btn go" data-act="next">Try again</button></div>`);
}
const ACTS = {
  more: () => { if (!P || wallet() < MORE_MOVES_COST) return; pay({ money: MORE_MOVES_COST }); P.moves += 5; P.over = false; save(); refresh(); renderPuzzleHead(); drawBoard(); toast('+5 moves'); },
  next: () => { startLevel(); },
  village: () => { P = null; setView('village'); },
  reset: () => { localStorage.removeItem(SAVE_KEY); S = newState(); if (ME) S.owner = ME.id; genMap(S.seed); P = null; save(); setView('village'); toast('Progress reset'); },
};

const TILE_COL = ['#e11d48', '#a0622d', '#9aa5b1', '#f5b301', '#22c55e'];
function rg(ctx, x, y, r, c0, c1, c2) { const g = ctx.createRadialGradient(x - r * .35, y - r * .4, r * .05, x, y, r * 1.05); g.addColorStop(0, c0); g.addColorStop(.55, c1); g.addColorStop(1, c2); return g; }
function lg(ctx, x0, y0, x1, y1, stops) { const g = ctx.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; }
function gloss(ctx, x, y, rx, ry, rot, a) { ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, 7); ctx.fill(); }
function drawIcon(ctx, t, x, y, r) {
  ctx.save(); ctx.translate(x, y);
  // contact shadow
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(r * .06, r * .78, r * .62, r * .16, 0, 0, 7); ctx.fill();
  switch (t) {
    case 0: { // berries
      ctx.fillStyle = lg(ctx, 0, -r * .8, 0, -r * .4, [[0, '#4ade80'], [1, '#166534']]);
      ctx.beginPath(); ctx.ellipse(r * .12, -r * .62, r * .38, r * .17, -.5, 0, 7); ctx.fill();
      ctx.strokeStyle = '#14532d'; ctx.lineWidth = r * .06; ctx.beginPath(); ctx.moveTo(0, -r * .25); ctx.quadraticCurveTo(r * .05, -r * .5, r * .1, -r * .6); ctx.stroke();
      for (const [a, b] of [[-.32, .14], [.32, .14], [0, -.2]]) {
        ctx.fillStyle = rg(ctx, a * r, b * r, r * .38, '#ff8fa3', '#e11d48', '#7f1028');
        ctx.beginPath(); ctx.arc(a * r, b * r, r * .37, 0, 7); ctx.fill();
        gloss(ctx, a * r - r * .13, b * r - r * .14, r * .1, r * .06, -.6, .75);
      }
      break; }
    case 1: { // log
      ctx.fillStyle = lg(ctx, 0, -r * .42, 0, r * .42, [[0, '#c98a4b'], [.45, '#8a5226'], [1, '#4a2a10']]);
      ctx.beginPath(); ctx.roundRect(-r * .82, -r * .4, r * 1.5, r * .8, r * .32); ctx.fill();
      ctx.strokeStyle = 'rgba(40,20,5,.45)'; ctx.lineWidth = r * .05;
      for (const k of [-.15, .12]) { ctx.beginPath(); ctx.moveTo(-r * .65, k * r); ctx.lineTo(r * .35, k * r + r * .03); ctx.stroke(); }
      ctx.fillStyle = rg(ctx, r * .68, 0, r * .4, '#f6d7a7', '#d9a86a', '#9a6a33');
      ctx.beginPath(); ctx.ellipse(r * .68, 0, r * .25, r * .4, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = r * .04;
      for (const k of [.08, .17, .27]) { ctx.beginPath(); ctx.ellipse(r * .68, 0, r * k * .62, r * k, 0, 0, 7); ctx.stroke(); }
      gloss(ctx, -r * .3, -r * .26, r * .35, r * .06, 0, .35);
      break; }
    case 2: { // stone
      const pts = [[-.8, .3], [-.5, -.55], [.3, -.72], [.82, -.05], [.5, .6], [-.4, .66]];
      ctx.fillStyle = rg(ctx, 0, 0, r * .85, '#e5e9ec', '#9aa5b1', '#4b5563');
      ctx.beginPath(); pts.forEach(([a, b], i) => i ? ctx.lineTo(a * r, b * r) : ctx.moveTo(a * r, b * r)); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.moveTo(-r * .5, -r * .55); ctx.lineTo(r * .3, -r * .72); ctx.lineTo(r * .05, -r * .12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.moveTo(r * .82, -r * .05); ctx.lineTo(r * .5, r * .6); ctx.lineTo(r * .1, r * .2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(30,41,59,.35)'; ctx.lineWidth = r * .04; ctx.beginPath(); ctx.moveTo(-r * .3, r * .1); ctx.lineTo(r * .05, r * .3); ctx.lineTo(r * .2, r * .05); ctx.stroke();
      break; }
    case 3: { // coin
      ctx.fillStyle = '#8a5a00'; ctx.beginPath(); ctx.arc(r * .04, r * .06, r * .76, 0, 7); ctx.fill();
      ctx.fillStyle = rg(ctx, 0, 0, r * .76, '#fff3b0', '#f5b301', '#a16207');
      ctx.beginPath(); ctx.arc(0, 0, r * .74, 0, 7); ctx.fill();
      ctx.fillStyle = rg(ctx, 0, 0, r * .52, '#fde68a', '#eab308', '#a16207');
      ctx.beginPath(); ctx.arc(0, 0, r * .52, 0, 7); ctx.fill();
      ctx.fillStyle = '#92400e'; ctx.font = `bold ${r * .7}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', 0, r * .04);
      ctx.fillStyle = '#fff7cc'; ctx.fillText('$', -r * .03, 0);
      gloss(ctx, -r * .28, -r * .38, r * .22, r * .09, -.6, .7);
      break; }
    case 4: { // leaf
      ctx.fillStyle = lg(ctx, -r * .5, -r * .8, r * .5, r * .8, [[0, '#86efac'], [.5, '#22c55e'], [1, '#14532d']]);
      ctx.beginPath(); ctx.moveTo(0, -r * .82); ctx.quadraticCurveTo(r * .85, 0, 0, r * .82); ctx.quadraticCurveTo(-r * .85, 0, 0, -r * .82); ctx.fill();
      ctx.strokeStyle = '#166534'; ctx.lineWidth = r * .07; ctx.beginPath(); ctx.moveTo(0, -r * .62); ctx.lineTo(0, r * .72); ctx.stroke();
      ctx.lineWidth = r * .04;
      for (const k of [-.3, 0, .3]) { ctx.beginPath(); ctx.moveTo(0, k * r); ctx.lineTo(r * .3, k * r - r * .18); ctx.moveTo(0, k * r); ctx.lineTo(-r * .3, k * r - r * .18); ctx.stroke(); }
      gloss(ctx, -r * .18, -r * .3, r * .08, r * .25, .2, .45);
      break; }
  }
  ctx.restore();
}
function drawSpecial(ctx, s, x, y, r, t) {
  ctx.save(); ctx.translate(x, y);
  const pulse = 1 + Math.sin(t * 5) * .06;
  // glow halo behind every special
  const hc = { h: '125,211,252', v: '125,211,252', b: '251,191,36', p: '250,204,21', c: '244,114,182' }[s];
  if (hc) { const g = ctx.createRadialGradient(0, 0, r * .2, 0, 0, r * 1.15 * pulse); g.addColorStop(0, `rgba(${hc},.0)`); g.addColorStop(.6, `rgba(${hc},.35)`); g.addColorStop(1, `rgba(${hc},0)`); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * 1.15 * pulse, 0, 7); ctx.fill(); }
  if (s === 'h' || s === 'v') {
    if (s === 'v') ctx.rotate(Math.PI / 2);
    const sh = (t * 1.6) % 2 - 1;
    ctx.fillStyle = 'rgba(15,23,42,.45)'; ctx.beginPath(); ctx.roundRect(-r * .9, -r * .2, r * 1.8, r * .4, r * .2); ctx.fill();
    ctx.fillStyle = lg(ctx, -r, 0, r, 0, [[0, 'rgba(255,255,255,0)'], [Math.max(0, (sh + 1) / 2 - .15), 'rgba(186,230,253,.4)'], [(sh + 1) / 2, '#ffffff'], [Math.min(1, (sh + 1) / 2 + .15), 'rgba(186,230,253,.4)'], [1, 'rgba(255,255,255,0)']]);
    ctx.beginPath(); ctx.roundRect(-r * .9, -r * .12, r * 1.8, r * .24, r * .12); ctx.fill();
    ctx.fillStyle = '#e0f2fe';
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(d * r * .95, 0); ctx.lineTo(d * r * .65, -r * .22); ctx.lineTo(d * r * .65, r * .22); ctx.fill(); }
  } else if (s === 'b') {
    ctx.fillStyle = rg(ctx, 0, 0, r * .8, '#64748b', '#1e293b', '#020617'); ctx.beginPath(); ctx.arc(0, r * .05, r * .62, 0, 7); ctx.fill();
    gloss(ctx, -r * .22, -r * .18, r * .16, r * .09, -.6, .45);
    ctx.strokeStyle = '#a16207'; ctx.lineWidth = r * .1; ctx.beginPath(); ctx.moveTo(r * .3, -r * .42); ctx.quadraticCurveTo(r * .5, -r * .72, r * .7, -r * .6); ctx.stroke();
    const sp = r * (.16 + Math.abs(Math.sin(t * 14)) * .1);
    ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.arc(r * .72, -r * .62, sp, 0, 7); ctx.fill();
    ctx.fillStyle = '#fb923c'; ctx.beginPath(); ctx.arc(r * .72, -r * .62, sp * .5, 0, 7); ctx.fill();
  } else if (s === 'p') {
    ctx.fillStyle = rg(ctx, 0, 0, r * .8, '#475569', '#0f1b3d', '#020617'); ctx.beginPath(); ctx.arc(0, 0, r * .78, 0, 7); ctx.fill();
    ctx.rotate(t * 9);
    for (let k = 0; k < 2; k++) { ctx.save(); ctx.rotate(k * Math.PI / 2); ctx.fillStyle = lg(ctx, 0, -r * .2, 0, r * .2, [[0, '#fef08a'], [.5, '#eab308'], [1, '#854d0e']]); ctx.beginPath(); ctx.ellipse(0, 0, r * .74, r * .18, 0, 0, 7); ctx.fill(); ctx.restore(); }
    ctx.fillStyle = rg(ctx, 0, 0, r * .2, '#fca5a5', '#dc2626', '#7f1d1d'); ctx.beginPath(); ctx.arc(0, 0, r * .19, 0, 7); ctx.fill();
  } else if (s === 'c') {
    ctx.fillStyle = rg(ctx, 0, 0, r * .8, '#334155', '#0f1b3d', '#020617'); ctx.beginPath(); ctx.arc(0, 0, r * .8, 0, 7); ctx.fill();
    for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2 + t * 1.5, cx = Math.cos(a) * r * .5, cy = Math.sin(a) * r * .5; ctx.fillStyle = rg(ctx, cx, cy, r * .15, '#fff', TILE_COL[k % 5], TILE_COL[k % 5]); ctx.beginPath(); ctx.arc(cx, cy, r * .14, 0, 7); ctx.fill(); }
    ctx.fillStyle = rg(ctx, 0, 0, r * .22, '#ffffff', '#fbcfe8', '#f472b6'); ctx.beginPath(); ctx.arc(0, 0, r * .2 * pulse, 0, 7); ctx.fill();
  }
  ctx.restore();
}
// ---------------------------------------------------------------- puzzle VFX
function addFx(f) { if (!P) return; (P.fx = P.fx || []).push({ ...f, t0: performance.now() }); }
function burst(x, y, col, n = 8, sp = 1) {
  if (!P) return; P.parts = P.parts || [];
  for (let k = 0; k < n; k++) { const a = Math.random() * Math.PI * 2, v = (1.5 + Math.random() * 3.5) * sp; P.parts.push({ x: x + .5, y: y + .5, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1.5, life: 1, col, sz: .05 + Math.random() * .07 }); }
}
let fxLast = 0, shake = 0;
function drawFx(now) {
  const dt = Math.min(.05, (now - (fxLast || now)) / 1000); fxLast = now;
  const W2 = CS * N;
  if (P.parts && P.parts.length) {
    for (const q of P.parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 9 * dt; q.life -= dt * 1.6; }
    P.parts = P.parts.filter(q => q.life > 0);
    for (const q of P.parts) { bx.globalAlpha = Math.max(0, q.life); bx.fillStyle = q.col; bx.beginPath(); bx.arc(q.x * CS, q.y * CS, q.sz * CS * (.6 + q.life * .6), 0, 7); bx.fill(); }
    bx.globalAlpha = 1;
  }
  if (!P.fx || !P.fx.length) return;
  P.fx = P.fx.filter(f => now - f.t0 < f.dur);
  bx.save(); bx.globalCompositeOperation = 'lighter';
  for (const f of P.fx) {
    const u = (now - f.t0) / f.dur, cx = (f.x + .5) * CS, cy = (f.y + .5) * CS, fade = 1 - u;
    if (f.type === 'h' || f.type === 'v') {
      const horiz = f.type === 'h', reach = ease(Math.min(1, u * 2.2)) * W2;
      const w = CS * (.9 - u * .6);
      for (const [col, ww] of [['rgba(56,189,248,', w], ['rgba(255,255,255,', w * .35]]) {
        bx.fillStyle = col + (.85 * fade) + ')';
        if (horiz) bx.fillRect(cx - reach, cy - ww / 2, reach * 2, ww); else bx.fillRect(cx - ww / 2, cy - reach, ww, reach * 2);
      }
    } else if (f.type === 'b') {
      const R = ease(u) * CS * 2.2;
      const g = bx.createRadialGradient(cx, cy, 0, cx, cy, R + 1);
      g.addColorStop(0, `rgba(255,255,255,${.9 * fade})`); g.addColorStop(.35, `rgba(253,224,71,${.8 * fade})`); g.addColorStop(.75, `rgba(249,115,22,${.55 * fade})`); g.addColorStop(1, 'rgba(249,115,22,0)');
      bx.fillStyle = g; bx.beginPath(); bx.arc(cx, cy, R + 1, 0, 7); bx.fill();
      bx.strokeStyle = `rgba(255,255,255,${fade})`; bx.lineWidth = CS * .12 * fade; bx.beginPath(); bx.arc(cx, cy, R * 1.1 + 1, 0, 7); bx.stroke();
    } else if (f.type === 'c') {
      for (const [tx, ty] of f.targets || []) {
        const ex = (tx + .5) * CS, ey = (ty + .5) * CS, seg = 6;
        bx.strokeStyle = `rgba(244,114,182,${fade})`; bx.lineWidth = CS * .08; bx.beginPath(); bx.moveTo(cx, cy);
        for (let k = 1; k <= seg; k++) { const m = k / seg, j = k < seg ? (Math.random() - .5) * CS * .5 : 0; bx.lineTo(cx + (ex - cx) * m + j, cy + (ey - cy) * m + j); }
        bx.stroke(); bx.strokeStyle = `rgba(255,255,255,${fade})`; bx.lineWidth = CS * .03; bx.stroke();
      }
      const g = bx.createRadialGradient(cx, cy, 0, cx, cy, CS * 1.4); g.addColorStop(0, `rgba(255,255,255,${fade})`); g.addColorStop(1, 'rgba(244,114,182,0)');
      bx.fillStyle = g; bx.beginPath(); bx.arc(cx, cy, CS * 1.4, 0, 7); bx.fill();
    } else if (f.type === 'p') {
      const R = CS * (.5 + u * 1.1);
      bx.strokeStyle = `rgba(250,204,21,${fade})`; bx.lineWidth = CS * .1 * fade;
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + u * 6; bx.beginPath(); bx.arc(cx, cy, R, a, a + .9); bx.stroke(); }
    } else if (f.type === 'flash') {
      bx.fillStyle = `rgba(255,255,255,${.35 * fade})`; bx.fillRect(0, 0, W2, W2);
    }
  }
  bx.restore();
}
function drawBoard() {
  if (!P) return;
  const t = performance.now() / 1000;
  const now = performance.now();
  shake *= .88;
  const sx = shake > .3 ? (Math.random() - .5) * shake : 0, sy = shake > .3 ? (Math.random() - .5) * shake : 0;
  bx.setTransform(DPR, 0, 0, DPR, sx * DPR, sy * DPR);
  bx.clearRect(-20, -20, CS * N + 40, CS * N + 40);
  bx.fillStyle = '#0f1b3d'; bx.fillRect(0, 0, CS * N, CS * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const X = x * CS + CS * .04, Y = y * CS + CS * .04, w = CS * .92;
    bx.fillStyle = lg(bx, X, Y, X, Y + w, (x + y) % 2 ? [[0, '#16234a'], [1, '#22336a']] : [[0, '#1b2a57'], [1, '#2a3e7a']]);
    bx.beginPath(); bx.roundRect(X, Y, w, w, CS * .14); bx.fill();
    bx.strokeStyle = 'rgba(255,255,255,.06)'; bx.lineWidth = 1; bx.beginPath(); bx.moveTo(X + CS * .12, Y + w - .5); bx.lineTo(X + w - CS * .12, Y + w - .5); bx.stroke();
  }
  if (P.sel) { bx.strokeStyle = '#fde047'; bx.lineWidth = CS * .07; bx.beginPath(); bx.roundRect(P.sel[0] * CS + CS * .06, P.sel[1] * CS + CS * .06, CS * .88, CS * .88, CS * .14); bx.stroke(); }
  bx.save(); bx.beginPath(); bx.rect(0, 0, CS * N, CS * N); bx.clip();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = P.b[y][x]; if (!c) continue;
    const px = (x + c.ox + .5) * CS, py = (y + c.oy + .5) * CS, r = CS * .42 * c.sc;
    bx.globalAlpha = c.a;
    if (c.t >= 0) drawIcon(bx, c.t, px, py, r);
    if (c.s) drawSpecial(bx, c.s, px, py, r, t);
    bx.globalAlpha = 1;
  }
  drawFx(now);
  if (P.fly) for (const f of P.fly) {
    const px = (f.x0 + (f.x1 - f.x0) * f.p + .5) * CS, py = (f.y0 + (f.y1 - f.y0) * f.p + .5) * CS, r = CS * .42 * (1 + Math.sin(f.p * Math.PI) * .35);
    (P.parts = P.parts || []).push({ x: px / CS, y: py / CS, vx: (Math.random() - .5) * .6, vy: (Math.random() - .5) * .6, life: .7, col: '#facc15', sz: .07 });
    if (f.carry) drawSpecial(bx, f.carry, px, py, r * .9, t);
    drawSpecial(bx, 'p', px, py, r, t);
  }
  bx.restore();
}
const LEGEND = [
  { s: 'h', t: 1, n: 'Row Clear', how: 'Match 4 in a row (side to side)', does: 'Clears its whole row.' },
  { s: 'v', t: 2, n: 'Column Clear', how: 'Match 4 in a column (up and down)', does: 'Clears its whole column.' },
  { s: 'b', t: 0, n: 'Bomb', how: 'Match an L or T shape', does: 'Clears the 3×3 area around it.' },
  { s: 'p', t: -1, n: 'Propeller', how: 'Match a 2×2 square', does: 'Clears the 4 tiles around it, then flies to the spot that helps your goals most. Swap it with another special to carry that special there.' },
  { s: 'c', t: -1, n: 'Color Bomb', how: 'Match 5 in a line', does: 'Swap it with any tile to clear every tile of that type.' },
];
let legendDone = false;
function legendDrag() {
  const el = $('#pz-legend'), hd = el.querySelector('[data-drag]');
  let st = null;
  try { const s = JSON.parse(localStorage.getItem('gsd-legend') || 'null'); if (s) { el.style.left = s.x + 'px'; el.style.top = s.y + 'px'; el.classList.toggle('min', !!s.min); } else if (innerWidth < 760) el.classList.add('min'); } catch (e) {}
  const keep = () => { const r = el.getBoundingClientRect(), pr = $('#v-puzzle').getBoundingClientRect(); try { localStorage.setItem('gsd-legend', JSON.stringify({ x: r.left - pr.left, y: r.top - pr.top, min: el.classList.contains('min') })); } catch (e) {} };
  hd.addEventListener('pointerdown', e => { if (e.target.dataset.lgx !== undefined) return; hd.setPointerCapture(e.pointerId); const r = el.getBoundingClientRect(), pr = $('#v-puzzle').getBoundingClientRect(); st = { dx: e.clientX - r.left, dy: e.clientY - r.top, pr }; });
  hd.addEventListener('pointermove', e => { if (!st) return; el.style.left = clamp(e.clientX - st.dx - st.pr.left, 0, st.pr.width - 60) + 'px'; el.style.top = clamp(e.clientY - st.dy - st.pr.top, 0, st.pr.height - 30) + 'px'; el.style.right = 'auto'; });
  hd.addEventListener('pointerup', () => { if (st) keep(); st = null; });
  el.querySelector('[data-lgx]').addEventListener('click', () => { el.classList.toggle('min'); keep(); });
}
function renderLegend() {
  if (legendDone) return; legendDone = true;
  $('#pz-legend').innerHTML = '<div class="lg-h" data-drag>Specials <button class="lg-x" data-lgx>–</button></div><div class="lg-body">' + LEGEND.map((L, k) => `<div class="lg"><canvas data-lg="${k}" width="${40 * DPR}" height="${40 * DPR}"></canvas>
    <div><b>${L.n}</b><div class="how">${L.how}</div><div>${L.does}</div></div></div>`).join('') +
    `<div class="lg-note"><b>Double-tap or swap any special to fire it</b> — no match needed (uses a move).<br>Swap two specials together → both fire.<br>Two Color Bombs → clears the board.</div></div>`;
  legendDrag();
  document.querySelectorAll('#pz-legend canvas[data-lg]').forEach(c => {
    const L = LEGEND[+c.dataset.lg], x = c.getContext('2d');
    x.setTransform(DPR, 0, 0, DPR, 0, 0); x.fillStyle = '#263970'; x.fillRect(0, 0, 40, 40);
    if (L.t >= 0) drawIcon(x, L.t, 20, 20, 16);
    drawSpecial(x, L.s, 20, 20, 16, 0);
  });
}
function renderPuzzleHead() {
  if (!P) return;
  const goals = Object.entries(P.left).map(([t, v]) => `<div class="goal${v <= 0 ? ' done' : ''}"><canvas data-icon="${t}" width="${28 * DPR}" height="${28 * DPR}" style="width:28px;height:28px"></canvas>${v <= 0 ? '✓' : v}</div>`).join('');
  $('#pz-head').innerHTML = `<div class="lv">Level ${P.L.n}</div><div class="goals">${goals}</div><div class="mv"><b>${P.moves}</b>moves</div>`;
  document.querySelectorAll('#pz-head canvas[data-icon]').forEach(c => { const x = c.getContext('2d'); x.setTransform(DPR, 0, 0, DPR, 0, 0); drawIcon(x, +c.dataset.icon, 14, 14, 12); });
  $('#pz-foot').innerHTML = `Leftover moves become speedup time · ${S.recruit}/${WINS_PER_WORKER} wins to next AI worker`;
  renderLegend();
}
(() => {
  let st = null, lastTap = null;
  const cellAt = e => { const r = boardC.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / CS), Math.floor((e.clientY - r.top) / CS)]; };
  const inB = c => c[0] >= 0 && c[1] >= 0 && c[0] < N && c[1] < N;
  boardC.addEventListener('pointerdown', e => {
    if (!P || P.busy || P.over) return;
    boardC.setPointerCapture(e.pointerId);
    st = { c: cellAt(e), x: e.clientX, y: e.clientY, done: false };
  });
  boardC.addEventListener('pointermove', e => {
    if (!st || st.done) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < CS * .35) return;
    st.done = true;
    const d = Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
    const to = [st.c[0] + d[0], st.c[1] + d[1]];
    if (inB(st.c) && inB(to)) trySwap(st.c, to);
  });
  boardC.addEventListener('pointerup', () => {
    if (!st) return;
    if (!st.done && inB(st.c)) {
      const s = P.sel, c = st.c, now = performance.now();
      const q = P.b[c[1]][c[0]];
      if (lastTap && lastTap.c[0] === c[0] && lastTap.c[1] === c[1] && now - lastTap.t < 400 && q && q.s) { lastTap = null; st = null; fireSpecial(c); return; }
      lastTap = { c, t: now };
      if (s && Math.abs(s[0] - c[0]) + Math.abs(s[1] - c[1]) === 1) trySwap(s, c);
      else { P.sel = (s && s[0] === c[0] && s[1] === c[1]) ? null : c; drawBoard(); }
    }
    st = null;
  });
})();

// ---------------------------------------------------------------- accounts, saves, orb (multiplayer)
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(path, opts = {}) {
  try {
    const r = await fetch('/api/' + path, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...opts });
    const j = await r.json().catch(() => ({ ok: false, error: 'HTTP ' + r.status }));
    if (r.status === 401) { j.auth = false; }
    return j;
  } catch (e) { return { ok: false, error: 'offline' }; }
}
function loadSave(sv) {
  S = sv; for (const k of ['iron', 'coal', 'steel']) if (S.res[k] == null) S.res[k] = 0;
  genMap(S.seed); S.buildings.forEach(b => { MAP.node[b.j * W + b.i] = null; });
  catchUp((Date.now() - S.t) / 1000, true); idle().forEach(autoAssign);
}
async function syncLogin() {
  const q = new URLSearchParams(location.search).get('login');
  if (q) { history.replaceState(null, '', location.pathname); if (q === 'ok') toast('Signed in'); if (q === 'expired') toast('That login link expired — request a new one'); }
  const r = await api('me');
  if (!r.ok) { ME = null; refresh(true); return; }
  ME = r.player;
  const sv = r.save;
  if (!sv) { S.owner = ME.id; save(); await pushSave(); toast('Your village is now saved to your account'); }
  else if (S.owner === ME.id && (S.t || 0) > (sv.t || 0)) { await pushSave(); }   // this device is ahead
  else { loadSave(sv); S.owner = ME.id; save(); dirty = false; }
  if (r.losses && r.losses.length) applyLosses(r.losses);
  refresh(true);
}
async function pushSave(beacon) {
  if (!ME) return;
  S.owner = ME.id;
  const body = JSON.stringify({ save: S, applied });
  if (beacon && navigator.sendBeacon) { navigator.sendBeacon('/api/save', new Blob([body], { type: 'application/json' })); return; }
  const r = await api('save', { method: 'PUT', body });
  if (r.ok) { dirty = false; applied = []; }
  else if (r.auth === false) { ME = null; refresh(true); }
}
async function pollLosses() { const r = await api('losses'); if (r.ok && r.losses.length) applyLosses(r.losses); }
function applyLosses(list) {
  for (const L of list) {
    if (applied.includes(L.id)) continue;
    const b = S.buildings.find(x => x.id === L.building_id);
    if (b) {
      S.buildings = S.buildings.filter(x => x !== b);
      for (const w of S.workers) if (w.task && ((w.task.kind === 'build' && w.task.bid === b.id) || (BNODE.includes(b.type) && TASKS[w.task.kind] && TASKS[w.task.kind].node === b.type))) w.task = null;
      toast(`${L.attacker}'s workers dismantled your ${BLD[b.type] ? BLD[b.type].n : b.type}`);
    }
    applied.push(L.id);
  }
  while (S.waiting >= 0 && S.workers.length > housing()) { S.workers.pop(); S.waiting++; }
  idle().forEach(autoAssign);
  save(); pushSave(); refresh(true);
}
// harvesting: a worker crosses the orb to another village
function raidTime(slotA, slotB, size) { const d = Math.abs(slotA - slotB), r = Math.min(d, size - d); return Math.min(600, 60 + r * 15); }
function startRaid(pl) {
  if (!ME || !ORB) return;
  const w = idle()[0] || free().find(x => !x.task || x.task.kind !== 'raid');
  if (!w) return toast('No free AI worker');
  const dur = raidTime(ORB.me.slot, pl.slot, ORB.size);
  w.task = { kind: 'raid', target: null, pid: pl.id, name: pl.name, dur, prog: 0 }; w.repeat = false;
  toast(`${w.name} heads to ${pl.name}'s village (${fmt(dur)})`); closeSheet(); save(); refresh(true);
}
async function resolveRaid(w, t) {
  const r = await api('harvest', { method: 'POST', body: JSON.stringify({ target: t.pid }) });
  if (!r.ok) { toast(`${w.name} came back empty: ${r.error}`); return; }
  if (r.empty) { toast(`${t.name} had nothing left to dismantle`); return; }
  for (const [k, v] of Object.entries(r.gained)) S.res[k] = (S.res[k] || 0) + v;
  toast(`${w.name} dismantled ${r.from}'s ${BLD[r.building] ? BLD[r.building].n : r.building}: ` + Object.entries(r.gained).map(([k, v]) => `+${v} ${k}`).join(', '));
  idle().forEach(autoAssign); save(); pushSave(); refresh(true);
}
// orb view
let ORB = null, orbLoading = false;
async function loadOrb() {
  if (!ME || orbLoading) return; orbLoading = true;
  const r = await api('orb'); orbLoading = false;
  if (r.ok) { ORB = r; ME = r.me; refresh(true); }
}
function renderOrb(force) {
  const el = $('#v-orb');
  const s = 'o' + JSON.stringify([!!ME, ORB && ORB.players.map(p => [p.id, p.score, p.team, p.online]), ORB && ORB.teams, S.workers.filter(w => w.task && w.task.kind === 'raid').length]);
  if (s === sig && !force) return; sig = s;
  if (!ME) {
    el.innerHTML = `<h2>The Orb</h2>
      <div class="card"><div class="t">Sign in to save your village and join a 100-player orb</div>
      <div class="d">We email you a one-time login link. No password. Your current progress carries over.</div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
        <input id="lg-name" maxlength="20" placeholder="Village name (shown to other players)" class="inp">
        <input id="lg-email" type="email" placeholder="Email" class="inp" autocomplete="email">
        <button class="btn go" data-login>Email me a login link</button>
        <div id="lg-msg" class="small"></div></div></div>
      <div class="card"><div class="t">What happens on the orb</div><div class="d">Up to 100 players share one world. Climb the leaderboard, form teams of up to 13, and send AI workers to dismantle rival villages for 33% of what they cost. New players are protected for 24 hours; teammates can't harvest each other.</div></div>`;
    return;
  }
  if (!ORB) { el.innerHTML = '<h2>The Orb</h2><div class="small">Loading…</div>'; loadOrb(); return; }
  const tName = id => { const t = ORB.teams.find(x => x.id === id); return t ? t.name : ''; };
  const myRank = ORB.players.findIndex(p => p.id === ME.id) + 1;
  let html = `<h2>Orb #${ORB.orb} <span class="small">${ORB.players.length}/${ORB.size} players · you are #${myRank}</span></h2>
    <canvas id="orbc" style="width:100%;max-width:420px;aspect-ratio:1;display:block;margin:0 auto"></canvas>
    <div class="small" style="text-align:center">Gold ring = you · green = teammates · tap a village below to send a harvest crew</div>
    <h3>Leaderboard</h3>
    <table class="lb"><tr><th>#</th><th>Village</th><th>Team</th><th>Lvl</th><th>Bldgs</th><th>Score</th></tr>
    ${ORB.players.map((p, i) => `<tr data-pl="${p.id}" class="${p.id === ME.id ? 'me' : ''}"><td>${i + 1}</td><td>${p.online ? '● ' : ''}${esc(p.name)}${p.shield ? ' 🛡' : ''}</td><td>${esc(tName(p.team))}</td><td>${p.level}</td><td>${p.bcount}</td><td>${p.score}</td></tr>`).join('')}
    </table>
    <h3>Teams <span class="small">${ORB.teams.length}/${ORB.limits.teams}</span></h3>`;
  if (ME.team) html += `<div class="card"><div class="row"><div><div class="t">${esc(tName(ME.team))}</div><div class="d">Your team</div></div><button class="btn sm alt" data-team="leave">Leave</button></div></div>`;
  for (const t of ORB.teams) if (t.id !== ME.team) html += `<div class="card"><div class="row"><div><div class="t">${esc(t.name)}</div><div class="d">${t.members}/${ORB.limits.teamMax} members · ${t.score} pts</div></div>
    <button class="btn sm" data-team="join" data-id="${t.id}" ${t.members >= ORB.limits.teamMax ? 'disabled' : ''}>Join</button></div></div>`;
  if (!ME.team && ORB.teams.length < ORB.limits.teams) html += `<div class="card"><div class="t">Start a team</div><div style="display:flex;gap:6px;margin-top:6px"><input id="tm-name" maxlength="20" placeholder="Team name" class="inp" style="flex:1"><button class="btn sm go" data-team="create">Create</button></div></div>`;
  html += `<div class="foot">Signed in as ${esc(ME.name)} (${esc(ME.email)}) · <button class="btn sm alt" data-logout>Sign out</button></div>`;
  el.innerHTML = html;
  drawOrb();
}
function drawOrb() {
  const c = $('#orbc'); if (!c || !ORB) return;
  const sz = c.getBoundingClientRect().width; if (!sz) return;
  c.width = c.height = sz * DPR; const g = c.getContext('2d'); g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const R = sz / 2, cx = R, cy = R;
  const grd = g.createRadialGradient(cx - R * .3, cy - R * .3, R * .1, cx, cy, R * .95);
  grd.addColorStop(0, '#4ade80'); grd.addColorStop(.6, '#15803d'); grd.addColorStop(1, '#0b4a8f');
  g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, R * .92, 0, 7); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, R * .72, 0, 7); g.stroke();
  for (const p of ORB.players) {
    const a = p.slot / ORB.size * Math.PI * 2 - Math.PI / 2, x = cx + Math.cos(a) * R * .72, y = cy + Math.sin(a) * R * .72;
    const mine = p.id === ME.id, mate = ME.team && p.team === ME.team;
    g.fillStyle = mine ? '#fbbf24' : mate ? '#86efac' : '#f8fafc';
    g.beginPath(); g.arc(x, y, mine ? 8 : 5 + Math.min(4, p.bcount / 3), 0, 7); g.fill();
    if (mine) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); }
  }
  g.fillStyle = '#fff'; g.font = 'bold 14px system-ui'; g.textAlign = 'center'; g.fillText(`Orb #${ORB.orb}`, cx, cy + 5);
}
$('#v-orb').addEventListener('click', async e => {
  const t = e.target;
  if (t.dataset.login !== undefined) {
    const email = $('#lg-email').value.trim(), name = $('#lg-name').value.trim(), msg = $('#lg-msg');
    t.disabled = true; msg.textContent = 'Sending…';
    const r = await api('login', { method: 'POST', body: JSON.stringify({ email, name }) });
    t.disabled = false;
    if (r.ok && r.devLink) { msg.innerHTML = `Dev link: <a href="${r.devLink}">${r.devLink}</a>`; return; }
    msg.textContent = r.ok ? `Check ${email} for your login link (it expires in 30 minutes).` : r.error;
    return;
  }
  if (t.dataset.logout !== undefined) { await pushSave(); await api('logout', { method: 'POST' }); ME = null; ORB = null; S.owner = null; save(); refresh(true); toast('Signed out — playing as guest on this device'); return; }
  if (t.dataset.team) {
    const body = { action: t.dataset.team };
    if (t.dataset.team === 'create') body.name = $('#tm-name').value;
    if (t.dataset.team === 'join') body.id = +t.dataset.id;
    const r = await api('team', { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok) toast(r.error); loadOrb(); return;
  }
  const row = t.closest('tr[data-pl]');
  if (row) {
    const pl = ORB.players.find(p => p.id === +row.dataset.pl); if (!pl) return;
    if (pl.id === ME.id) return openSheet(`<div class="t">${esc(pl.name)} (you)</div><div class="d">Score ${pl.score} · level ${pl.level} · ${pl.bcount} buildings</div>`);
    const mate = ME.team && pl.team === ME.team;
    const blocked = mate ? 'Teammate — immune' : pl.shield ? 'New-player protection (24h)' : '';
    openSheet(`<div class="t">${esc(pl.name)}</div><div class="d">Score ${pl.score} · level ${pl.level} · ${pl.bcount} buildings${pl.online ? ' · online now' : ''}</div>
      <div style="margin-top:8px">${blocked ? `<span class="small">${blocked}</span>` : `<button class="btn go" data-raid="${pl.id}">Send harvest crew (${fmt(raidTime(ORB.me.slot, pl.slot, ORB.size))})</button>
      <div class="small" style="margin-top:4px">One AI worker travels there and dismantles their lowest-tier building for 33% of its cost.</div>`}</div>`);
  }
});
$('#sheet').addEventListener('click', e => { const b = e.target.closest('[data-raid]'); if (b && ORB) { const pl = ORB.players.find(p => p.id === +b.dataset.raid); if (pl) startRaid(pl); } });

// ---------------------------------------------------------------- boot + loop
S = load();
genMap(S.seed);
S.buildings.forEach(b => { MAP.node[b.j * W + b.i] = null; });
catchUp((Date.now() - S.t) / 1000, true);
idle().forEach(autoAssign); // idle workers get to work on load
layout();
refresh(true);
let lastWall = Date.now(), lastUI = 0, lastSave = 0;
function frame(now) {
  const wall = Date.now();
  let dt = (wall - lastWall) / 1000; lastWall = wall;
  if (dt > 2) catchUp(dt, true); else if (dt > 0) tick(dt, false);
  updateDeer(Math.min(dt, .1));
  floaters.forEach(f => f.age += Math.min(dt, .1));
  if (view === 'village') drawMap(now);
  if (view === 'puzzle' && P && !P.busy) drawBoard();
  if (now - lastUI > 300) { lastUI = now; refresh(); }
  if (wall - lastSave > 5000) { lastSave = wall; save(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.addEventListener('visibilitychange', () => { if (document.hidden) { save(); pushSave(true); } });
window.addEventListener('pagehide', () => { save(); pushSave(true); });
setInterval(() => { if (ME && dirty) pushSave(); }, 15000);
setInterval(() => { if (ME) pollLosses(); }, 30000);
setInterval(() => { if (ME && view === 'orb') loadOrb(); }, 20000);
syncLogin();
