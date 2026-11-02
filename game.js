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
};
const FUTURE = [
  { tier: 3, n: 'Charcoal Kiln', desc: 'Wood + Wood → Coal' },
  { tier: 3, n: 'Mine', desc: 'Iron, copper, silver' },
  { tier: 4, n: 'Smelter', desc: 'Iron + Coal → Steel' },
  { tier: 4, n: 'Mint', desc: 'Silver and gold' },
  { tier: 5, n: 'Town Hall', desc: 'More workers, orb rank' },
];
const TASKS = {
  berries: { n: 'Pick berries', node: 'bush', time: 20, gain: { food: 3 } },
  hunt:    { n: 'Hunt deer', node: 'deer', time: 30, gain: { food: 6 }, req: 'hunt' },
  farm:    { n: 'Harvest farm', node: 'farm', time: 25, gain: { food: 5 }, req: 'farm' },
  chop:    { n: 'Chop wood', node: 'tree', time: 20, gain: { wood: 3 }, boost: 'lumber' },
  stone:   { n: 'Quarry stone', node: 'rock', time: 30, gain: { stone: 2 }, req: 'quarry' },
};
const NODE_TASK = { bush: 'berries', tree: 'chop', rock: 'stone', deer: 'hunt', farm: 'farm' };
const NODE_NAME = { bush: 'Berry bush', tree: 'Tree', rock: 'Rock', deer: 'Deer', farm: 'Farm Plot' };

// ---------------------------------------------------------------- state
const SAVE_KEY = 'gsd-get-stuff-done-v1';
const W = 32, H = 24, TCI = 16, TCJ = 12;
let S;

function newState() {
  return {
    v: 1, t: Date.now(), seed: (Math.random() * 1e9) | 0,
    res: { food: 10, wood: 12, stone: 0, copper: 6, silver: 0, gold: 0 },
    bank: 0, level: 1, wins: 0, recruit: 0, waiting: 0, eatAcc: 0, nextId: 1,
    workers: [], buildings: [{ id: 0, type: 'tc', i: TCI, j: TCJ, done: true }],
  };
}
function load() {
  try { const raw = localStorage.getItem(SAVE_KEY); if (raw) { const s = JSON.parse(raw); if (s && s.v === 1) return s; } } catch (e) {}
  return newState();
}
function save() { S.t = Date.now(); try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {} }

const hasB = t => S.buildings.some(b => b.type === t && b.done);
const countB = t => S.buildings.filter(b => b.type === t).length;
const housing = () => S.buildings.reduce((a, b) => a + (b.done ? (BLD[b.type].house || 0) : 0), 0);
const starving = () => S.workers.length > 0 && S.res.food <= 0;
const idle = () => S.workers.filter(w => !w.task);
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
  if (T.node === 'farm') { const b = S.buildings.find(x => x.type === 'farm' && x.done); return [b.i, b.j]; }
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
    if (!taskOpen(kind)) continue;
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
  const y = taskYield(t.kind);
  for (const k in y) S.res[k] += y[k];
  if (!quiet && t.target) floaters.push({ i: t.target[0], j: t.target[1], text: Object.entries(y).map(([k, v]) => `+${v} ${k}`).join(' '), age: 0 });
  const carry = t.prog - t.dur;
  if (w.repeat && taskOpen(t.kind)) {
    w.task = { kind: t.kind, dur: TASKS[t.kind].time, prog: Math.max(0, carry), target: pickTarget(t.kind) };
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
  w.task = { kind, dur: T.time, prog: 0, target }; w.repeat = true;
  save(); refresh();
}
function startBuild(type) {
  const D = BLD[type], c = costOf(type), w = idle()[0];
  if (!D.repeat && countB(type)) return;
  if (D.req && !D.req.every(hasB)) return toast('Locked');
  if (!canPay(c)) return toast('Not enough resources');
  if (!w) return toast('No idle AI worker to build it');
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
    it('#c0392b', 'Food', R.food, starving() || (R.food <= 2 && S.workers.length)) + it('#8b5a2b', 'Wood', R.wood) + it('#9aa3ab', 'Stone', R.stone) +
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
  const s = 'b' + JSON.stringify([S.res, S.buildings.map(b => b.type + b.done), idle().length]);
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
      else btn = `<button class="btn sm" data-build="${k}" ${locked || !canPay(c) || !idle().length ? 'disabled' : ''}>Build</button>`;
      html += `<div class="card${locked ? ' locked' : ''}"><div class="row"><div><div class="t">${D.n}${D.repeat && built ? ` <span class="small">×${built}</span>` : ''}</div><div class="d">${D.desc}</div>
        <div class="cost">${locked ? 'Requires ' + D.req.map(r => BLD[r].n).join(', ') : costHTML(c) + ` · ${fmt(D.time)}`}</div></div>${btn}</div></div>`;
    }
    for (const f of FUTURE.filter(f => f.tier === tier)) {
      html += `<div class="card locked"><div class="row"><div><div class="t">${f.n}</div><div class="d">${f.desc}</div></div><span class="small">Coming soon</span></div></div>`;
    }
  }
  if (!idle().length) html += `<div class="foot">Building needs an idle AI worker.</div>`;
  $('#v-build').innerHTML = html;
}
$('#v-build').addEventListener('click', e => { const b = e.target.closest('[data-build]'); if (b && !b.disabled) startBuild(b.dataset.build); });

function taskLabel(t) { if (t.kind === 'build') { const b = S.buildings.find(x => x.id === t.bid); return 'Building ' + (b ? BLD[b.type].n : ''); } return TASKS[t.kind].n; }
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
    html += `<div class="foot">Guest save on this device. Accounts and the shared 100-player orb are next.<br>
      <a href="https://gsdconsultantsllc.com" target="_blank" rel="noopener">GSD Consultants, LLC</a> · v0.1<br><br>
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
function tileSheet(i, j) {
  const b = bAt(i, j);
  let kind = b ? (b.type === 'farm' && b.done ? 'farm' : null) : nodeAt(i, j);
  const deer = DEER.find(d => Math.floor(mod(d.i, W)) === mod(i, W) && Math.floor(d.j) === j);
  if (deer && !b) kind = 'deer';
  if (b && kind !== 'farm') {
    const D = BLD[b.type];
    return openSheet(`<div class="t">${D.n}</div><div class="d">${b.done ? (D.desc || 'Your base. Houses 2 AI workers.') : 'Under construction'}</div>`);
  }
  if (!kind) return closeSheet();
  const tk = NODE_TASK[kind], T = TASKS[tk], y = taskYield(tk), locked = T.req && !hasB(T.req);
  openSheet(`<div class="t">${NODE_NAME[kind]}</div>
    <div class="d">${T.n}: ${Object.entries(y).map(([k, v]) => `+${v} ${k}`).join(', ')} every ${fmt(T.time)}</div>
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
  mx.fillStyle = '#1d3b52'; mx.fillRect(0, 0, cw, ch);
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
      if (hit) tileSheet(hit[0], hit[1]); else closeSheet();
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
        do { t = rndType(); } while ((x >= 2 && b[y][x - 1].t === t && b[y][x - 2].t === t) || (y >= 2 && b[y - 1][x].t === t && b[y - 2][x].t === t));
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
  const wrap = $('#v-puzzle'); if (!wrap.offsetWidth) return;
  const side = wrap.offsetWidth >= 760 ? 280 : 0;
  const avail = Math.min(wrap.offsetWidth - 20 - side, (side ? wrap.offsetHeight - 150 : wrap.offsetHeight - 150), 480);
  CS = Math.floor(Math.max(200, avail) / N);
  boardC.style.width = boardC.style.height = CS * N + 'px';
  boardC.width = boardC.height = CS * N * DPR;
  drawBoard();
}
function findRuns(b) {
  const runs = [];
  for (let y = 0; y < N; y++) { let x = 0; while (x < N) { const t = b[y][x] ? b[y][x].t : -2; let e = x + 1; if (t >= 0) while (e < N && b[y][e] && b[y][e].t === t) e++; if (t >= 0 && e - x >= 3) { const cs = []; for (let k = x; k < e; k++) cs.push([k, y]); runs.push({ dir: 'h', cells: cs, t }); } x = e; } }
  for (let x = 0; x < N; x++) { let y = 0; while (y < N) { const t = b[y][x] ? b[y][x].t : -2; let e = y + 1; if (t >= 0) while (e < N && b[e][x] && b[e][x].t === t) e++; if (t >= 0 && e - y >= 3) { const cs = []; for (let k = y; k < e; k++) cs.push([x, k]); runs.push({ dir: 'v', cells: cs, t }); } y = e; } }
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
  const max = Math.max(...g.runs.map(r => r.cells.length));
  const hv = g.runs.some(r => r.dir === 'h') && g.runs.some(r => r.dir === 'v');
  if (max >= 5) return 'c';
  if (hv) return 'b';
  if (max === 4) return g.runs.find(r => r.cells.length === 4).dir;
  return null;
}
function hasMoves(b) {
  const sw = (x1, y1, x2, y2) => { const t = b[y1][x1]; b[y1][x1] = b[y2][x2]; b[y2][x2] = t; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const x2 = x + dx, y2 = y + dy; if (x2 >= N || y2 >= N) continue;
      const A = b[y][x], B = b[y2][x2];
      if (A.s === 'c' || B.s === 'c' || (A.s && B.s)) return true;
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
async function clearCells(start, spawns = []) {
  const queue = [...start], seen = new Set();
  while (queue.length) {
    const k = queue.pop(); if (seen.has(k)) continue; seen.add(k);
    const [x, y] = k.split(',').map(Number), c = P.b[y][x];
    if (c && c.s) triggerArea(c, x, y).forEach(q => { if (!seen.has(q)) queue.push(q); });
  }
  const cells = [...seen].map(k => k.split(',').map(Number)).filter(([x, y]) => P.b[y][x]);
  for (const [x, y] of cells) { const c = P.b[y][x]; if (c.t >= 0 && P.left[c.t] > 0) P.left[c.t]--; P.score += 10; }
  await anim(170, t => { for (const [x, y] of cells) { const c = P.b[y][x]; c.a = 1 - t; c.sc = 1 + .25 * t; } });
  for (const [x, y] of cells) P.b[y][x] = null;
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
      spawns.push({ pos, s, t: s === 'c' ? -1 : g.t });
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
  } else if (A.s && B.s) {
    P.moves--;
    await clearCells([a[0] + ',' + a[1], b[0] + ',' + b[1]]);
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
function checkEnd() {
  if (P.over) return;
  const won = Object.values(P.left).every(v => v <= 0);
  if (won) return win();
  if (P.moves <= 0) lose();
}
function win() {
  P.over = true;
  const extra = P.moves, stars = 1 + (extra >= 3 ? 1 : 0) + (extra >= 6 ? 1 : 0);
  const rw = { copper: 3, silver: stars - 1, gold: S.level % 5 === 0 ? 1 : 0 };
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
    <ul><li>+${rw.copper} copper${rw.silver ? `, +${rw.silver} silver` : ''}${rw.gold ? ', +1 gold' : ''}</li>
    ${extra ? `<li>${extra} moves left → +${fmt(speed)} speedup</li>` : ''}${recruit}</ul>
    <div class="btns"><button class="btn alt" data-act="village">Village</button><button class="btn go" data-act="next">Next puzzle</button></div>`);
}
function lose() {
  P.over = true;
  modal(`<h2>Out of moves</h2><p>${Object.entries(P.left).filter(([, v]) => v > 0).map(([t, v]) => `${v} ${TILE_NAME[t]}`).join(', ')} left.</p>
    <div class="btns"><button class="btn alt" data-act="village">Village</button><button class="btn go" data-act="next">Try again</button></div>`);
}
const ACTS = {
  next: () => { startLevel(); },
  village: () => { P = null; setView('village'); },
  reset: () => { localStorage.removeItem(SAVE_KEY); S = newState(); genMap(S.seed); P = null; save(); setView('village'); toast('Progress reset'); },
};

function drawIcon(ctx, t, x, y, r) {
  ctx.save(); ctx.translate(x, y);
  switch (t) {
    case 0: // berries
      ctx.fillStyle = '#2f7a2a'; ctx.beginPath(); ctx.ellipse(r * .1, -r * .62, r * .35, r * .16, -.5, 0, 7); ctx.fill();
      ctx.fillStyle = '#d0263a';
      [[-.32, .12], [.32, .12], [0, -.22]].forEach(([a, b]) => { ctx.beginPath(); ctx.arc(a * r, b * r, r * .36, 0, 7); ctx.fill(); });
      ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.arc(-.42 * r, 0, r * .09, 0, 7); ctx.fill();
      break;
    case 1: // wood log
      ctx.fillStyle = '#7a4a22'; ctx.beginPath(); ctx.roundRect(-r * .8, -r * .38, r * 1.5, r * .76, r * .3); ctx.fill();
      ctx.fillStyle = '#d9a86a'; ctx.beginPath(); ctx.ellipse(r * .7, 0, r * .24, r * .38, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = '#7a4a22'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(r * .7, 0, r * .1, r * .18, 0, 0, 7); ctx.stroke();
      break;
    case 2: // stone
      ctx.fillStyle = '#8e979e'; ctx.beginPath(); ctx.moveTo(-r * .8, r * .3); ctx.lineTo(-r * .5, -r * .55); ctx.lineTo(r * .3, -r * .7); ctx.lineTo(r * .8, -r * .05); ctx.lineTo(r * .5, r * .6); ctx.lineTo(-r * .4, r * .65); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#c3cacf'; ctx.beginPath(); ctx.moveTo(-r * .5, -r * .55); ctx.lineTo(r * .3, -r * .7); ctx.lineTo(0, -r * .1); ctx.closePath(); ctx.fill();
      break;
    case 3: // coin
      ctx.fillStyle = '#b8860b'; ctx.beginPath(); ctx.arc(0, 0, r * .75, 0, 7); ctx.fill();
      ctx.fillStyle = '#f2c43d'; ctx.beginPath(); ctx.arc(0, 0, r * .62, 0, 7); ctx.fill();
      ctx.strokeStyle = '#b8860b'; ctx.lineWidth = r * .1; ctx.beginPath(); ctx.arc(0, 0, r * .38, 0, 7); ctx.stroke();
      break;
    case 4: // leaf
      ctx.fillStyle = '#4caf3a'; ctx.beginPath(); ctx.moveTo(0, -r * .8); ctx.quadraticCurveTo(r * .8, 0, 0, r * .8); ctx.quadraticCurveTo(-r * .8, 0, 0, -r * .8); ctx.fill();
      ctx.strokeStyle = '#2b6a20'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -r * .6); ctx.lineTo(0, r * .7); ctx.stroke();
      break;
  }
  ctx.restore();
}
function drawSpecial(ctx, s, x, y, r, t) {
  ctx.save(); ctx.translate(x, y);
  if (s === 'h' || s === 'v') {
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = r * .12;
    for (const k of [-.35, 0, .35]) { ctx.beginPath(); if (s === 'h') { ctx.moveTo(-r * .85, k * r); ctx.lineTo(r * .85, k * r); } else { ctx.moveTo(k * r, -r * .85); ctx.lineTo(k * r, r * .85); } ctx.stroke(); }
  } else if (s === 'b') {
    ctx.strokeStyle = '#ffde59'; ctx.lineWidth = r * .14; ctx.beginPath(); ctx.arc(0, 0, r * .88, 0, 7); ctx.stroke();
    ctx.fillStyle = '#ffde59'; ctx.beginPath(); ctx.arc(r * .6, -r * .6, r * .16 + Math.sin(t * 10) * r * .05, 0, 7); ctx.fill();
  } else if (s === 'c') {
    ctx.fillStyle = '#22160c'; ctx.beginPath(); ctx.arc(0, 0, r * .8, 0, 7); ctx.fill();
    const cols = ['#d0263a', '#c87a2a', '#c3cacf', '#f2c43d', '#4caf3a'];
    for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2 + t * 1.5; ctx.fillStyle = cols[k % 5]; ctx.beginPath(); ctx.arc(Math.cos(a) * r * .5, Math.sin(a) * r * .5, r * .14, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, r * .18, 0, 7); ctx.fill();
  }
  ctx.restore();
}
function drawBoard() {
  if (!P) return;
  const t = performance.now() / 1000;
  bx.setTransform(DPR, 0, 0, DPR, 0, 0);
  bx.clearRect(0, 0, CS * N, CS * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { bx.fillStyle = (x + y) % 2 ? '#3a2816' : '#45301b'; bx.fillRect(x * CS, y * CS, CS, CS); }
  if (P.sel) { bx.fillStyle = 'rgba(255,222,89,.35)'; bx.fillRect(P.sel[0] * CS, P.sel[1] * CS, CS, CS); }
  bx.save(); bx.beginPath(); bx.rect(0, 0, CS * N, CS * N); bx.clip();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = P.b[y][x]; if (!c) continue;
    const px = (x + c.ox + .5) * CS, py = (y + c.oy + .5) * CS, r = CS * .42 * c.sc;
    bx.globalAlpha = c.a;
    if (c.t >= 0) drawIcon(bx, c.t, px, py, r);
    if (c.s) drawSpecial(bx, c.s, px, py, r, t);
    bx.globalAlpha = 1;
  }
  bx.restore();
}
const LEGEND = [
  { s: 'h', t: 1, n: 'Row Clear', how: 'Match 4 in a row (side to side)', does: 'Clears its whole row when matched or swapped.' },
  { s: 'v', t: 2, n: 'Column Clear', how: 'Match 4 in a column (up and down)', does: 'Clears its whole column when matched or swapped.' },
  { s: 'b', t: 0, n: 'Bomb', how: 'Match an L or T shape', does: 'Clears the 3×3 area around it.' },
  { s: 'c', t: -1, n: 'Color Bomb', how: 'Match 5 in a line', does: 'Swap it with any tile to clear every tile of that type.' },
];
let legendDone = false;
function renderLegend() {
  if (legendDone) return; legendDone = true;
  $('#pz-legend').innerHTML = '<div class="lg-h">Specials</div>' + LEGEND.map((L, k) => `<div class="lg"><canvas data-lg="${k}" width="${40 * DPR}" height="${40 * DPR}"></canvas>
    <div><b>${L.n}</b><div class="how">${L.how}</div><div>${L.does}</div></div></div>`).join('') +
    `<div class="lg-note">Swap two specials together → both fire.<br>Two Color Bombs → clears the board.</div>`;
  document.querySelectorAll('#pz-legend canvas[data-lg]').forEach(c => {
    const L = LEGEND[+c.dataset.lg], x = c.getContext('2d');
    x.setTransform(DPR, 0, 0, DPR, 0, 0); x.fillStyle = '#45301b'; x.fillRect(0, 0, 40, 40);
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
  let st = null;
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
      const s = P.sel, c = st.c;
      if (s && Math.abs(s[0] - c[0]) + Math.abs(s[1] - c[1]) === 1) trySwap(s, c);
      else { P.sel = (s && s[0] === c[0] && s[1] === c[1]) ? null : c; drawBoard(); }
    }
    st = null;
  });
})();

// ---------------------------------------------------------------- boot + loop
S = load();
genMap(S.seed);
S.buildings.forEach(b => { MAP.node[b.j * W + b.i] = null; });
catchUp((Date.now() - S.t) / 1000, true);
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
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
window.addEventListener('pagehide', save);
