/* GSD: Get Stuff Done — Apartments, Barracks + soldiers, and roaming golems.
   Loaded after live.js. The world server (world/index.js) simulates golems and their fights; this file trains and heals
   soldiers on the player's own device, tells the server who is home / hunting, and draws the golems as box rigs. */
'use strict';

// ---------------------------------------------------------------- shared numbers (keep in step with world/shared.js)
const GOLEM_TYPES = ['wood', 'planks', 'stone', 'coal', 'iron', 'steel', 'gears', 'wires'];
const GOLEM_AXE = ['wood', 'planks'], GOLEM_IND = ['gears'], GOLEM_DIG = ['wires'];
const GOLEM_START = 10000, HIT_MS = 2000, SOLDIER_HP = 50, SOLDIER_HIT = 5, GOLEM_HIT = 5, SOLDIER_SPEED = 1;
const golemLoot = mx => Math.round(7500 + mx * .5);
const soldierMaxHp = lvl => Math.round(SOLDIER_HP * (1 + .1 * (lvl | 0)));
const golemPos = (g, now) => { const dx = g.tx - g.x, dy = g.ty - g.y, L = Math.hypot(dx, dy), d = Math.min(L, Math.max(0, now - g.t0) / 1000 * g.sp); return L ? [g.x + dx / L * d, g.y + dy / L * d] : [g.x, g.y]; };

const TRAIN_COST = { gold: 100, steel: 100 }, TRAIN_MS = 60000, SOLDIER_MAX_LVL = 10;
const xpNeed = lvl => 100 * (lvl + 1);
const dmgMul = s => 1 + .1 * (s.lvl || 0);

// ---------------------------------------------------------------- leveled buildings: Apartment (workers) and Barracks (soldiers)
const LEVELED = { apartment: { max: 5, per: 10, what: 'AI workers' }, barracks: { max: 5, per: 10, what: 'soldiers' } };
const soldierCap = () => S.buildings.reduce((a, b) => a + (b.done && b.type === 'barracks' ? 10 * (b.lvl || 1) : 0), 0);
const soldiers = () => S.soldiers || (S.soldiers = []);
const trainQ = () => S.trainQ || (S.trainQ = []);
function levelUpRow(b, compact) {
  const L = LEVELED[b.type], lvl = b.lvl || 1, D = BLD[b.type], up = S.workers.find(w => w.task && w.task.kind === 'build' && w.task.bid === b.id);
  if (up) return `<div class="small">Upgrading to level ${lvl + 1}…</div>`;
  if (lvl >= L.max) return `<div class="small">Max level.</div>`;
  const c = storageUpCost(b), ok = canPay(c) && free().length;
  if (compact) return `<div class="cost">${costHTML(c)} · ${fmt(D.time * (lvl + 1))}</div>`;
  return `<div class="cost">${costHTML(c)} · ${fmt(D.time * (lvl + 1))} → houses ${L.per * (lvl + 1)} ${L.what}</div>
    <div style="margin-top:6px"><button class="btn go" data-supg="${b.id}" ${ok ? '' : 'disabled'}>Upgrade to level ${lvl + 1}</button>${ok ? '' : whyHTML(!free().length ? 'Every AI worker is already building' : 'Need ' + shortBy(c).join(', '))}</div>`;
}
function levelSheet(b) {
  const L = LEVELED[b.type], lvl = b.lvl || 1;
  let h = `<div class="d">Level ${lvl}/${L.max} · houses ${L.per * lvl} ${L.what}.</div>` + levelUpRow(b);
  if (b.type === 'barracks') h += barracksHTML();
  return h;
}
function levelRows(type) {
  const L = LEVELED[type];
  return S.buildings.filter(b => b.type === type && b.done).map((b, n) => {
    const lvl = b.lvl || 1, up = S.workers.find(w => w.task && w.task.kind === 'build' && w.task.bid === b.id);
    if (up || lvl >= L.max) return `<div class="row" style="margin-top:6px"><div class="d">#${n + 1} · level ${lvl} · houses ${L.per * lvl}${up ? ' · upgrading…' : ' · max level'}</div></div>`;
    const c = storageUpCost(b), ok = canPay(c) && free().length;
    return `<div class="row" style="margin-top:6px"><div><div class="d">#${n + 1} · level ${lvl} · houses ${L.per * lvl} → ${L.per * (lvl + 1)}</div>${levelUpRow(b, true)}</div><button class="btn sm" data-supg="${b.id}" ${ok ? '' : 'disabled'}>Upgrade</button></div>`;
  }).join('');
}

// ---------------------------------------------------------------- soldiers
function soldierDmg(s, k) { const ax = GOLEM_AXE.includes(k); return SOLDIER_HIT * (1 + (ax ? U('axes') : U('picks'))) * dmgMul(s); }
function immuneFor(k) { return GOLEM_IND.includes(k) && !U('age8') ? 'Industrial Age' : GOLEM_DIG.includes(k) && !U('age9') ? 'Digital Age' : ''; }
function soldierStatus(s, now) {
  const g = s.gid && LIVE.golems.get(s.gid);
  if (s.mode === 1) return s.ready > now ? `Marching to the ${g ? g.k : ''} golem · ${fmt((s.ready - now) / 1000)}` : `Hunting the ${g ? g.k : ''} golem`;
  if (s.ready > now) return `Returning · ${fmt((s.ready - now) / 1000)}`;
  if (s.wnd) return `Wounded — healing (${fmt(soldierMaxHp(s.lvl) - s.hp)})`;
  if (s.hp < soldierMaxHp(s.lvl)) return 'Healing';
  return 'Ready in the barracks';
}
function barracksHTML() {
  const now = sNowL(), cap = soldierCap(), q = trainQ(), n = soldiers().length;
  const room = n + q.length < cap, ok = room && canPay(TRAIN_COST);
  let h = `<div class="t" style="margin-top:10px">Soldiers <span class="small">${n}/${cap} housed${q.length ? ` · ${q.length} training` : ''}</span></div>
    <div class="d">Soldiers defend your piles from golems while they're in the barracks, or hunt golems out in the wild. They eat the same food as AI workers.
    Axes: ${SOLDIER_HIT * (1 + U('axes'))} damage every 2s (Sharp Axes ${U('axes')}) · Picks: ${SOLDIER_HIT * (1 + U('picks'))} every 2s (Iron Picks ${U('picks')}).</div>`;
  if (q.length) h += `<div class="small">Next soldier ready in ${fmt((q[0].at - now) / 1000)}</div>`;
  h += `<div class="cost">${costHTML(TRAIN_COST)} · ${fmt(TRAIN_MS / 1000)}</div>
    <div style="margin-top:6px"><button class="btn go" data-train ${ok ? '' : 'disabled'}>Train a soldier</button>${ok ? '' : whyHTML(!room ? 'Barracks full — build or upgrade a Barracks' : 'Need ' + shortBy(TRAIN_COST).join(', '))}</div>`;
  for (const s of soldiers()) {
    const mh = soldierMaxHp(s.lvl), f = Math.max(0, s.hp / mh);
    h += `<div class="row" style="margin-top:6px"><div style="flex:1"><div class="d"><b>${esc(s.name)}</b> · Lv ${s.lvl || 0} · ${Math.round(s.xp || 0)}/${xpNeed(s.lvl || 0)} xp · ${soldierStatus(s, now)}</div>
      <div style="height:5px;background:rgba(0,0,0,.35);border-radius:3px;margin-top:3px"><div style="height:5px;width:${Math.round(f * 100)}%;background:${s.wnd ? '#ef4444' : '#22c55e'};border-radius:3px"></div></div></div>
      ${s.mode === 1 ? `<button class="btn sm alt" data-recall="${s.id}">Recall</button>` : ''}</div>`;
  }
  return h;
}
function addSoldier() {
  const n = (S.sNext = (S.sNext || 0) + 1);
  soldiers().push({ id: n, name: `Soldier ${n}`, hue: (n * 53) % 360, lvl: 0, xp: 0, hp: SOLDIER_HP, wnd: false, mode: 0, gid: 0, ready: 0, trip: 0 });
}
const healthy = s => s.mode === 0 && !s.wnd && s.hp >= soldierMaxHp(s.lvl) && s.ready <= sNowL();
function sendHome(s, now) { const back = s.trip || 0; s.mode = 0; s.gid = 0; s.gz = ''; s.ready = now + back; }
// per tick: training finishes, wounded heal 1 HP/s once back in the barracks
function milTick(dt) {
  if (!S) return;
  const now = simNow() + (LIVE.skew || 0), q = trainQ();
  while (q.length && q[0].at <= now && soldiers().length < soldierCap()) { q.shift(); addSoldier(); if (!SIM_BACK) { toast('A soldier finished training'); sfx('recruit'); } }
  for (const s of soldiers()) {
    const mh = soldierMaxHp(s.lvl);
    if (s.mode === 0 && s.ready <= now && s.hp < mh) { s.hp = Math.min(mh, s.hp + dt); if (s.hp >= mh) s.wnd = false; }
  }
}
const _milTick0 = tick;
tick = function (dt, quiet) { _milTick0(dt, quiet); milTick(dt); };
document.addEventListener('click', e => {
  const t = e.target.closest('[data-train],[data-recall],[data-hunt],[data-hn],[data-callall]'); if (!t || t.disabled || !S) return;
  const now = sNowL();
  if (t.dataset.train !== undefined) {
    if (soldiers().length + trainQ().length >= soldierCap() || !canPay(TRAIN_COST)) return;
    pay(TRAIN_COST); const q = trainQ(), last = q.length ? q[q.length - 1].at : now; q.push({ at: Math.max(now, last) + TRAIN_MS });
    toast('Training a soldier'); sfx('build'); save(); refresh(true);
    const b = S.buildings.find(x => x.type === 'barracks' && x.done); if (b && t.closest('#sheet')) tileSheet(b.i, b.j);
    return;
  }
  if (t.dataset.recall) { const s = soldiers().find(x => x.id === +t.dataset.recall); if (s) sendHome(s, now); save(); livePublish(true); milSync(true); const b = S.buildings.find(x => x.type === 'barracks' && x.done); if (b && t.closest('#sheet')) tileSheet(b.i, b.j); else refresh(true); return; }
  if (t.dataset.hn) { HUNT_N = Math.max(1, HUNT_N + +t.dataset.hn); const g = findGolem(t.dataset.g); if (g) golemSheet(g); return; }
  if (t.dataset.callall) { for (const s of soldiers()) if (s.mode === 1 && s.gid === t.dataset.callall) sendHome(s, now); save(); livePublish(true); const g = findGolem(t.dataset.callall); if (g) golemSheet(g); return; }
  if (t.dataset.hunt) {
    const g = findGolem(t.dataset.hunt); if (!g) return closeSheet();
    const [gx, gy] = golemPos(g, now), [hx, hy] = toWorld(TCI, TCJ);
    const trip = Math.round(Math.hypot(gx - hx, gy - hy) / SOLDIER_SPEED * 1000);   // no range limit: farther golems just take longer to reach
    const pick = soldiers().filter(healthy).slice(0, HUNT_N);
    if (!pick.length) return toast('No healthy soldiers in the barracks');
    for (const s of pick) { s.mode = 1; s.gid = g.id; s.gz = g.zone || golemZone(g); s.go = now; s.trip = trip; s.ready = now + trip; }
    toast(`${pick.length} soldier${pick.length > 1 ? 's' : ''} marching to the ${g.k} golem`); sfx('build');
    save(); livePublish(true); milSync(true); golemSheet(findGolem(g.id) || g);
  }
});
// a golem we know about: live (from a zone socket) or from the World tab map
function findGolem(id) { const g = LIVE.golems.get(id); if (g) return g; const w = typeof WLD !== 'undefined' && WLD && (WLD.golems || []).find(x => x.id === id); return w ? { ...w, dmg: w.dmg || {} } : null; }
function golemZone(g) { const [gx, gy] = plotOf(Math.floor(g.x), Math.floor(g.y)), [zx, zy] = zoneOf(gx, gy); return zx + ',' + zy; }
const homeZone = () => LIVE.home ? zoneOf(...LIVE.home).join(',') : '';
// soldiers hunting outside our home zone: keep that zone's socket open and tell it who's coming
const HUNT_SENT = new Map();
function milSync(force) {
  if (!ME || !S) return;
  const hz = homeZone(), by = new Map();
  for (const s of soldiers()) if (s.mode === 1 && s.gz && s.gz !== hz) { if (!by.has(s.gz)) by.set(s.gz, []); by.get(s.gz).push(s); }
  const tk = milSnap().tk;
  for (const [key, list] of by) {
    liveOpen(key); const sock = LIVE.socks.get(key); if (sock) sock.want = Date.now();
    const sd = list.map(sdRow), sig = JSON.stringify(sd.map(x => [x[0], x[5], x[6], x[7], Math.round(x[1] / 10)]));
    const was = HUNT_SENT.get(key);
    if (force || !was || was.sig !== sig || Date.now() - was.at > 60000) { if (liveSend(key, { t: 'hunt', sd, tk })) HUNT_SENT.set(key, { sig, at: Date.now() }); }
  }
  for (const [key] of HUNT_SENT) if (!by.has(key)) { if (liveSend(key, { t: 'hunt', sd: [], tk })) HUNT_SENT.delete(key); }
}
setInterval(() => milSync(false), 2000);

// ---------------------------------------------------------------- what the world server hears about our soldiers
const sdRow = s => [s.id, Math.round(s.hp * 10) / 10, soldierMaxHp(s.lvl), dmgMul(s), s.mode === 1 ? 1 : 0, s.mode === 1 ? s.gid : 0, s.ready || 0, s.wnd ? 1 : 0];
function milSnap() {
  const hz = homeZone();
  return {
    sd: soldiers().filter(s => !(s.mode === 1 && s.gz && s.gz !== hz)).map(sdRow),   // hunters out in other zones report to that zone instead
    tk: { ax: U('axes'), pk: U('picks'), ind: !!U('age8'), dig: !!U('age9') },
  };
}

// ---------------------------------------------------------------- messages from the world server
LIVE.golems = new Map(); LIVE.gdeath = [];
let lastBiteToast = 0, biteSum = {};
function golemList(m) {
  const now = sNowL(), seen = new Set();
  for (const a of m.list) {
    const [id, k, mass, mxm, x, y, tx, ty, t0, sp, eat, nf, dmg] = a; seen.add(id);
    const old = LIVE.golems.get(id);
    const g = { id, k, m: mass, mx: mxm, x, y, tx, ty, t0, sp, eat, nf, dmg: dmg || {}, hitAt: old && mass < old.m ? now : old ? old.hitAt : 0, born: old ? old.born : now };
    LIVE.golems.set(id, g);
  }
  // golems from this zone that are gone (killed or moved out)
  for (const [id, g] of LIVE.golems) if (!seen.has(id) && g.zone === m.zone) LIVE.golems.delete(id);
  for (const g of LIVE.golems.values()) if (seen.has(g.id)) g.zone = m.zone;
}
function golemDead(m) {
  const g = LIVE.golems.get(m.id); const now = sNowL();
  if (g) { LIVE.gdeath.push({ g, at: now, pos: golemSeen(g, now) }); LIVE.golems.delete(m.id); }
  if (S) for (const s of soldiers()) if (s.mode === 1 && s.gid === m.id) sendHome(s, now);
}
function applyMil(x) {
  const now = sNowL();
  if (x.kind === 'shp') {
    const s = soldiers().find(q => q.id === x.id); if (!s) return;
    s.hp = Math.min(s.hp, x.hp);
    if (x.wnd && !s.wnd) { s.wnd = true; s.hp = 0; if (s.mode === 1) sendHome(s, now); else s.ready = now; toast(`${s.name} was wounded and is heading back to heal`); }
    return;
  }
  if (x.kind === 'gain') {
    S.res[x.res] = (S.res[x.res] || 0) + x.amt;
    const team = soldiers().filter(s => (x.ids || []).includes(s.id)), each = team.length ? x.xp / team.length : 0;
    for (const s of team) { s.xp = (s.xp || 0) + each; while ((s.lvl || 0) < SOLDIER_MAX_LVL && s.xp >= xpNeed(s.lvl || 0)) { s.xp -= xpNeed(s.lvl || 0); s.lvl = (s.lvl || 0) + 1; s.hp = soldierMaxHp(s.lvl); toast(`${s.name} reached level ${s.lvl}`); } }
    toast(`Golem destroyed! ${x.share}% of the damage was yours: +${x.amt} ${x.res}, +${x.xp} soldier xp`); sfx('win');
    return;
  }
  if (x.kind === 'golem') {
    S.res[x.res] = Math.max(0, (S.res[x.res] || 0) - x.amt);
    biteSum[x.res] = (biteSum[x.res] || 0) + x.amt;
    if (now - lastBiteToast > 60000) { const ks = Object.keys(biteSum); toast(`${ks.length === 1 ? 'A' + (/^[aeiou]/.test(GNAME[ks[0]].toLowerCase()) ? 'n ' : ' ') + GNAME[ks[0]] + ' Golem is' : 'Golems are'} eating your piles: −${Object.entries(biteSum).map(([k, v]) => v + ' ' + k).join(', ')} — tap it to send soldiers`); sfx('lose'); lastBiteToast = now; biteSum = {}; }
  }
}
const _applyLoss0 = applyLoss;
applyLoss = function (m) { if (m && m.kind) { applyMil(m); save(); refresh(true); return; } _applyLoss0(m); };
const _liveMsg0 = liveMsg;
liveMsg = function (key, m) {
  if (m.t === 'gol') { m.zone = key; return golemList(m); }
  if (m.t === 'gdead') return golemDead(m);
  return _liveMsg0(key, m);
};

// ---------------------------------------------------------------- tapping a golem
let HUNT_N = 5;
// where we draw (and tap) a golem: one eating a pile stands in front of it, toward the viewer, so it's never hidden
const golemSeen = (g, now) => {
  const [x, y] = golemPos(g, now); if (!g.eat) return [x, y];
  // our own pile: stand just past its front corner
  if (ME && g.eat === ME.id && typeof PILES !== 'undefined') { const p = PILES.find(q => q.k === g.k); if (p) return toWorld(p.i + p.side + .3, p.j + p.side + .3); }
  return [x + 1.6, y + 1.6];
};
function golemAtWorld(x, y) {
  const now = sNowL(); let best = null, bd = 1e9;
  for (const g of LIVE.golems.values()) { const [gx, gy] = golemSeen(g, now), r = Math.max(1.3, golemScale(g) * 1.2), d = Math.hypot(gx - x, gy - y); if (d < r && d < bd) { bd = d; best = g; } }
  return best;
}
const GNAME = { wood: 'Wood', planks: 'Plank', stone: 'Stone', coal: 'Coal', iron: 'Iron', steel: 'Steel', gears: 'Gear', wires: 'Wire' };
function golemSheet(g) {
  const now = sNowL(), imm = immuneFor(g.k), ax = GOLEM_AXE.includes(g.k);
  const owner = g.eat ? (ME && g.eat === ME.id ? 'your' : ((LIVE.snaps.get(g.eat) || {}).name || 'a village') + "'s") : '';
  const tot = Object.values(g.dmg).reduce((a, b) => a + b, 0), mine = ME ? (g.dmg[ME.id] || 0) : 0;
  const top = Object.entries(g.dmg).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([pid, d]) => `${ME && +pid === ME.id ? 'You' : esc((LIVE.snaps.get(+pid) || {}).name || 'Village ' + pid)}: ${Math.round(d / (tot || 1) * 100)}%`).join(' · ');
  const ready = soldiers().filter(healthy).length, mineHunting = soldiers().filter(s => s.mode === 1 && s.gid === g.id).length;
  HUNT_N = Math.max(1, Math.min(HUNT_N, Math.max(1, ready)));
  openSheet(`<div class="t">${GNAME[g.k] || g.k} Golem <span class="small">· ${Math.round(g.m).toLocaleString()} ${g.k} (biggest ${Math.round(g.mx).toLocaleString()})</span></div>
    <div class="d">${g.eat ? `Eating ${owner} ${g.k} pile — 10 a minute, growing by half of what it eats.` : `Roaming the wilds, looking for ${g.k} piles.`} ${g.nf ? `${g.nf} soldier${g.nf > 1 ? 's' : ''} fighting it.` : ''}</div>
    <div class="d">Takes ${ax ? 'axes' : 'picks'} — your soldiers hit for ${SOLDIER_HIT * (1 + (ax ? U('axes') : U('picks')))} every 2s (${ax ? 'Sharp Axes' : 'Iron Picks'} ${ax ? U('axes') : U('picks')}).${imm ? ` <b style="color:var(--red)">Immune to you until the ${imm}.</b>` : ''}</div>
    <div class="d">Destroyed, it drops ${golemLoot(g.mx).toLocaleString()} ${g.k}, split by damage dealt (soldier xp too).${top ? ' Damage so far — ' + top : ''}${mine ? ` (yours ${Math.round(mine)})` : ''}</div>
    ${!ME ? '<div class="small" style="margin-top:8px">Sign in on the World tab to fight golems.</div>' : !soldierCap() ? '<div class="small" style="margin-top:8px">Build a Barracks (Iron Age) and train soldiers to fight golems.</div>' : `
    <div class="row" style="justify-content:flex-start;gap:8px;margin-top:8px"><span class="small">Soldiers</span><button class="btn sm alt" data-hn="-1" data-g="${g.id}">−</button><b>${HUNT_N}</b><button class="btn sm alt" data-hn="1" data-g="${g.id}">+</button><span class="small">${ready} ready</span></div>
    <div class="small" style="margin-top:6px">${(() => { const [gx, gy] = golemPos(g, now), [hx, hy] = toWorld(TCI, TCJ), d = Math.hypot(gx - hx, gy - hy); return `${Math.round(d)} tiles from your Town Center · soldiers arrive in ${fmt(d / SOLDIER_SPEED)}. Only soldiers sent out fight away from home — the barracks defends your own piles.`; })()}</div>
    <div style="margin-top:8px">${ready ? `<button class="btn go" data-hunt="${g.id}">Send ${Math.min(HUNT_N, ready)} to hunt</button>` : '<span class="small">No healthy soldiers in the barracks.</span>'}
    ${mineHunting ? ` <button class="btn alt" data-callall="${g.id}">Recall ${mineHunting}</button>` : ''}</div>`}`);
}
const _tileSheet0 = tileSheet;
tileSheet = function (i, j) { const [x, y] = toWorld(i, j), g = golemAtWorld(x, y); if (g) return golemSheet(g); return _tileSheet0(i, j); };
const _extTileSheet0 = extTileSheet;
extTileSheet = function (i, j) { const [x, y] = toWorld(i, j), g = golemAtWorld(x, y); if (g) return golemSheet(g); return _extTileSheet0(i, j); };
const _sendClosest0 = sendClosest;
sendClosest = function (i, j) { const [x, y] = toWorld(i, j); if (golemAtWorld(x, y)) return false; return _sendClosest0(i, j); };

// ---------------------------------------------------------------- drawing: golems as box rigs with moving joints
const GMAT = {
  wood:   { c: ['#b07a45', '#7a4f26', '#4a2e14'], eye: '#fde047' },
  planks: { c: ['#f0cf8f', '#c9944f', '#8a5a26'], eye: '#fde047' },
  stone:  { c: ['#cfd4d9', '#8f979e', '#5b6268'], eye: '#7dd3fc' },
  coal:   { c: ['#4b5563', '#1f2937', '#0b0f17'], eye: '#fb923c' },
  iron:   { c: ['#b6bec8', '#77818c', '#454c55'], eye: '#f87171' },
  steel:  { c: ['#f1f5f9', '#b7c3d0', '#6b7a8a'], eye: '#38bdf8' },
  gears:  { c: ['#a3a9b1', '#5f6670', '#30353c'], eye: '#facc15' },
  wires:  { c: ['#475569', '#1e293b', '#0f172a'], eye: '#22d3ee' },
};
const golemScale = g => Math.max(.6, Math.min(3, Math.cbrt(g.m / GOLEM_START)));
// one box part: front face, right side, top; drawn in a local frame that hangs down from (0,0)
function gBox(k, w, d, h, flash, tt) {
  const M = GMAT[k] || GMAT.stone, c = M.c, dx = d * .55, dy = -d * .38;
  const f0 = flash ? '#ffffff' : c[0], f1 = flash ? '#f1f5f9' : c[1], f2 = flash ? '#e2e8f0' : c[2];
  // side
  mx.fillStyle = f2; mx.beginPath(); mx.moveTo(w / 2, 0); mx.lineTo(w / 2 + dx, dy); mx.lineTo(w / 2 + dx, h + dy); mx.lineTo(w / 2, h); mx.closePath(); mx.fill();
  // top
  mx.fillStyle = f0; mx.beginPath(); mx.moveTo(-w / 2, 0); mx.lineTo(-w / 2 + dx, dy); mx.lineTo(w / 2 + dx, dy); mx.lineTo(w / 2, 0); mx.closePath(); mx.fill();
  // front
  mx.fillStyle = lg(mx, -w / 2, 0, w / 2, h, [[0, f0], [1, f1]]); mx.fillRect(-w / 2, 0, w, h);
  if (!flash) gTexture(k, w, h, tt);
  mx.strokeStyle = 'rgba(0,0,0,.35)'; mx.lineWidth = Math.max(.6, w * .04); mx.strokeRect(-w / 2, 0, w, h);
}
function gTexture(k, w, h, t) {
  mx.save(); mx.beginPath(); mx.rect(-w / 2, 0, w, h); mx.clip();
  const lw = Math.max(.6, w * .05);
  if (k === 'wood') { mx.strokeStyle = 'rgba(60,32,10,.55)'; mx.lineWidth = lw; for (let q = 1; q < 5; q++) { const x = -w / 2 + w * q / 5; mx.beginPath(); mx.moveTo(x, 0); mx.bezierCurveTo(x + w * .06, h * .3, x - w * .06, h * .6, x, h); mx.stroke(); } }
  else if (k === 'planks') { mx.strokeStyle = 'rgba(90,50,15,.55)'; mx.lineWidth = lw; for (let q = 1; q < 4; q++) { const y = h * q / 4; mx.beginPath(); mx.moveTo(-w / 2, y); mx.lineTo(w / 2, y); mx.stroke(); } mx.fillStyle = '#3f3f46'; for (let q = 0; q < 4; q++) { const y = h * (q + .5) / 4; mx.fillRect(-w * .38, y - lw / 2, lw, lw); mx.fillRect(w * .34, y - lw / 2, lw, lw); } }
  else if (k === 'stone') { mx.strokeStyle = 'rgba(40,40,45,.5)'; mx.lineWidth = lw; mx.beginPath(); mx.moveTo(-w * .3, 0); mx.lineTo(-w * .1, h * .4); mx.lineTo(-w * .25, h * .7); mx.moveTo(w * .2, h * .2); mx.lineTo(w * .05, h * .55); mx.stroke(); mx.fillStyle = 'rgba(74,222,128,.55)'; mx.beginPath(); mx.arc(w * .25, h * .8, w * .1, 0, 7); mx.arc(-w * .3, h * .2, w * .07, 0, 7); mx.fill(); }
  else if (k === 'coal') { mx.strokeStyle = `rgba(251,146,60,${.55 + .35 * Math.sin(t * 4)})`; mx.lineWidth = lw * 1.2; mx.beginPath(); mx.moveTo(-w * .35, h * .1); mx.lineTo(-w * .05, h * .45); mx.lineTo(w * .3, h * .3); mx.moveTo(-w * .05, h * .45); mx.lineTo(w * .05, h * .9); mx.stroke(); }
  else if (k === 'iron' || k === 'steel') { mx.fillStyle = k === 'iron' ? 'rgba(180,83,9,.45)' : 'rgba(255,255,255,.5)'; if (k === 'iron') { mx.beginPath(); mx.arc(-w * .2, h * .6, w * .12, 0, 7); mx.arc(w * .25, h * .25, w * .08, 0, 7); mx.fill(); } else mx.fillRect(-w * .4, h * .12, w * .12, h * .76); mx.fillStyle = 'rgba(30,41,59,.7)'; for (const [a, b] of [[-.38, .08], [.38, .08], [-.38, .92], [.38, .92]]) { mx.beginPath(); mx.arc(w * a, h * b, lw * 1.1, 0, 7); mx.fill(); } }
  else if (k === 'gears') { mx.fillStyle = 'rgba(250,204,21,.6)'; mx.beginPath(); const r = Math.min(w, h) * .3, cx = 0, cy = h * .5; for (let q = 0; q < 16; q++) { const a = q / 16 * Math.PI * 2 + t * 1.5, rr = q % 2 ? r * .7 : r; mx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } mx.closePath(); mx.fill(); mx.fillStyle = '#30353c'; mx.beginPath(); mx.arc(cx, cy, r * .3, 0, 7); mx.fill(); }
  else if (k === 'wires') { ['#f97316', '#d8dde2', '#e8b923'].forEach((c, q) => { mx.strokeStyle = c; mx.lineWidth = lw * 1.3; mx.beginPath(); for (let y = h * (.15 + q * .28); y < h; y += h * .9) { mx.moveTo(-w / 2, y); mx.bezierCurveTo(-w * .1, y + h * .12, w * .1, y - h * .12, w / 2, y + h * .05); } mx.stroke(); }); mx.fillStyle = `rgba(34,211,238,${.5 + .4 * Math.sin(t * 6)})`; mx.fillRect(-w * .1, h * .4, w * .2, w * .2); }
  mx.restore();
}
// rig: hips (root) → torso → head; shoulders → upper arm → forearm; hips → thigh → shin. Angles in radians, 0 = hanging straight down.
function drawGolem(x, y, g, t, face, dead) {
  const s = golemScale(g), u = 15 * s, now = sNowL(), moving = !g.eat && Math.hypot(g.tx - g.x, g.ty - g.y) > .05 && (now - g.t0) / 1000 * g.sp < Math.hypot(g.tx - g.x, g.ty - g.y);
  const flash = now - (g.hitAt || 0) < 110, fight = g.nf > 0, ph = t * (moving ? 5 : 2) + (g.id.length * 1.7);
  let bob = 0, legA = [0, 0], shinA = [0, 0], armA = [0, 0], foreA = [0, 0], crouch = 0;
  if (moving) { const sw = Math.sin(ph); legA = [sw * .5, -sw * .5]; shinA = [Math.max(0, -sw) * .5, Math.max(0, sw) * .5]; armA = [-sw * .45, sw * .45]; foreA = [-.25, -.25]; bob = Math.abs(Math.sin(ph)) * 2 * s; }
  else if (fight) { const p = (t % 2) / 2, slam = p < .7 ? -2.7 * (p / .7) : -2.7 + 2.3 * ((p - .7) / .3); armA = [slam, slam + .25]; foreA = [-.3, -.3]; legA = [-.25, .25]; }
  else if (g.eat) { crouch = 1; const sc = Math.sin(t * 3); armA = [-1.3 - .9 * Math.max(0, sc), -1.3 - .9 * Math.max(0, -sc)]; foreA = [-1.2 * Math.max(0, sc), -1.2 * Math.max(0, -sc)]; legA = [-.55, -.55]; shinA = [.95, .95]; }
  else { armA = [Math.sin(t * 1.4) * .08, -Math.sin(t * 1.4) * .08]; bob = Math.sin(t * 1.6) * .8 * s; }
  const thigh = 1.0 * u, shin = 1.0 * u, legY = -(thigh + shin) + crouch * .55 * u;
  mx.save(); mx.translate(x, y); if (face < 0) mx.scale(-1, 1);
  if (dead) { mx.globalAlpha = Math.max(0, 1 - dead.f); }
  // shadow
  mx.fillStyle = 'rgba(0,0,0,.3)'; mx.beginPath(); mx.ellipse(u * .3, 2, u * 1.6, u * .55, 0, 0, 7); mx.fill();
  const hipY = legY - bob;
  const part = (px, py, a, w, d, h, ch, extra) => {
    mx.save(); mx.translate(px, py); if (dead) { const v = dead.v[ch] || [0, 0, 0]; mx.translate(v[0] * dead.f * u * 3, v[1] * dead.f * u * 3 + dead.f * dead.f * u * 6); mx.rotate(v[2] * dead.f * 3); }
    mx.rotate(a); gBox(g.k, w, d, h, flash, t); if (extra) extra(); mx.restore();
  };
  const leg = (side, sgn) => part(sgn * .35 * u, hipY, legA[side], .55 * u, .55 * u, thigh, 'th' + side, () => { mx.translate(0, thigh); mx.rotate(shinA[side]); gBox(g.k, .62 * u, .65 * u, shin, flash, t); });
  const arm = (side, sgn) => part(sgn * .95 * u, hipY - 1.45 * u, armA[side], .5 * u, .5 * u, .95 * u, 'ar' + side, () => { mx.translate(0, .95 * u); mx.rotate(foreA[side]); gBox(g.k, .62 * u, .62 * u, .9 * u, flash, t); });
  // back limbs darker
  mx.globalAlpha *= .8; leg(1, -1); arm(1, -1); mx.globalAlpha = dead ? Math.max(0, 1 - dead.f) : 1;
  part(0, hipY - .35 * u, 0, 1.25 * u, .9 * u, .45 * u, 'hip');                 // hips
  part(0, hipY - 1.7 * u, 0, 1.55 * u, 1.05 * u, 1.4 * u, 'tor');               // torso
  part(0, hipY - 2.45 * u, Math.sin(t * 1.3) * .05, .85 * u, .8 * u, .72 * u, 'hd', () => {   // head + eyes
    if (dead) return; const M = GMAT[g.k] || GMAT.stone; mx.fillStyle = M.eye; mx.shadowColor = M.eye; mx.shadowBlur = 6 * s;
    mx.fillRect(-.28 * u, .28 * u, .16 * u, .12 * u); mx.fillRect(.1 * u, .28 * u, .16 * u, .12 * u); mx.shadowBlur = 0;
  });
  leg(0, 1); arm(0, 1);
  mx.restore();
  // chips flying off when hit; crumbs while eating
  if (flash || (g.eat && Math.random() < .3)) { const c = (GMAT[g.k] || GMAT.stone).c[1]; mx.fillStyle = c; for (let q = 0; q < 4; q++) { const a = Math.random() * 6.28, r = u * (.5 + Math.random()); mx.fillRect(x + Math.cos(a) * r, y - 2 * u + Math.sin(a) * r * .6, 2 + s, 2 + s); } }
  if (!dead) {
    const f = Math.max(0, Math.min(1, g.m / Math.max(1, g.mx))), top = y + legY - 3.4 * u - 10;   // above the head
    mx.font = `bold ${Math.round(11 / Math.min(1, ZM) )}px system-ui`; mx.textAlign = 'center'; mx.lineWidth = 3 / ZM; mx.strokeStyle = 'rgba(0,0,0,.75)';
    const label = `${GNAME[g.k] || g.k} Golem · ${g.m >= 1000 ? (g.m / 1000).toFixed(1) + 'k' : Math.round(g.m)}`;
    mx.strokeText(label, x, top - 6); mx.fillStyle = immuneFor(g.k) ? '#fca5a5' : '#fde68a'; mx.fillText(label, x, top - 6);
    if (fight || f < 1) { mx.fillStyle = 'rgba(0,0,0,.55)'; mx.fillRect(x - 22, top - 2, 44, 5); mx.fillStyle = '#ef4444'; mx.fillRect(x - 22, top - 2, 44 * f, 5); }
  }
}
// a soldier: worker body, red tunic, helmet, axe or pick
function drawSoldier(x, y, hue, t, swing, axe) {
  const bob = swing ? Math.abs(Math.sin(t * 6 + hue)) * 2 : 0;
  mx.fillStyle = 'rgba(0,0,0,.28)'; mx.beginPath(); mx.ellipse(x + 2, y, 7, 3, 0, 0, 7); mx.fill();
  mx.fillStyle = lg(mx, x - 5, 0, x + 5, 0, [[0, '#f87171'], [1, '#7f1d1d']]); mx.beginPath(); mx.roundRect(x - 5, y - 15 - bob, 10, 12, 3); mx.fill();
  mx.fillStyle = rg(mx, x - 1, y - 20 - bob, 5, '#f8dcc0', '#e8c39a', '#b8875a'); mx.beginPath(); mx.arc(x, y - 19 - bob, 4.5, 0, 7); mx.fill();
  mx.fillStyle = '#94a3b8'; mx.beginPath(); mx.arc(x, y - 20.5 - bob, 4.8, Math.PI, 0); mx.fill();
  const a = swing ? -1.2 + Math.sin(t * 7 + hue) * 1.1 : -.3;
  mx.save(); mx.translate(x + 4, y - 11 - bob); mx.rotate(a); mx.strokeStyle = '#6b4220'; mx.lineWidth = 2; mx.beginPath(); mx.moveTo(0, 0); mx.lineTo(0, -12); mx.stroke();
  mx.fillStyle = '#cbd5e1'; if (axe) { mx.beginPath(); mx.moveTo(0, -12); mx.lineTo(5, -14); mx.lineTo(5, -8); mx.lineTo(0, -9); mx.fill(); } else { mx.fillRect(-5, -13, 10, 2); }
  mx.restore();
}
let TOP = [];
function drawTopObjs() { TOP.sort((a, b) => a.d - b.d).forEach(o => o.f()); TOP = []; }
function golemObjects(objs, t, vw, vh) {
  const now = sNowL(); TOP = [];
  for (const g of LIVE.golems.values()) {
    const [gx, gy] = golemSeen(g, now), [li, lj] = toLocal(gx, gy), [sx, sy] = iso(li, lj);
    if (sx < -250 || sx > vw + 250 || sy < -60 || sy > vh + 350) continue;
    const ex = iso(...toLocal(g.tx, g.ty))[0], face = g.eat || g.nf ? 1 : (ex < sx - 1 ? -1 : 1);
    TOP.push({ d: li + lj, f: () => drawGolem(sx, sy, g, t, face) });   // drawn after everything: piles, trees and buildings never hide a golem
    // soldiers fighting it, in a ring
    const n = Math.min(12, g.nf || 0), s = golemScale(g), ax = GOLEM_AXE.includes(g.k);
    for (let q = 0; q < n; q++) {
      const a = q / Math.max(1, n) * Math.PI * 2 + .4, r = 1 + s * .6, pi = li + Math.cos(a) * r, pj = lj + Math.sin(a) * r * .8, [qx, qy] = iso(pi, pj);
      TOP.push({ d: pi + pj, f: () => drawSoldier(qx, qy, q * 37, t, true, ax) });
    }
  }
  // our own soldiers on the road (out to a golem, or back home)
  if (S && LIVE.golems) for (const s of soldiers()) {
    let p = null;
    if (s.mode === 1 && s.ready > now) { const g = LIVE.golems.get(s.gid); if (!g) continue; const [gx, gy] = golemSeen(g, now), [hx, hy] = toWorld(TCI, TCJ), f = 1 - (s.ready - now) / Math.max(1, s.trip); p = [hx + (gx - hx) * f, hy + (gy - hy) * f]; }
    else if (s.mode === 0 && s.ready > now && s.trip) { const [hx, hy] = toWorld(TCI, TCJ), f = (s.ready - now) / Math.max(1, s.trip); p = [hx + 6 * f, hy + 6 * f]; }
    if (!p) continue;
    const [li, lj] = toLocal(...p), [qx, qy] = iso(li, lj);
    if (qx < -30 || qx > vw + 30 || qy < -40 || qy > vh + 30) continue;
    objs.push({ d: li + lj, f: () => drawSoldier(qx, qy, s.hue, t, false, true) });
  }
  // death: the rig comes apart and crumbles
  LIVE.gdeath = LIVE.gdeath.filter(d => now - d.at < 2600);
  for (const d of LIVE.gdeath) {
    if (!d.v) { d.v = {}; for (const k of ['th0', 'th1', 'ar0', 'ar1', 'hip', 'tor', 'hd']) d.v[k] = [(Math.random() - .5) * 2, -Math.random() * 1.5, (Math.random() - .5) * 2]; }
    const [li, lj] = toLocal(...d.pos), [sx, sy] = iso(li, lj), f = (now - d.at) / 2600;
    TOP.push({ d: li + lj, f: () => { drawGolem(sx, sy, d.g, t, 1, { f, v: d.v }); if (f > .4) drawPile(sx, sy + 4, d.g.k, 400 * (f - .4), 1); } });
  }
}
const _worldObjectsMil = worldObjects;
worldObjects = function (objs, t, vw, vh) { _worldObjectsMil(objs, t, vw, vh); golemObjects(objs, t, vw, vh); };

// the barracks sheet keeps its timers fresh while it's open
setInterval(() => {
  const sh = $('#sheet'); if (!S || sh.hidden) return;
  if (sh.querySelector('[data-train]')) { const b = S.buildings.find(x => x.type === 'barracks' && x.done); if (b && (trainQ().length || soldiers().some(s => s.mode === 1 || s.ready > sNowL() || s.hp < soldierMaxHp(s.lvl)))) tileSheet(b.i, b.j); }
}, 1000);

// ---------------------------------------------------------------- World tab map: a little golem icon (body, head, arms), sized by mass
function drawWorldGolem(g, gm, x, y, z, t) {
  const M = GMAT[gm.k] || GMAT.stone, s = Math.max(.6, Math.min(3, Math.cbrt(gm.m / GOLEM_START))), u = Math.max(5, z * .45) * s;
  const p = golemPos(gm, sNow()), walking = Math.hypot(gm.tx - p[0], gm.ty - p[1]) > .05 && !gm.eat, sw = walking ? Math.sin(t / 160) * .35 : 0;
  g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(x + 1, y + u * 1.3, u * 1.1, u * .4, 0, 0, 7); g.fill();
  const box = (bx, by, w, h, a) => { g.save(); g.translate(bx, by); g.rotate(a || 0); g.fillStyle = M.c[2]; g.fillRect(-w / 2 + w * .18, -h * .12, w, h); g.fillStyle = M.c[1]; g.fillRect(-w / 2, 0, w, h); g.fillStyle = M.c[0]; g.fillRect(-w / 2, 0, w, h * .25); g.restore(); };
  box(x - u * .35, y + u * .3, u * .45, u * .95, sw); box(x + u * .35, y + u * .3, u * .45, u * .95, -sw);          // legs
  box(x - u * .95, y - u * .75, u * .4, u * 1.05, -sw * 1.2); box(x + u * .95, y - u * .75, u * .4, u * 1.05, sw * 1.2); // arms
  box(x, y - u * .85, u * 1.5, u * 1.25); box(x, y - u * 1.55, u * .8, u * .7);                                       // torso, head
  g.fillStyle = M.eye; g.fillRect(x - u * .25, y - u * 1.3, u * .16, u * .12); g.fillRect(x + u * .09, y - u * 1.3, u * .16, u * .12);
  if (gm.nf) { g.fillStyle = '#ef4444'; g.font = `bold ${Math.max(9, u * .9)}px system-ui`; g.textAlign = 'center'; g.fillText('⚔', x + u * 1.5, y - u * 1.4); }
  if (z >= 9) { g.font = `bold ${Math.max(10, Math.min(12, z * .55))}px system-ui`; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.7)';
    const label = `${GNAME[gm.k] || gm.k} Golem ${gm.m >= 1000 ? (gm.m / 1000).toFixed(1) + 'k' : Math.round(gm.m)}`; g.strokeText(label, x, y + u * 1.9 + 10); g.fillStyle = immuneFor(gm.k) ? '#fca5a5' : '#fde68a'; g.fillText(label, x, y + u * 1.9 + 10); }
  return u * 1.6;
}

// ---------------------------------------------------------------- Soldiers tab (same layout as the AI Workers tab)
function soldierGroups(now) {
  const G = { ready: [], train: trainQ(), march: [], hunt: [], back: [], heal: [] };
  for (const s of soldiers()) {
    if (s.mode === 1) (s.ready > now ? G.march : G.hunt).push(s);
    else if (s.ready > now) G.back.push(s);
    else if (s.wnd || s.hp < soldierMaxHp(s.lvl)) G.heal.push(s);
    else G.ready.push(s);
  }
  return G;
}
let soldierSig = '';
function renderSoldiers(force) {
  const el = $('#v-soldiers'); if (!el || !S) return;
  const now = sNowL(), G = soldierGroups(now), cap = soldierCap(), q = trainQ();
  const room = soldiers().length + q.length < cap, canTrain = room && canPay(TRAIN_COST);
  const sg = JSON.stringify([soldiers().map(s => [s.id, s.mode, s.gid, s.lvl, Math.round(s.xp || 0), Math.round(s.hp), s.wnd, Math.round((s.ready - now) / 1000)]), q.map(x => Math.round((x.at - now) / 1000)), cap, canTrain, U('axes'), U('picks'), U('age8'), U('age9'), [...LIVE.golems.keys()].join()]);
  if (!force && sg === soldierSig) return; soldierSig = sg;
  const nextTrain = q.length ? fmt(Math.max(0, (q[0].at - now) / 1000)) : '';
  const huntTargets = new Map(); for (const s of [...G.march, ...G.hunt]) huntTargets.set(s.gid, (huntTargets.get(s.gid) || 0) + 1);
  let h = `<h2>Soldiers <span class="small">${soldiers().length}/${cap} housed${q.length ? ` · ${q.length} training` : ''}</span></h2>`;
  if (!cap) h += `<div class="card"><div class="t">Build a Barracks to train soldiers</div><div class="d">Barracks unlock in the Iron Age. Each one houses 10 soldiers per level (up to level 5). Soldiers defend your piles from golems and can hunt golems anywhere on the map.</div><div style="margin-top:6px"><button class="btn go" data-go="build">Build tab</button></div></div>`;
  if (starving()) h += `<div class="card"><div class="t" style="color:var(--red)">No food — soldiers eat the same food as AI workers</div></div>`;
  const tile = (k, n, c, sub, btns, alert) => `<div class="wt status${alert ? ' alert' : ''}"><canvas data-si="${k}" width="${44 * DPR}" height="${44 * DPR}"></canvas><div class="wn">${n}</div><div class="wc">${c}</div><div class="wr">${sub}</div>${btns ? `<div class="wb">${btns}</div>` : ''}</div>`;
  h += '<div class="wgrid">';
  h += tile('ready', 'Ready', G.ready.length, 'In the barracks · defending your piles', `<button class="btn sm" data-train ${canTrain ? '' : 'disabled'} title="Train a soldier: 100 gold, 100 steel, 60s">+ Train</button>`);
  h += tile('train', 'Training', q.length, q.length ? `Next in ${nextTrain}` : (cap ? (room ? '100 gold · 100 steel · 60s' : 'Barracks full') : 'Needs a Barracks'), '');
  h += tile('march', 'Marching', G.march.length, G.march.length ? 'On the road to a golem' : '—', '');
  h += tile('hunt', 'Hunting', G.hunt.length, G.hunt.length ? 'Fighting a golem' : 'Tap a golem to send some', G.march.length + G.hunt.length ? `<button class="btn sm alt" data-recallall>Recall all</button>` : '');
  h += tile('back', 'Returning', G.back.length, G.back.length ? 'Walking home' : '—', '');
  h += tile('heal', 'Healing', G.heal.length, G.heal.length ? '1 HP a second in the barracks' : 'Nobody hurt', '', G.heal.some(s => s.wnd));
  h += '</div>';
  if (!canTrain && cap) h += whyHTML(!room ? 'Barracks full — build or upgrade a Barracks' : 'Need ' + shortBy(TRAIN_COST).join(', '));
  // weapons
  const imm = [U('age8') ? '' : 'Gear golems until the Industrial Age', U('age9') ? '' : 'Wire golems until the Digital Age'].filter(Boolean);
  h += `<div class="card"><div class="t">Weapons</div><div class="d">Axes (Wood, Plank golems): <b>${SOLDIER_HIT * (1 + U('axes'))}</b> damage every 2s — Sharp Axes ${U('axes')}.<br>Picks (Stone, Coal, Iron, Steel, Gear, Wire golems): <b>${SOLDIER_HIT * (1 + U('picks'))}</b> damage every 2s — Iron Picks ${U('picks')}.<br>Each soldier level adds +10% damage and HP.${imm.length ? `<br><span style="color:var(--red)">Immune to you: ${imm.join('; ')}.</span>` : ''}</div></div>`;
  // golems: ours to hunt, nearest first
  const [hx, hy] = toWorld(TCI, TCJ), seen = new Map();
  for (const g of LIVE.golems.values()) seen.set(g.id, g);
  if (typeof WLD !== 'undefined' && WLD) for (const g of WLD.golems || []) if (!seen.has(g.id)) seen.set(g.id, { ...g, dmg: {} });
  const gl = [...seen.values()].map(g => { const [x, y] = golemPos(g, now); return { g, d: Math.hypot(x - hx, y - hy) }; }).sort((a, b) => a.d - b.d).slice(0, 12);
  h += `<h3>Golems</h3>`;
  if (!gl.length) h += `<div class="card"><div class="d">No golems spotted yet. They show up in the village view and on the World tab map.</div></div>`;
  for (const { g, d } of gl) {
    const n = huntTargets.get(g.id) || 0, im = immuneFor(g.k);
    h += `<div class="card"><div class="row"><div><div class="t">${GNAME[g.k] || g.k} Golem <span class="small">· ${Math.round(g.m).toLocaleString()} ${g.k}</span></div>
      <div class="d">${Math.round(d)} tiles away · march ${fmt(d / SOLDIER_SPEED)}${g.eat ? ` · eating ${ME && g.eat === ME.id ? 'your' : 'a'} pile` : ''}${g.nf ? ` · ${g.nf} fighting` : ''}${n ? ` · <b>${n} of yours sent</b>` : ''}${im ? ` · <span style="color:var(--red)">immune until ${im}</span>` : ''}</div></div>
      <button class="btn sm" data-gview="${g.id}">${n ? 'Manage' : 'Send'}</button></div></div>`;
  }
  // roster
  h += `<h3>Roster</h3>`;
  if (!soldiers().length) h += `<div class="card"><div class="d">${cap ? 'No soldiers yet — tap + Train.' : 'No soldiers yet.'}</div></div>`;
  for (const s of [...soldiers()].sort((a, b) => (b.lvl || 0) - (a.lvl || 0) || a.id - b.id)) {
    const mh = soldierMaxHp(s.lvl), f = Math.max(0, s.hp / mh), xf = Math.min(1, (s.xp || 0) / xpNeed(s.lvl || 0));
    h += `<div class="card"><div class="row"><div style="flex:1"><div class="t">${esc(s.name)} <span class="small">· Lv ${s.lvl || 0} · ${Math.round(s.hp)}/${mh} HP · +${Math.round((dmgMul(s) - 1) * 100)}% damage</span></div>
      <div class="d">${soldierStatus(s, now)}</div>
      <div style="height:5px;background:rgba(0,0,0,.12);border-radius:3px;margin-top:4px"><div style="height:5px;width:${Math.round(f * 100)}%;background:${s.wnd ? '#ef4444' : '#22c55e'};border-radius:3px"></div></div>
      <div style="height:4px;background:rgba(0,0,0,.08);border-radius:3px;margin-top:3px"><div style="height:4px;width:${Math.round(xf * 100)}%;background:#60a5fa;border-radius:3px"></div></div>
      <div class="small">${Math.round(s.xp || 0)}/${xpNeed(s.lvl || 0)} xp to level ${(s.lvl || 0) + 1}</div></div>
      ${s.mode === 1 ? `<button class="btn sm alt" data-recall="${s.id}">Recall</button>` : ''}</div></div>`;
  }
  el.innerHTML = h;
  el.querySelectorAll('canvas[data-si]').forEach(c => {
    const x = c.getContext('2d'); x.setTransform(DPR, 0, 0, DPR, 0, 0); x.clearRect(0, 0, 44, 44);
    const k = c.dataset.si, old = mx; mx = x; x.translate(22, 43); x.scale(1.35, 1.35); x.translate(-22, -40);
    try {
      if (k === 'train') { drawSoldier(22, 38, 200, 0, false, false); x.fillStyle = "#e8b923"; x.beginPath(); x.arc(33, 15, 5, 0, 7); x.fill(); }
      else if (k === 'heal') { drawSoldier(22, 38, 90, 0, false, true); x.fillStyle = '#ef4444'; x.fillRect(30, 13, 9, 3); x.fillRect(33, 10, 3, 9); }
      else drawSoldier(22, 38, k.length * 40, k === 'hunt' ? 1.1 : 0, k === 'hunt', k !== 'ready');
    } finally { mx = old; }
  });
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-gview],[data-recallall],#v-soldiers [data-go]'); if (!t || !S) return;
  if (t.dataset.go) return setView(t.dataset.go);
  if (t.dataset.gview) { const g = findGolem(t.dataset.gview); if (g) golemSheet(g); return; }
  if (t.dataset.recallall !== undefined) { const now = sNowL(); for (const s of soldiers()) if (s.mode === 1) sendHome(s, now); save(); livePublish(true); milSync(true); renderSoldiers(true); }
});
const _refreshMil = refresh;
refresh = function (force) { _refreshMil(force); if (view === 'soldiers') renderSoldiers(force); };
setInterval(() => { if (S && view === 'soldiers' && $('#sheet').hidden) renderSoldiers(false); }, 1000);
