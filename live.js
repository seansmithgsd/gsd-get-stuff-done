// ---------------------------------------------------------------- live shared world
// Your device simulates your own village (game.js). This file lays your village into one continuous world:
// the land around it is shared wild land, neighbours' villages sit next door with their workers moving live,
// and the gsd-world server (Cloudflare Durable Objects) referees anything two players could both take.

// --- world layout + wild land: identical copy of world/shared.js (the server runs the same code)
const VW = 32, VH = 24, VTCI = 16, VTCJ = 12, PX = 48, PY = 40, ZONE = 4;
const plotOrigin = (gx, gy) => [gx * PX - VTCI, gy * PY - VTCJ];
const plotOf = (x, y) => [Math.floor((x + VTCI) / PX), Math.floor((y + VTCJ) / PY)];
const inPlot = (x, y, gx, gy) => { const [ox, oy] = plotOrigin(gx, gy); return x >= ox && x < ox + VW && y >= oy && y < oy + VH; };
const zoneOf = (gx, gy) => [Math.floor(gx / ZONE), Math.floor(gy / ZONE)];
function hsh(x, y, s) { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hsh(xi, yi, s), b = hsh(xi + 1, yi, s), c = hsh(xi, yi + 1, s), d = hsh(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function wildAt(x, y) {
  const r = hsh(x, y, 7), f = vnoise(x / 9, y / 9, 1), s = vnoise(x / 6, y / 6, 2);
  if (f > .62 && r < (f - .55) * 1.6) return { n: 'tree', amt: 8 + Math.floor(hsh(x, y, 8) * 12) };
  if (s > .7 && r < (s - .62) * 1.3) return { n: hsh(x, y, 9) < .06 ? 'goldrock' : 'rock', amt: 10 + Math.floor(hsh(x, y, 10) * 15) };
  if (r > .992) return { n: 'bush', amt: 4 + Math.floor(hsh(x, y, 11) * 6) };
  return null;
}
const wildGrass = (x, y) => vnoise(x / 5, y / 5, 3);
// --- end shared copy
const WILD_MEMO = new Map();
function wildAtM(x, y) {
  const cx = Math.floor(x / 16), cy = Math.floor(y / 16), key = cx + ',' + cy;
  let a = WILD_MEMO.get(key);
  if (!a) { a = []; for (let b = 0; b < 16; b++) for (let c = 0; c < 16; c++) a.push(wildAt(cx * 16 + c, cy * 16 + b)); WILD_MEMO.set(key, a); if (WILD_MEMO.size > 400) WILD_MEMO.delete(WILD_MEMO.keys().next().value); }
  return a[(y - cy * 16) * 16 + (x - cx * 16)];
}

const WORLD_URL = location.hostname === 'localhost' ? 'ws://localhost:8787' : 'wss://world.gsdconsultantsllc.com';
const LIVE = {
  home: [0, 0], OX: 0, OY: 0,
  socks: new Map(),          // "zx,zy" -> { ws, open, want, retry, tries }
  snaps: new Map(),          // pid -> neighbour village snapshot
  byPlot: new Map(),         // "gx,gy" -> snapshot
  intents: new Map(),        // pid -> { workerId: intent }
  wild: new Map(),           // "x,y" -> { u, rt }   trips taken from wild tiles
  skew: 0, ticket: null, ticketAt: 0, claims: new Map(), nextClaim: 1,
  chunks: new Map(), ver: new Map(), sentW: new Map(), snapSig: '', snapAt: 0, down: 0,
};
const sNowL = () => Date.now() + LIVE.skew;
function liveHome() {
  const gx = ME && ME.x != null ? Math.round(ME.x / 14) : 0, gy = ME && ME.y != null ? Math.round(ME.y / 14) : 0;
  if (gx !== LIVE.home[0] || gy !== LIVE.home[1]) { LIVE.chunks.clear(); }
  LIVE.home = [gx, gy]; [LIVE.OX, LIVE.OY] = plotOrigin(gx, gy);
}
const toLocal = (x, y) => [x - LIVE.OX, y - LIVE.OY];
const toWorld = (i, j) => [LIVE.OX + i, LIVE.OY + j];

// ---------------------------------------------------------------- what is on a world tile
function neighbourAt(x, y) {
  const [gx, gy] = plotOf(x, y);
  if (gx === LIVE.home[0] && gy === LIVE.home[1]) return null;
  const v = LIVE.byPlot.get(gx + ',' + gy);
  return v && inPlot(x, y, gx, gy) ? v : null;
}
const ownBlock = (x, y) => inPlot(x, y, LIVE.home[0], LIVE.home[1]);
function wildLeft(x, y, n) {
  const u = LIVE.wild.get(x + ',' + y);
  if (!u) return n.amt;
  if (u.rt && sNowL() > u.rt) return n.amt;
  return Math.max(0, n.amt - u.u);
}
// returns { kind: 'wild'|'village', n, left, v? } for a harvestable tile outside our village, else null
function tileInfo(x, y) {
  if (ownBlock(x, y)) return null;
  const v = neighbourAt(x, y);
  if (v) {
    const k = (y - v.oy) * VW + (x - v.ox), n = v.n[k], left = v.left[k] | 0;
    return n && left > 0 ? { kind: 'village', n, left, v, k } : null;
  }
  if (inPlotAny(x, y)) return null;
  const n = wildAtM(x, y); if (!n) return null;
  const left = wildLeft(x, y, n);
  return left > 0 ? { kind: 'wild', n: n.n, left, amt: n.amt } : null;
}
// an empty plot (nobody lives there) is wild land too
function inPlotAny(x, y) { const [gx, gy] = plotOf(x, y); return !!LIVE.byPlot.get(gx + ',' + gy) && inPlot(x, y, gx, gy); }

// ---------------------------------------------------------------- drawing: ground in cached chunks, resources/buildings/workers as objects
const CHK = 16;
function chunkKey(cx, cy) { return cx + ',' + cy; }
function bumpChunkAt(x, y) { const k = chunkKey(Math.floor(x / CHK), Math.floor(y / CHK)); LIVE.ver.set(k, (LIVE.ver.get(k) || 0) + 1); }
function groundColour(x, y) {
  const v = neighbourAt(x, y);
  if (v) {
    const k = (y - v.oy) * VW + (x - v.ox), g = Math.round(v.g[k] * 8) / 8, d = Math.hypot(x - v.ox - VTCI, y - v.oy - VTCJ);
    if (d < 2.2) return `hsl(36,${32 + g * 10}%,${50 + g * 6}%)`;
    return `hsl(${92 + g * 18},${46 + g * 10}%,${36 + g * 8}%)`;
  }
  const g = Math.round(wildGrass(x, y) * 6) / 6;
  return `hsl(${98 + g * 22},${38 + g * 10}%,${31 + g * 8}%)`;
}
function chunkCanvas(cx, cy) {
  const key = chunkKey(cx, cy), ver = LIVE.ver.get(key) || 0, have = LIVE.chunks.get(key);
  if (have && have.ver === ver) { LIVE.chunks.delete(key); LIVE.chunks.set(key, have); return have; }
  const ox = CHK * TW / 2 + TW / 2, oy = TH / 2 + 1, w = CHK * TW + TW, h = CHK * TH + TH + 2, LD = 1;
  const c = (have && have.c) || document.createElement('canvas'); c.width = w * LD; c.height = h * LD;
  const g = c.getContext('2d'); g.setTransform(LD, 0, 0, LD, 0, 0); g.clearRect(0, 0, w, h);
  const old = mx; mx = g;
  try {
    for (let b = 0; b < CHK; b++) for (let a = 0; a < CHK; a++) {
      const x = cx * CHK + a, y = cy * CHK + b; if (ownBlock(x, y)) continue;
      groundTile((a - b) * TW / 2 + ox, (a + b) * TH / 2 + oy, groundColour(x, y));
    }
  } finally { mx = old; }
  const out = { c, ver, ox, oy, w, h };
  LIVE.chunks.delete(key); LIVE.chunks.set(key, out);
  while (LIVE.chunks.size > 40) LIVE.chunks.delete(LIVE.chunks.keys().next().value);
  return out;
}
// world tiles currently on screen
function viewTiles(vw, vh) {
  const toTile = (px, py) => { const wx = px - vw / 2 + camX, wy = py - vh / 2 + camY; return [(wx / (TW / 2) + wy / (TH / 2)) / 2, (wy / (TH / 2) - wx / (TW / 2)) / 2]; };
  const cs = [toTile(0, 0), toTile(vw, 0), toTile(0, vh), toTile(vw, vh)];
  const is = cs.map(c => c[0]), js = cs.map(c => c[1]);
  return [Math.floor(Math.min(...is)) - 2 + LIVE.OX, Math.floor(Math.min(...js)) - 2 + LIVE.OY, Math.ceil(Math.max(...is)) + 3 + LIVE.OX, Math.ceil(Math.max(...js)) + 4 + LIVE.OY];
}
function drawWorldGround(vw, vh) {
  liveHome();
  const [x0, y0, x1, y1] = viewTiles(vw, vh), list = [];
  for (let cy = Math.floor(y0 / CHK); cy <= Math.floor(y1 / CHK); cy++) for (let cx = Math.floor(x0 / CHK); cx <= Math.floor(x1 / CHK); cx++) list.push([cx, cy]);
  list.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
  for (const [cx, cy] of list) {
    const C = chunkCanvas(cx, cy), [li, lj] = toLocal(cx * CHK, cy * CHK), [sx, sy] = iso(li, lj);
    mx.drawImage(C.c, sx - C.ox, sy - C.oy, C.w, C.h);
  }
  liveWant(x0, y0, x1, y1);
}
function stageFrom(left, amt) { const f = left / (amt || 12); return f > .66 ? 2 : f > .33 ? 1 : 0; }
function worldObjects(objs, t, vw, vh) {
  const [x0, y0, x1, y1] = viewTiles(vw, vh), now = sNowL();
  // resources on shared land and in neighbours' villages
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const T = tileInfo(x, y); if (!T) continue;
    const [li, lj] = toLocal(x, y), [sx, sy] = iso(li, lj);
    if (sx < -60 || sx > vw + 60 || sy < -20 || sy > vh + 90) continue;
    const st = T.kind === 'wild' ? stageFrom(T.left, T.amt) : (T.left >= 8 ? 2 : T.left >= 4 ? 1 : 0);
    objs.push({ d: li + lj, f: () => nodeSprite(T.n, sx, sy, hsh(x, y, 4), st) });
  }
  // neighbours: buildings, name, and their workers moving live
  for (const v of LIVE.snaps.values()) {
    const [vi, vj] = toLocal(v.ox, v.oy);
    if (v.ox + VW < x0 - 4 || v.ox > x1 + 4 || v.oy + VH < y0 - 4 || v.oy > y1 + 4) continue;
    for (const b of v.b) {
      const bi = vi + b[1], bj = vj + b[2], [sx, sy] = iso(bi, bj);
      if (sx < -120 || sx > vw + 120 || sy < -140 || sy > vh + 60) continue;
      const B = { type: b[0], i: b[1], j: b[2], done: true, id: -1 };
      objs.push({ d: bi + bj, f: () => { try { drawBuilding(B, sx, sy, t); } catch (e) {} } });
    }
    const [tx, ty] = iso(vi + VTCI, vj + VTCJ);
    objs.push({ d: vi + vj + VTCI + VTCJ + 2, f: () => {
      mx.font = `bold ${Math.round(13 / ZM)}px system-ui`; mx.textAlign = 'center'; mx.lineWidth = 3 / ZM; mx.strokeStyle = 'rgba(0,0,0,.7)';
      const label = `${v.on ? '● ' : ''}${v.name} · L${v.lvl}`; mx.strokeText(label, tx, ty - 58); mx.fillStyle = v.on ? '#bbf7d0' : '#fff'; mx.fillText(label, tx, ty - 58);
    } });
    const ws = LIVE.intents.get(v.pid); if (!ws) continue;
    const home = [vi + VTCI, vj + VTCJ];
    let k = 0;
    for (const it of Object.values(ws)) {
      const pos = intentPos(it, home, k++, now); if (!pos) continue;
      const [sx, sy] = iso(pos.p[0] - .5, pos.p[1] - .5);
      if (sx < -30 || sx > vw + 30 || sy < -40 || sy > vh + 30) continue;
      const fw = { id: it.id, hue: it.h, name: it.nm || 'AI Worker', owner: v.name, label: it.lb || '', ext: true };
      objs.push({ d: pos.p[0] + pos.p[1] - .4, f: () => drawWorker(sx, sy, fw, t, pos.working) });
    }
  }
}
// where a neighbour's worker is right now, from the trip it announced
function intentPos(it, home, k, now) {
  const hp = [home[0] + Math.cos(k * 2.1) * 1.1 + .5, home[1] + 1.3 + Math.sin(k * 2.1) * .5 + .5];
  if (it.x == null) return { p: hp, working: false };
  const tg = toLocal(it.x, it.y), tgt = [tg[0] + .5, tg[1] + .95];
  const f = (now - it.s) / Math.max(1, it.d);
  if (f >= 1 || f < 0) return { p: hp, working: false };
  const lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], go = it.tf || .2, back = it.tf || .15;
  if (it.k === 'build') return f < .1 ? { p: lerp(hp, tgt, f / .1), working: false } : { p: tgt, working: true };
  if (f < go) return { p: lerp(hp, tgt, f / go), working: false };
  if (f > 1 - back) return { p: lerp(tgt, hp, (f - 1 + back) / back), working: false };
  return { p: tgt, working: true };
}

// ---------------------------------------------------------------- tapping shared land
function extAt(i, j) { const [x, y] = toWorld(i, j); return !!tileInfo(x, y); }
const taskFor = n => Object.keys(TASKS).find(k => TASKS[k].node === n && k !== 'deadwood');
function extTip(i, j) {
  const [x, y] = toWorld(i, j), T = tileInfo(x, y); if (!T) return null;
  const tk = taskFor(T.n), Tk = TASKS[tk];
  return `<b>${NODE_NAME[T.n]}</b> <span class="small">${T.left} trips left</span><br>${T.kind === 'wild' ? 'Wild land — any player can harvest' : `In ${esc(T.v.name)}'s village`}<br>${Tk.n}: ${Object.entries(taskYield(tk)).map(([k, v]) => '+' + v + ' ' + k).join(', ')} + walk ${fmt(travelSecs(i, j))} each way<br><i>Click to send the closest worker</i>`;
}
function travelSecs(i, j) { return Math.min(120, Math.round(Math.hypot(i - TCI, j - TCJ) * .9)); }
let EXT_AT = null;
function extTileSheet(i, j) {
  const [x, y] = toWorld(i, j), T = tileInfo(x, y); if (!T) return closeSheet();
  const tk = taskFor(T.n), Tk = TASKS[tk], locked = Tk.req && !reqMet(Tk.req), tr = travelSecs(i, j);
  EXT_AT = [i, j];
  const sock = LIVE.socks.get(zoneKeyAt(x, y));
  const why = !ME ? 'Sign in on the World tab to harvest shared land' : !(sock && sock.open) ? 'Connecting to the live world…' : locked ? `Requires ${reqName(Tk.req)}` : '';
  openSheet(`<div class="t">${NODE_NAME[T.n]} <span class="small">· ${T.left} trips left</span></div>
    <div class="d">${T.kind === 'wild' ? 'Wild land — first come, first served for every player.' : `In <b>${esc(T.v.name)}</b>'s village. All land is shared: your workers can harvest it too.`}</div>
    <div class="d">${Tk.n}: ${Object.entries(taskYield(tk)).map(([k, v]) => `+${v} ${k}`).join(', ')} per trip · ${fmt(tr)} walk each way + ${fmt(taskTime({}, tk))} work</div>
    <div style="margin-top:8px">${why ? `<span class="small">${why}</span>` : '<button class="btn go" data-forage>Send closest AI worker</button>'}</div>`);
}
$('#sheet').addEventListener('click', e => {
  if (!e.target.closest('[data-forage]') || !EXT_AT) return;
  const [i, j] = EXT_AT;
  let best = null, bd = 1e9;
  S.workers.forEach((w, k) => { if (w.task && (w.task.kind === 'build' || w.task.kind === 'raid') || w.claiming) return; const p = workerPos(w, k).p, d = Math.hypot(p[0] - i, p[1] - j); if (d < bd) { bd = d; best = w; } });
  if (!best) return toast(S.workers.length ? 'All AI workers are busy building or out on crews' : 'No AI workers yet — win puzzles to recruit');
  startForage(best, i, j, true); closeSheet();
});
function startForage(w, i, j, loud) {
  const [x, y] = toWorld(i, j), T = tileInfo(x, y);
  if (!T) { if (loud) toast('Nothing left there'); w.task = null; autoAssign(w); return; }
  const tk = taskFor(T.n);
  w.claiming = true;
  liveClaim(x, y, ok => {
    w.claiming = false;
    if (!ok) { if (loud) toast(`Someone got there first — ${NODE_NAME[T.n]} is used up`); if (!w.task) autoAssign(w); refresh(true); return; }
    const tr = travelSecs(i, j), work = taskTime(w, tk), dur = work + tr * 2;
    w.task = { kind: tk, dur, prog: 0, target: [i, j], ext: [x, y], tf: tr / dur }; w.repeat = true;
    if (loud) toast(`${w.name} → ${TASKS[tk].n} (${T.kind === 'wild' ? 'wild land' : T.v.name + "'s village"})`);
    save(); refresh(true);
  });
}
// a trip out to shared land finished (game.js already paid out the gains): go again if anything is left
function liveTripDone(w, t, quiet) {
  if (quiet || !w.repeat || !ME) { autoAssign(w); return; }
  startForage(w, t.target[0], t.target[1], false);
}

// ---------------------------------------------------------------- network
const zoneKeyAt = (x, y) => { const [gx, gy] = plotOf(x, y), [zx, zy] = zoneOf(gx, gy); return zx + ',' + zy; };
let wantAt = 0;
function liveWant(x0, y0, x1, y1) {
  if (!ME || Date.now() - wantAt < 1500) return; wantAt = Date.now();
  const need = new Set([zoneOf(...LIVE.home).join(',')]);
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1], [(x0 + x1) >> 1, (y0 + y1) >> 1]]) need.add(zoneKeyAt(x, y));
  for (const k of [...need].slice(0, 4)) liveOpen(k);
  for (const [k, s] of LIVE.socks) { if (need.has(k)) s.want = Date.now(); else if (Date.now() - s.want > 60000) { s.closing = true; try { s.ws && s.ws.close(); } catch (e) {} LIVE.socks.delete(k); } }
}
async function liveTicket() {
  if (LIVE.ticket && Date.now() - LIVE.ticketAt < 10 * 3600 * 1000) return LIVE.ticket;
  const r = await api('wsticket', { method: 'POST' }); if (!r.ok) return null;
  LIVE.ticket = r.ticket; LIVE.ticketAt = Date.now(); return r.ticket;
}
function liveOpen(key) {
  let s = LIVE.socks.get(key);
  if (s && (s.ws || s.retry > Date.now())) return;
  if (!s) { s = { open: false, want: Date.now(), retry: 0, tries: 0 }; LIVE.socks.set(key, s); }
  s.ws = 'pending';
  liveTicket().then(tk => {
    if (!tk || !ME) { s.ws = null; s.retry = Date.now() + 30000; return; }
    const [zx, zy] = key.split(',');
    let ws; try { ws = new WebSocket(`${WORLD_URL}/zone/${zx}/${zy}?t=${tk}`); } catch (e) { s.ws = null; s.retry = Date.now() + 60000; return; }
    s.ws = ws;
    ws.onopen = () => { s.open = true; s.tries = 0; if (key === zoneOf(...LIVE.home).join(',')) { LIVE.snapSig = ''; LIVE.sentW.clear(); livePublish(true); } };
    ws.onmessage = e => { try { liveMsg(key, JSON.parse(e.data)); } catch (er) {} };
    ws.onclose = () => {
      s.open = false; s.ws = null;
      for (const [id, c] of LIVE.claims) if (c.key === key) { LIVE.claims.delete(id); c.cb(false); }
      if (s.closing) return;
      s.tries++; s.retry = Date.now() + Math.min(60000, 2000 * 2 ** s.tries);
      if (s.tries === 3) LIVE.ticket = null;   // maybe the ticket expired
    };
  });
}
function liveSend(key, msg) { const s = LIVE.socks.get(key); if (s && s.open && s.ws && s.ws.readyState === 1) { s.ws.send(JSON.stringify(msg)); return true; } return false; }
function liveClaim(x, y, cb) {
  const id = LIVE.nextClaim++, key = zoneKeyAt(x, y);
  if (!liveSend(key, { t: 'claim', id, x, y })) { cb(false); return; }
  LIVE.claims.set(id, { cb, key });
  setTimeout(() => { const c = LIVE.claims.get(id); if (c) { LIVE.claims.delete(id); c.cb(false); } }, 10000);
}
function addSnap(v) {
  if (ME && v.pid === ME.id) return;
  const old = LIVE.snaps.get(v.pid); if (old) LIVE.byPlot.delete(old.gx + ',' + old.gy);
  [v.ox, v.oy] = plotOrigin(v.gx, v.gy);
  const r = rng(v.seed); v.g = []; for (let k = 0; k < VW * VH; k++) v.g[k] = r();
  v.n = v.n || {};
  LIVE.snaps.set(v.pid, v); LIVE.byPlot.set(v.gx + ',' + v.gy, v);
  for (let y = v.oy; y < v.oy + VH; y += CHK / 2) for (let x = v.ox; x < v.ox + VW; x += CHK / 2) bumpChunkAt(x, y);
  bumpChunkAt(v.ox + VW - 1, v.oy + VH - 1);
}
function liveMsg(key, m) {
  if (m.t === 'hello') {
    LIVE.skew = m.now - Date.now();
    for (const v of m.snaps) addSnap(v);
    for (const [k, u, rt] of m.wild) { LIVE.wild.set(k, { u, rt }); const [x, y] = k.split(',').map(Number); bumpChunkAt(x, y); }
    for (const it of m.intents) if (!ME || it.pid !== ME.id) LIVE.intents.set(it.pid, it.w);
    return;
  }
  if (m.t === 'snap') return addSnap(m.v);
  if (m.t === 'on') { const v = LIVE.snaps.get(m.pid); if (v) v.on = m.on; if (!m.on) LIVE.intents.delete(m.pid); return; }
  if (m.t === 'w') { const cur = LIVE.intents.get(m.pid) || {}; for (const it of m.w) { if (it.gone) delete cur[it.id]; else cur[it.id] = it; } LIVE.intents.set(m.pid, cur); return; }
  if (m.t === 'wild') { LIVE.wild.set(m.k, { u: m.u, rt: m.rt }); return; }
  if (m.t === 'claim') { const c = LIVE.claims.get(m.id); if (c) { LIVE.claims.delete(m.id); c.cb(!!m.ok); } return; }
  if (m.t === 'took') {
    if (ME && m.pid === ME.id) {
      // another player harvested a trip from a resource in our village
      const k = m.k; if (!MAP.node[k]) return;
      const n = MAP.node[k], left = m.left;
      S.used = S.used || {}; S.used[k] = Math.max(S.used[k] || 0, MAP.amt[k] - left);
      if (left <= 0) { MAP.node[k] = null; (S.dep = S.dep || {})[k] = { n, t: Date.now() }; }
      layerDirty = true; save();
      if (m.by !== ME.id) toast(`${m.byName} took a trip from your ${NODE_NAME[n] || n}`);
    } else { const v = LIVE.snaps.get(m.pid); if (v) v.left[m.k] = m.left; }
  }
}
// publish: our village snapshot (when it changes) and what each worker is doing (one message per trip, batched)
function livePublish(force) {
  if (!ME) return;
  const key = zoneOf(...LIVE.home).join(','), s = LIVE.socks.get(key); if (!s || !s.open) return;
  const left = {}, n = {};
  for (let k = 0; k < W * H; k++) { const t = MAP.node[k]; if (NODES.includes(t)) { const l = Math.max(0, MAP.amt[k] - ((S.used && S.used[k]) || 0)); if (l > 0) { left[k] = l; n[k] = t; } } }
  const b = S.buildings.filter(x => x.done).map(x => [x.type, x.i, x.j]);
  const sig = JSON.stringify([b, left, S.level]);
  if (force || (sig !== LIVE.snapSig && Date.now() - LIVE.snapAt > 8000)) { LIVE.snapSig = sig; LIVE.snapAt = Date.now(); liveSend(key, { t: 'snap', seed: S.seed, b, left, n, lvl: S.level }); }
  const now = sNowL(), out = [], seen = new Set();
  S.workers.forEach(w => {
    seen.add(w.id);
    const t = w.task, onRoad = t && t.kind === 'raid';
    const it = !t || onRoad ? { id: w.id, h: w.hue, nm: w.name, x: null, s: 0, d: 0, k: onRoad ? 'raid' : 'idle' }
      : { id: w.id, h: w.hue, nm: w.name, x: t.target ? LIVE.OX + Math.round(t.target[0]) : null, y: t.target ? LIVE.OY + Math.round(t.target[1]) : null, s: Math.round(now - t.prog * 1000), d: Math.round(t.dur * 1000), k: t.kind, tf: t.tf, lb: taskLabel(t) };
    const prev = LIVE.sentW.get(w.id), sig = [it.k, it.x, it.y, it.d].join('|');
    if (!force && prev && prev.sig === sig && Math.abs(prev.s - it.s) < 3000) return;
    LIVE.sentW.set(w.id, { sig, s: it.s }); out.push(it);
  });
  for (const id of [...LIVE.sentW.keys()]) if (!seen.has(id)) { LIVE.sentW.delete(id); out.push({ id, gone: true }); }
  if (out.length) liveSend(key, { t: 'w', w: out });
}
setInterval(() => { if (ME && !document.hidden) livePublish(false); }, 2000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { for (const s of LIVE.socks.values()) if (!s.open) s.retry = 0; } });
