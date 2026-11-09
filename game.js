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
const MORE_MOVES_COST = 100;
const TOOLS = {
  pick:  { n: 'Pickaxe', d: 'Smash any one tile', cost: 30 },
  saw:   { n: 'Buzz Saw', d: 'Cut a whole row', cost: 60 },
  drill: { n: 'Drill Rig', d: 'Bore a whole column', cost: 60 },
  storm: { n: 'Dust Storm', d: 'Reshuffle the whole board', cost: 40 },
  swap:  { n: 'Swap', d: 'Swap any two tiles anywhere on the board (no move used)', cost: 40 },
};  // copper value for +5 moves on a failed puzzle
const MAX_OFFLINE = 3 * 86400;

const RES = [
  { k: 'food', n: 'Food', c: '#c0392b' },
  { k: 'wood', n: 'Wood', c: '#8b5a2b' },
  { k: 'stone', n: 'Stone', c: '#9aa3ab' },
  { k: 'copper', n: 'Copper', c: '#c86f33' },
  { k: 'silver', n: 'Silver', c: '#d8dde2' },
  { k: 'gold', n: 'Gold', c: '#e8b923' },
  { k: 'iron', n: 'Iron' }, { k: 'coal', n: 'Coal' }, { k: 'steel', n: 'Steel' }, { k: 'planks', n: 'Planks' }, { k: 'gears', n: 'Gears' },
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
  townhall: { n: 'Town Hall', tier: 5, time: 300, house: 5, req: ['smelter', 'mint'], cost: { wood: 80, stone: 60, steel: 10, money: 40 }, desc: 'Houses 5 more AI workers; world rank (multiplayer)' },
  mine:   { n: 'Mine', tier: 3, time: 150, req: ['quarry', 'farm'], cost: { wood: 30, stone: 20, money: 10 }, desc: 'Iron and copper; silver every 3rd trip' },
};
const FUTURE = [];
const TASKS = {
  berries: { n: 'Pick berries', node: 'bush', time: 20, gain: { food: 6 } },
  hunt:    { n: 'Hunt deer', node: 'deer', time: 30, gain: { food: 6 }, req: 'hunt' },
  farm:    { n: 'Harvest farm', node: 'farm', time: 25, gain: { food: 5 }, req: 'farm' },
  chop:    { n: 'Chop wood', node: 'tree', time: 20, gain: { wood: 3 }, boost: 'lumber' },
  stone:   { n: 'Quarry stone', node: 'rock', time: 30, gain: { stone: 2 }, req: 'quarry' },
  coal:    { n: 'Burn charcoal', node: 'kiln', time: 30, cost: { wood: 2 }, gain: { coal: 1 }, req: 'kiln' },
  smelt:   { n: 'Smelt steel', node: 'smelter', time: 35, cost: { iron: 1, coal: 1 }, gain: { steel: 1 }, req: 'smelter' },
  strike:  { n: 'Strike gold', node: 'mint', time: 45, cost: { steel: 1 }, gain: { gold: 1 }, req: 'mint' },
  mine:    { n: 'Mine ore', node: 'mine', time: 40, gain: { iron: 2, copper: 1 }, req: 'mine' },
  deadwood: { n: 'Gather deadwood', node: 'tc', time: 30, gain: { wood: 1 } },   // endless fallback once every tree is gone
};
const NODE_TASK = { bush: 'berries', tree: 'chop', rock: 'stone', deer: 'hunt', farm: 'farm', kiln: 'coal', mine: 'mine', smelter: 'smelt', mint: 'strike' };
const NODE_NAME = { bush: 'Berry bush', tree: 'Tree', rock: 'Rock', deer: 'Deer', farm: 'Farm Plot', kiln: 'Charcoal Kiln', mine: 'Mine', smelter: 'Smelter', mint: 'Mint' };
const BNODE = ['farm', 'kiln', 'mine', 'smelter', 'mint'];   // buildings workers gather at
const SPOT_CAP = 2;   // AI workers per resource building
const workersAt = (b, except) => S.workers.filter(w => w !== except && w.task && w.task.target && TASKS[w.task.kind] && TASKS[w.task.kind].node === b.type && Math.round(w.task.target[0]) === b.i && Math.round(w.task.target[1]) === b.j);
function openSpot(type, except) { let best = null; for (const b of S.buildings) if (b.type === type && b.done) { const n = workersAt(b, except).length; if (n < SPOT_CAP && (!best || n < best.n)) best = { b, n }; } return best && best.b; }
// saves from before the cap: extra workers at a building go find other work
function enforceSpotCap() { for (const b of S.buildings) if (BNODE.includes(b.type)) workersAt(b).slice(SPOT_CAP).forEach(w => { const kind = w.task.kind; w.task = null; const o = openSpot(b.type, w); if (o) w.task = mkTask(w, kind, [o.i, o.j]); else autoAssign(w); }); }
// resource buildings: 1 more copy per Age researched and per prestige after the first; each copy costs double the last
const isResB = t => BNODE.includes(t) || t === 'storehouse' || t === 'grainstore';
const maxCopies = () => 1 + ['age6', 'age7', 'age8', 'age9'].filter(a => U(a)).length + Math.max(0, PRES() - 1);
Object.assign(BLD, EXTRA_BLD); Object.assign(TASKS, EXTRA_TASKS);
Object.assign(NODE_TASK, { quarry: 'dig', dock: 'fish', quarry2: 'stone2', sawmill: 'saw', blastfurnace: 'blast', gearworks: 'gear', goldrock: 'pan' });
Object.assign(NODE_NAME, { dock: 'Fishing Dock', quarry2: 'Deep Quarry Pit', sawmill: 'Sawmill', blastfurnace: 'Blast Furnace', gearworks: 'Gearworks', goldrock: 'Gold rock' });
BNODE.push('quarry', 'dock', 'quarry2', 'sawmill', 'blastfurnace', 'gearworks');
const NODES = ['tree', 'bush', 'rock', 'goldrock'];

// ---------------------------------------------------------------- sound (synthesized, no files)
let AC = null, MUTED = false, lastSfx = {};
try { MUTED = localStorage.getItem('gsd-mute') === '1'; } catch (e) {}
function audio() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } } if (AC.state === 'suspended') AC.resume(); return AC; }
window.addEventListener('pointerdown', () => audio(), { once: true });
function tone(f, d, o = {}) {
  const a = audio(); if (!a) return; const t0 = a.currentTime + (o.at || 0);
  const g = a.createGain(), osc = a.createOscillator();
  osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(f, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + d);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(o.vol || .18, t0 + .01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  osc.connect(g).connect(a.destination); osc.start(t0); osc.stop(t0 + d + .02);
}
function noise(d, o = {}) {
  const a = audio(); if (!a) return; const t0 = a.currentTime + (o.at || 0);
  const buf = a.createBuffer(1, Math.max(1, a.sampleRate * d), a.sampleRate), ch = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, o.decay || 2);
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = o.ftype || 'lowpass'; f.frequency.setValueAtTime(o.f || 1200, t0); if (o.fto) f.frequency.exponentialRampToValueAtTime(o.fto, t0 + d);
  const g = a.createGain(); g.gain.value = o.vol || .3;
  src.connect(f).connect(g).connect(a.destination); src.start(t0);
}
const SFX = {
  tap: () => tone(660, .06, { type: 'triangle', vol: .08 }),
  swap: () => tone(420, .09, { type: 'triangle', to: 560, vol: .1 }),
  bad: () => { tone(220, .12, { type: 'square', vol: .06 }); tone(180, .14, { type: 'square', vol: .06, at: .08 }); },
  match: n => { const b = 520 * Math.pow(1.12, Math.min(n, 8)); tone(b, .12, { type: 'triangle', vol: .12 }); tone(b * 1.5, .1, { type: 'sine', vol: .07, at: .04 }); },
  special: () => { [0, 4, 7, 12].forEach((k, i) => tone(660 * Math.pow(2, k / 12), .14, { type: 'triangle', vol: .1, at: i * .05 })); },
  line: () => { noise(.35, { ftype: 'bandpass', f: 600, fto: 4000, vol: .35, decay: 1 }); tone(300, .3, { type: 'sawtooth', to: 1200, vol: .05 }); },
  bomb: () => { noise(.6, { f: 900, fto: 80, vol: .6, decay: 1.5 }); tone(110, .45, { type: 'sine', to: 40, vol: .35 }); },
  color: () => { for (let i = 0; i < 6; i++) tone(900 + i * 220, .18, { type: 'sine', vol: .07, at: i * .03 }); noise(.4, { ftype: 'highpass', f: 3000, vol: .15 }); },
  prop: () => { noise(.45, { ftype: 'bandpass', f: 300, fto: 1400, vol: .3, decay: .8 }); },
  nuke: () => { noise(1.1, { f: 1500, fto: 60, vol: .7, decay: 1.2 }); tone(80, .9, { type: 'sine', to: 30, vol: .4 }); },
  tool: () => { tone(160, .08, { type: 'square', vol: .12 }); noise(.15, { f: 2500, vol: .25 }); },
  shuffle: () => { for (let i = 0; i < 8; i++) tone(300 + Math.random() * 600, .06, { type: 'triangle', vol: .06, at: i * .04 }); },
  coin: () => { tone(988, .08, { type: 'square', vol: .07 }); tone(1319, .18, { type: 'square', vol: .07, at: .07 }); },
  win: () => { [0, 4, 7, 12, 16].forEach((k, i) => tone(523 * Math.pow(2, k / 12), .3, { type: 'triangle', vol: .12, at: i * .1 })); },
  lose: () => { [0, -3, -7].forEach((k, i) => tone(392 * Math.pow(2, k / 12), .35, { type: 'triangle', vol: .1, at: i * .16 })); },
  gather: () => tone(740, .07, { type: 'sine', vol: .05 }),
  build: () => { [0, 7, 12].forEach((k, i) => tone(392 * Math.pow(2, k / 12), .2, { type: 'triangle', vol: .1, at: i * .08 })); noise(.15, { f: 600, vol: .2 }); },
  recruit: () => { [0, 5, 9, 12].forEach((k, i) => tone(587 * Math.pow(2, k / 12), .22, { type: 'sine', vol: .1, at: i * .07 })); },
  harvest: () => { noise(.3, { f: 700, vol: .3 }); tone(330, .2, { type: 'square', to: 220, vol: .06 }); },
};
function sfx(name, arg, gap = 0) {
  if (MUTED || !SFX[name]) return;
  const now = performance.now(); if (gap && now - (lastSfx[name] || 0) < gap) return; lastSfx[name] = now;
  try { SFX[name](arg); } catch (e) {}
}
document.addEventListener('click', e => { const b = e.target.closest('button'); if (b && !b.disabled && b.id !== 'mute') sfx('tap', 0, 40); }, true);
function muteIcon() { const m = document.getElementById('mute'); if (m) m.textContent = MUTED ? '🔇' : '🔊'; }
document.addEventListener('DOMContentLoaded', muteIcon);
document.addEventListener('click', e => { if (e.target.id !== 'mute') return; MUTED = !MUTED; try { localStorage.setItem('gsd-mute', MUTED ? '1' : '0'); } catch (er) {} muteIcon(); if (!MUTED) sfx('coin'); });
setTimeout(muteIcon, 0);

// ---------------------------------------------------------------- state
const SAVE_KEY = 'gsd-get-stuff-done-v1';
const W = 32, H = 24, TCI = 16, TCJ = 12;
let S, ME = null, dirty = false, applied = [], SIM_BACK = 0;
const simNow = () => Date.now() - SIM_BACK;   // during offline catch-up, the moment being simulated

function newState() {
  return {
    v: 1, t: Date.now(), seed: (Math.random() * 1e9) | 0,
    res: { food: 10, wood: 12, stone: 0, iron: 0, coal: 0, steel: 0, planks: 0, gears: 0, copper: 6, silver: 0, gold: 0 },
    bank: 0, level: 1, wins: 0, recruit: 0, waiting: 0, eatAcc: 0, nextId: 1, upg: {},
    workers: [], buildings: [{ id: 0, type: 'tc', i: TCI, j: TCJ, done: true }],
  };
}
function load() {
  try { const raw = localStorage.getItem(SAVE_KEY); if (raw) { const s = JSON.parse(raw); if (s && s.v === 1) return migrate(s); } } catch (e) {}
  return newState();
}
// fill any field added since the save was written, without touching existing values
function migrate(s) {
  const d = newState();
  for (const k in d) if (s[k] == null) s[k] = d[k];
  for (const k in d.res) if (s.res[k] == null) s.res[k] = 0;
  return s;
}
function save() { S.t = Date.now(); dirty = true; try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {} }

const hasB = t => S.buildings.some(b => b.type === t && b.done);
const countB = t => S.buildings.filter(b => b.type === t).length;
const housing = () => S.buildings.reduce((a, b) => a + (b.done ? (b.type === 'hut' ? hutHouse() : (BLD[b.type].house || 0)) : 0), 0);
const starving = () => S.workers.length > 0 && S.res.food <= 0;
const idle = () => S.workers.filter(w => !w.task);
const free = () => S.workers.filter(w => !w.task || w.task.kind !== 'build'); // can be pulled onto a build
const wallet = () => S.res.copper + 3 * S.res.silver + 10 * S.res.gold;

function costOf(type) {
  if (type === 'hut') { const n = countB('hut'); return buildCost(type, { wood: 15 + 8 * n, money: 3 + 2 * n }); }
  const D = BLD[type];
  if (isResB(type) && D.cost) { const n = countB(type), m = Math.pow(2, n), c = {}; for (const k in D.cost) c[k] = Math.round(D.cost[k] * m); return buildCost(type, c); }
  if (D.repeat && D.cost) { const n = countB(type), m = Math.pow(1.4, n), c = {}; for (const k in D.cost) c[k] = Math.round(D.cost[k] * m); return buildCost(type, c); }
  return buildCost(type, D.cost);
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
// why a button is greyed out — shown under every disabled option
function shortBy(c) { return Object.entries(c).map(([k, v]) => { const have = k === 'money' ? wallet() : (S.res[k] || 0); return have < v ? `${Math.ceil(v - have)} more ${k === 'money' ? 'coin' : k}` : null; }).filter(Boolean); }
function reqHint(r) { return BLD[r] ? `build ${BLD[r].n}` : UPGI[r] ? `research ${UPGI[r].n} (Tech tab)` : r; }
const whyHTML = w => w ? `<div class="why">🔒 ${w}</div>` : '';
const needCoin = n => `need ${Math.ceil(n - wallet())} more coin`;
function costHTML(c) {
  return Object.entries(c).map(([k, v]) => {
    const have = k === 'money' ? wallet() : (S.res[k] || 0);
    const label = k === 'money' ? 'coin' : k;
    return `<span class="${have < v ? 'no' : ''}">${v} ${label}</span>`;
  }).join(' · ');
}

// ---------------------------------------------------------------- map
let MAP, DEER = [];
function near(i, j, a, b) { return Math.max(Math.abs(i - a), Math.abs(j - b)); }
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
  // every tree / bush / rock holds a random number of trips
  const ra = rng(seed ^ 0x2545f491), amt = new Array(W * H).fill(0);
  if (S && S.planted) for (const k in S.planted) if (!node[k]) node[k] = S.planted[k];
  if (S && U('prospect')) { const rp = rng(seed ^ 0x77aa11); for (let n = 0; n < 7; n++) { const k = ((rp() * H) | 0) * W + ((rp() * W) | 0); if (!node[k]) node[k] = 'goldrock'; } }
  for (let k = 0; k < W * H; k++) { const n = node[k], r = ra(); if (n === 'tree') amt[k] = 6 + Math.floor(r * 10) + treeBonus(); else if (n === 'bush') amt[k] = 3 + Math.floor(r * 6); else if (n === 'rock') amt[k] = 8 + Math.floor(r * 13) + rockBonus(); else if (n === 'goldrock') amt[k] = 5; }
  MAP = { node, g, amt }; layerDirty = true;
  // saves from before regrowth tracking have used-up trees/bushes with no depletion record: backfill so Forestry/Orchard can regrow them
  if (S && S.used) for (const k in S.used) { const n = node[k]; if (S.used[k] >= amt[k] && (n === 'tree' || n === 'bush')) { S.dep = S.dep || {}; if (!S.dep[k]) S.dep[k] = { n, t: 0 }; } }
  if (S && S.used) for (const k in S.used) if (S.used[k] >= amt[k]) node[k] = null;
  const rd = rng(seed ^ 0x5bd1e995);
  DEER = [];
  for (let k = 0; k < (S ? deerCount() : 7); k++) {
    let i, j;
    do { i = rd() * W; j = 1 + rd() * (H - 2); } while (near(Math.floor(i), Math.floor(j), TCI, TCJ) < 4);
    DEER.push({ i, j, ti: i, tj: j, wait: rd() * 3 });
  }
  DEER.push({ i: TCI + 6.5, j: TCJ + 2.5, ti: TCI + 6.5, tj: TCJ + 2.5, wait: 1 });
}
function nodeAt(i, j) { if (j < 0 || j >= H || i < 0 || i >= W) return null; return MAP.node[j * W + i]; }
function bAt(i, j) { return S.buildings.find(b => b.i === i && b.j === j); }
function unwrapNear(i) { return i; }   // the village no longer wraps around: it is one block of the shared world

const SLOTS = [[2, 0], [0, 2], [-2, 0], [0, -2], [2, 2], [-2, 2], [2, -2], [-2, -2], [3, 1], [1, 3], [-3, 1], [1, -3], [3, -1], [-1, 3], [-3, -1], [-1, -3], [4, 2], [2, 4], [-4, 2], [2, -4]];
(() => { const more = []; for (let r = 4; r <= 6; r++) for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) if (Math.max(Math.abs(di), Math.abs(dj)) === r && (di + dj) % 2 === 0 && !SLOTS.some(([a, b]) => a === di && b === dj)) more.push([di, dj]); more.sort((a, b) => Math.hypot(...a) - Math.hypot(...b)); SLOTS.push(...more); })();
// build spots: the classic ring first, then every other tile outward from the Town Center.
// The build radius grows with each Age and with Expansion; open ground is used before clearing trees or rocks.
const buildRadius = () => 6 + 2 * ['age6', 'age7', 'age8', 'age9'].filter(a => U(a)).length + (U('expansion') ? 3 : 0);
function findSlot() {
  const free = (i, j) => i >= 1 && i < W - 1 && j >= 1 && j < H - 1 && !bAt(i, j) && !pileAt(i, j) && near(i, j, TCI, TCJ) >= 2;
  for (const [di, dj] of [...SLOTS, ...SLOTS2]) { const i = TCI + di, j = TCJ + dj; if (free(i, j) && !MAP.node[j * W + i]) return [i, j]; }
  const R = buildRadius(), cands = [];
  for (let j = TCJ - R; j <= TCJ + R; j++) for (let i = TCI - R; i <= TCI + R; i++) {
    if ((i + j) % 2 !== (TCI + TCJ) % 2 || !free(i, j)) continue;
    cands.push([i, j, Math.hypot(i - TCI, j - TCJ) + (MAP.node[j * W + i] ? 4 : 0)]);
  }
  cands.sort((a, b) => a[2] - b[2]);
  return cands.length ? [cands[0][0], cands[0][1]] : null;
}
function pickTarget(kind) {
  const T = TASKS[kind];
  if (T.node === 'tc') return [TCI, TCJ];
  if (BNODE.includes(T.node)) { const b = openSpot(T.node); return b ? [b.i, b.j] : null; }
  if (T.node === 'deer') {
    let best = null, bd = 1e9;
    for (const d of DEER) { const ui = unwrapNear(d.i, TCI); const dd = Math.hypot(ui - TCI, d.j - TCJ); if (dd < bd) { bd = dd; best = [ui, d.j]; } }
    return best;
  }
  let best = null, bd = 1e9;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (MAP.node[j * W + i] !== T.node || bAt(i, j) || pileAt(i, j)) continue;
    const ui = unwrapNear(i, TCI), dd = Math.hypot(ui - TCI, j - TCJ);
    if (dd < bd) { bd = dd; best = [ui, j]; }
  }
  return best;
}

// ---------------------------------------------------------------- simulation
let floaters = [];
function addWorker() {
  const n = S.workers.length + 1;
  const w = { id: S.nextId++, name: `AI Worker ${n}`, task: null, repeat: true, hue: (n * 67) % 360, trained: !!U('training'), trips: 0 };
  S.workers.push(w);
  autoAssign(w);
}
// new workers head straight to the closest open resource
function autoAssign(w) {
  let best = null, bd = 1e9;
  for (const kind of Object.keys(TASKS)) {
    if (!taskOpen(kind) || TASKS[kind].cost || fallbackBlocked(kind) || !Object.keys(TASKS[kind].gain).length) continue;   // quarry cutting only once rocks are gone
    const t = pickTarget(kind), d = Math.hypot(t[0] - TCI, t[1] - TCJ);
    if (d < bd) { bd = d; best = { kind, target: t }; }
  }
  if (best) { w.task = mkTask(w, best.kind, best.target); w.repeat = true; }
}
function taskYield(kind) {
  const T = TASKS[kind], m = T.boost && hasB(T.boost) ? 2 : 1, out = {};
  for (const k in T.gain) out[k] = T.gain[k] * m;
  return yieldMods(kind, out);
}
function finishTask(w, quiet) {
  const t = w.task;
  if (t.kind === 'build') {
    const b = S.buildings.find(x => x.id === t.bid);
    if (b && t.up) { b.lvl = (b.lvl || 1) + 1; if (!quiet) { toast(`${BLD[b.type].n} upgraded to level ${b.lvl}`); sfx('build'); } }
    else if (b) { b.done = true; if (!quiet) { toast(`${BLD[b.type].n} complete`); sfx('build'); } }
    w.task = null; return;
  }
  if (t.kind === 'raid') { w.task = null; resolveRaid(w, t); return; }
  const y = rollBonuses(t.kind, taskYield(t.kind));
  w.trips = (w.trips || 0) + 1;
  if (t.kind === 'mine') { w.mineN = (w.mineN || 0) + 1; if (w.mineN % silverEvery() === 0) y.silver = 1; }
  for (const k in y) S.res[k] = (S.res[k] || 0) + y[k];
  if (!quiet && view === 'village') sfx('gather', 0, 250);
  if (!quiet && t.target && Object.keys(y).length) floaters.push({ i: t.target[0], j: t.target[1], text: Object.entries(y).map(([k, v]) => `+${v} ${k}`).join(' '), age: 0 });
  if (t.ext) { w.task = null; if (typeof liveTripDone === 'function') liveTripDone(w, t, quiet); else autoAssign(w); return; }
  // deplete the resource node that was worked
  const NT = TASKS[t.kind].node;
  let tgt = t.target;
  if (NODES.includes(NT) && tgt) {
    const k = tgt[1] * W + mod(tgt[0], W);
    if (MAP.node[k] === NT) { const st0 = stageOf(tgt[0], tgt[1]); S.used = S.used || {}; S.used[k] = (S.used[k] || 0) + 1; if (stageOf(tgt[0], tgt[1]) !== st0) layerDirty = true; if (S.used[k] >= MAP.amt[k]) { MAP.node[k] = null; layerDirty = true; (S.dep = S.dep || {})[k] = { n: NT, t: simNow() }; if (!quiet) toast(`${NODE_NAME[NT]} used up`); } }
    if (MAP.node[k] !== NT) tgt = null;
  }
  // on a fallback (deadwood / quarry cutting) and the real source is back: go back to it
  if (w.repeat && fallbackBlocked(t.kind)) { w.task = null; const G = GROUPS.find(g => g.tasks.includes(t.kind)); if (G) assignGroup(G.k, w, true); if (!w.task) autoAssign(w); return; }
  const carry = t.prog - t.dur;
  const TC = taskCost(t.kind);
  if (w.repeat && (BNODE.includes(NT) || taskOpen(t.kind)) && (!TC || canPay(TC))) {
    if (TC) pay(TC);
    w.task = mkTask(w, t.kind, (NT === 'deer' || !tgt) ? pickTarget(t.kind) : tgt, Math.max(0, carry));
  } else {
    w.task = null;
    // source ran out: stay on the same resource if another source exists (rocks gone → cut stone at the Quarry), else find other work
    if (w.repeat && !taskOpen(t.kind)) { const G = GROUPS.find(g => g.tasks.includes(t.kind)); if (G) assignGroup(G.k, w, true); if (!w.task) autoAssign(w); }
  }
}
function fallbackBlocked(k) { return (k === 'dig' && (taskOpen('stone') || taskOpen('stone2'))) || (k === 'deadwood' && taskOpen('chop')); }
function taskOpen(kind) { const T = TASKS[kind]; return (!T.req || reqMet(T.req)) && !!pickTarget(kind); }
function tick(dt, quiet) {
  if (S.workers.length) {
    S.eatAcc += dt * S.workers.length;
    while (S.eatAcc >= eatEvery()) { S.eatAcc -= eatEvery(); if (S.res.food > 0) S.res.food--; }
  }
  passive(dt, quiet);
  const sp = starving() ? starveMul() : 1;
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
  while (r > 0) { const d = Math.min(1, r); SIM_BACK = (r - d) * 1000; tick(d, true); r -= d; }
  SIM_BACK = 0;
  if (report && sec > 30) {
    const lines = RES.map(x => [x.n, S.res[x.k] - before[x.k]]).filter(x => x[1] !== 0).map(([n, v]) => `<li>${v > 0 ? '+' : ''}${v} ${n}</li>`);
    if (lines.length) modal(`<h2>While you were away</h2><div class="small">${fmt(sec)} passed</div><ul>${lines.join('')}</ul><div class="btns"><button class="btn" data-close>OK</button></div>`);
  }
}

// ---------------------------------------------------------------- actions
function assign(kind) {
  const T = TASKS[kind], w = idle()[0];
  if (!w) return toast('No idle AI workers — win puzzles to recruit more');
  if (T.req && !reqMet(T.req)) return toast(`Requires ${reqName(T.req)}`);
  const target = pickTarget(kind);
  if (!target) return toast('Nothing to gather');
  const TC = taskCost(kind);
  if (TC && !canPay(TC)) return toast('Not enough: needs ' + Object.entries(TC).map(([k, v]) => v + ' ' + k).join(', '));
  if (TC) pay(TC);
  w.task = mkTask(w, kind, target); w.repeat = true;
  save(); refresh();
}
// building placement: the player picks the tile. Build tab -> village with valid tiles lit -> tap a tile -> "Build here".
let PLACE = null;
function buildCheck(type) {
  const D = BLD[type], c = costOf(type);
  if (isResB(type) ? countB(type) >= maxCopies() : (!D.repeat && countB(type))) return isResB(type) ? `Max ${maxCopies()} — research the next Age or prestige for another` : 'Already built';
  if (D.req && !D.req.every(reqMet)) return 'Locked';
  if (!canPay(c)) return 'Not enough resources';
  if (!(idle()[0] || free()[0])) return 'All AI workers are already building';
  return '';
}
function placeOk(i, j) {
  return i >= 1 && i < W - 1 && j >= 1 && j < H - 1 && !bAt(i, j) && !pileAt(i, j) && near(i, j, TCI, TCJ) >= 2 && near(i, j, TCI, TCJ) <= buildRadius();
}
function startBuild(type) {
  const why = buildCheck(type); if (why) return toast(why);
  if (!findSlot()) return toast(`No room within ${buildRadius()} tiles of the Town Center — research the next Age or Expansion to build farther out`);
  PLACE = { type, at: null };
  setView('village'); renderPlaceBar();
}
function cancelPlace() { PLACE = null; renderPlaceBar(); }
function renderPlaceBar() {
  let el = document.getElementById('placebar');
  if (!PLACE) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'placebar'; document.body.appendChild(el);
    el.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.pl === 'go') placeBuild(); else cancelPlace(); }); }
  const D = BLD[PLACE.type];
  el.innerHTML = `<div class="pt">${PLACE.at ? 'Build the ' + esc(D.n) + ' here?' : 'Tap a lit tile to place the ' + esc(D.n)}</div>
    <div class="pb"><button class="btn sm" data-pl="x">Cancel</button><button class="btn sm" data-pl="go" ${PLACE.at ? '' : 'disabled'}>Build here</button></div>`;
}
function placeTap(i, j) {
  if (!placeOk(i, j)) return toast(near(i, j, TCI, TCJ) > buildRadius() ? `Too far — you can build within ${buildRadius()} tiles of the Town Center` : 'Can\'t build there');
  PLACE.at = [i, j]; renderPlaceBar();
}
function placeBuild() {
  if (!PLACE || !PLACE.at) return;
  const type = PLACE.type, [i, j] = PLACE.at;
  const why = buildCheck(type); if (why) { cancelPlace(); return toast(why); }
  if (!placeOk(i, j)) { PLACE.at = null; renderPlaceBar(); return toast('Can\'t build there'); }
  const D = BLD[type], c = costOf(type), w = idle()[0] || free()[0];
  pay(c); PLACE = null; renderPlaceBar();
  const b = { id: S.nextId++, type, i, j, done: false };
  S.buildings.push(b); MAP.node[b.j * W + b.i] = null; layerDirty = true;
  w.task = { kind: 'build', bid: b.id, dur: D.time, prog: 0, target: [unwrapNear(b.i, TCI), b.j] };
  w.repeat = false;
  toast(`${w.name} is building a ${D.n}`);
  save(); refresh();
}
function rawTile(cx, cy) {
  const r = mapC.getBoundingClientRect();
  const wx = (cx - r.left) / ZM - cw / ZM / 2 + camX, wy = (cy - r.top) / ZM - ch / ZM / 2 + camY;
  return [Math.round((wx / (TW / 2) + wy / (TH / 2)) / 2), Math.round((wy / (TH / 2) - wx / (TW / 2)) / 2)];
}
function drawPlaceGrid(vw, vh, t) {
  const R = buildRadius(), a = .22 + .1 * Math.sin(t * 4);
  for (let j = TCJ - R; j <= TCJ + R; j++) for (let i = TCI - R; i <= TCI + R; i++) {
    if (!placeOk(i, j)) continue;
    const [x, y] = iso(i, j); if (x < -TW || y < -TH || x > vw + TW || y > vh + TH) continue;
    diamond(x, y, `rgba(255,255,255,${a})`);
    mx.strokeStyle = 'rgba(255,240,150,.8)'; mx.lineWidth = 1.2; mx.stroke();
  }
  for (const h of [PLACE.hover, PLACE.at]) if (h && placeOk(h[0], h[1])) { const [x, y] = iso(h[0], h[1]); diamond(x, y, h === PLACE.at ? 'rgba(255,215,0,.55)' : 'rgba(255,255,255,.35)'); }
}
function placeGhost(objs, t) {
  if (!PLACE || !PLACE.at) return;
  const [i, j] = PLACE.at, [x, y] = iso(i, j), b = { type: PLACE.type, i, j, done: true, lvl: 1 };
  objs.push({ d: i + j, f: () => { mx.globalAlpha = .7; drawBuilding(b, x, y, t); mx.globalAlpha = 1; } });
}
function useSpeed(id) {
  const w = S.workers.find(x => x.id === id); if (!w || !w.task || S.bank <= 0) return;
  const sp = starving() ? starveMul() : 1;
  const need = (w.task.dur - w.task.prog) / sp;
  const use = Math.min(S.bank, need);
  S.bank -= use; w.task.prog += use * sp;
  if (w.task.prog >= w.task.dur - 1e-6) { w.task.prog = w.task.dur; finishTask(w, false); }
  save(); refresh();
}
// speedup: spend banked seconds on specific tasks (soonest-to-finish first)
function remaining(w) { const sp = starving() ? starveMul() : 1; return w.task ? (w.task.dur - w.task.prog) / sp : 0; }
function speedTasks(ids, amt) {
  const ws = ids.map(id => S.workers.find(w => w.id === id)).filter(w => w && w.task).sort((a, b) => remaining(a) - remaining(b));
  if (!ws.length || S.bank <= 0) return;
  const sp = starving() ? starveMul() : 1; let used = 0;
  for (const w of ws) {
    if (S.bank <= 0) break;
    const use = Math.min(S.bank, remaining(w), amt === 'all' ? Infinity : +amt);
    S.bank -= use; used += use; w.task.prog += use * sp;
    if (w.task.prog >= w.task.dur - 1e-6) { w.task.prog = w.task.dur; finishTask(w, false); }
  }
  if (used > 0) { sfx('coin'); toast(`⏱ Used ${fmt(used)} of speedup`); }
  save(); refresh(true);
}
function speedRow(ws) {
  ws = ws.filter(w => w.task); if (!ws.length) return '';
  const ids = ws.map(w => w.id).join(','), all = ws.reduce((a, w) => a + remaining(w), 0), dis = S.bank > 0 ? '' : 'disabled';
  return `<div class="spd"><button class="btn sm go" data-sp="${ids}" data-amt="60" ${dis}>⏱ 1m</button><button class="btn sm go" data-sp="${ids}" data-amt="300" ${dis}>⏱ 5m</button>
    <button class="btn sm" data-sp="${ids}" data-amt="all" ${dis}>Finish ${ws.length > 1 ? 'all' : 'now'} (${fmt(all)})${S.bank < all ? ' — bank short' : ''}</button>
    <span class="small">bank ${fmt(S.bank)}</span></div>${S.bank > 0 ? '' : whyHTML('Speedup bank is empty — win puzzles with moves left over to fill it')}`;
}
function progRow(w) {
  return `<div class="bar"><b data-pw="${w.id}" style="width:${(100 * w.task.prog / w.task.dur).toFixed(1)}%"></b></div><div class="small"><span data-tl="${w.id}">${fmt(remaining(w))}</span> left</div>`;
}
function liveProgress() {
  document.querySelectorAll('[data-pw]').forEach(el => { const w = S.workers.find(x => x.id === +el.dataset.pw); if (w && w.task) el.style.width = (100 * w.task.prog / w.task.dur).toFixed(1) + '%'; });
  document.querySelectorAll('[data-tl]').forEach(el => { const w = S.workers.find(x => x.id === +el.dataset.tl); if (w && w.task) el.textContent = fmt(remaining(w)); });
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-sp]'); if (!b || b.disabled) return;
  speedTasks(b.dataset.sp.split(',').map(Number), b.dataset.amt);
  if (!$('#sheet').hidden && b.closest('#sheet')) closeSheet();
});
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
  if (v !== 'village' && PLACE) cancelPlace();
  document.querySelectorAll('.view').forEach(e => e.classList.toggle('active', e.id === 'v-' + v));
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  closeSheet();
  if (v === 'puzzle' && !P) startLevel();
  if (v === 'puzzle') sizeBoard();
  if (v === 'village') sizeMap();
  if (v === 'orb') { loadOrb(); if (ME) loadOrbExtras(); }
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

const RES_COL = { food: '#e11d48', wood: '#a0622d', stone: '#9aa5b1', iron: '#6b7a8a', coal: '#374151', steel: '#a5b4c4', planks: '#d4a056', gears: '#64748b', copper: '#c86f33', silver: '#d8dde2', gold: '#e8b923' };
function renderRates() {
  const R = rates(), keys = Object.keys(RES_COL).filter(k => R[k] && (R[k].p > .01 || R[k].c > .01));
  const el = $('#rates');
  if (!keys.length) { el.innerHTML = '<span class="small">No production yet — win puzzles to recruit AI workers</span>'; return; }
  el.innerHTML = keys.map(k => {
    const p = R[k].p, c = R[k].c, net = p - c, m = Math.max(p, c), up = Math.round(14 * p / m), dn = Math.round(14 * c / m);
    return `<span class="rt" title="${k}: +${p.toFixed(1)} made, −${c.toFixed(1)} used per minute"><span class="rb"><i class="up" style="height:${up}px;background:${RES_COL[k]}"></i><i class="dn" style="height:${dn}px"></i></span>
      <span class="rl">${k[0].toUpperCase() + k.slice(1)}</span><b class="${net < -.01 ? 'neg' : 'pos'}">${net >= 0 ? '+' : ''}${(+net.toFixed(1))}</b></span>`;
  }).join('') + '<span class="small rmin">per min</span>';
}
function hud() {
  const R = S.res;
  const it = (c, label, v, warn) => `<span class="r${warn ? ' warn' : ''}"><i style="background:${c}"></i>${label} <b>${v}</b></span>`;
  $('#res').innerHTML =
    it('#c0392b', 'Food', R.food, starving() || (R.food <= 2 && S.workers.length)) + it('#8b5a2b', 'Wood', R.wood) + it('#9aa3ab', 'Stone', R.stone) + it('#6b7a8a', 'Iron', R.iron || 0) + it('#2b2b2b', 'Coal', R.coal || 0) + it('#a5b4c4', 'Steel', R.steel || 0) + (U('age6') ? it('#d4a056', 'Planks', R.planks || 0) + it('#64748b', 'Gears', R.gears || 0) : '') +
    it('#c86f33', 'Copper', R.copper) + it('#d8dde2', 'Silver', R.silver) + it('#e8b923', 'Gold', R.gold) +
    `<span class="r">Speedup <b>${fmt(S.bank)}</b></span><span class="r">Workers <b>${S.workers.length}/${housing()}</b>${S.waiting ? ` <b>(+${S.waiting} waiting)</b>` : ''}</span>`;
  renderRates();
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
  if (view === 'tech') renderTech(force);
  if (view === 'puzzle') renderPuzzleHead();
  liveProgress();
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
  const building = S.workers.filter(w => w.task && w.task.kind === 'build');
  const s = 'b' + JSON.stringify([S.res, S.buildings.map(b => b.type + b.done + (b.lvl || 1)), free().length, building.map(w => w.id), Math.floor(S.bank)]);
  if (s === sig && !force) return; sig = s;
  let html = '';
  if (building.length) {
    html += `<h2>Under construction <span class="small">speedup bank ${fmt(S.bank)}</span></h2>`;
    for (const w of building) { const b = S.buildings.find(x => x.id === w.task.bid);
      html += `<div class="card"><div class="row">${b ? artThumb(b.type) : ''}<div style="flex:1"><div class="t">${b ? BLD[b.type].n : 'Building'}</div><div class="d">${esc(w.name)}</div>${progRow(w)}</div></div>${speedRow([w])}</div>`; }
    if (building.length > 1) html += `<div class="card"><div class="t">All construction</div>${speedRow(building)}</div>`;
  }
  html += '<h2>Tech Tree</h2>';
  for (let tier = 1; tier <= Math.max(5, Math.min(9, tierNow() + 1)); tier++) {
    html += `<h3>Tier ${tier}</h3>`;
    for (const [k, D] of Object.entries(BLD)) {
      if (D.tier !== tier) continue;
      const c = costOf(k), built = countB(k), locked = D.req && !D.req.every(reqMet);
      const multi = isResB(k), doneOnce = multi ? built >= maxCopies() : (!D.repeat && built);
      const why = doneOnce ? '' : [locked && 'Needs: ' + D.req.filter(r => !reqMet(r)).map(reqHint).join(' + '), !canPay(c) && 'Need ' + shortBy(c).join(', '), !free().length && (S.workers.length ? 'Every AI worker is already building — wait or speed one up' : 'No AI workers yet — win puzzles to recruit one')].filter(Boolean).join(' · ');
      let btn;
      if (doneOnce) btn = k === 'market' && hasB(k) ? `<button class="btn sm go" data-market>Open</button>` : `<button class="btn sm alt" disabled>${multi ? 'Max' : hasB(k) ? 'Built' : 'Building'}</button>`;
      else btn = `<button class="btn sm" data-build="${k}" ${locked || !canPay(c) || !free().length ? 'disabled' : ''}>Build</button>`;
      html += `<div class="card${locked ? ' locked' : ''}"><div class="row">${artThumb(k)}<div><div class="t">${D.n}${multi ? ` <span class="small">${built}/${maxCopies()}${BNODE.includes(k) ? ` · ${SPOT_CAP} AI workers each` : ''}</span>` : D.repeat && built ? ` <span class="small">×${built}</span>` : ''}</div><div class="d">${D.desc}</div>
        <div class="cost">${doneOnce ? (multi ? 'Next one: research the next Age or prestige' : '') : costHTML(c) + ` · ${fmt(D.time)}`}</div>${whyHTML(why)}</div>${btn}</div>${storageRows(k)}</div>`;
    }
    for (const f of FUTURE.filter(f => f.tier === tier)) {
      html += `<div class="card locked"><div class="row"><div><div class="t">${f.n}</div><div class="d">${f.desc}</div><div class="cost">Requires ${f.req}</div></div><span class="small">Coming soon</span></div></div>`;
    }
  }
  if (!free().length) html += `<div class="foot">Building needs an AI worker that isn't already building.</div>`;
  $('#v-build').innerHTML = html;
}
$('#v-build').addEventListener('click', e => { if (e.target.closest('[data-market]')) return openMarket(); const b = e.target.closest('[data-build]'); if (b && !b.disabled) startBuild(b.dataset.build); });

function taskLabel(t) { if (t.kind === 'raid') return t.label || ('Harvesting ' + t.name + "'s village"); if (t.kind === 'build') { const b = S.buildings.find(x => x.id === t.bid); return 'Building ' + (b ? BLD[b.type].n : ''); } return TASKS[t.kind].n; }
// worker groups by what they produce
const GROUPS = [
  { k: 'food', n: 'Food', tasks: ['berries', 'hunt', 'farm', 'fish'], icon: 0 },
  { k: 'wood', n: 'Wood', tasks: ['chop', 'deadwood'], icon: 1 },
  { k: 'stone', n: 'Stone', tasks: ['stone', 'stone2', 'dig'], icon: 2 },
  { k: 'planks', n: 'Planks', tasks: ['saw'], icon: 'planks' },
  { k: 'gears', n: 'Gears', tasks: ['gear'], icon: 'gears' },
  { k: 'ore', n: 'Ore', tasks: ['mine'], icon: 'iron' },
  { k: 'coal', n: 'Coal', tasks: ['coal'], icon: 'coal' },
  { k: 'steel', n: 'Steel', tasks: ['smelt', 'blast'], icon: 'steel' },
  { k: 'gold', n: 'Gold', tasks: ['strike', 'pan'], icon: 3 },
  { k: 'guard', n: 'On guard', tasks: ['guard'], icon: 'guard' },
];
function groupOf(w) { if (!w.task) return 'idle'; if (w.task.kind === 'build') return 'build'; if (w.task.kind === 'raid' || w.task.kind === 'hv') return 'raid'; const g = GROUPS.find(g => g.tasks.includes(w.task.kind)); return g ? g.k : 'idle'; }
function drawResIcon(ctx, k, x, y, r) {
  if (typeof k === 'number') return drawIcon(ctx, k, x, y, r);
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0, r * .75, r * .6, r * .14, 0, 0, 7); ctx.fill();
  if (k === 'iron' || k === 'steel') {
    const c = k === 'iron' ? ['#a8b0b8', '#6b7480', '#374151'] : ['#f1f5f9', '#b6c2d1', '#64748b'];
    ctx.fillStyle = lg(ctx, 0, -r * .4, 0, r * .5, [[0, c[0]], [.5, c[1]], [1, c[2]]]);
    ctx.beginPath(); ctx.moveTo(-r * .55, -r * .3); ctx.lineTo(r * .55, -r * .3); ctx.lineTo(r * .8, r * .45); ctx.lineTo(-r * .8, r * .45); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(-r * .45, -r * .25, r * .9, r * .1);
    if (k === 'steel') { ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(r * .4, -r * .1, r * .08, 0, 7); ctx.fill(); }
  } else if (k === 'coal') {
    ctx.fillStyle = rg(ctx, 0, 0, r * .8, '#6b7280', '#1f2937', '#030712');
    ctx.beginPath(); ctx.moveTo(-r * .7, r * .3); ctx.lineTo(-r * .45, -r * .45); ctx.lineTo(r * .25, -r * .6); ctx.lineTo(r * .75, -r * .05); ctx.lineTo(r * .45, r * .55); ctx.lineTo(-r * .35, r * .6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(249,115,22,.7)'; ctx.beginPath(); ctx.arc(r * .1, r * .1, r * .12, 0, 7); ctx.fill();
  } else if (k === 'planks') {
    for (let i = 0; i < 3; i++) { ctx.fillStyle = lg(ctx, 0, -r * .2, 0, r * .2, [[0, '#e7c08a'], [1, '#a16207']]); ctx.fillRect(-r * .75, -r * .45 + i * r * .32, r * 1.5, r * .26); }
  } else if (k === 'gears') {
    ctx.fillStyle = rg(ctx, 0, 0, r * .8, '#e5e7eb', '#94a3b8', '#334155'); ctx.beginPath();
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, rr = i % 2 ? r * .55 : r * .75; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#334155'; ctx.beginPath(); ctx.arc(0, 0, r * .2, 0, 7); ctx.fill();
  } else if (k === 'build') {
    ctx.rotate(-.6); ctx.fillStyle = lg(ctx, -r * .1, 0, r * .1, 0, [[0, '#d6a46a'], [1, '#7a4a22']]); ctx.fillRect(-r * .09, -r * .4, r * .18, r * 1.2);
    ctx.fillStyle = lg(ctx, 0, -r * .75, 0, -r * .35, [[0, '#e5e7eb'], [1, '#475569']]); ctx.beginPath(); ctx.roundRect(-r * .5, -r * .75, r * 1, r * .4, r * .08); ctx.fill();
  } else if (k === 'raid') {
    ctx.fillStyle = rg(ctx, 0, 0, r * .8, '#fecaca', '#ef4444', '#7f1d1d'); ctx.beginPath(); ctx.moveTo(0, -r * .75); ctx.lineTo(r * .65, -r * .45); ctx.lineTo(r * .55, r * .25); ctx.lineTo(0, r * .75); ctx.lineTo(-r * .55, r * .25); ctx.lineTo(-r * .65, -r * .45); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `bold ${r * .8}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('⚔', 0, r * .02);
  } else if (k === 'guard') {
    ctx.fillStyle = rg(ctx, 0, 0, r * .8, '#dbeafe', '#3b82f6', '#1e3a8a'); ctx.beginPath(); ctx.moveTo(0, -r * .75); ctx.lineTo(r * .65, -r * .45); ctx.lineTo(r * .55, r * .25); ctx.lineTo(0, r * .75); ctx.lineTo(-r * .55, r * .25); ctx.lineTo(-r * .65, -r * .45); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `bold ${r * .7}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🛡', 0, r * .02);
  } else if (k === 'idle') {
    ctx.fillStyle = rg(ctx, 0, 0, r * .8, '#e0f2fe', '#7dd3fc', '#0369a1'); ctx.beginPath(); ctx.arc(0, 0, r * .62, 0, 7); ctx.fill();
    ctx.fillStyle = '#0f1b3d'; ctx.font = `bold ${r * .55}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('Zz', 0, r * .03);
  }
  ctx.restore();
}
// per-minute production and consumption for the rate bar
function rates() {
  const sp = starving() ? starveMul() : 1, R = {};
  const add = (k, v) => { R[k] = R[k] || { p: 0, c: 0 }; if (v >= 0) R[k].p += v; else R[k].c -= v; };
  for (const w of S.workers) {
    if (!w.task || !TASKS[w.task.kind]) continue;
    const per = 60 / (w.task.dur / sp), TC = taskCost(w.task.kind);
    for (const [k, v] of Object.entries(taskYield(w.task.kind))) add(k, v * per);
    if (w.task.kind === 'mine') add('silver', per / silverEvery());
    if (TC) for (const [k, v] of Object.entries(TC)) add(k, -v * per);
  }
  if (S.workers.length) add('food', -S.workers.length * 60 / eatEvery());
  return R;
}
function assignGroup(gk, w, quiet) {
  const G = GROUPS.find(g => g.k === gk); if (!G) return;
  w = w || idle()[0]; if (!w) return toast('No idle AI workers — tap − on another group first');
  let best = null, bd = 1e9;
  for (const k of G.tasks) {
    const TC = taskCost(k); if (!taskOpen(k) || (TC && !canPay(TC)) || fallbackBlocked(k)) continue;
    const t = pickTarget(k), d = Math.hypot(t[0] - TCI, t[1] - TCJ);
    if (d < bd) { bd = d; best = { k, t }; }
  }
  if (!best) return quiet ? null : toast(`Nothing to gather for ${G.n} yet`);
  const TC = taskCost(best.k); if (TC) pay(TC);
  w.task = mkTask(w, best.k, best.t); w.repeat = true;
  if (!quiet) { save(); refresh(true); }
}
function unassignGroup(gk) {
  const ws = S.workers.filter(w => groupOf(w) === gk); if (!ws.length) return;
  ws.sort((a, b) => (a.task.prog / a.task.dur) - (b.task.prog / b.task.dur));
  ws[0].task = null; save(); refresh(true);
}
function speedSoonest() {
  const ws = S.workers.filter(w => w.task && w.task.kind !== 'raid'); if (!ws.length || S.bank <= 0) return;
  ws.sort((a, b) => (a.task.dur - a.task.prog) - (b.task.dur - b.task.prog)); useSpeed(ws[0].id);
}
function renderWorkers(force) {
  const s = 'w' + JSON.stringify([S.workers.map(w => [w.id, groupOf(w)]), Math.floor(S.bank), starving(), S.waiting, housing(), S.recruit, S.buildings.filter(b => b.done).length]);
  if (s !== sig || force) {
    sig = s;
    const R = rates(), cnt = k => S.workers.filter(w => groupOf(w) === k).length;
    let html = `<h2>AI Workers <span class="small">${S.workers.length}/${housing()} housed · next recruit ${S.recruit}/${WINS_PER_WORKER} wins</span></h2>`;
    if (starving()) html += `<div class="card"><div class="t" style="color:var(--red)">No food — everyone works at half speed</div></div>`;
    if (S.waiting) html += `<div class="card"><div class="d">${S.waiting} recruited worker${S.waiting > 1 ? 's' : ''} waiting for housing — build a Hut.</div></div>`;
    html += '<div class="wgrid">';
    for (const G of GROUPS) {
      const open = G.tasks.some(k => taskOpen(k)), n = cnt(G.k), r = R[G.k === 'ore' ? 'iron' : G.k];
      const need = !open ? (G.tasks.map(k => TASKS[k].req).filter(Boolean).map(reqHint)[0] || '') : '';
      html += `<div class="wt${open ? '' : ' locked'}"><canvas data-gi="${G.k}" width="${44 * DPR}" height="${44 * DPR}"></canvas>
        <div class="wn">${G.n}</div><div class="wc">${n}</div>
        <div class="wr">${open ? (r ? `+${(+r.p.toFixed(1))}/min` : '—') : 'Needs: ' + need}</div>${open && !idle().length && !n ? '<div class="why sm">no idle worker</div>' : ''}
        <div class="wb"><button class="btn sm alt" data-minus="${G.k}" ${n ? '' : 'disabled'} title="${n ? 'Take one worker off' : 'No workers on this'}">−</button><button class="btn sm" data-plus="${G.k}" ${open && idle().length ? '' : 'disabled'} title="${!open ? 'Locked — ' + esc(need) : idle().length ? 'Add an idle worker' : 'No idle worker — tap − on another group first'}">+</button>
        ${n ? `<button class="btn sm go" title="Finish this group's current trips with speedup" data-sp="${S.workers.filter(w => groupOf(w) === G.k).map(w => w.id).join(',')}" data-amt="all" ${S.bank > 0 ? '' : 'disabled'}>⏱</button>` : ''}</div></div>`;
    }
    for (const [k, n] of [['build', 'Building'], ['raid', 'On the road'], ['idle', 'Idle']]) {
      const c = cnt(k);
      html += `<div class="wt status${k === 'idle' && c ? ' alert' : ''}"><canvas data-gi="${k}" width="${44 * DPR}" height="${44 * DPR}"></canvas><div class="wn">${n}</div><div class="wc">${c}</div>
        <div class="wr">${k === 'idle' ? (c ? 'Tap + on a group' : 'Everyone busy') : k === 'build' ? 'Build tab' : 'World tab'}</div>
        ${k !== 'idle' && c ? `<div class="wb"><button class="btn sm go" title="Finish with speedup" data-sp="${S.workers.filter(w => groupOf(w) === k).map(w => w.id).join(',')}" data-amt="all" ${S.bank > 0 ? '' : 'disabled'}>⏱ Finish</button></div>` : ''}</div>`;
    }
    html += '</div>';
    html += `<div class="card"><div class="t">Speedup bank: ${fmt(S.bank)}</div><div class="d">Earned from leftover puzzle moves. ⏱ on a group finishes that group's current trips; builds can also be sped up on the Build tab or by tapping them in the village. Crews on the world map walk at their own pace.</div>
      ${speedRow(S.workers.filter(w => w.task))}</div>`;
    if (!S.workers.length) html += `<div class="card"><div class="d">No AI workers yet. Win ${WINS_PER_WORKER} puzzles to recruit one.</div></div>`;
    html += `<div class="foot">${ME ? `Signed in as <b>${esc(ME.name)}</b> — progress saves to your account.` : 'Guest save on this device only. Sign in on the World tab to keep it.'}<br>
      <a href="https://gsdconsultantsllc.com" target="_blank" rel="noopener">GSD Consultants, LLC</a> · v0.3<br><br>
      <button class="btn sm alt" data-reset>Reset progress</button></div>`;
    $('#v-workers').innerHTML = html;
    document.querySelectorAll('#v-workers canvas[data-gi]').forEach(c => {
      const x = c.getContext('2d'); x.setTransform(DPR, 0, 0, DPR, 0, 0);
      const G = GROUPS.find(g => g.k === c.dataset.gi); drawResIcon(x, G ? G.icon : c.dataset.gi, 22, 22, 18);
    });
  }
}
$('#v-workers').addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.plus) assignGroup(t.dataset.plus);
  else if (t.dataset.minus) unassignGroup(t.dataset.minus);
  else if (t.dataset.reset !== undefined) modal(`<h2>Reset progress?</h2><p>This wipes this device's save.</p><div class="btns"><button class="btn alt" data-close>Cancel</button><button class="btn" data-act="reset">Reset</button></div>`);
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
  if (T.req && !reqMet(T.req)) return false;           // locked: show the sheet instead
  const target = deer ? [unwrapNear(deer.i, TCI), deer.j] : [unwrapNear(i, TCI), j];
  if (b && BNODE.includes(kind) && workersAt(b).length >= SPOT_CAP) { toast(`${BLD[b.type].n} is full (${SPOT_CAP} AI workers)`); return true; }
  let best = null, bd = 1e9;
  S.workers.forEach((w, k) => {
    if (w.task && (w.task.kind === 'build' || w.task.kind === 'raid')) return;
    const p = workerPos(w, k).p, d = Math.hypot(unwrapNear(p[0], target[0]) - target[0], p[1] - target[1]);
    if (d < bd) { bd = d; best = w; }
  });
  if (!best) { toast(S.workers.length ? 'All AI workers are building' : 'No AI workers yet — win puzzles to recruit'); return true; }
  const TC = taskCost(tk);
  if (TC && !canPay(TC)) { toast('Not enough: needs ' + Object.entries(TC).map(([k, v]) => v + ' ' + k).join(', ')); return true; }
  if (TC) pay(TC);
  best.task = mkTask(best, tk, target); best.repeat = true;
  toast(`${best.name} → ${T.n}`);
  closeSheet(); save(); refresh(true);
  return true;
}
function tileSheet(i, j) {
  const b = bAt(i, j);
  let kind = b ? (b.done && BNODE.includes(b.type) ? b.type : null) : nodeAt(i, j);
  const deer = DEER.find(d => Math.floor(mod(d.i, W)) === mod(i, W) && Math.floor(d.j) === j);
  if (deer && !b) kind = 'deer';
  if (b && !kind && b.type === 'market' && b.done) return openMarket();
  if (b && !kind) {
    const D = BLD[b.type], bw = S.workers.find(w => w.task && w.task.kind === 'build' && w.task.bid === b.id);
    return openSheet(`<div class="t">${D.n}${b.lvl > 1 ? ' · level ' + b.lvl : ''}</div><div class="d">${b.done ? (b.type === 'tc' ? 'Your base. Houses 2 AI workers and stores 200 of each resource.' : D.desc) : 'Under construction' + (bw ? ' by ' + esc(bw.name) : '')}</div>${bw ? progRow(bw) + speedRow([bw]) : ''}${b.done ? storageSheet(b) : ''}`);
  }
  if (!kind) return closeSheet();
  const tk = NODE_TASK[kind], T = TASKS[tk], y = taskYield(tk), locked = T.req && !reqMet(T.req);
  openSheet(`<div class="t">${NODE_NAME[kind]}</div>
    <div class="d">${T.n}: ${T.cost ? Object.entries(T.cost).map(([k, v]) => `${v} ${k}`).join(', ') + ' → ' : ''}${Object.entries(y).map(([k, v]) => `+${v} ${k}`).join(', ')}${tk === 'mine' ? ', +1 silver every 3rd trip' : ''} every ${fmt(T.time)}</div>
    <div style="margin-top:8px">${locked ? `<span class="small">Requires ${reqName(T.req)}</span> <button class="btn sm" data-go="build">Tech tree</button>`
      : idle().length ? `<button class="btn go" data-task="${tk}">Send AI worker</button>` : `<span class="small">No idle workers.</span> <button class="btn sm" data-go="puzzle">Win puzzles to recruit</button>`}</div>`);
}

// ---------------------------------------------------------------- village rendering
const TW = 64, TH = 32;
const mapC = $('#map');
let mx = mapC.getContext('2d');
// pre-rendered sprites: shaded art is drawn once, then copied each frame
const SPR = new Map();
function sprite(key, w, h, ox, oy, draw) {
  let c = SPR.get(key);
  if (!c) {
    c = document.createElement('canvas'); c.width = Math.ceil(w * DPR); c.height = Math.ceil(h * DPR);
    const g = c.getContext('2d'); g.setTransform(DPR, 0, 0, DPR, 0, 0);
    const old = mx; mx = g; try { draw(ox, oy); } finally { mx = old; }
    SPR.set(key, c);
  }
  return c;
}
function leftOf(i, j) { const k = j * W + mod(i, W); return Math.max(0, MAP.amt[k] - ((S.used && S.used[k]) || 0)); }
function stageOf(i, j) { const k = j * W + mod(i, W), f = leftOf(i, j) / (MAP.amt[k] || 1); return f > .66 ? 2 : f > .33 ? 1 : 0; }
function nodeSprite(n, x, y, g, st) {
  const sc = [.62, .82, 1][st];
  if (n === 'tree') { const gq = Math.round(g * 5); const c = sprite(`t${gq}${st}`, 60, 90, 28, 78, (a, b) => { mx.translate(a, b); mx.scale(sc, sc); drawTree(0, 0, gq / 5); }); mx.drawImage(c, x - 28, y - 78, 60, 90); }
  else if (n === 'bush') { const c = sprite(`b${st}`, 44, 34, 20, 24, (a, b) => { mx.translate(a, b); mx.scale(sc, sc); drawBush(0, 0, st); }); mx.drawImage(c, x - 20, y - 24, 44, 34); }
  else if (n === 'goldrock') { const c = sprite(`gr${st}`, 44, 34, 20, 26, (a, b) => { mx.translate(a, b); mx.scale(sc, sc); drawRock(0, 0); mx.fillStyle = '#facc15'; [[-6, -10], [3, -14], [7, -6], [-2, -5]].forEach(([p, q]) => { mx.beginPath(); mx.arc(p, q, 2.2, 0, 7); mx.fill(); }); }); mx.drawImage(c, x - 20, y - 26, 44, 34); }
  else { const c = sprite(`r${st}`, 44, 34, 20, 26, (a, b) => { mx.translate(a, b); mx.scale(sc, sc); drawRock(0, 0); }); mx.drawImage(c, x - 20, y - 26, 44, 34); }
}
let cw = 0, ch = 0, camX = (TCI - TCJ) * TW / 2, camY = (TCI + TCJ) * TH / 2, ZM = 1;   // ZM: village zoom (pinch / wheel)
function sizeMap() {
  const r = mapC.getBoundingClientRect(); if (!r.width) return;
  cw = r.width; ch = r.height; mapC.width = cw * DPR; mapC.height = ch * DPR;
}
const iso = (i, j) => [(i - j) * TW / 2 - camX + cw / ZM / 2, (i + j) * TH / 2 - camY + ch / ZM / 2];

function grassColor(i, j) {
  const g = Math.round(MAP.g[j * W + mod(i, W)] * 8) / 8;
  const near = Math.hypot(unwrapNear(i, TCI) - TCI, j - TCJ);
  if (near < 2.2) return `hsl(36,${32 + g * 10}%,${50 + g * 6}%)`;
  return `hsl(${92 + g * 18},${46 + g * 10}%,${36 + g * 8}%)`;
}
function diamond(x, y, fill) {
  mx.beginPath(); mx.moveTo(x, y - TH / 2); mx.lineTo(x + TW / 2, y); mx.lineTo(x, y + TH / 2); mx.lineTo(x - TW / 2, y); mx.closePath();
  mx.fillStyle = fill; mx.fill();
}
function groundTile(x, y, fill) {
  const c = sprite('g' + fill, TW + 2, TH + 2, TW / 2 + 1, TH / 2 + 1, (a, b) => groundTileRaw(a, b, fill));
  mx.drawImage(c, x - TW / 2 - 1, y - TH / 2 - 1, TW + 2, TH + 2);
}
function groundTileRaw(x, y, fill) {
  diamond(x, y, fill);
  mx.fillStyle = lg(mx, x, y - TH / 2, x, y + TH / 2, [[0, 'rgba(255,255,255,.10)'], [.5, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,0,.12)']]); mx.fill();
  mx.strokeStyle = 'rgba(0,0,0,.06)'; mx.lineWidth = 1; mx.stroke();
}
function shadow(x, y, rx, ry, a = .28) { mx.fillStyle = `rgba(0,0,0,${a})`; mx.beginPath(); mx.ellipse(x + 4, y + 2, rx, ry, 0, 0, 7); mx.fill(); }
function drawTree(x, y, g) {
  const s = 0.85 + g * 0.3;
  shadow(x, y, 15 * s, 6 * s);
  mx.fillStyle = lg(mx, x - 3, 0, x + 3, 0, [[0, '#7a4f2a'], [1, '#3e2612']]); mx.fillRect(x - 3, y - 14, 6, 14);
  const layer = (top, bot, w, c0, c1) => { mx.fillStyle = lg(mx, x - w, 0, x + w, 0, [[0, c0], [.55, c1], [1, '#0f2e14']]); mx.beginPath(); mx.moveTo(x, top); mx.lineTo(x + w, bot); mx.quadraticCurveTo(x, bot + 4, x - w, bot); mx.closePath(); mx.fill(); };
  layer(y - 46 * s, y - 14, 17 * s, '#3f8f45', '#235c2a');
  layer(y - 56 * s, y - 28 * s, 13 * s, '#4caf50', '#2b6a2c');
  layer(y - 64 * s, y - 42 * s, 9 * s, '#66c06a', '#2f7a33');
}
function drawBush(x, y, st = 2) {
  shadow(x, y, 15, 5);
  mx.fillStyle = rg(mx, x, y - 9, 16, '#5cb85c', '#2f6b2b', '#173d16'); mx.beginPath(); mx.ellipse(x, y - 8, 16, 10.5, 0, 0, 7); mx.fill();
  [[-7, -10], [3, -13], [8, -6], [-2, -5], [-9, -4]].slice(0, [2, 3, 5][st]).forEach(([a, b]) => { mx.fillStyle = rg(mx, x + a, y + b, 3, '#ff8fa3', '#e11d48', '#7f1028'); mx.beginPath(); mx.arc(x + a, y + b, 2.8, 0, 7); mx.fill(); });
}
function drawRock(x, y) {
  shadow(x, y, 16, 5);
  mx.fillStyle = rg(mx, x - 3, y - 12, 18, '#d4d9de', '#8a939b', '#4b5563');
  mx.beginPath(); mx.moveTo(x - 16, y - 2); mx.lineTo(x - 10, y - 16); mx.lineTo(x + 4, y - 20); mx.lineTo(x + 15, y - 8); mx.lineTo(x + 12, y + 2); mx.closePath(); mx.fill();
  mx.fillStyle = 'rgba(255,255,255,.45)'; mx.beginPath(); mx.moveTo(x - 10, y - 16); mx.lineTo(x + 4, y - 20); mx.lineTo(x + 2, y - 9); mx.closePath(); mx.fill();
  mx.fillStyle = 'rgba(0,0,0,.2)'; mx.beginPath(); mx.moveTo(x + 15, y - 8); mx.lineTo(x + 12, y + 2); mx.lineTo(x + 3, y - 4); mx.closePath(); mx.fill();
}
function drawDeer(x, y, t) {
  const bob = Math.sin(t * 6) * 1;
  shadow(x, y, 10, 3, .22);
  mx.fillStyle = '#6b4220'; mx.fillRect(x - 7, y - 7, 2, 7); mx.fillRect(x + 5, y - 7, 2, 7);
  mx.fillStyle = rg(mx, x - 2, y - 13 + bob, 10, '#c98a4b', '#8a5a2b', '#5a3615'); mx.beginPath(); mx.ellipse(x, y - 10 + bob, 9, 5, 0, 0, 7); mx.fill();
  mx.fillStyle = '#9a6a3a'; mx.beginPath(); mx.ellipse(x + 9, y - 16 + bob, 4, 3, -0.5, 0, 7); mx.fill();
  mx.fillStyle = '#f5f0e6'; mx.beginPath(); mx.ellipse(x - 8, y - 11 + bob, 2, 1.5, 0, 0, 7); mx.fill();
  mx.strokeStyle = '#4a3220'; mx.lineWidth = 1.5; mx.beginPath(); mx.moveTo(x + 9, y - 19 + bob); mx.lineTo(x + 7, y - 25 + bob); mx.moveTo(x + 10, y - 19 + bob); mx.lineTo(x + 13, y - 24 + bob); mx.stroke();
}
function face(pts, base, from, to) {
  mx.beginPath(); pts.forEach(([a, b], i) => i ? mx.lineTo(a, b) : mx.moveTo(a, b)); mx.closePath();
  mx.fillStyle = base; mx.fill();
  mx.fillStyle = lg(mx, from[0], from[1], to[0], to[1], [[0, 'rgba(255,255,255,.14)'], [1, 'rgba(0,0,0,.2)']]); mx.fill();
  mx.strokeStyle = 'rgba(0,0,0,.22)'; mx.lineWidth = 1; mx.stroke();
}
function isoBox(x, y, w, h, top, left, right) {
  const hw = w * TW / 2, hh = w * TH / 2;
  shadow(x, y + hh * .3, hw * 1.05, hh * .9, .25);
  face([[x - hw, y], [x, y + hh], [x, y + hh - h], [x - hw, y - h]], left, [x, y - h], [x, y + hh]);
  face([[x + hw, y], [x, y + hh], [x, y + hh - h], [x + hw, y - h]], right, [x, y - h], [x, y + hh]);
  face([[x, y - hh - h], [x + hw, y - h], [x, y + hh - h], [x - hw, y - h]], top, [x, y - hh - h], [x, y + hh - h]);
}
function roof(x, y, w, h, peak, c1, c2) {
  const hw = w * TW / 2, hh = w * TH / 2, top = y - h;
  face([[x - hw, top], [x, top + hh], [x, top - peak]], c1, [x, top - peak], [x - hw, top]);
  face([[x - hw, top], [x, top - hh], [x, top - peak]], c1, [x, top - peak], [x - hw, top]);
  face([[x + hw, top], [x, top + hh], [x, top - peak]], c2, [x, top - peak], [x + hw, top]);
  face([[x + hw, top], [x, top - hh], [x, top - peak]], c2, [x, top - peak], [x + hw, top]);
  mx.strokeStyle = 'rgba(255,255,255,.35)'; mx.lineWidth = 1.5; mx.beginPath(); mx.moveTo(x, top - peak); mx.lineTo(x, top + hh); mx.stroke();
}
function buildProgress(b) {
  for (const w of S.workers) if (w.task && w.task.kind === 'build' && w.task.bid === b.id) return w.task.prog / w.task.dur;
  return 0;
}
function drawBuilding(b, x, y, t) {
  if (b.done && b.type === 'palisade') return;   // the palisade is the fence around the village (drawn by drawPalisade)
  if (b.done && typeof drawBuildingArt === 'function' && drawBuildingArt(b, x, y)) return;
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
    default:
      drawExtraBuilding(b, x, y, t); break;
    case 'farm':
      diamond(x, y, '#8a6b35');
      mx.strokeStyle = '#d4b23f'; mx.lineWidth = 2;
      for (let k = -2; k <= 2; k++) { mx.beginPath(); mx.moveTo(x - 20 + Math.abs(k) * 4 + k * 4, y + k * 4 - 6); mx.lineTo(x + 4 + k * 8, y + k * 4 + 6); mx.stroke(); }
      break;
  }
}
function drawWorker(x, y, w, t, working) {
  const bob = working ? Math.abs(Math.sin(t * 8 + w.id)) * 3 : Math.sin(t * 3 + w.id) * .8;
  WSCR.push({ w, x, y: y - 12 - bob });
  mx.fillStyle = 'rgba(0,0,0,.28)'; mx.beginPath(); mx.ellipse(x + 2, y, 7, 3, 0, 0, 7); mx.fill();
  mx.fillStyle = lg(mx, x - 5, 0, x + 5, 0, [[0, `hsl(${w.hue},60%,58%)`], [1, `hsl(${w.hue},55%,30%)`]]);
  mx.beginPath(); mx.roundRect(x - 5, y - 15 - bob, 10, 12, 3); mx.fill();
  mx.fillStyle = rg(mx, x - 1, y - 20 - bob, 5, '#f8dcc0', '#e8c39a', '#b8875a'); mx.beginPath(); mx.arc(x, y - 19 - bob, 4.5, 0, 7); mx.fill();
  mx.fillStyle = lg(mx, x - 4, 0, x + 4, 0, [[0, '#e0f2fe'], [1, '#38bdf8']]); mx.fillRect(x - 3.5, y - 20.5 - bob, 7, 2.5); // visor: AI worker
  if (working) { const sw = Math.sin(t * 8 + w.id); mx.strokeStyle = '#6b4220'; mx.lineWidth = 2; mx.beginPath(); mx.moveTo(x + 4, y - 10 - bob); mx.lineTo(x + 9 + sw * 3, y - 16 - bob + sw * 2); mx.stroke(); }
  if (!w.ext && starving()) { mx.fillStyle = '#ff6b5b'; mx.font = 'bold 10px Georgia'; mx.textAlign = 'center'; mx.fillText('!', x, y - 26); }
}
function workerPos(w, k) {
  const t = w.task;
  const home = [TCI + Math.cos(k * 2.1) * 1.1 + .5, TCJ + 1.3 + Math.sin(k * 2.1) * .5 + .5];
  if (!t || !t.target) return { p: home, working: false };
  const tgt = [t.target[0] + .5, t.target[1] + .5 + (t.kind === 'build' ? .4 : .45)];
  const f = t.prog / t.dur, lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  if (t.kind === 'build') return f < .1 ? { p: lerp(home, tgt, f / .1), working: false } : { p: tgt, working: true };
  const go = t.tf || .2, back = t.tf || .15;
  if (f < go) return { p: lerp(home, tgt, f / go), working: false };
  if (f > 1 - back) return { p: lerp(tgt, home, (f - 1 + back) / back), working: false };
  return { p: tgt, working: true };
}
function updateDeer(dt) {
  for (const d of DEER) {
    if (d.wait > 0) { d.wait -= dt; continue; }
    const dx = d.ti - d.i, dy = d.tj - d.j, L = Math.hypot(dx, dy);
    if (L < .05) { d.wait = 2 + Math.random() * 4; d.ti = clamp(d.i + (Math.random() - .5) * 3, 1, W - 2); deerLure(d); d.tj = clamp(d.j + (Math.random() - .5) * 3, 1, H - 2); continue; }
    const s = Math.min(L, dt * .5); d.i += dx / L * s; d.j += dy / L * s;
  }
}
let WSCR = [], LAYER = null, layerDirty = true;
function worldLayer() {
  if (LAYER && !layerDirty) return LAYER;
  layerDirty = false;
  const ox = H * TW / 2 + TW, oy = 90, w = (W + H) * TW / 2 + TW * 2, h = (W + H) * TH / 2 + 130, LD = Math.min(DPR, 1.5);
  const c = (LAYER && LAYER.c) || document.createElement('canvas'); c.width = Math.ceil(w * LD); c.height = Math.ceil(h * LD);
  const g = c.getContext('2d'); g.setTransform(LD, 0, 0, LD, 0, 0); g.clearRect(0, 0, w, h);
  const old = mx; mx = g;
  try {
    const P = (i, j) => [(i - j) * TW / 2 + ox, (i + j) * TH / 2 + oy];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const [x, y] = P(i, j); groundTile(x, y, grassColor(i, j)); }
    const list = [];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const n = MAP.node[j * W + i]; if (NODES.includes(n) && !bAt(i, j) && !pileAt(i, j)) list.push([i, j, n]); }
    list.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1])).forEach(([i, j, n]) => { const [x, y] = P(i, j); nodeSprite(n, x, y, MAP.g[j * W + i], stageOf(i, j)); });
  } finally { mx = old; }
  LAYER = { c, ox, oy, w, h }; return LAYER;
}
function drawMap(now) {
  const t = now / 1000; WSCR = [];
  mx.setTransform(DPR * ZM, 0, 0, DPR * ZM, 0, 0);
  const vw = cw / ZM, vh = ch / ZM;
  mx.fillStyle = '#4e8a3e'; mx.fillRect(0, 0, vw, vh);
  const objs = [], front = new Set();
  // the shared world around the village: wild land and neighbours' villages (pre-rendered in chunks)
  if (typeof drawWorldGround === 'function') drawWorldGround(vw, vh);
  // our own village: ground + resources, one pre-rendered layer
  const L = worldLayer(), sx = vw / 2 - camX - L.ox, sy = vh / 2 - camY - L.oy;
  if (!(sx > vw || sy > vh || sx + L.w < 0 || sy + L.h < 0)) mx.drawImage(L.c, sx, sy, L.w, L.h);
  if (typeof worldObjects === 'function') worldObjects(objs, t, vw, vh);
  if (PLACE) drawPlaceGrid(vw, vh, t);
  pileObjects(objs, t, vw, vh);
  placeGhost(objs, t);
  if (hasB('palisade')) palisadeObjects(objs, vw, vh);
  const cI = TCI;
  const markFront = (fi, fj) => { for (let a = 0; a <= 2; a++) for (let b = 0; b <= 2; b++) if (a + b) { const j = fj + b; if (j >= 0 && j < H) front.add((fi + a) + ',' + j); } };
  for (const b of S.buildings) {
    const ui = unwrapNear(b.i, cI), [x, y] = iso(ui, b.j);
    if (x < -120 || x > cw / ZM + 120 || y < -140 || y > ch / ZM + 60) continue;
    objs.push({ d: ui + b.j, f: () => drawBuilding(b, x, y, t) }); markFront(ui, b.j);
  }
  // world edge (poles of the orb)
  mx.fillStyle = 'rgba(29,59,82,.0)';
  for (const d of DEER) {
    const ui = unwrapNear(d.i, cI);
    const [x, y] = iso(ui - .5, d.j - .5);
    objs.push({ d: ui + d.j, f: () => drawDeer(x, y, t) }); markFront(Math.floor(ui), Math.floor(d.j));
  }
  S.workers.forEach((w, k) => {
    if (w.task && w.task.kind === 'raid') return; // out on the world map
    const { p, working } = workerPos(w, k);
    const ui = unwrapNear(p[0], cI);
    const [x, y] = iso(ui - .5, p[1] - .5);
    objs.push({ d: ui + p[1] - .4, f: () => drawWorker(x, y, w, t, working) }); markFront(Math.floor(ui), Math.floor(p[1]));
  });
  objs.sort((a, b) => a.d - b.d).forEach(o => o.f());
  // resources standing in front of anything that moved get drawn again on top (keeps depth correct)
  [...front].map(k => k.split(',').map(Number)).sort((a, b) => (a[0] + a[1]) - (b[0] + b[1])).forEach(([i, j]) => {
    const n = nodeAt(i, j); if (!NODES.includes(n)) return;
    const [x, y] = iso(i, j); nodeSprite(n, x, y, MAP.g[j * W + mod(i, W)], stageOf(i, j));
  });
  mx.textAlign = 'center'; mx.font = 'bold 13px Georgia';
  flushLabels();
  if (typeof drawEdgeArrows === 'function') drawEdgeArrows(cw / ZM, ch / ZM);
  floaters = floaters.filter(f => f.age < 1.6);
  for (const f of floaters) {
    const ui = unwrapNear(f.i, cI); const [x, y] = iso(ui, f.j);
    mx.globalAlpha = 1 - f.age / 1.6; mx.fillStyle = '#fff3c4'; mx.strokeStyle = '#2b1d10'; mx.lineWidth = 3;
    mx.strokeText(f.text, x, y - 30 - f.age * 25); mx.fillText(f.text, x, y - 30 - f.age * 25); mx.globalAlpha = 1;
  }
}
// pan + pinch/wheel zoom + tap
(() => {
  let down = null; const pts = new Map(); let pinch = null;
  const zoomAt = (z, cx, cy) => {
    if (z < .29 && ME && typeof villageToWorld === 'function') { pts.clear(); pinch = null; down = null; villageToWorld(); return; }   // zoomed all the way out: hand off to the world map
    const r = mapC.getBoundingClientRect(), px = cx - r.left, py = cy - r.top, nz = clamp(z, .3, 1.6);
    const wx = px / ZM - cw / ZM / 2 + camX, wy = py / ZM - ch / ZM / 2 + camY;
    ZM = nz; camX = wx - px / ZM + cw / ZM / 2; camY = wy - py / ZM + ch / ZM / 2;
  };
  mapC.addEventListener('pointerdown', e => {
    mapC.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: ZM }; down = null; return; }
    down = { x: e.clientX, y: e.clientY, cx: camX, cy: camY, moved: false };
  });
  mapC.addEventListener('pointermove', e => {
    if (pts.has(e.pointerId)) pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; zoomAt(pinch.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); return; }
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (Math.hypot(dx, dy) > 8) down.moved = true;
    if (down.moved) { camX = down.cx - dx / ZM; camY = down.cy - dy / ZM; }
  });
  const up = e => {
    pts.delete(e.pointerId);
    if (pinch) { if (pts.size < 2) pinch = null; down = null; return; }
    if (!down) return;
    if (!down.moved && e.type === 'pointerup') {
      const r = mapC.getBoundingClientRect();
      if (PLACE) { placeTap(...rawTile(e.clientX, e.clientY)); down = null; return; }
      if (typeof edgeArrowTap === 'function' && edgeArrowTap((e.clientX - r.left) / ZM, (e.clientY - r.top) / ZM)) { down = null; return; }
      const hit = tileAt(e.clientX, e.clientY);
      if (hit && hit.ext) { if (typeof extTileSheet === 'function') extTileSheet(hit[0], hit[1]); }
      else if (hit) { if (!sendClosest(hit[0], hit[1])) tileSheet(hit[0], hit[1]); } else closeSheet();
    }
    down = null;
  };
  mapC.addEventListener('pointerup', up); mapC.addEventListener('pointercancel', up);
  mapC.addEventListener('wheel', e => { e.preventDefault(); zoomAt(ZM * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY); }, { passive: false });
  mapC.addEventListener('pointermove', e => { if (PLACE && e.pointerType === 'mouse') { PLACE.hover = rawTile(e.clientX, e.clientY); return; } if (e.pointerType !== 'mouse' || down) { if (down) hideTip(); return; } showTip(e); });
  mapC.addEventListener('pointerleave', hideTip);
})();

function tileAt(cx, cy) {
  const r = mapC.getBoundingClientRect();
  const wx = (cx - r.left) / ZM - cw / ZM / 2 + camX, wy = (cy - r.top) / ZM - ch / ZM / 2 + camY;
  const fi = (wx / (TW / 2) + wy / (TH / 2)) / 2, fj = (wy / (TH / 2) - wx / (TW / 2)) / 2;
  // objects are drawn above their tile: test tile under the pointer and the one just below it
  const cands = [[Math.floor(fi + .5), Math.floor(fj + .5)], [Math.floor(fi), Math.floor(fj)], [Math.floor(fi + 1), Math.floor(fj + 1)]];
  for (const [i, j] of cands) {
    if (i < 0 || i >= W || j < 0 || j >= H) { if (typeof extAt === 'function' && extAt(i, j)) { const h = [i, j]; h.ext = true; return h; } continue; }
    if (bAt(i, j) || nodeAt(i, j) || DEER.some(d => Math.floor(d.i) === i && Math.floor(d.j) === j)) return [i, j];
  }
  return null;
}
const tipEl = document.createElement('div'); tipEl.id = 'tip'; document.body.appendChild(tipEl);
function hideTip() { tipEl.style.display = 'none'; }
function workerAtTile(type, b) { return S.workers.filter(w => w.task && ((w.task.kind === 'build' && w.task.bid === b.id) || (TASKS[w.task.kind] && TASKS[w.task.kind].node === type))).map(w => esc(w.name)); }
function tipHTML(cx, cy) {
  const r = mapC.getBoundingClientRect(), px = (cx - r.left) / ZM, py = (cy - r.top) / ZM;
  const wk = WSCR.find(q => Math.hypot(q.x - px, q.y - py) < 12);
  if (wk && wk.w.ext) return `<b>${esc(wk.w.owner)}'s ${esc(wk.w.name)}</b><br>${esc(wk.w.label)}`;
  if (wk) {
    const w = wk.w, sp = starving() ? starveMul() : 1;
    return `<b>${esc(w.name)}</b><br>${w.task ? taskLabel(w.task) + ` · ${fmt((w.task.dur - w.task.prog) / sp)} left${w.repeat && w.task.kind !== 'build' ? ' · repeating' : ''}` : 'Idle — click a resource to put it to work'}${starving() ? '<br><span class="warn">Hungry: working at half speed</span>' : ''}`;
  }
  const hit = tileAt(cx, cy); if (!hit) return null;
  if (hit.ext) return typeof extTip === 'function' ? extTip(hit[0], hit[1]) : null;
  const [i, j] = hit, b = bAt(i, j);
  const deer = !b && DEER.find(d => Math.floor(mod(d.i, W)) === mod(i, W) && Math.floor(d.j) === j);
  if (b) {
    const D = BLD[b.type], ws = workerAtTile(b.type, b);
    let h = `<b>${D.n}</b><br>${b.type === 'tc' ? 'Your base. Houses 2 AI workers.' : D.desc}`;
    if (!b.done) h += `<br>Under construction · ${Math.round(buildProgress(b) * 100)}%`;
    else if (NODE_TASK[b.type]) { const tk = NODE_TASK[b.type], T = TASKS[tk]; h += `<br>${T.cost ? Object.entries(T.cost).map(([k, v]) => v + ' ' + k).join(' + ') + ' → ' : ''}${Object.entries(taskYield(tk)).map(([k, v]) => '+' + v + ' ' + k).join(', ')} every ${fmt(T.time)}`; }
    if (ws.length) h += `<br>Working here: ${ws.join(', ')}`;
    if (b.done && NODE_TASK[b.type]) h += '<br><i>Click to send the closest worker</i>';
    return h;
  }
  const kind = deer ? 'deer' : nodeAt(i, j); if (!kind) return null;
  const tk = NODE_TASK[kind], T = TASKS[tk], locked = T.req && !reqMet(T.req);
  return `<b>${NODE_NAME[kind]}</b>${kind !== 'deer' ? ` <span class="small">${leftOf(i, j)} trips left</span>` : ''}<br>${T.n}: ${Object.entries(taskYield(tk)).map(([k, v]) => '+' + v + ' ' + k).join(', ')} every ${fmt(T.time)}<br>${locked ? `<span class="warn">Requires ${reqName(T.req)}</span>` : '<i>Click to send the closest worker</i>'}`;
}
function showTip(e) {
  const h = tipHTML(e.clientX, e.clientY);
  if (!h) return hideTip();
  tipEl.innerHTML = h; tipEl.style.display = 'block';
  const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
  tipEl.style.left = Math.min(innerWidth - tw - 8, e.clientX + 14) + 'px';
  tipEl.style.top = Math.max(8, e.clientY - th - 10) + 'px';
}

// ---------------------------------------------------------------- puzzle
const N = 9, TYPES = 5;   // board arrays are 9×9; each level's shape masks out the cells it doesn't use
const TILE_NAME = ['Berries', 'Wood', 'Stone', 'Coins', 'Leaves'];
const goalName = k => /^\d$/.test(k) ? TILE_NAME[k] : (OB[k] ? OB[k].n : k);
const boardC = $('#board'), bx = boardC.getContext('2d');
let P = null, CS = 48;

// obstacles: a new one every 25 levels (Royal Match / Candy Crush style blockers)
const OBST = [
  { k: 'crate', n: 'Crate', at: 25, kind: 'block', hp: 1, d: 'Break with a match next to it or any special' },
  { k: 'moss', n: 'Moss', at: 50, kind: 'floor', d: 'Clear the tile sitting on it' },
  { k: 'ice', n: 'Ice', at: 75, kind: 'cover', hp: 1, d: 'Frozen tile can\'t move — match it to thaw' },
  { k: 'boulder', n: 'Boulder', at: 100, kind: 'block', hp: 2, d: 'Takes 2 hits' },
  { k: 'chain', n: 'Chains', at: 125, kind: 'cover', hp: 2, d: 'Locked tile — match it twice to free' },
  { k: 'safe', n: 'Safe', at: 150, kind: 'block', hp: 3, d: '3 hits — drops 5 copper' },
  { k: 'mud', n: 'Mud', at: 175, kind: 'block', hp: 1, d: 'Spreads every move you don\'t break some' },
  { k: 'keg', n: 'Powder Keg', at: 200, kind: 'block', hp: 1, d: 'Explodes 3×3 when hit' },
];
const OB = Object.fromEntries(OBST.map(o => [o.k, o]));
const isFixed = c => c && (c.t === -9 || c.t === -8 || c.cov);
const isVoid = c => c && c.t === -8;   // not part of this level's board
function levelDef(n) {
  const r = rng(n * 7919 + 13), d = Math.floor((n - 1) / 10);
  const unlocked = OBST.filter(o => n >= o.at), intro = OBST.find(o => o.at === n), hard = n % 10 === 0 && !intro;
  let obs = [];
  if (intro) obs = [intro.k];
  else if (unlocked.length && r() < .75) { obs.push(unlocked[(r() * unlocked.length) | 0].k); if (unlocked.length > 2 && r() < .4) { const o2 = unlocked[(r() * unlocked.length) | 0].k; if (!obs.includes(o2)) obs.push(o2); } }
  let moves = Math.max(16, 25 - Math.floor(d / 2)) + (intro ? 3 : 0) - (hard ? 2 : 0) + (typeof U === 'function' ? U('xmoves') : 0);
  const tileGoals = obs.length ? (d >= 4 && !intro ? 1 : 0) + (r() < .5 ? 1 : 0) : (n < 3 ? 1 : d < 3 ? 2 : 3);
  const pool = [0, 1, 2, 3, 4], goals = {};
  const base = Math.min(40, 12 + 2 * d + (n % 10)) * (hard ? 1.2 : 1);
  for (let g = 0; g < Math.max(obs.length ? 0 : 1, tileGoals); g++) { const t = pool.splice((r() * pool.length) | 0, 1)[0]; goals[t] = Math.round(base * (tileGoals > 1 ? .7 : 1)); }
  return { n, d, hard, moves, goals, obs, intro: intro ? intro.k : null, seed: (n * 104729) >>> 0, ...boardShape(n, hard) };
}
// board shapes: plain 8×8 for the first 10 levels, then new sizes and shapes unlock every 10 levels.
// split shapes have rows/columns that don't connect, so tiles can't match or fall across the gap — rockets and bombs still fire through it.
const SHAPES = [
  { k: 'rect', at: 1 }, { k: 'corners', at: 11 }, { k: 'holes', at: 21 }, { k: 'diamond', at: 31 }, { k: 'plus', at: 31 },
  { k: 'splitV', at: 41, split: true }, { k: 'splitH', at: 51, split: true }, { k: 'islands', at: 71, split: true },
];
function boardShape(n, hard) {
  if (n <= 10) return { shape: 'rect', bw: 8, bh: 8 };
  const r = rng(n * 31337 + 7), open = SHAPES.filter(s => n >= s.at);
  let pool = open; if (hard && open.some(s => s.split) && r() < .7) pool = open.filter(s => s.split);
  const sh = pool[(r() * pool.length) | 0].k;
  const sizes = n < 21 ? [7, 8] : [7, 8, 9];
  let bw = sizes[(r() * sizes.length) | 0], bh = sizes[(r() * sizes.length) | 0];
  if (sh === 'splitV' || sh === 'islands' || sh === 'plus' || sh === 'diamond') bw = 9;
  if (sh === 'splitH' || sh === 'islands' || sh === 'plus' || sh === 'diamond') bh = 9;
  return { shape: sh, bw, bh };
}
function makeMask(L) {
  const r = rng(L.seed ^ 0x5eed), m = Array.from({ length: N }, () => Array(N).fill(0));
  const W = L.bw || 8, H = L.bh || 8;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[y][x] = 1;
  const off = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) { m[y][x] = 0; m[y][W - 1 - x] = 0; } };
  if (L.shape === 'corners') { const c = 1 + (r() < .5 ? 1 : 0); for (let i = 0; i < c; i++) for (let j = 0; j < c - i; j++) { off(i, j); off(i, H - 1 - j); } }
  if (L.shape === 'diamond') for (let y = 0; y < H; y++) { const cut = Math.max(0, 2 - Math.min(y, H - 1 - y)); for (let i = 0; i < cut; i++) off(i, y); }
  if (L.shape === 'plus') for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { off(x, y); off(x, H - 1 - y); }
  if (L.shape === 'holes') { const k = 1 + ((r() * 3) | 0); for (let i = 0; i < k; i++) off(1 + ((r() * (W / 2 - 1)) | 0), 1 + ((r() * (H - 2)) | 0)); }
  if (L.shape === 'splitV' || L.shape === 'islands') for (let y = 0; y < H; y++) m[y][(W - 1) >> 1] = 0;
  if (L.shape === 'splitH' || L.shape === 'islands') for (let x = 0; x < W; x++) m[(H - 1) >> 1][x] = 0;
  return m;
}
const cell = (t, s = null) => ({ t, s, ox: 0, oy: 0, a: 1, sc: 1 });
const voidCell = () => ({ t: -8, s: null, ox: 0, oy: 0, a: 1, sc: 1 });
const block = (k, hp) => ({ t: -9, ob: k, hp: hp || OB[k].hp, max: hp || OB[k].hp, s: null, ox: 0, oy: 0, a: 1, sc: 1 });
const rndType = () => (Math.random() * TYPES) | 0;
function newBoard(mask) {
  let b;
  do {
    b = [];
    for (let y = 0; y < N; y++) {
      b[y] = [];
      for (let x = 0; x < N; x++) {
        if (mask && !mask[y][x]) { b[y][x] = voidCell(); continue; }
        let t;
        do { t = rndType(); } while ((x >= 2 && b[y][x - 1].t === t && b[y][x - 2].t === t) || (y >= 2 && b[y - 1][x].t === t && b[y - 2][x].t === t) ||
          (x >= 1 && y >= 1 && b[y][x - 1].t === t && b[y - 1][x].t === t && b[y - 1][x - 1].t === t));
        b[y][x] = cell(t);
      }
    }
  } while (!hasMoves(b));
  return b;
}
// place a level's obstacles with left/right symmetry
function placeObstacles(L, b, floor) {
  const r = rng(L.seed), d = L.d, left = {};
  // bounding box of the playable cells, used to mirror placements left/right
  let x0 = N, x1 = -1, y0 = N, y1 = -1;
  b.forEach((row, y) => row.forEach((c, x) => { if (!isVoid(c)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }));
  const mir = x => x0 + x1 - x, play = (x, y) => x >= 0 && y >= 0 && x < N && y < N && !isVoid(b[y][x]);
  for (const k of L.obs) {
    const O = OB[k]; let placed = 0;
    if (O.kind === 'floor') {
      // moss grows as random mirrored patches anywhere on the board
      const total = b.flat().filter(c => !isVoid(c)).length;
      const want = Math.min(Math.floor(total * .5), (2 + Math.min(3, Math.floor(d / 4))) * (x1 - x0 + 1));
      const patches = 1 + ((r() * 3) | 0), front = [];
      for (let p = 0; p < patches; p++) for (let t = 0; t < 30; t++) { const x = x0 + ((r() * ((x1 - x0 + 2) / 2)) | 0), y = y0 + ((r() * (y1 - y0 + 1)) | 0); if (play(x, y)) { front.push([x, y]); break; } }
      const add = (x, y) => { for (const X of [x, mir(x)]) if (play(X, y) && !floor[y][X]) { floor[y][X] = 1; placed++; } };
      for (let guard = 0; guard < 2000 && placed < want && front.length; guard++) {
        const i = (r() * front.length) | 0, [x, y] = front[i]; add(x, y);
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [x + dx, y + dy]).filter(([X, Y]) => play(X, Y) && !floor[Y][X]);
        if (nb.length) front.push(nb[(r() * nb.length) | 0]); else front.splice(i, 1);
      }
    } else {
      const want = Math.min(O.kind === 'cover' ? 14 : 12, (k === 'mud' ? 3 : 4) + Math.floor(d / 2) + (L.hard ? 2 : 0));
      for (let tries = 0; tries < 300 && placed < want; tries++) {
        const x = x0 + ((r() * ((x1 - x0 + 2) / 2)) | 0), y = y0 + 2 + ((r() * Math.max(1, y1 - y0 - 2)) | 0);
        for (const X of [...new Set([x, mir(x)])]) {
          if (placed >= want) break;
          if (!play(X, y)) continue;
          const c = b[y][X], rowPlay = b[y].filter(q => !isVoid(q)).length, rowFixed = b[y].filter(q => isFixed(q) && !isVoid(q)).length;
          if (isFixed(c) || rowFixed >= rowPlay - 3) continue;
          if (O.kind === 'block') b[y][X] = block(k); else c.cov = { k, hp: O.hp, max: O.hp };
          placed++;
        }
      }
    }
    left[k] = placed;
  }
  return left;
}
function startLevel(def) {
  const L = def || levelDef(S.level);
  const mask = makeMask(L), b = newBoard(mask), floor = Array.from({ length: N }, () => Array(N).fill(0));
  const obLeft = placeObstacles(L, b, floor);
  let x0 = N, x1 = -1, y0 = N, y1 = -1;
  mask.forEach((row, y) => row.forEach((v, x) => { if (v) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }));
  P = { L, b, floor, mask, box: { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, maskKey: mask.map(r => r.join('')).join('|'), moves: L.moves, left: { ...L.goals, ...obLeft }, score: 0, busy: false, over: false, sel: null, daily: !!(def && def.daily) };
  if (typeof startBoosts === 'function') startBoosts();
  if (!hasMoves(P.b)) reshuffle();
  sizeBoard(); renderPuzzleHead(); drawBoard();
  if (!L.intro && SHAPES.find(x => x.k === L.shape && x.split) && !S.seenSplit) { S.seenSplit = 1; save(); setTimeout(() => modal(`<h2>Split board</h2><p>Gaps cut this board into pieces. Tiles can't match or fall across a gap — use rockets, bombs and propellers to reach the other side.</p><div class="btns"><button class="btn go" data-close>Got it</button></div>`), 300); }
  if (L.intro) setTimeout(() => modal(`<h2>New obstacle: ${OB[L.intro].n}</h2><canvas id="obintro" width="${80 * DPR}" height="${80 * DPR}" style="width:80px;height:80px"></canvas><p>${OB[L.intro].d}.</p><div class="btns"><button class="btn go" data-close>Got it</button></div>`) || (() => { const g = $('#obintro').getContext('2d'); g.setTransform(DPR, 0, 0, DPR, 0, 0); drawObIcon(g, L.intro, 40, 40, 32, true, OB[L.intro].hp || 1, OB[L.intro].hp || 1); })(), 300);
}
function reshuffle() {
  const pos = [], cells = [];
  P.b.forEach((row, y) => row.forEach((c, x) => { if (c && !isFixed(c)) { pos.push([x, y]); cells.push(c); } }));
  for (let tries = 0; tries < 80; tries++) {
    for (let i = cells.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [cells[i], cells[j]] = [cells[j], cells[i]]; }
    pos.forEach(([x, y], i) => P.b[y][x] = cells[i]);
    if (!findRuns(P.b).length && hasMoves(P.b)) return;
  }
  // last resort: recolor movable tiles
  for (const [x, y] of pos) P.b[y][x].t = rndType();
}
function sizeBoard() {
  const wrap = $('#pz-wrap'); if (!$('#v-puzzle').offsetWidth || !wrap.offsetWidth) return;
  const bw = P ? P.box.w : 8, bh = P ? P.box.h : 8;
  CS = Math.max(20, Math.floor(Math.min((wrap.clientWidth - 8) / bw, (wrap.clientHeight - 8) / bh)));
  boardC.style.width = CS * bw + 'px'; boardC.style.height = CS * bh + 'px';
  boardC.width = CS * bw * DPR; boardC.height = CS * bh * DPR;
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
      if (!A || !B || isFixed(A) || isFixed(B)) continue;
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
  else if (c.s === 'b') { const R = (c.big || U('combomaster')) && c.ob !== 'keg' ? 2 : 1; for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < N && Y < N) out.push(X + ',' + Y); } }
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
  for (const k of keys) {
    const [x, y] = k.split(',').map(Number), q = P.b[y][x];
    if (P.floor && P.floor[y][x] && P.left.moss > 0) n++;
    if (!q) continue;
    if (q.t === -9) { if (P.left[q.ob] > 0) n += 1.5; continue; }
    if (q.cov && P.left[q.cov.k] > 0) n += 1.2;
    if (q.t >= 0 && P.left[q.t] > 0) n++;
  }
  return n;
}
function bestTarget(claimed, carry) {
  let best = [], bs = -1;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = x + ',' + y, q = P.b[y][x];
    if (!q || isVoid(q) || claimed.has(k)) continue;
    let sc;
    if (carry) { const area = triggerArea({ s: carry }, x, y); sc = goalHits(area) + area.length * .01; }
    else if (q.s && q.s !== 'p') sc = goalHits(triggerArea(q, x, y)) + .5;
    else sc = goalHits([k]) || .1;
    if (sc > bs + 1e-9) { bs = sc; best = [[x, y]]; } else if (Math.abs(sc - bs) < 1e-9) best.push([x, y]);
  }
  return best.length ? best[(Math.random() * best.length) | 0] : null;
}
// clears run in phases: a propeller's 4 neighbours clear first, then it flies, then its target clears
async function clearCells(start, spawns = [], adj = false) {
  const queue = [...start].map(k => [k, 0]), phaseOf = new Map(), flights = [];
  if (adj) { // a normal match also hits blocks touching it
    for (const k of [...start]) { const [x, y] = k.split(',').map(Number);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < N && Y < N && P.b[Y][X] && P.b[Y][X].t === -9) queue.push([X + ',' + Y, 0]); } }
  }
  while (queue.length) {
    const [k, ph] = queue.pop(); if (phaseOf.has(k)) continue; phaseOf.set(k, ph);
    const [x, y] = k.split(',').map(Number), c = P.b[y][x];
    if (c && c.ob === 'keg' && c.hp <= 1) { addFx({ type: 'b', x, y, dur: 500 }); sfx('bomb', 0, 60); shake = Math.max(shake, 8); triggerArea({ s: 'b', ob: 'keg' }, x, y).forEach(q => { if (!phaseOf.has(q)) queue.push([q, ph]); }); continue; }
    if (!c || !c.s) continue;
    if (c.s === 'p') {
      addFx({ type: 'p', x, y, dur: 450 }); sfx('prop');
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
      if (c.s === 'h' || c.s === 'v') { addFx({ type: c.s, x, y, dur: 520 }); shake = Math.max(shake, 5); sfx('line', 0, 60); }
      else if (c.s === 'b') { addFx({ type: 'b', x, y, dur: 600 }); shake = Math.max(shake, 10); sfx('bomb', 0, 60); }
      else if (c.s === 'c') { addFx({ type: 'c', x, y, dur: 650, targets: area.map(k => k.split(',').map(Number)) }); addFx({ type: 'flash', x, y, dur: 300 }); shake = Math.max(shake, 12); sfx('color', 0, 60); }
      area.forEach(q => { if (!phaseOf.has(q)) queue.push([q, ph]); });
    }
  }
  const maxPh = Math.max(0, ...phaseOf.values());
  for (let ph = 0; ph <= maxPh; ph++) {
    const fl = flights.filter(f => f.ph === ph);
    if (fl.length) { P.fly = fl; await anim(380, t => fl.forEach(f => f.p = ease(t))); P.fly = null; }
    const hit = [...phaseOf].filter(([, p]) => p === ph).map(([k]) => k.split(',').map(Number));
    // floor (moss) under any hit cell
    for (const [x, y] of hit) if (P.floor && P.floor[y][x]) { P.floor[y][x] = 0; if (P.left.moss > 0) P.left.moss--; burst(x, y, '#65a30d', 6); }
    const cells = [];
    for (const [x, y] of hit) {
      const c = P.b[y][x]; if (!c || isVoid(c)) continue;
      if (c.t === -9) { // block takes a hit
        c.hp--; c.flash = performance.now(); if (c.ob === 'mud') P.mudHit = true;
        burst(x, y, OB_COL[c.ob], 8, 1.1); sfx('tool', 0, 50);
        if (c.hp <= 0) { cells.push([x, y]); if (P.left[c.ob] > 0) P.left[c.ob]--; if (c.ob === 'safe') { S.res.copper += 5; P.safeCopper = (P.safeCopper || 0) + 5; } }
        continue;
      }
      if (c.cov) { // ice / chains: lose a layer, tile stays
        c.cov.hp--; c.flash = performance.now(); burst(x, y, OB_COL[c.cov.k], 8);
        if (c.cov.hp <= 0) { if (P.left[c.cov.k] > 0) P.left[c.cov.k]--; c.cov = null; }
        continue;
      }
      cells.push([x, y]);
    }
    if (!cells.length) { renderPuzzleHead(); continue; }
    for (const [x, y] of cells) { const c = P.b[y][x]; if (c.t >= 0 && P.left[c.t] > 0) P.left[c.t]--; P.score += 10; if (c.t !== -9) burst(x, y, c.t >= 0 ? TILE_COL[c.t] : '#fde047', c.s ? 16 : 7, c.s ? 1.4 : 1); }
    P.destroyed = (P.destroyed || 0) + cells.length;
    await anim(170, t => { for (const [x, y] of cells) { const c = P.b[y][x]; c.a = 1 - t; c.sc = 1 + .25 * t; } });
    for (const [x, y] of cells) P.b[y][x] = null;
    renderPuzzleHead();
  }
  for (const sp of spawns) { const [x, y] = sp.pos; P.b[y][x] = cell(sp.t, sp.s); }
  renderPuzzleHead();
}
async function gravity() {
  const moving = [], pop = [];
  for (let x = 0; x < N; x++) {
    // split the column into segments separated by fixed cells (blocks, frozen/chained tiles)
    let bottom = N - 1;
    while (bottom >= 0) {
      let top = bottom; while (top >= 0 && !isFixed(P.b[top][x])) top--;
      // segment rows top+1 .. bottom
      let w = bottom;
      for (let y = bottom; y > top; y--) { const c = P.b[y][x]; if (c) { if (w !== y) { P.b[w][x] = c; P.b[y][x] = null; c.oy = y - w; moving.push(c); } w--; } }
      const holes = w - top;
      let sky = top < 0; if (!sky && isVoid(P.b[top][x])) { sky = true; for (let y = top; y >= 0; y--) if (!isVoid(P.b[y][x])) { sky = false; break; } }   // only void above = the board's top edge here
      for (let y = w; y > top; y--) {
        const c = cell(rndType());
        if (sky) { c.oy = -holes; moving.push(c); } else { c.sc = 0; pop.push(c); } // below a blocker or gap: appear in place
        P.b[y][x] = c;
      }
      bottom = top - 1;
    }
  }
  moving.forEach(c => c.o0 = c.oy);
  await anim(230, t => { const e = ease(t); moving.forEach(c => c.oy = c.o0 * (1 - e)); pop.forEach(c => c.sc = e); });
  moving.forEach(c => c.oy = 0); pop.forEach(c => c.sc = 1);
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
      if (pref) for (const p of pref) if (g.keys.has(p[0] + ',' + p[1]) && !isFixed(P.b[p[1]][p[0]])) { pos = p; break; }
      if (!pos) { const lr = g.runs.reduce((a, r) => r.cells.length > a.cells.length ? r : a); pos = lr.cells[lr.cells.length >> 1]; }
      if (isFixed(P.b[pos[1]][pos[0]])) { const free = [...g.keys].map(k => k.split(',').map(Number)).find(([x, y]) => !isFixed(P.b[y][x])); if (!free) continue; pos = free; }
      spawns.push({ pos, s, t: (s === 'c' || s === 'p') ? -1 : g.t });
    }
    P.combo = (P.combo || 0) + 1; sfx('match', P.combo);
    if (spawns.length) setTimeout(() => sfx('special'), 120);
    await clearCells(clear, spawns, true);
    await gravity();
    pref = null;
  }
  if (!hasMoves(P.b)) { toast('No moves — shuffling'); reshuffle(); drawBoard(); }
}
function mudSpread() {
  if (P.mudHit) { P.mudHit = false; return; }
  const muds = []; P.b.forEach((row, y) => row.forEach((c, x) => { if (c && c.ob === 'mud') muds.push([x, y]); }));
  if (!muds.length) return;
  const opts = [];
  for (const [x, y] of muds) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < N && Y < N) { const c = P.b[Y][X]; if (c && c.t >= 0 && !c.s && !c.cov) opts.push([X, Y]); } }
  if (!opts.length) return;
  const [X, Y] = opts[(Math.random() * opts.length) | 0]; P.b[Y][X] = block('mud'); P.left.mud = (P.left.mud || 0) + 1; burst(X, Y, OB_COL.mud, 10); toast('The mud spread');
}
async function trySwap(a, b) {
  if (P.busy || P.over) return;
  const A = P.b[a[1]][a[0]], B = P.b[b[1]][b[0]];
  if (!A || !B || isVoid(A) || isVoid(B)) return;
  if (isFixed(A) || isFixed(B)) { sfx('bad'); toast('That tile is stuck'); return; }
  P.busy = true; P.sel = null; P.combo = 0; P.mudHit = false; const m0 = P.moves;
  sfx('swap');
  await animSwap(a, b);
  const line = q => q.s === 'h' || q.s === 'v';
  const all = () => { const k = []; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) k.push(i + ',' + j); return k; };
  if (A.s === 'c' && B.s === 'c') {
    // two color bombs: clear the board twice
    P.moves--; A.s = B.s = null;
    for (let r = 0; r < 2; r++) { addFx({ type: 'nuke', x: b[0], y: b[1], dur: 800 }); shake = 18; sfx('nuke'); await clearCells(all()); await gravity(); }
    await resolve(null);
  } else if (A.s === 'b' && B.s === 'b') {
    // two bombs: clear the board
    P.moves--; A.s = B.s = null;
    addFx({ type: 'nuke', x: b[0], y: b[1], dur: 800 }); shake = 16; sfx('nuke');
    await clearCells(all()); await gravity(); await resolve(null);
  } else if (line(A) && line(B)) {
    // two rockets: 3 rows + 3 columns through the meeting point
    P.moves--; A.s = B.s = null;
    const [cx, cy] = b, keys = new Set();
    const R2 = U('combomaster') ? 2 : 1;
    for (let d = -R2; d <= R2; d++) for (let k = 0; k < N; k++) {
      if (cy + d >= 0 && cy + d < N) keys.add(k + ',' + (cy + d));
      if (cx + d >= 0 && cx + d < N) keys.add((cx + d) + ',' + k);
    }
    addFx({ type: 'cross', x: cx, y: cy, dur: 650 }); shake = 12; sfx('line'); setTimeout(() => sfx('line'), 90);
    await clearCells([...keys]); await gravity(); await resolve(null);
  } else if (A.s === 'c' || B.s === 'c') {
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
    sfx('bad');
    await animSwap(b, a);
  } else {
    P.moves--;
    await resolve([b, a]);
  }
  if (P.moves < m0) mudSpread();
  P.busy = false;
  renderPuzzleHead(); drawBoard();
  checkEnd();
}
// double-tap a special to fire it in place (costs a move)
async function fireSpecial(pos) {
  if (P.busy || P.over) return;
  const c = P.b[pos[1]][pos[0]]; if (!c || !c.s) return;
  P.busy = true; P.sel = null; P.moves--; P.combo = 0; P.mudHit = false;
  await clearCells([pos[0] + ',' + pos[1]]);
  await gravity(); await resolve(null);
  mudSpread();
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
  const extra = P.moves, stars = 1 + (extra >= 3 ? 1 : 0) + (extra >= 6 ? 1 : 0), L = P.L;
  const mult = L.hard ? 1.5 : 1;
  const rw = { copper: puzzleCopper(Math.round((3 + (L.d || 0)) * mult) + bonus), silver: stars - 1, gold: (S.level % 5 === 0 ? 1 : 0) + (L.hard ? 1 : 0) };
  if (P.daily) { rw.copper += 50; rw.gold += 5; S.bank += 600; S.dailyDone = today(); }
  S.res.copper += rw.copper; S.res.silver += rw.silver; S.res.gold += rw.gold;
  const speed = extra * perMove(); S.bank = Math.min(bankCap(), S.bank + speed);
  S.streak = (S.streak || 0) + 1;
  if (!P.daily) { S.level++; S.wins++; S.recruit++; if (U('recruit') && S.wins % 3 === 0) S.recruit++; }
  if (!P.daily && hasB('gsdtower') && S.wins % 5 === 0) { if (S.workers.length < housing()) addWorker(); else S.waiting++; toast('GSD Tower: +1 AI worker'); }
  let recruit = '';
  if (S.recruit >= WINS_PER_WORKER) {
    S.recruit = 0;
    if (S.workers.length < housing()) { addWorker(); recruit = `<li><b>New AI worker recruited!</b></li>`; }
    else { S.waiting++; recruit = `<li><b>New AI worker</b> — waiting for housing (build a Hut)</li>`; }
  } else recruit = `<li>${S.recruit}/${WINS_PER_WORKER} wins toward next AI worker</li>`;
  save(); refresh(); sfx('win'); if (recruit.includes('recruited')) setTimeout(() => sfx('recruit'), 700);
  modal(`<h2>Puzzle complete</h2><div class="stars">${[1, 2, 3].map(s => `<span class="${s <= stars ? '' : 'off'}">★</span>`).join('')}</div>
    <ul>${P.daily ? '<li><b>Daily Challenge cleared!</b> +50 copper, +5 gold, +10 min speedup</li>' : ''}${L.hard ? '<li>Hard level bonus: ×1.5 copper, +1 gold</li>' : ''}${P.safeCopper ? `<li>Safes cracked: +${P.safeCopper} copper</li>` : ''}${bonus ? `<li>Leftover specials destroyed ${bonus} tiles → +${bonus} copper</li>` : ''}<li>+${rw.copper} copper total${rw.silver ? `, +${rw.silver} silver` : ''}${rw.gold ? ', +1 gold' : ''}</li>
    ${extra ? `<li>${extra} moves left → +${fmt(speed)} speedup</li>` : ''}${recruit}</ul>
    <div class="btns"><button class="btn alt" data-act="village">Village</button><button class="btn go" data-act="next">Next puzzle</button></div>`);
}
function lose() {
  P.over = true; sfx('lose'); S.streak = 0;
  if (U('secondchance') && S.chanceDay !== today() && !P.usedChance) { P.usedChance = true; S.chanceDay = today(); P.moves += 5; P.over = false; save(); renderPuzzleHead(); toast('Second Chance: +5 free moves'); return; }
  modal(`<h2>Out of moves</h2><p>${Object.entries(P.left).filter(([, v]) => v > 0).map(([t, v]) => `${v} ${goalName(t)}`).join(', ')} left.</p>
    <div class="btns"><button class="btn" data-act="more" ${wallet() >= MORE_MOVES_COST ? '' : 'disabled'}>+5 moves (${MORE_MOVES_COST} copper)</button></div>${wallet() >= MORE_MOVES_COST ? '' : whyHTML(needCoin(MORE_MOVES_COST))}
    <div class="small" style="margin-top:4px">You have ${wallet()} coin value (copper ${S.res.copper}, silver ×3, gold ×10)</div>
    <div class="btns"><button class="btn alt" data-act="village">Village</button><button class="btn go" data-act="next">Try again</button></div>`);
}
let PENDING_SV = null;
async function waitForClaim(rid) {
  for (let n = 0; n < 240 && !ME; n++) {
    await new Promise(r => setTimeout(r, 5000));
    let cur = null; try { cur = localStorage.getItem('gsd_rid'); } catch (e) {}
    if (cur && cur !== rid) return;
    const r = await api('claim?rid=' + rid);
    if (r.ok && r.signedIn) { try { localStorage.removeItem('gsd_rid'); } catch (e) {} toast('Signed in'); syncLogin(); return; }
  }
}
const ACTS = {
  keepLocal: async () => { S.owner = ME.id; save(); await pushSave(); toast('Kept this device\'s village'); refresh(true); },
  keepServer: () => { if (PENDING_SV) { loadSave(PENDING_SV); S.owner = ME.id; save(); dirty = false; PENDING_SV = null; toast('Loaded your account\'s village'); refresh(true); } },
  prestige: () => doPrestige(),
  more: () => { if (!P || wallet() < MORE_MOVES_COST) return; pay({ money: MORE_MOVES_COST }); sfx('coin'); P.moves += 5; P.over = false; save(); refresh(); renderPuzzleHead(); drawBoard(); toast('+5 moves'); },
  next: () => { startLevel(); },
  village: () => { P = null; setView('village'); },
  reset: () => { localStorage.removeItem(SAVE_KEY); S = newState(); if (ME) S.owner = ME.id; genMap(S.seed); P = null; save(); setView('village'); toast('Progress reset'); },
};

const TILE_COL = ['#e11d48', '#a0622d', '#9aa5b1', '#f5b301', '#22c55e'];
const OB_COL = { crate: '#b7793f', moss: '#65a30d', ice: '#bae6fd', boulder: '#78716c', chain: '#94a3b8', safe: '#64748b', mud: '#78350f', keg: '#b45309' };
function drawObIcon(ctx, k, x, y, r, big, hp = 1, max = 1) {
  ctx.save(); ctx.translate(x, y);
  const pips = () => { if (max > 1) for (let i = 0; i < max; i++) { ctx.fillStyle = i < hp ? '#fde047' : 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.arc((i - (max - 1) / 2) * r * .3, r * .78, r * .09, 0, 7); ctx.fill(); } };
  if (k === 'crate') {
    ctx.fillStyle = lg(ctx, 0, -r, 0, r, [[0, '#e0a96d'], [1, '#8a5226']]); ctx.beginPath(); ctx.roundRect(-r * .9, -r * .9, r * 1.8, r * 1.8, r * .14); ctx.fill();
    ctx.strokeStyle = '#5a3615'; ctx.lineWidth = r * .1; ctx.strokeRect(-r * .72, -r * .72, r * 1.44, r * 1.44);
    ctx.beginPath(); ctx.moveTo(-r * .72, -r * .72); ctx.lineTo(r * .72, r * .72); ctx.moveTo(r * .72, -r * .72); ctx.lineTo(-r * .72, r * .72); ctx.stroke();
  } else if (k === 'moss') {
    ctx.fillStyle = 'rgba(101,163,13,.55)'; ctx.beginPath(); ctx.roundRect(-r * .95, -r * .95, r * 1.9, r * 1.9, r * .28); ctx.fill();
    ctx.fillStyle = 'rgba(190,242,100,.6)'; for (const [a, b] of [[-.5, -.4], [.4, -.5], [-.3, .5], [.5, .35], [0, 0]]) { ctx.beginPath(); ctx.arc(a * r, b * r, r * .14, 0, 7); ctx.fill(); }
  } else if (k === 'ice') {
    ctx.fillStyle = 'rgba(186,230,253,.55)'; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = r * .07;
    ctx.beginPath(); ctx.roundRect(-r * .92, -r * .92, r * 1.84, r * 1.84, r * .22); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r * .6, -r * .2); ctx.lineTo(-r * .2, -r * .6); ctx.moveTo(-r * .4, r * .1); ctx.lineTo(r * .2, -r * .5); ctx.stroke();
  } else if (k === 'boulder') {
    ctx.fillStyle = rg(ctx, 0, 0, r * .95, '#d6d3d1', '#78716c', '#292524'); ctx.beginPath(); ctx.ellipse(0, r * .05, r * .92, r * .82, 0, 0, 7); ctx.fill();
    if (hp < max) { ctx.strokeStyle = '#1c1917'; ctx.lineWidth = r * .08; ctx.beginPath(); ctx.moveTo(-r * .3, -r * .6); ctx.lineTo(0, -r * .1); ctx.lineTo(-r * .2, r * .3); ctx.lineTo(r * .2, r * .6); ctx.stroke(); }
    pips();
  } else if (k === 'chain') {
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = r * .14;
    for (const s of [1, -1]) { ctx.save(); ctx.rotate(s * Math.PI / 4); for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.ellipse(i * r * .36, 0, r * .2, r * .12, 0, 0, 7); ctx.stroke(); } ctx.restore(); }
    pips();
  } else if (k === 'safe') {
    ctx.fillStyle = lg(ctx, 0, -r, 0, r, [[0, '#cbd5e1'], [1, '#334155']]); ctx.beginPath(); ctx.roundRect(-r * .9, -r * .9, r * 1.8, r * 1.8, r * .16); ctx.fill();
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = r * .07; ctx.strokeRect(-r * .7, -r * .7, r * 1.4, r * 1.4);
    ctx.fillStyle = rg(ctx, 0, 0, r * .35, '#fef3c7', '#eab308', '#854d0e'); ctx.beginPath(); ctx.arc(0, -r * .05, r * .32, 0, 7); ctx.fill();
    pips();
  } else if (k === 'mud') {
    ctx.fillStyle = rg(ctx, 0, 0, r, '#a16207', '#78350f', '#451a03'); ctx.beginPath();
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, rr = r * (.8 + Math.sin(i * 2.3) * .12); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.beginPath(); ctx.ellipse(-r * .3, -r * .35, r * .2, r * .1, -.4, 0, 7); ctx.fill();
  } else if (k === 'keg') {
    ctx.fillStyle = lg(ctx, -r, 0, r, 0, [[0, '#7c2d12'], [.5, '#c2410c'], [1, '#7c2d12']]); ctx.beginPath(); ctx.ellipse(0, 0, r * .75, r * .9, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = '#1c1917'; ctx.lineWidth = r * .1; for (const yy of [-.45, .45]) { ctx.beginPath(); ctx.moveTo(-r * .7, yy * r); ctx.lineTo(r * .7, yy * r); ctx.stroke(); }
    ctx.fillStyle = '#fde047'; ctx.font = `bold ${r * .7}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', 0, r * .05);
  }
  ctx.restore();
}
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
    } else if (f.type === 'nuke') {
      const R = ease(u) * W2 * 1.5;
      const g = bx.createRadialGradient(cx, cy, 0, cx, cy, R + 1);
      g.addColorStop(0, `rgba(255,255,255,${fade})`); g.addColorStop(.4, `rgba(253,224,71,${.8 * fade})`); g.addColorStop(.8, `rgba(239,68,68,${.5 * fade})`); g.addColorStop(1, 'rgba(239,68,68,0)');
      bx.fillStyle = g; bx.fillRect(0, 0, W2, W2);
    } else if (f.type === 'cross') {
      const reach = ease(Math.min(1, u * 2)) * W2;
      bx.fillStyle = `rgba(56,189,248,${.75 * fade})`;
      bx.fillRect(cx - reach, cy - CS * 1.5, reach * 2, CS * 3); bx.fillRect(cx - CS * 1.5, cy - reach, CS * 3, reach * 2);
      bx.fillStyle = `rgba(255,255,255,${.8 * fade})`;
      bx.fillRect(cx - reach, cy - CS * .2, reach * 2, CS * .4); bx.fillRect(cx - CS * .2, cy - reach, CS * .4, reach * 2);
    } else if (f.type === 'flash') {
      bx.fillStyle = `rgba(255,255,255,${.35 * fade})`; bx.fillRect(0, 0, W2, W2);
    }
  }
  bx.restore();
}
let BG = null, ICONS = {};
function boardBg() {
  if (BG && BG.cs === CS && BG.key === P.maskKey) return BG.c;
  const c = document.createElement('canvas'); c.width = c.height = CS * N * DPR; const g = c.getContext('2d'); g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const M = P.mask;
  // board frame only under playable cells
  g.fillStyle = '#0f1b3d';
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (M[y][x]) { g.beginPath(); g.roundRect(x * CS - 2, y * CS - 2, CS + 4, CS + 4, CS * .2); g.fill(); }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!M[y][x]) continue;
    const X = x * CS + CS * .04, Y = y * CS + CS * .04, w = CS * .92;
    g.fillStyle = lg(g, X, Y, X, Y + w, (x + y) % 2 ? [[0, '#16234a'], [1, '#22336a']] : [[0, '#1b2a57'], [1, '#2a3e7a']]);
    g.beginPath(); g.roundRect(X, Y, w, w, CS * .14); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1; g.beginPath(); g.moveTo(X + CS * .12, Y + w - .5); g.lineTo(X + w - CS * .12, Y + w - .5); g.stroke();
  }
  BG = { cs: CS, key: P.maskKey, c }; ICONS = {}; return c;
}
function iconSprite(t) {
  if (ICONS[t]) return ICONS[t];
  const c = document.createElement('canvas'); c.width = c.height = Math.ceil(CS * DPR); const g = c.getContext('2d'); g.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawIcon(g, t, CS / 2, CS / 2, CS * .42); return (ICONS[t] = c);
}
function drawBoard() {
  if (!P) return;
  const t = performance.now() / 1000;
  const now = performance.now();
  shake *= .88;
  const sx = shake > .3 ? (Math.random() - .5) * shake : 0, sy = shake > .3 ? (Math.random() - .5) * shake : 0;
  bx.setTransform(1, 0, 0, 1, 0, 0); bx.clearRect(0, 0, boardC.width, boardC.height);
  bx.setTransform(DPR, 0, 0, DPR, (sx - P.box.x0 * CS) * DPR, (sy - P.box.y0 * CS) * DPR);
  bx.drawImage(boardBg(), 0, 0, CS * N, CS * N);
  if (P.tool && P.hover) {
    const [hx, hy] = P.hover; bx.fillStyle = 'rgba(253,224,71,.28)';
    if (P.tool === 'pick') bx.fillRect(hx * CS, hy * CS, CS, CS);
    if (P.tool === 'saw') bx.fillRect(0, hy * CS, CS * N, CS);
    if (P.tool === 'drill') bx.fillRect(hx * CS, 0, CS, CS * N);
  }
  if (P.sel) { bx.strokeStyle = '#fde047'; bx.lineWidth = CS * .07; bx.beginPath(); bx.roundRect(P.sel[0] * CS + CS * .06, P.sel[1] * CS + CS * .06, CS * .88, CS * .88, CS * .14); bx.stroke(); }
  bx.save(); bx.beginPath(); bx.rect(P.box.x0 * CS - 4, P.box.y0 * CS - 4, P.box.w * CS + 8, P.box.h * CS + 8); bx.clip();
  if (P.floor) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (P.floor[y][x]) drawObIcon(bx, 'moss', (x + .5) * CS, (y + .5) * CS, CS * .48);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = P.b[y][x]; if (!c || isVoid(c)) continue;
    const px = (x + c.ox + .5) * CS, py = (y + c.oy + .5) * CS, r = CS * .42 * c.sc;
    bx.globalAlpha = c.a;
    if (c.t === -9) { const fl = c.flash && now - c.flash < 180; drawObIcon(bx, c.ob, px + (fl ? (Math.random() - .5) * 4 : 0), py, CS * .46 * c.sc, false, c.hp, c.max); bx.globalAlpha = 1; continue; }
    if (c.t >= 0) { const R = CS * .42, ic = iconSprite(c.t); const k = r / R; bx.drawImage(ic, px - CS / 2 * k, py - CS / 2 * k, CS * k, CS * k); }
    if (c.s) drawSpecial(bx, c.s, px, py, r, t);
    if (c.cov) drawObIcon(bx, c.cov.k, px, py, CS * .48, false, c.cov.hp, c.cov.max);
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
  try { const s = JSON.parse(localStorage.getItem('gsd-legend2') || 'null'); if (s) { el.style.left = s.x + 'px'; el.style.top = s.y + 'px'; el.classList.toggle('min', !!s.min); } else if (innerWidth < 760) el.classList.add('min'); else { el.style.left = '10px'; el.style.top = ($('#pz-head').offsetHeight + 10) + 'px'; } } catch (e) {}
  const keep = () => { const r = el.getBoundingClientRect(), pr = $('#v-puzzle').getBoundingClientRect(); try { localStorage.setItem('gsd-legend2', JSON.stringify({ x: r.left - pr.left, y: r.top - pr.top, min: el.classList.contains('min') })); } catch (e) {} };
  hd.addEventListener('pointerdown', e => { if (e.target.dataset.lgx !== undefined) return; hd.setPointerCapture(e.pointerId); const r = el.getBoundingClientRect(), pr = $('#v-puzzle').getBoundingClientRect(); st = { dx: e.clientX - r.left, dy: e.clientY - r.top, pr }; });
  hd.addEventListener('pointermove', e => { if (!st) return; el.style.left = clamp(e.clientX - st.dx - st.pr.left, 0, st.pr.width - 60) + 'px'; el.style.top = clamp(e.clientY - st.dy - st.pr.top, 0, st.pr.height - 30) + 'px'; el.style.right = 'auto'; });
  hd.addEventListener('pointerup', () => { if (st) keep(); st = null; });
  el.querySelector('[data-lgx]').addEventListener('click', () => { el.classList.toggle('min'); keep(); });
}
function renderLegend() {
  if (legendDone) return; legendDone = true;
  $('#pz-legend').innerHTML = '<div class="lg-h" data-drag>Specials <button class="lg-x" data-lgx>–</button></div><div class="lg-body">' + LEGEND.map((L, k) => `<div class="lg"><canvas data-lg="${k}" width="${40 * DPR}" height="${40 * DPR}"></canvas>
    <div><b>${L.n}</b><div class="how">${L.how}</div><div>${L.does}</div></div></div>`).join('') +
    `<div class="lg-note"><b>Double-tap or swap any special to fire it</b> — no match needed (uses a move).<br>Swap two specials together → both fire.<br><b>Combos:</b> 2 Rockets → 3 rows + 3 columns · 2 Bombs → whole board · 2 Color Bombs → whole board twice · Propeller + any special → carries it to the best spot.</div></div>`;
  legendDrag();
  document.querySelectorAll('#pz-legend canvas[data-lg]').forEach(c => {
    const L = LEGEND[+c.dataset.lg], x = c.getContext('2d');
    x.setTransform(DPR, 0, 0, DPR, 0, 0); x.fillStyle = '#263970'; x.fillRect(0, 0, 40, 40);
    if (L.t >= 0) drawIcon(x, L.t, 20, 20, 16);
    drawSpecial(x, L.s, 20, 20, 16, 0);
  });
}
function drawTool(ctx, k, x, y, r) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0, r * .8, r * .6, r * .14, 0, 0, 7); ctx.fill();
  if (k === 'pick') {
    ctx.rotate(-.6);
    ctx.fillStyle = lg(ctx, -r * .1, 0, r * .1, 0, [[0, '#d6a46a'], [1, '#7a4a22']]); ctx.fillRect(-r * .09, -r * .55, r * .18, r * 1.35);
    ctx.fillStyle = lg(ctx, 0, -r * .8, 0, -r * .45, [[0, '#e5e7eb'], [1, '#64748b']]);
    ctx.beginPath(); ctx.moveTo(-r * .85, -r * .45); ctx.quadraticCurveTo(0, -r * .95, r * .85, -r * .45); ctx.quadraticCurveTo(0, -r * .68, -r * .85, -r * .45); ctx.fill();
  } else if (k === 'saw') {
    ctx.fillStyle = rg(ctx, 0, 0, r * .8, '#f8fafc', '#94a3b8', '#334155');
    ctx.beginPath(); for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, rr = i % 2 ? r * .62 : r * .8; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(0, 0, r * .18, 0, 7); ctx.fill();
  } else if (k === 'drill') {
    ctx.fillStyle = lg(ctx, -r * .4, 0, r * .4, 0, [[0, '#fbbf24'], [1, '#b45309']]); ctx.beginPath(); ctx.roundRect(-r * .4, -r * .8, r * .8, r * .55, r * .1); ctx.fill();
    ctx.fillStyle = lg(ctx, -r * .2, 0, r * .2, 0, [[0, '#e5e7eb'], [1, '#475569']]);
    ctx.beginPath(); ctx.moveTo(-r * .22, -r * .25); ctx.lineTo(r * .22, -r * .25); ctx.lineTo(0, r * .78); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#334155'; ctx.lineWidth = r * .06; for (let i = 0; i < 4; i++) { const yy = -r * .15 + i * r * .2; ctx.beginPath(); ctx.moveTo(-r * .18 + i * r * .04, yy); ctx.lineTo(r * .18 - i * r * .04, yy + r * .08); ctx.stroke(); }
  } else if (k === 'swap') {
    // two curved arrows chasing each other
    ctx.lineWidth = r * .16; ctx.lineCap = 'round';
    for (const [sgn, col] of [[1, '#3b82f6'], [-1, '#f59e0b']]) {
      ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(0, 0, r * .55, sgn > 0 ? Math.PI * 1.1 : Math.PI * .1, sgn > 0 ? Math.PI * 1.9 : Math.PI * .9); ctx.stroke();
      const ang = sgn > 0 ? Math.PI * 1.9 : Math.PI * .9, ex = Math.cos(ang) * r * .55, ey = Math.sin(ang) * r * .55;
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(ex + Math.cos(ang + 1.9) * r * .3, ey + Math.sin(ang + 1.9) * r * .3); ctx.lineTo(ex + Math.cos(ang) * r * .22, ey + Math.sin(ang) * r * .22); ctx.lineTo(ex + Math.cos(ang + Math.PI) * r * .22, ey + Math.sin(ang + Math.PI) * r * .22); ctx.closePath(); ctx.fill();
    }
  } else if (k === 'storm') {
    for (let i = 0; i < 5; i++) { const w = r * (.85 - i * .14), yy = -r * .6 + i * r * .28; ctx.strokeStyle = `rgba(${200 - i * 10},${180 - i * 10},${140 - i * 10},.95)`; ctx.lineWidth = r * .14; ctx.beginPath(); ctx.ellipse(i * r * .05, yy, w, r * .12, 0, 0, 7); ctx.stroke(); }
  }
  ctx.restore();
}
function renderTools() {
  const T = S.tools || (S.tools = {});
  $('#pz-tools').innerHTML = Object.entries(TOOLS).map(([k, t]) => `<button class="tool${P && P.tool === k ? ' armed' : ''}" data-tool="${k}" title="${t.n}: ${t.d}"><canvas data-ti="${k}" width="${36 * DPR}" height="${36 * DPR}"></canvas><span class="cnt">${T[k] || '+'}</span></button>`).join('') +
    `<button class="tool shop" data-shop title="Copper Shop"><b>Shop</b><span class="small">${S.res.copper}c</span></button>`;
  document.querySelectorAll('#pz-tools canvas[data-ti]').forEach(c => { const x = c.getContext('2d'); x.setTransform(DPR, 0, 0, DPR, 0, 0); drawTool(x, c.dataset.ti, 18, 18, 15); });
}
function openShop() {
  const T = S.tools || (S.tools = {});
  modal(`<h2>Copper Shop</h2><div class="small">Wallet: ${wallet()} coin value (copper ${S.res.copper}, silver ×3, gold ×10). Tools don't use a move.</div>
    ${Object.entries(TOOLS).map(([k, t]) => `<div class="card" style="text-align:left"><div class="row"><canvas data-si="${k}" width="${40 * DPR}" height="${40 * DPR}" style="width:40px;height:40px;flex:none"></canvas>
      <div style="flex:1"><div class="t">${t.n} <span class="small">owned ${T[k] || 0}</span></div><div class="d">${t.d}</div></div>
      <button class="btn sm" data-buy="${k}" ${wallet() >= toolCost(k) ? '' : 'disabled'}>${toolCost(k)} c</button></div>${wallet() >= toolCost(k) ? '' : whyHTML(needCoin(toolCost(k)))}</div>`).join('')}
    <div class="btns"><button class="btn alt" data-close>Done</button></div>`);
  document.querySelectorAll('#modal canvas[data-si]').forEach(c => { const x = c.getContext('2d'); x.setTransform(DPR, 0, 0, DPR, 0, 0); drawTool(x, c.dataset.si, 20, 20, 17); });
}
$('#modal').addEventListener('click', e => {
  const b = e.target.closest('[data-buy]'); if (!b) return;
  const t = TOOLS[b.dataset.buy]; if (wallet() < toolCost(b.dataset.buy)) return;
  pay({ money: toolCost(b.dataset.buy) }); S.tools[b.dataset.buy] = (S.tools[b.dataset.buy] || 0) + 1; sfx('coin'); save(); refresh(); renderTools(); openShop();
});
$('#pz-foot').addEventListener('click', e => { if (e.target.closest('[data-daily]')) startDaily(); });
$('#pz-tools').addEventListener('click', e => {
  if (e.target.closest('[data-shop]')) return openShop();
  const b = e.target.closest('[data-tool]'); if (!b || !P || P.busy || P.over) return;
  const k = b.dataset.tool;
  if (!(S.tools && S.tools[k])) return openShop();
  if (k === 'storm') { useTool('storm'); return; }
  P.tool = P.tool === k ? null : k; renderTools();
  P.swapA = null;
  if (P.tool) toast(k === 'pick' ? 'Tap a tile to smash' : k === 'saw' ? 'Tap a row to cut' : k === 'swap' ? 'Tap two tiles to swap' : 'Tap a column to drill');
});
async function useTool(k, c) {
  if (!P || P.busy || P.over) return;
  S.tools[k]--; P.tool = null; P.busy = true; P.combo = 0; save(); renderTools(); sfx('tool');
  if (k === 'storm') {
    sfx('shuffle'); addFx({ type: 'flash', x: 0, y: 0, dur: 300 });
    reshuffle();
    await anim(350, t => P.b.forEach(r => r.forEach(q => { if (q && !isFixed(q)) { q.sc = .4 + .6 * ease(t); q.a = t; } })));
  } else if (k === 'swap') {
    const [a, b] = c; sfx('swap');
    await animSwap(a, b);
    if (findRuns(P.b).length) await resolve([b, a]);
  } else {
    const [x, y] = c, keys = [];
    if (k === 'pick') { keys.push(x + ',' + y); addFx({ type: 'b', x, y, dur: 350 }); shake = 5; }
    if (k === 'saw') { for (let i = 0; i < N; i++) keys.push(i + ',' + y); addFx({ type: 'h', x, y, dur: 520 }); sfx('line'); shake = 6; }
    if (k === 'drill') { for (let j = 0; j < N; j++) keys.push(x + ',' + j); addFx({ type: 'v', x, y, dur: 520 }); sfx('line'); shake = 6; }
    await clearCells(keys); await gravity(); await resolve(null);
  }
  P.busy = false; renderPuzzleHead(); drawBoard(); checkEnd();
}
function renderPuzzleHead() {
  if (!P) return;
  const goals = Object.entries(P.left).map(([t, v]) => `<div class="goal${v <= 0 ? ' done' : ''}" title="${goalName(t)}"><canvas data-icon="${t}" width="${28 * DPR}" height="${28 * DPR}" style="width:28px;height:28px"></canvas>${v <= 0 ? '✓' : v}</div>`).join('');
  $('#pz-head').innerHTML = `<div class="lv">${P.daily ? 'Daily Challenge' : 'Level ' + P.L.n}${P.L.hard ? ' <span class="hard">HARD</span>' : ''}</div><div class="goals">${goals}</div><div class="mv"><b>${P.moves}</b>moves</div>`;
  document.querySelectorAll('#pz-head canvas[data-icon]').forEach(c => { const x = c.getContext('2d'); x.setTransform(DPR, 0, 0, DPR, 0, 0); const k = c.dataset.icon; if (/^\d$/.test(k)) drawIcon(x, +k, 14, 14, 12); else drawObIcon(x, k, 14, 14, 12, false, OB[k].hp || 1, OB[k].hp || 1); });
  $('#pz-foot').innerHTML = `Leftover moves become speedup time · ${S.recruit}/${WINS_PER_WORKER} wins to next AI worker${U('daily') && S.dailyDone !== today() && !P.daily ? ' · <button class="btn sm go" data-daily>Daily Challenge</button>' : ''}`;
  renderLegend(); renderTools();
}
(() => {
  let st = null, lastTap = null;
  const cellAt = e => { const r = boardC.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / CS) + P.box.x0, Math.floor((e.clientY - r.top) / CS) + P.box.y0]; };
  const inB = c => c[0] >= 0 && c[1] >= 0 && c[0] < N && c[1] < N && !isVoid(P.b[c[1]][c[0]]);
  boardC.addEventListener('pointerdown', e => {
    if (!P || P.busy || P.over) return;
    boardC.setPointerCapture(e.pointerId);
    st = { c: cellAt(e), x: e.clientX, y: e.clientY, done: false };
  });
  boardC.addEventListener('pointermove', e => { if (P && P.tool) { const c = cellAt(e); P.hover = inB(c) ? c : null; } });
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
      if (P.tool === 'swap') {
        // Swap tool: first tap picks a tile, second tap swaps it with any other tile
        st = null; const q = P.b[c[1]][c[0]];
        if (!q || isVoid(q) || isFixed(q)) { sfx('bad'); toast('That tile is stuck'); return; }
        if (!P.swapA) { P.swapA = c; P.sel = c; drawBoard(); return; }
        if (P.swapA[0] === c[0] && P.swapA[1] === c[1]) { P.swapA = null; P.sel = null; drawBoard(); return; }
        const a = P.swapA; P.swapA = null; P.sel = null; useTool('swap', [a, c]); return;
      }
      if (P.tool) { const k = P.tool; st = null; useTool(k, c); return; }
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
  S = migrate(sv);
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
  const prog = x => (x.level || 1) + (x.buildings || []).length * 2 + (x.workers || []).length * 3;
  if (!sv) { S.owner = ME.id; save(); await pushSave(); toast('Your village is now saved to your account'); }
  // this device has its own guest village and the account already has one: ask which to keep
  else if (S.owner !== ME.id && prog(S) > prog(newState()) && JSON.stringify([S.level, S.buildings.length]) !== JSON.stringify([sv.level, (sv.buildings || []).length])) {
    PENDING_SV = sv;
    modal(`<h2>Two villages</h2><p>This device: <b>level ${S.level}</b>, ${S.buildings.length} buildings, ${S.workers.length} AI workers.<br>Your account (${esc(ME.email)}): <b>level ${sv.level || 1}</b>, ${(sv.buildings || []).length} buildings, ${(sv.workers || []).length} AI workers.</p><p>Which one do you want to keep? The other is replaced.</p>
      <div class="btns"><button class="btn go" data-act="keepLocal">Keep this device's</button><button class="btn alt" data-act="keepServer">Use the account's</button></div>`);
  }
  else if (S.owner === ME.id && (S.t || 0) > (sv.t || 0)) { await pushSave(); }   // this device is ahead
  else { loadSave(sv); S.owner = ME.id; save(); dirty = false; }
  S.teamWonder = !!r.teamWonder;
  if (r.losses && r.losses.length) applyLosses(r.losses);
  pollLosses(); refresh(true);
}
async function pushSave(beacon) {
  if (!ME) return;
  S.owner = ME.id;
  const body = JSON.stringify({ save: S, applied, appliedGifts });
  if (beacon && navigator.sendBeacon) { navigator.sendBeacon('/api/save', new Blob([body], { type: 'application/json' })); return; }
  const r = await api('save', { method: 'PUT', body });
  if (r.ok) { dirty = false; applied = []; appliedGifts = []; }
  else if (r.auth === false) { ME = null; refresh(true); }
}
let appliedGifts = [], INCOMING = [], seenGifts = new Set();
let lastPoll = 0;
async function pollLosses() {
  lastPoll = Date.now();
  const r = await api('losses'); if (!r.ok) return;
  if (r.now) SKEW = r.now - Date.now();
  if (r.losses.length) applyLosses(r.losses);
  for (const g of r.gifts || []) {
    if (seenGifts.has(g.id)) continue; seenGifts.add(g.id);
    for (const [k, v] of Object.entries(g.res)) S.res[k] = (S.res[k] || 0) + v;
    appliedGifts.push(g.id); dirty = true;
    const got = Object.entries(g.res).map(([k, v]) => `+${v} ${k}`).join(', ');
    if (g.note && g.note.startsWith('crew:')) { toast(crewMsg(g.note.slice(5)) + (got && !g.note.includes(' with ') ? ': ' + got : '')); if (got) sfx('harvest'); }
    else toast(`${g.from_name} ${g.note === 'auction sale' ? 'bought your listing' : 'sent a caravan'}: ` + got);
  }
  if (appliedGifts.length) { save(); pushSave(); }
  // a crew the server already brought home frees its workers here too
  if (r.marches) { const live = new Set(r.marches.map(m => m.id)); for (const w of S.workers) if (w.task && w.task.kind === 'raid' && w.task.mid && !live.has(w.task.mid)) { w.task = null; autoAssign(w); } }
  const fresh = (r.incoming || []).filter(i => !INCOMING.some(x => x.id === i.id));
  for (const i of fresh) { toast(`⚠ ${i.attacker}'s raid arrives in ${fmt(Math.max(0, (i.eta - sNow()) / 1000))} — World tab to intercept`); sfx('lose'); }
  INCOMING = r.incoming || [];
  refresh(true);
}
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
// ---------------------------------------------------------------- world map (multiplayer): one shared map, crews march in the open
const WILD_INFO = { grove: { n: 'Wild grove', res: 'wood', carry: 25 }, rocks: { n: 'Rock field', res: 'stone', carry: 20 }, ore: { n: 'Iron outcrop', res: 'iron', carry: 12 }, goldvein: { n: 'Gold vein', res: 'gold', carry: 2 } };
const W_WORK = 30, W_CREW = 5;
const wTravel = (d, fast) => Math.min(1800, Math.round((15 + d * 4) * (fast ? .7 : 1)));
let ORB = null, orbLoading = false, WLD = null, wLoading = false, CAM = null, SKEW = 0, CREW_N = 1, wLastBox = null;
const sNow = () => Date.now() + SKEW;
const crewsOut = () => S.workers.filter(w => w.task && w.task.kind === 'raid');
const myTeam = () => ME && ME.team && ORB && ORB.teams.find(x => x.id === ME.team);
const isMate = v => ME && ME.team && v.team === ME.team && v.id !== ME.id;
const isAlly = v => { const t = myTeam(); return !!(t && v.team && t.ally === v.team); };
const vName = (id, fallback) => { const v = WLD && WLD.villages.find(x => x.id === id); return v ? v.name : fallback || ''; };
function crewMsg(msg) { return msg.replace(/dismantled (.+?)'s (.+)$/, (m, who, what) => `dismantled ${who}'s ${what.split(' + ').map(b => BLD[b] ? BLD[b].n : b).join(' + ')}`); }

// harvesting: crews walk the world map; the server resolves them and mails the haul home as a gift
function resolveRaid(w, t) {
  if (!t.mid) toast(`${w.name} is back home`);
  autoAssign(w);
  setTimeout(() => { if (ME) pollLosses(); }, 2500);
}
async function sendCrew(kind, target, n, label) {
  if (!ME) return;
  const pool = [...idle(), ...free().filter(x => x.task && x.task.kind !== 'raid')];
  if (pool.length < n) return toast(`Need ${n} free AI worker${n > 1 ? 's' : ''} (${pool.length} free)`);
  const r = await api('march', { method: 'POST', body: JSON.stringify({ kind, target, crew: n }) });
  if (!r.ok) return toast(r.error);
  const dur = Math.max(5, (r.ret - r.now) / 1000);
  pool.slice(0, n).forEach(w => { w.task = { kind: 'raid', mode: kind, mid: r.id, name: label, label: { raid: `Raiding ${label}`, gather: `Gathering at ${label}`, intercept: `Intercepting ${label}` }[kind], target: null, dur, prog: 0 }; w.repeat = false; });
  sfx('build'); toast(`${n} AI worker${n > 1 ? 's' : ''} set out (${fmt(dur)} round trip)`);
  closeSheet(); save(); refresh(true); loadWorld(true);
}

// data
async function loadOrb() {
  if (!ME || orbLoading) return; orbLoading = true;
  const r = await api('board'); orbLoading = false;
  if (r.ok) { ORB = r; ME = r.me; S.teamWonder = !!(ME.team && (r.teams.find(x => x.id === ME.team) || {}).wonder >= r.wonderGoal); if (!CAM) CAM = { x: ME.x, y: ME.y, z: 18 }; refresh(true); loadWorld(); }
}
function viewBox() {
  const c = $('#worldc'), w = c ? c.clientWidth : 400, h = c ? c.clientHeight : 400, z = CAM.z;
  return [Math.floor(CAM.x - w / 2 / z) - 4, Math.floor(CAM.y - h / 2 / z) - 4, Math.ceil(CAM.x + w / 2 / z) + 4, Math.ceil(CAM.y + h / 2 / z) + 4];
}
async function loadWorld(force) {
  if (!ME || !CAM || wLoading) return;
  const b = viewBox();
  if (!force && wLastBox && b[0] >= wLastBox[0] && b[1] >= wLastBox[1] && b[2] <= wLastBox[2] && b[3] <= wLastBox[3] && WLD && Date.now() - WLD.at < 3500) return;
  wLoading = true;
  // fetch a margin around the view so small pans don't refetch
  const m = 12, q = [b[0] - m, b[1] - m, b[2] + m, b[3] + m];
  const r = await api(`world?x0=${q[0]}&y0=${q[1]}&x1=${q[2]}&y1=${q[3]}`); wLoading = false;
  if (!r.ok) { if (r.auth === false) { ME = null; refresh(true); } return; }
  r.at = Date.now(); WLD = r; wLastBox = r.box; SKEW = r.now - Date.now(); ME = { ...ME, ...r.me };
  if (view === 'orb') renderOrb();
}

// march position at a moment (server time)
function marchPos(m, t) {
  const lerp = (f, ax, ay, bx, by) => [ax + (bx - ax) * f, ay + (by - ay) * f];
  if (m.status === 'back') {
    if (t < m.back_at) return { p: [m.tx, m.ty], home: false, work: true };
    const f = Math.min(1, Math.max(0, (t - m.back_at) / Math.max(1, m.ret - m.back_at)));
    return { p: lerp(f, m.tx, m.ty, m.fx, m.fy), home: true };
  }
  const f = Math.min(1, Math.max(0, (t - m.start) / Math.max(1, m.arrive - m.start)));
  return { p: lerp(f, m.fx, m.fy, m.tx, m.ty), home: false };
}
function marchColor(m) {
  if (m.owner === ME.id) return '#fbbf24';
  if (m.kind === 'raid' && m.status !== 'back' && (m.target === ME.id || (ME.team && WLD.villages.some(v => v.id === m.target && v.team === ME.team)))) return '#ef4444';
  if (ME.team && m.owner_team === ME.team) return '#86efac';
  return '#e2e8f0';
}

// rendering
function wNoise(x, y) { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); }
function wSmooth(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = wNoise(xi, yi), b = wNoise(xi + 1, yi), c = wNoise(xi, yi + 1), d = wNoise(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const GRASS = ['#3f7d3a', '#468a3f', '#4e9645', '#5aa14c', '#66a957', '#7aa95d', '#8b9a5b'];
let wTerrain = null, wTKey = '';
function terrainLayer(c, w, h) {
  const key = [Math.round(CAM.x * CAM.z), Math.round(CAM.y * CAM.z), CAM.z, w, h].join(',');
  if (key === wTKey && wTerrain) return wTerrain;
  wTKey = key;
  if (!wTerrain) wTerrain = document.createElement('canvas');
  wTerrain.width = w * DPR; wTerrain.height = h * DPR;
  const g = wTerrain.getContext('2d'); g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const z = CAM.z, step = z < 7 ? 3 : z < 11 ? 2 : 1;
  const x0 = Math.floor(CAM.x - w / 2 / z) - 1, y0 = Math.floor(CAM.y - h / 2 / z) - 1, x1 = Math.ceil(CAM.x + w / 2 / z) + 1, y1 = Math.ceil(CAM.y + h / 2 / z) + 1;
  for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
    const n = wSmooth(x / 11, y / 11) * .7 + wSmooth(x / 3, y / 3) * .3;
    g.fillStyle = GRASS[Math.min(GRASS.length - 1, Math.floor(n * GRASS.length))];
    const [sx, sy] = w2s(x, y, w, h); g.fillRect(Math.floor(sx), Math.floor(sy), Math.ceil(z * step) + 1, Math.ceil(z * step) + 1);
  }
  // faint plot grid every 14 tiles
  g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1;
  for (let x = Math.floor(x0 / 14) * 14; x <= x1; x += 14) { const [sx] = w2s(x, 0, w, h); g.beginPath(); g.moveTo(sx, 0); g.lineTo(sx, h); g.stroke(); }
  for (let y = Math.floor(y0 / 14) * 14; y <= y1; y += 14) { const [, sy] = w2s(0, y, w, h); g.beginPath(); g.moveTo(0, sy); g.lineTo(w, sy); g.stroke(); }
  return wTerrain;
}
function w2s(x, y, w, h) { return [(x - CAM.x) * CAM.z + w / 2, (y - CAM.y) * CAM.z + h / 2]; }
function s2w(sx, sy, w, h) { return [(sx - w / 2) / CAM.z + CAM.x, (sy - h / 2) / CAM.z + CAM.y]; }
function drawWild(g, n, x, y, z) {
  const k = Math.max(5, z * .55), dead = n.amt <= 0;
  g.save(); g.translate(x, y); g.globalAlpha = dead ? .35 : 1;
  if (n.type === 'grove') {
    for (const [dx, dy, s] of [[-.6, .2, .8], [.55, .25, .75], [0, -.35, 1]]) {
      g.fillStyle = '#5b3a1e'; g.fillRect(dx * k - k * .08, dy * k, k * .16, k * .45 * s);
      g.fillStyle = '#14532d'; g.beginPath(); g.moveTo(dx * k, dy * k - k * .85 * s); g.lineTo(dx * k + k * .45 * s, dy * k + k * .1); g.lineTo(dx * k - k * .45 * s, dy * k + k * .1); g.closePath(); g.fill();
      g.fillStyle = 'rgba(134,239,172,.35)'; g.beginPath(); g.moveTo(dx * k, dy * k - k * .85 * s); g.lineTo(dx * k + k * .2 * s, dy * k - k * .2); g.lineTo(dx * k - k * .3 * s, dy * k); g.closePath(); g.fill();
    }
  } else {
    const col = n.type === 'rocks' ? ['#cbd5e1', '#64748b'] : n.type === 'ore' ? ['#78716c', '#292524'] : ['#fde68a', '#a16207'];
    for (const [dx, dy, s] of [[-.45, .15, .7], [.4, .2, .6], [0, -.2, .85]]) {
      const gr = g.createRadialGradient(dx * k - k * .15, dy * k - k * .2, k * .05, dx * k, dy * k, k * .5 * s); gr.addColorStop(0, col[0]); gr.addColorStop(1, col[1]);
      g.fillStyle = gr; g.beginPath(); g.ellipse(dx * k, dy * k, k * .5 * s, k * .38 * s, 0, 0, 7); g.fill();
    }
    if (n.type === 'ore') { g.fillStyle = '#f97316'; for (const [dx, dy] of [[-.4, .1], [.1, -.25], [.35, .25]]) { g.beginPath(); g.arc(dx * k, dy * k, k * .07, 0, 7); g.fill(); } }
    if (n.type === 'goldvein') { g.fillStyle = '#fff7'; g.beginPath(); g.arc(-k * .1, -k * .35, k * .08, 0, 7); g.fill(); }
  }
  g.restore();
  if (z >= 14 && !dead) { const f = n.amt / n.max; g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(x - k * .6, y + k * .7, k * 1.2, 3); g.fillStyle = '#facc15'; g.fillRect(x - k * .6, y + k * .7, k * 1.2 * f, 3); }
}
function drawVillage(g, v, x, y, z, t) {
  const mine = v.id === ME.id, mate = isMate(v), ally = isAlly(v), r = Math.max(6, z * (.75 + Math.min(.6, v.bcount / 30)));
  if (v.shield || v.treaty) { g.strokeStyle = 'rgba(96,165,250,.8)'; g.lineWidth = 2; g.setLineDash([4, 3]); g.beginPath(); g.arc(x, y, r * 1.55, 0, 7); g.stroke(); g.setLineDash([]); }
  if (v.palisade) { g.strokeStyle = '#7c4a1e'; g.lineWidth = Math.max(2, r * .18); g.beginPath(); g.arc(x, y, r * 1.25, 0, 7); g.stroke(); }
  const base = mine ? ['#fde68a', '#d97706'] : mate ? ['#bbf7d0', '#16a34a'] : ally ? ['#a5f3fc', '#0e7490'] : ['#f1f5f9', '#64748b'];
  const gr = g.createRadialGradient(x - r * .3, y - r * .3, r * .1, x, y, r); gr.addColorStop(0, base[0]); gr.addColorStop(1, base[1]);
  g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(x + 2, y + r * .35, r, r * .55, 0, 0, 7); g.fill();
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  // little roofs for the buildings
  const nh = Math.min(5, 1 + Math.floor(v.bcount / 4));
  for (let i = 0; i < nh; i++) {
    const a = i / nh * Math.PI * 2 + .4, hx = x + Math.cos(a) * r * (nh > 1 ? .45 : 0), hy = y + Math.sin(a) * r * (nh > 1 ? .4 : 0), s = r * .32;
    g.fillStyle = '#fef3c7'; g.fillRect(hx - s * .7, hy - s * .2, s * 1.4, s * .9);
    g.fillStyle = v.tier >= 8 ? '#475569' : v.tier >= 6 ? '#1e3a8a' : '#9a3412'; g.beginPath(); g.moveTo(hx - s, hy - s * .1); g.lineTo(hx, hy - s * .9); g.lineTo(hx + s, hy - s * .1); g.closePath(); g.fill();
  }
  if (mine) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r + 2 + Math.sin(t / 300) * 1.5, 0, 7); g.stroke(); }
  if (v.online) { g.fillStyle = '#22c55e'; g.beginPath(); g.arc(x + r * .75, y - r * .75, Math.max(3, r * .18), 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke(); }
  if (z >= 9 || mine || mate || U('orbmap')) {
    g.font = `bold ${Math.max(10, Math.min(13, z * .6))}px system-ui`; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.7)';
    const label = (v.banner ? '👑 ' : '') + v.name.slice(0, 16); g.strokeText(label, x, y + r + 13); g.fillStyle = '#fff'; g.fillText(label, x, y + r + 13);
  }
  return r;
}
function drawMarch(g, m, x, y, z, t, w, h) {
  const col = marchColor(m), at = marchPos(m, sNow());
  const dest = at.home ? [m.fx, m.fy] : [m.tx, m.ty], [dx, dy] = w2s(dest[0], dest[1], w, h);
  g.strokeStyle = col; g.globalAlpha = .55; g.lineWidth = 2; g.setLineDash([6, 5]); g.lineDashOffset = -t / 60;
  g.beginPath(); g.moveTo(x, y); g.lineTo(dx, dy); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
  const r = Math.max(6, z * .38) + Math.min(4, m.crew);
  g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(x + 1.5, y + 2, r, 0, 7); g.fill();
  g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.strokeStyle = '#0f1b3d'; g.lineWidth = 1.5; g.stroke();
  g.fillStyle = '#0f1b3d'; g.font = `bold ${r * 1.05}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(m.kind === 'raid' ? '⚔' : m.kind === 'gather' ? (at.work ? '⛏' : at.home ? '📦' : '⛏') : '🛡', x, y + 1); g.textBaseline = 'alphabetic';
  if (m.crew > 1) { g.fillStyle = '#fff'; g.font = `bold 10px system-ui`; g.fillText('×' + m.crew, x + r + 6, y - r + 4); }
  return r;
}
let wHits = [];
function drawWorld(t) {
  const c = $('#worldc'); if (!c || !CAM || !WLD) return;
  const w = c.clientWidth, h = c.clientHeight; if (!w || !h) return;
  if (c.width !== Math.round(w * DPR) || c.height !== Math.round(h * DPR)) { c.width = Math.round(w * DPR); c.height = Math.round(h * DPR); wTKey = ''; }
  const g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(terrainLayer(c, w, h), 0, 0); g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const z = CAM.z, hits = [], on = (x, y, pad = 30) => x > -pad && y > -pad && x < w + pad && y < h + pad;
  for (const n of WLD.wild) { const [x, y] = w2s(n.x + .5, n.y + .5, w, h); if (!on(x, y)) continue; drawWild(g, n, x, y, z); hits.push({ k: 'wild', o: n, x, y, r: Math.max(10, z * .7) }); }
  for (const v of WLD.villages) { const [x, y] = w2s(v.x + .5, v.y + .5, w, h); if (!on(x, y, 60)) continue; const r = drawVillage(g, v, x, y, z, t); hits.push({ k: 'v', o: v, x, y, r: r + 6 }); }
  for (const m of WLD.marches) { if (m.status === 'done') continue; const p = marchPos(m, sNow()).p, [x, y] = w2s(p[0] + .5, p[1] + .5, w, h); if (!on(x, y, 200)) continue; const r = drawMarch(g, m, x, y, z, t, w, h); hits.push({ k: 'm', o: m, x, y, r: r + 8 }); }
  // compass to home when it is off screen
  const [hx, hy] = w2s(ME.x + .5, ME.y + .5, w, h);
  if (!on(hx, hy, -10)) { const a = Math.atan2(hy - h / 2, hx - w / 2), ex = w / 2 + Math.cos(a) * (w / 2 - 22), ey = h / 2 + Math.sin(a) * (h / 2 - 22);
    g.save(); g.translate(ex, ey); g.rotate(a); g.fillStyle = '#fbbf24'; g.beginPath(); g.moveTo(12, 0); g.lineTo(-8, -8); g.lineTo(-8, 8); g.closePath(); g.fill(); g.restore(); }
  wHits = hits;
}

// panel (everything under the map)
function renderOrb(force) {
  const el = $('#v-orb');
  if (!ME) {
    if (sig === 'o-out' && !force) return; sig = 'o-out';
    el.innerHTML = `<h2>The World</h2>
      <div class="card"><div class="t">Sign in to save your village and join the shared world map</div>
      <div class="d">We email you a one-time login link. No password. Your current progress carries over.</div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
        <input id="lg-name" maxlength="20" placeholder="Village name (shown to other players)" class="inp">
        <input id="lg-email" type="email" placeholder="Email" class="inp" autocomplete="email">
        <button class="btn go" data-login>Email me a login link</button>
        <div id="lg-msg" class="small"></div></div></div>
      <div class="card"><div class="t">What happens in the world</div><div class="d">Every village sits on one shared map. Send AI worker crews to gather from wild groves, rocks, ore and gold veins before others pick them clean, or march on rival villages to dismantle a building for 33% of its cost. Every crew walks in the open — if a raid is heading for you or a teammate, send a crew out to stop it on the road. New players are protected for 24 hours.</div></div>`;
    return;
  }
  if (!ORB) { if (sig !== 'o-load') { sig = 'o-load'; el.innerHTML = '<h2>The World</h2><div class="small">Loading…</div>'; } loadOrb(); return; }
  if (!$('#worldc')) {
    el.innerHTML = `<div id="wmap"><canvas id="worldc"></canvas>
      <div class="wbtns"><button class="btn sm" data-lb title="Leaderboard">🏆</button><button class="btn sm" data-wz="1">+</button><button class="btn sm" data-wz="-1">−</button><button class="btn sm" data-whome title="Home">⌂</button></div>
      <div class="wleg">⚔ raid · ⛏ gather · 🛡 intercept · <b style="color:#fbbf24">gold</b> = yours · <b style="color:#ef4444">red</b> = coming for you</div></div><div id="wpanel"></div>`;
    bindWorldInput(); sig = '';
  }
  const crews = crewsOut();
  const s = 'o' + JSON.stringify([ORB.players.map(p => [p.id, p.score, p.team, p.online]), ORB.teams, ORB.rank, crews.map(w => [w.id, w.task.mid]), INCOMING.map(i => i.id), TBANK, EVT && [EVT.total, EVT.claimed], LISTS && LISTS.map(l => l.id), ORB.teams.map(t => [t.ally, t.wonder]), Math.floor(Date.now() / 5000)]);
  if (s === sig && !force) return; sig = s;
  const tName = id => { const t = ORB.teams.find(x => x.id === id); return t ? t.name : ''; };
  let html = `<h2>World <span class="small">home ${ME.x}, ${ME.y}</span></h2>
    <div class="small">${ORB.total} signed-in village${ORB.total === 1 ? '' : 's'} on the map${ORB.guests ? ` · ${ORB.guests} guest device${ORB.guests === 1 ? '' : 's'} played without signing in (${ORB.guestsWeek} this week) — guests stay off the map until they sign in` : ''}</div>`;
  if (crews.length) {
    const byM = {}; crews.forEach(w => { (byM[w.task.mid || 'old' + w.id] = byM[w.task.mid || 'old' + w.id] || []).push(w); });
    html += `<h3>Your crews on the road</h3>` + Object.values(byM).map(ws => { const w = ws[0]; return `<div class="card"><div class="t">${esc(w.task.label || w.task.name)} <span class="small">· ${ws.length} worker${ws.length > 1 ? 's' : ''}</span></div>${progRow(w)}</div>`; }).join('');
  }
  html += orbExtras();
  html += `<h3>Leaderboard</h3>${lbHTML()}<div class="small">Tap a row to find that village on the map.</div>`;
  html += `<h3>Teams <span class="small">${ORB.teams.length}/${ORB.limits.teams}</span></h3>`;
  if (ME.team) html += `<div class="card"><div class="row"><div><div class="t">${esc(tName(ME.team))}</div><div class="d">Your team</div></div><button class="btn sm alt" data-team="leave">Leave</button></div></div>`;
  const myT = myTeam();
  for (const t of ORB.teams) if (t.id !== ME.team) html += `<div class="card"><div class="row"><div><div class="t">${esc(t.name)}${myT && myT.ally === t.id ? ' <span class="small">· ally</span>' : ''}</div><div class="d">${t.members}/${ORB.limits.teamMax} members · ${t.score} pts</div></div>
    <div style="display:flex;gap:4px">${ME.team && U('envoy') && myT && myT.ally !== t.id ? `<button class="btn sm alt" data-ally="${t.id}">Ally</button>` : ''}
    <button class="btn sm" data-team="join" data-id="${t.id}" ${t.members >= ORB.limits.teamMax ? 'disabled' : ''}>Join</button></div></div></div>`;
  if (!ME.team && ORB.teams.length < ORB.limits.teams) html += `<div class="card"><div class="t">Start a team</div><div style="display:flex;gap:6px;margin-top:6px"><input id="tm-name" maxlength="20" placeholder="Team name" class="inp" style="flex:1"><button class="btn sm go" data-team="create">Create</button></div></div>`;
  html += `<div class="card"><div class="t">Move your village</div><div class="d">${U('migration') ? 'Tap open land on the map and choose “Move village here”. Buildings, workers and research come with you; resources reset to the starting amounts.' : 'Research Migration (#90, Tech tab) to move your village to any open land on the map.'}</div></div>`;
  html += `<div class="foot">Signed in as ${esc(ME.name)} (${esc(ME.email)}) · <button class="btn sm alt" data-logout>Sign out</button></div>`;
  $('#wpanel').innerHTML = html;
}

// map input: drag to pan, wheel / pinch to zoom, tap to inspect
function bindWorldInput() {
  const c = $('#worldc'), pts = new Map(); let moved = 0, pinch = null, last = null;
  const clampZ = z => Math.max(5, Math.min(40, z));
  const zoomAt = (f, sx, sy) => { const w = c.clientWidth, h = c.clientHeight, [wx, wy] = s2w(sx, sy, w, h);
    if (CAM.z * f > 41 && typeof worldToVillage === 'function') { pts.clear(); pinch = null; worldToVillage(wx, wy); return; }   // zoomed all the way in: drop into the village view there
    CAM.z = clampZ(CAM.z * f); const [nx, ny] = s2w(sx, sy, w, h); CAM.x += wx - nx; CAM.y += wy - ny; };
  c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.offsetX, e.offsetY]); if (pts.size === 1) { moved = 0; last = [e.offsetX, e.offsetY]; } if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: CAM.z }; } });
  c.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); zoomAt(pinch.z * d / pinch.d / CAM.z, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); moved = 99; return; }
    if (pts.size === 1 && last) { const dx = e.offsetX - last[0], dy = e.offsetY - last[1]; moved += Math.abs(dx) + Math.abs(dy); CAM.x -= dx / CAM.z; CAM.y -= dy / CAM.z; last = [e.offsetX, e.offsetY]; }
  });
  const up = e => {
    if (!pts.has(e.pointerId)) return; pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0) { if (moved < 8) wTap(e.offsetX, e.offsetY); else loadWorld(); last = null; }
    else last = [...pts.values()][0];
  };
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  c.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.offsetX, e.offsetY); clearTimeout(c._wt); c._wt = setTimeout(loadWorld, 250); }, { passive: false });
}
let LB_SORT = 'level';
function lbRows() {
  const k = LB_SORT, list = [...ORB.players].sort((a, b) => (b[k] - a[k]) || (b.score - a.score));
  return list;
}
function lbHTML(limit) {
  const tName = id => { const t = ORB.teams.find(x => x.id === id); return t ? t.name : ''; };
  const list = lbRows().slice(0, limit || 100), th = (k, n) => `<th><button class="lbs${LB_SORT === k ? ' on' : ''}" data-lbsort="${k}">${n}${LB_SORT === k ? ' ▼' : ''}</button></th>`;
  return `<table class="lb"><tr><th>#</th><th>Village</th><th>Team</th>${th('level', 'Lvl')}${th('bcount', 'Bldgs')}${th('score', 'Score')}</tr>
    ${list.map((p, i) => `<tr data-pl="${p.id}" class="${p.id === ME.id ? 'me' : ''}"><td>${i + 1}</td><td>${p.online ? '● ' : ''}${p.banner && i < 10 ? '👑 ' : ''}${esc(p.name)}${p.shield || p.treaty ? ' 🛡' : ''}</td><td>${esc(tName(p.team))}</td><td>${p.level}</td><td>${p.bcount}</td><td>${p.score}</td></tr>`).join('')}</table>`;
}
function lbSheet() {
  if (!ORB) return;
  SHEET_FOR = { k: 'lb' };
  openSheet(`<div class="t">🏆 Leaderboard <span class="small">· ${ORB.total} villages</span></div><div style="max-height:50vh;overflow:auto;margin-top:6px">${lbHTML()}</div>`);
}
function wTap(sx, sy) {
  let best = null, bd = 1e9;
  for (const h of wHits) { const d = Math.hypot(h.x - sx, h.y - sy); if (d <= h.r && d - (h.k === 'm' ? 6 : 0) < bd) { bd = d - (h.k === 'm' ? 6 : 0); best = h; } }
  if (!best) { const c = $('#worldc'), [x, y] = s2w(sx, sy, c.clientWidth, c.clientHeight); return landSheet(Math.floor(x), Math.floor(y)); }
  if (best.k === 'v') return villageSheet(best.o);
  if (best.k === 'wild') return wildSheet(best.o);
  if (best.k === 'm') return marchSheet(best.o);
}
const crewPicker = (max = W_CREW) => `<div class="row" style="justify-content:flex-start;gap:8px;margin-top:8px"><span class="small">Crew</span><button class="btn sm alt" data-crew="-1">−</button><b id="crew-n">${CREW_N}</b><button class="btn sm alt" data-crew="1">+</button><span class="small">of ${max}</span></div>`;
let SHEET_FOR = null;
function villageSheet(v) {
  SHEET_FOR = { k: 'v', o: v };
  const d = Math.hypot(v.x - ME.x, v.y - ME.y);
  if (v.id === ME.id) return openSheet(`<div class="t">${esc(v.name)} (you)</div><div class="d">Score ${v.score} · level ${v.level} · ${v.bcount} buildings · at ${v.x}, ${v.y}</div>`);
  const mate = isMate(v), ally = isAlly(v);
  const blocked = mate ? 'Teammate — immune' : ally ? 'Allied team — immune' : v.shield ? 'New-player protection (24h)' : v.treaty ? 'Peace treaty (recently harvested)' : '';
  const go = wTravel(d, U('fastcrews')) * (v.palisade ? 2 : 1), back = wTravel(d, U('fastcrews'));
  openSheet(`<div class="t">${esc(v.name)}</div><div class="d">Score ${v.score} · level ${v.level} · ${v.bcount} buildings${v.online ? ' · online now' : ''} · ${Math.round(d)} tiles away</div>
    <div style="margin-top:8px">${blocked ? `<span class="small">${blocked}</span>` : `<button class="btn go" data-raid="${v.id}">Send raid crew · arrives in ${fmt(go)}</button>
    <div class="small" style="margin-top:4px">One AI worker marches there in the open and dismantles their lowest-tier building for ${U('spoils') ? 40 : 33}% of its cost${U('bigcrews') ? ' (Big Crews: 2 buildings)' : ''}, then walks ${fmt(back)} home with the haul. They can send a crew to stop it on the road.${v.palisade ? ' Palisade: the march there takes twice as long.' : ''}</div>
    ${U('scout') ? `<button class="btn sm alt" style="margin-top:6px" data-scout="${v.id}">Scout</button><div id="scout-out" class="small"></div>` : ''}`}</div>
    ${mate && U('caravan') ? `<div style="margin-top:8px">${giftForm(v.id)}</div>` : ''}`);
}
function wildSheet(n) {
  SHEET_FOR = { k: 'wild', o: n };
  const I = WILD_INFO[n.type], d = Math.hypot(n.x - ME.x, n.y - ME.y), t = wTravel(d, U('fastcrews')), haul = Math.min(n.amt, I.carry * CREW_N);
  const heading = WLD.marches.filter(m => m.kind === 'gather' && m.target === n.id && m.status === 'out');
  openSheet(`<div class="t">${I.n}</div><div class="d">${n.amt > 0 ? `${n.amt}/${n.max} ${I.res} left` : `Picked clean — grows back in ${fmt((n.regrow - sNow()) / 1000)}`} · ${Math.round(d)} tiles away · open to every player</div>
    ${heading.length ? `<div class="small" style="margin-top:4px">Crews already heading here: ${heading.map(m => `${esc(m.owner_name)} (${m.crew})`).join(', ')}</div>` : ''}
    ${n.amt > 0 ? `${crewPicker()}<div class="small" id="crew-info">Each worker carries ${I.carry} ${I.res} · this crew brings home up to ${haul} ${I.res} · ${fmt(t * 2 + W_WORK)} round trip. First crew there takes it.</div>
    <button class="btn go" style="margin-top:8px" data-gather="${n.id}">Send gather crew</button>` : ''}`);
}
function marchSheet(m) {
  SHEET_FOR = { k: 'm', o: m };
  const at = marchPos(m, sNow()), mine = m.owner === ME.id;
  const what = m.kind === 'raid' ? `raiding ${esc(m.target_name)}` : m.kind === 'gather' ? `gathering at a ${esc((WILD_INFO[m.target_name] || {}).n || 'wild spot')}` : `intercepting ${esc(m.target_name)}'s raid`;
  const eta = m.status === 'back' ? `heading home · ${fmt((m.ret - sNow()) / 1000)}` : `arrives in ${fmt((m.arrive - sNow()) / 1000)}`;
  const threat = m.kind === 'raid' && m.status === 'out' && !mine && (m.target === ME.id || (ME.team && WLD.villages.some(v => v.id === m.target && v.team === ME.team)));
  openSheet(`<div class="t">${mine ? 'Your crew' : esc(m.owner_name) + "'s crew"} · ${m.crew} worker${m.crew > 1 ? 's' : ''}</div><div class="d">${what} · ${eta}${at.work ? ' · working' : ''}</div>
    ${threat ? `${crewPicker()}<div class="small" id="crew-info">Your crew musters, marches out and meets them on the road. Each worker you send adds to your odds${U('militia') ? ' (Militia: +1)' : ''}${hasB('watchtower') ? '; Watchtower: your crew moves twice as fast' : ''}. If you win, the raiders go home empty-handed.</div>
    <button class="btn go" style="margin-top:8px" data-icpt="${m.id}">Intercept</button>` : ''}`);
}
function landSheet(x, y) {
  SHEET_FOR = { k: 'land', o: { x, y } };
  openSheet(`<div class="t">Open land · ${x}, ${y}</div><div class="d">${Math.round(Math.hypot(x - ME.x, y - ME.y))} tiles from home</div>
    ${U('migration') ? `<button class="btn go" style="margin-top:8px" data-move="${x},${y}">Move village here</button><div class="small" style="margin-top:4px">Buildings, workers and research come with you; resources reset to the starting amounts. Must be 7+ tiles from other villages.</div>` : whyHTML('Moving your village needs Migration research (#90, Tech tab)')}`);
}
function centerOn(x, y) { if (!CAM) return; CAM.x = x; CAM.y = y; loadWorld(true); }

$('#v-orb').addEventListener('click', async e => {
  const t = e.target;
  if (t.dataset.login !== undefined) {
    const email = $('#lg-email').value.trim(), name = $('#lg-name').value.trim(), msg = $('#lg-msg');
    t.disabled = true; msg.textContent = 'Sending…';
    // remember which device asked: if the link is opened in another browser, this one still signs in and keeps its village
    const rid = [...crypto.getRandomValues(new Uint8Array(20))].map(b => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem('gsd_rid', rid); } catch (e) {}
    S.t = Date.now();
    const r = await api('login', { method: 'POST', body: JSON.stringify({ email, name, rid, save: S }) });
    if (r.ok) waitForClaim(rid);
    t.disabled = false;
    if (r.ok && r.devLink) { msg.innerHTML = `Dev link: <a href="${r.devLink}">${r.devLink}</a>`; return; }
    msg.textContent = r.ok ? `Check ${email} for your login link (it expires in 30 minutes).` : r.error;
    return;
  }
  if (t.dataset.logout !== undefined) { await pushSave(); await api('logout', { method: 'POST' }); ME = null; ORB = null; WLD = null; CAM = null; S.owner = null; save(); refresh(true); toast('Signed out — playing as guest on this device'); return; }
  if (t.dataset.wz) { CAM.z = Math.max(5, Math.min(40, CAM.z * (t.dataset.wz === '1' ? 1.3 : 1 / 1.3))); loadWorld(); return; }
  if (t.dataset.whome !== undefined) { centerOn(ME.x, ME.y); return; }
  if (t.closest('[data-lb]')) { lbSheet(); return; }
  if (t.dataset.lbsort) { LB_SORT = t.dataset.lbsort; sig = ''; renderOrb(true); return; }
  if (t.dataset.team) {
    const body = { action: t.dataset.team };
    if (t.dataset.team === 'create') body.name = $('#tm-name').value;
    if (t.dataset.team === 'join') body.id = +t.dataset.id;
    const r = await api('team', { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok) toast(r.error); loadOrb(); return;
  }
  const inc = t.closest('[data-incoming]');
  if (inc) { const m = WLD && WLD.marches.find(x => x.id === +inc.dataset.incoming); if (m) { const p = marchPos(m, sNow()).p; centerOn(p[0], p[1]); marchSheet(m); } window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const row = t.closest('tr[data-pl]');
  if (row) { const pl = ORB.players.find(p => p.id === +row.dataset.pl); if (pl) { centerOn(pl.x, pl.y); window.scrollTo({ top: 0, behavior: 'smooth' }); } }
});
$('#sheet').addEventListener('click', e => {
  if (!SHEET_FOR || SHEET_FOR.k !== 'lb') return;
  const so = e.target.closest('[data-lbsort]'); if (so) { LB_SORT = so.dataset.lbsort; sig = ''; renderOrb(true); lbSheet(); return; }
  const row = e.target.closest('tr[data-pl]'); if (row) { const pl = ORB.players.find(p => p.id === +row.dataset.pl); if (pl) { closeSheet(); centerOn(pl.x, pl.y); } }
});
$('#sheet').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b || !ME) return;
  if (b.dataset.crew) {
    CREW_N = Math.max(1, Math.min(W_CREW, CREW_N + +b.dataset.crew));
    if (SHEET_FOR && SHEET_FOR.k === 'wild') wildSheet(SHEET_FOR.o); else if (SHEET_FOR && SHEET_FOR.k === 'm') marchSheet(SHEET_FOR.o); return;
  }
  if (b.dataset.raid) { const v = WLD.villages.find(x => x.id === +b.dataset.raid); if (v) sendCrew('raid', v.id, 1, v.name); return; }
  if (b.dataset.gather) { const n = WLD.wild.find(x => x.id === +b.dataset.gather); if (n) sendCrew('gather', n.id, CREW_N, WILD_INFO[n.type].n); return; }
  if (b.dataset.icpt) { const m = WLD.marches.find(x => x.id === +b.dataset.icpt); if (m) sendCrew('intercept', m.id, CREW_N, m.owner_name); return; }
  if (b.dataset.move) {
    if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = 'Confirm: resources reset'; return; }
    const [x, y] = b.dataset.move.split(',').map(Number);
    const r = await api('relocate', { method: 'POST', body: JSON.stringify({ x, y }) }); if (!r.ok) return toast(r.error);
    S.res = newState().res; ME.x = r.x; ME.y = r.y; closeSheet(); save(); pushSave(); centerOn(r.x, r.y); loadOrb(); toast('Village moved — resources reset'); return;
  }
  if (b.dataset.scout) { const r = await api('scout?id=' + b.dataset.scout); const o = $('#scout-out'); if (o) o.textContent = r.ok ? `${r.workers} workers · ` + (Object.entries(r.buildings).map(([k, v]) => `${v}× ${BLD[k] ? BLD[k].n : k}`).join(', ') || 'no buildings') : r.error; return; }
  if (b.dataset.gift) { const res = readResForm('gf'); if (!res) return; const r = await api('gift', { method: 'POST', body: JSON.stringify({ to: +b.dataset.gift, res }) });
    if (!r.ok) { refundRes(res); return toast(r.error); } toast('Caravan sent'); closeSheet(); save(); pushSave(); refresh(true); }
});

// ---------------------------------------------------------------- orb upgrades (caravan, team bank, wonder, auction, events)
const TRADE_RES = ['food', 'wood', 'stone', 'iron', 'coal', 'steel', 'planks', 'gears', 'copper', 'silver', 'gold'];
let TBANK = null, EVT = null, LISTS = null;
async function loadOrbExtras() {
  const [tb, ev, ls] = await Promise.all([ME.team ? api('teambank') : null, U('events') ? api('event') : null, U('auction') ? api('listings') : null]);
  TBANK = tb && tb.ok ? tb.bank : null; EVT = ev && ev.ok ? ev : null; LISTS = ls && ls.ok ? ls.listings : null;
  if (view === 'orb') renderOrb(true);
}
function resSelect(id, list = TRADE_RES) { return `<select id="${id}-k" class="inp" style="flex:1">${list.map(k => `<option value="${k}">${k} (${Math.floor(S.res[k] || 0)})</option>`).join('')}</select><input id="${id}-n" class="inp" type="number" min="1" placeholder="amount" style="width:90px">`; }
function giftForm(pid) { return `<div class="t">Trade caravan</div><div style="display:flex;gap:6px;margin-top:4px">${resSelect('gf')}<button class="btn sm go" data-gift="${pid}">Send</button></div>`; }
// reads a resource form and takes the amount out of the village; null if not enough
function readResForm(id, take = true) {
  const k = $('#' + id + '-k').value, n = Math.floor(+$('#' + id + '-n').value || 0);
  if (n <= 0) { toast('Enter an amount'); return null; }
  if (take && (S.res[k] || 0) < n) { toast(`You only have ${Math.floor(S.res[k] || 0)} ${k}`); return null; }
  if (take) S.res[k] -= n;
  return { [k]: n };
}
function refundRes(res) { for (const [k, v] of Object.entries(res)) S.res[k] = (S.res[k] || 0) + v; }
const WONDER_PTS = { steel: 1, gears: 2, gold: 5 };
function orbExtras() {
  let h = '';
  if (INCOMING.length) h += `<div class="card" style="border-color:#ef4444"><div class="t">⚠ Raids heading for you</div>${INCOMING.map(i => `<div class="row" style="margin-top:4px"><div class="d">${esc(i.attacker)} · arrives in ${fmt(Math.max(0, (i.eta - sNow()) / 1000))}</div><button class="btn sm go" data-incoming="${i.id}">Intercept</button></div>`).join('')}</div>`;
  const myT = ME.team && ORB.teams.find(x => x.id === ME.team);
  if (myT && U('storage')) h += `<div class="card"><div class="t">Team bank</div><div class="d">${TBANK ? (Object.entries(TBANK).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(' · ') || 'Empty') : 'Loading…'}</div>
    <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">${resSelect('tb')}<button class="btn sm go" data-tb="deposit">Deposit</button><button class="btn sm alt" data-tb="withdraw">Withdraw</button></div></div>`;
  if (myT && U('wonder')) { const w = myT.wonder || 0, goal = ORB.wonderGoal || 5000;
    h += `<div class="card"><div class="t">Team Wonder ${w >= goal ? '— complete: +10% gathering for the team' : `${w}/${goal}`}</div><div class="bar"><b style="width:${Math.min(100, w / goal * 100)}%"></b></div>
    ${w < goal ? `<div class="d">Steel = 1 pt · gears = 2 · gold = 5</div><div style="display:flex;gap:6px;margin-top:6px">${resSelect('wd', Object.keys(WONDER_PTS))}<button class="btn sm go" data-wonder>Contribute</button></div>` : ''}</div>`; }
  if (U('events') && EVT) h += `<div class="card"><div class="t">Weekly world event: ${EVT.goal.toLocaleString()} ${EVT.res}</div><div class="bar"><b style="width:${Math.min(100, EVT.total / EVT.goal * 100)}%"></b></div>
    <div class="d">${EVT.total.toLocaleString()} delivered · ends in ${Math.ceil((EVT.ends - Date.now()) / 3600000)}h · reward 300 copper, 15 gold, 30 min speedup</div>
    <div style="display:flex;gap:6px;margin-top:6px">${EVT.total >= EVT.goal ? (EVT.claimed ? '<span class="small">Claimed</span>' : '<button class="btn sm go" data-evclaim>Claim reward</button>') : `<input id="ev-n" class="inp" type="number" min="1" placeholder="${EVT.res}" style="width:110px"><button class="btn sm go" data-ev>Deliver</button>`}</div></div>`;
  if (U('auction')) h += `<div class="card"><div class="t">Auction house</div>
    ${LISTS ? (LISTS.length ? LISTS.map(l => `<div class="row" style="margin-top:4px"><div class="d">${l.amt} ${l.res} for ${l.price} copper · ${esc(l.seller_name)}</div><button class="btn sm ${l.seller === ME.id ? 'alt' : ''}" data-buy="${l.id}">${l.seller === ME.id ? 'Cancel' : 'Buy'}</button></div>`).join('') : '<div class="d">No listings</div>') : '<div class="d">Loading…</div>'}
    <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">${resSelect('au', TRADE_RES.filter(k => k !== 'copper'))}<input id="au-p" class="inp" type="number" min="1" placeholder="price (copper)" style="width:110px"><button class="btn sm go" data-list>List</button></div></div>`;
  return h;
}
$('#v-orb').addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t || !ME) return;
  const done = (msg) => { if (msg) toast(msg); save(); pushSave(); loadOrb(); loadOrbExtras(); };
  if (t.dataset.tb) {
    const dep = t.dataset.tb === 'deposit', res = readResForm('tb', dep); if (!res) return;
    const r = await api('teambank', { method: 'POST', body: JSON.stringify({ action: t.dataset.tb, res }) });
    if (!r.ok) { if (dep) refundRes(res); return toast(r.error); }
    if (!dep) refundRes(res); return done(dep ? 'Deposited' : 'Withdrawn');
  }
  if (t.dataset.wonder !== undefined) {
    const res = readResForm('wd'); if (!res) return; const [k, v] = Object.entries(res)[0];
    const r = await api('wonder', { method: 'POST', body: JSON.stringify({ amt: v * WONDER_PTS[k] }) });
    if (!r.ok) { refundRes(res); return toast(r.error); }
    if (r.wonder >= r.goal) S.teamWonder = true; return done(`+${v * WONDER_PTS[k]} wonder points`);
  }
  if (t.dataset.ev !== undefined) {
    const n = Math.floor(+$('#ev-n').value || 0), k = EVT.res; if (n <= 0 || (S.res[k] || 0) < n) return toast(`You have ${Math.floor(S.res[k] || 0)} ${k}`);
    S.res[k] -= n; const r = await api('event', { method: 'POST', body: JSON.stringify({ amt: n }) });
    if (!r.ok) { S.res[k] += n; return toast(r.error); } return done(`Delivered ${n} ${k}`);
  }
  if (t.dataset.evclaim !== undefined) {
    const r = await api('event', { method: 'POST', body: JSON.stringify({ action: 'claim' }) }); if (!r.ok) return toast(r.error);
    S.res.copper += r.reward.copper; S.res.gold += r.reward.gold; S.bank = Math.min(bankCap(), S.bank + r.reward.speed); sfx('win');
    return done('Event reward: +300 copper, +15 gold, +30 min speedup');
  }
  if (t.dataset.list !== undefined) {
    const price = Math.floor(+$('#au-p').value || 0); if (price <= 0) return toast('Set a price');
    const res = readResForm('au'); if (!res) return; const [k, v] = Object.entries(res)[0];
    const r = await api('list', { method: 'POST', body: JSON.stringify({ res: k, amt: v, price }) });
    if (!r.ok) { refundRes(res); return toast(r.error); } return done('Listed');
  }
  if (t.dataset.buy) {
    const l = LISTS && LISTS.find(x => x.id === +t.dataset.buy); if (!l) return;
    const mine = l.seller === ME.id;
    if (!mine && S.res.copper < l.price) return toast(`Needs ${l.price} copper`);
    if (!mine) S.res.copper -= l.price;
    const r = await api('buy', { method: 'POST', body: JSON.stringify({ id: l.id }) });
    if (!r.ok) { if (!mine) S.res.copper += l.price; return toast(r.error); }
    S.res[r.res] = (S.res[r.res] || 0) + r.amt; return done(r.cancelled ? 'Listing cancelled' : `Bought ${r.amt} ${r.res}`);
  }
  if (t.dataset.ally) { const r = await api('ally', { method: 'POST', body: JSON.stringify({ team: +t.dataset.ally }) }); return r.ok ? done('Alliance formed') : toast(r.error); }
});
// ---------------------------------------------------------------- boot + loop
S = load();
genMap(S.seed);
S.buildings.forEach(b => { MAP.node[b.j * W + b.i] = null; });
catchUp((Date.now() - S.t) / 1000, true);
enforceSpotCap();
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
  if (view === 'orb') drawWorld(now);
  if (view === 'puzzle' && P && !P.busy) drawBoard();
  if (now - lastUI > 300) { lastUI = now; refresh(); }
  if (wall - lastSave > 5000) { lastSave = wall; save(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.addEventListener('visibilitychange', () => { if (document.hidden) { save(); pushSave(true); } });
window.addEventListener('pagehide', () => { save(); pushSave(true); });
setInterval(() => { if (ME && dirty) pushSave(); }, 15000);
setInterval(() => { if (ME && (crewsOut().length || INCOMING.length || Date.now() - lastPoll > 30000)) pollLosses(); }, 8000);
setInterval(() => { if (ME && view === 'orb') loadOrb(); }, 20000);
setInterval(() => { if (ME && view === 'orb' && !document.hidden) loadWorld(true); }, 4000);
syncLogin().then(() => { let rid = null; try { rid = localStorage.getItem('gsd_rid'); } catch (e) {} if (rid && !ME) waitForClaim(rid); });
// count guest plays (no account) so the world screen can show how many people tried it without signing in
setTimeout(() => { if (ME) return; let d; try { d = localStorage.getItem('gsd_dev'); if (!d) { d = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('gsd_dev', d); } } catch (e) { return; } api('hello', { method: 'POST', body: JSON.stringify({ device: d, level: S.level }) }); }, 8000);
