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
    for (const p of v.pl) { const sd = p[4] || 1, [sx, sy] = iso(vi + p[1] + (sd - 1) / 2, vj + p[2] + (sd - 1) / 2); if (sx > -200 && sx < vw + 200 && sy > -200 && sy < vh + 200) objs.push({ d: vi + vj + p[1] + p[2] + 2 * (sd - 1), f: () => drawPile(sx, sy, p[0], p[3], sd) }); }
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
// a neighbour's pile or storage building on this tile (what harvesters go for)
function hvTarget(x, y) {
  const v = neighbourAt(x, y); if (!v) return null;
  const li = x - v.ox, lj = y - v.oy;
  const p = v.pl.find(q => li >= q[1] && li < q[1] + (q[4] || 1) && lj >= q[2] && lj < q[2] + (q[4] || 1));
  if (p) return { v, src: 'pile', res: p[0], amt: v.pl.filter(q => q[0] === p[0]).reduce((a, q) => a + q[3], 0) };
  const b = v.b.find(q => q[1] === li && q[2] === lj && (q[0] === 'storehouse' || q[0] === 'grainstore'));
  if (b) { const list = b[0] === 'grainstore' ? ['food'] : STORE_RES; const res = list.slice().sort((a, c) => (v.st[c] | 0) - (v.st[a] | 0))[0]; return { v, src: 'store', res, amt: v.st[res] | 0, list }; }
  return null;
}
function extAt(i, j) { const [x, y] = toWorld(i, j); return !!tileInfo(x, y) || !!hvTarget(x, y); }
const taskFor = n => Object.keys(TASKS).find(k => TASKS[k].node === n && k !== 'deadwood');
function extTip(i, j) {
  const [x, y] = toWorld(i, j), hv = hvTarget(x, y);
  if (hv) return `<b>${esc(hv.v.name)}'s ${hv.src === 'pile' ? hv.res + ' pile' : 'storage'}</b> <span class="small">${hv.amt} ${hv.res}</span><br>${hv.src === 'pile' ? 'Piles give harvesters 2×' : 'Storage gives harvesters ½×'} · ${hv.v.gd.n} on guard<br><i>Click to send harvesters</i>`;
  const T = tileInfo(x, y); if (!T) return null;
  const tk = taskFor(T.n), Tk = TASKS[tk];
  return `<b>${NODE_NAME[T.n]}</b> <span class="small">${T.left} trips left</span><br>${T.kind === 'wild' ? 'Wild land — any player can harvest' : `In ${esc(T.v.name)}'s village`}<br>${Tk.n}: ${Object.entries(taskYield(tk)).map(([k, v]) => '+' + v + ' ' + k).join(', ')} + walk ${fmt(travelSecs(i, j))} each way<br><i>Click to send the closest worker</i>`;
}
function travelSecs(i, j) { return Math.min(120, Math.round(Math.hypot(i - TCI, j - TCJ) * .9)); }
let EXT_AT = null;
function extTileSheet(i, j) {
  const [x0, y0] = toWorld(i, j), hv = hvTarget(x0, y0); if (hv) return harvestSheet(i, j, hv);
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
  if (t.hv) {
    const got = Object.entries(t.loot || {}).filter(([, v]) => v > 0);
    for (const [k, v] of got) S.res[k] = (S.res[k] || 0) + v;
    if (!quiet && got.length) { toast(`${w.name} brought home ${got.map(([k, v]) => `${v} ${k}`).join(', ')} from ${t.hv.name}`); sfx('harvest'); }
    autoAssign(w); save(); return;
  }
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
  v.n = v.n || {}; v.pl = v.pl || []; v.st = v.st || {}; v.gd = v.gd || { n: 0, lvl: 0 };
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
    for (const x of m.losses || []) applyLoss(x);
    return;
  }
  if (m.t === 'snap') return addSnap(m.v);
  if (m.t === 'on') { const v = LIVE.snaps.get(m.pid); if (v) v.on = m.on; if (!m.on) LIVE.intents.delete(m.pid); return; }
  if (m.t === 'w') { const cur = LIVE.intents.get(m.pid) || {}; for (const it of m.w) { if (it.gone) delete cur[it.id]; else cur[it.id] = it; } LIVE.intents.set(m.pid, cur); return; }
  if (m.t === 'wild') { LIVE.wild.set(m.k, { u: m.u, rt: m.rt }); return; }
  if (m.t === 'claim' || m.t === 'hvr') { const c = LIVE.claims.get(m.id); if (c) { LIVE.claims.delete(m.id); c.cb(!!m.ok, m); } return; }
  if (m.t === 'loss') { for (const x of m.list) applyLoss(x); return; }
  if (m.t === 'shoo') { toast(`Your guards chased off ${m.by}'s harvester`); return; }
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
  const pl = PILES.map(p => [p.k, p.i, p.j, p.amt, p.side]), st = {}; for (const k of PILE_RES) st[k] = storedOf(k);
  const gd = { n: guards(), lvl: guardLvl() };
  const sig = JSON.stringify([b, left, S.level, pl, st, gd]);
  if (force || (sig !== LIVE.snapSig && Date.now() - LIVE.snapAt > 8000)) { LIVE.snapSig = sig; LIVE.snapAt = Date.now(); liveSend(key, { t: 'snap', seed: S.seed, b, left, n, lvl: S.level, pl, st, gd }); }
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


// ---------------------------------------------------------------- harvesting other players' piles and storage
let HV_AT = null, HV_N = 1;
function harvestOdds(v) { const H = 1 + harvStats().power, G = (v.gd.n || 0) * (1 + (v.gd.lvl || 0)); return G ? H / (G + H) : 1; }
function harvestSheet(i, j, hv) {
  HV_AT = [i, j]; const v = hv.v, st = harvStats(), tr = Math.round(travelSecs(i, j) / st.speed);
  const mine = ME && v.team && ME.team === v.team;
  const per = Math.min(hv.amt, Math.round(st.carry * (hv.src === 'pile' ? 2 : .5)));
  const sock = LIVE.socks.get(zoneKeyAt(...toWorld(i, j)));
  const why = !ME ? 'Sign in on the World tab to harvest' : mine ? 'Teammates are off limits' : !(sock && sock.open) ? 'Connecting to the live world…' : hv.amt <= 0 ? 'Nothing left to take' : '';
  openSheet(`<div class="t">${esc(v.name)}'s ${hv.src === 'pile' ? hv.res + ' pile' : 'storage'} <span class="small">· ${hv.amt} ${hv.res}</span></div>
    <div class="d">${hv.src === 'pile' ? 'Loose piles are easy pickings: harvesters load 2× their carry.' : 'Stored goods are locked up: harvesters load only ½ their carry.'} ${v.gd.n ? `${v.gd.n} worker${v.gd.n > 1 ? 's' : ''} on guard (level ${v.gd.lvl}).` : 'Nobody on guard.'}</div>
    <div class="d">Each harvester: walks ${fmt(tr)}, loads ${fmt(st.load)}, carries up to ${per} ${hv.res} · ${Math.round(harvestOdds(v) * 100)}% chance to get past the guards (your harvester level ${st.power})</div>
    <div class="row" style="justify-content:flex-start;gap:8px;margin-top:8px"><span class="small">Harvesters</span><button class="btn sm alt" data-hvn="-1">−</button><b>${HV_N}</b><button class="btn sm alt" data-hvn="1">+</button></div>
    <div style="margin-top:8px">${why ? `<span class="small">${why}</span>` : `<button class="btn go" data-hvgo="${hv.src}|${hv.res}">Send ${HV_N} harvester${HV_N > 1 ? 's' : ''}</button>`}</div>`);
}
$('#sheet').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !HV_AT) return;
  if (b.dataset.hvn) { HV_N = Math.max(1, Math.min(5, HV_N + +b.dataset.hvn)); const [x, y] = toWorld(...HV_AT), hv = hvTarget(x, y); if (hv) harvestSheet(HV_AT[0], HV_AT[1], hv); return; }
  if (!b.dataset.hvgo) return;
  const [src, res] = b.dataset.hvgo.split('|'), [i, j] = HV_AT, [x, y] = toWorld(i, j), hv = hvTarget(x, y); if (!hv) return closeSheet();
  const pool = S.workers.map((w, k) => ({ w, k })).filter(o => !(o.w.task && ['build', 'raid', 'hv', 'guard'].includes(o.w.task.kind)) && !o.w.claiming)
    .sort((a, c) => { const pa = workerPos(a.w, a.k).p, pc = workerPos(c.w, c.k).p; return Math.hypot(pa[0] - i, pa[1] - j) - Math.hypot(pc[0] - i, pc[1] - j); });
  if (!pool.length) return toast('No free AI workers — take one off a job first');
  const st = harvStats(), tr = Math.max(5, Math.round(travelSecs(i, j) / st.speed)), dur = tr * 2 + st.load;
  pool.slice(0, HV_N).forEach(({ w }) => { w.task = { kind: 'hv', dur, prog: 0, target: [i, j], ext: [x, y], tf: tr / dur, hv: { pid: hv.v.pid, name: hv.v.name, res, src, tr, sent: false } }; w.repeat = false; });
  toast(`${Math.min(HV_N, pool.length)} harvester${HV_N > 1 ? 's' : ''} heading to ${hv.v.name}'s ${src === 'pile' ? res + ' pile' : 'storage'}`);
  closeSheet(); save(); refresh(true);
});
// when a harvester reaches the target, the zone server rolls against the guards and hands over the load
setInterval(() => {
  if (!S) return;
  for (const w of S.workers) {
    const t = w.task; if (!t || t.kind !== 'hv' || t.hv.sent || t.prog < t.hv.tr) continue;
    t.hv.sent = true;
    const st = harvStats(), id = LIVE.nextClaim++, key = zoneKeyAt(t.ext[0], t.ext[1]);
    const done = r => {
      if (w.task !== t) return;
      if (r && r.ok) t.loot = { [t.hv.res]: r.amt };
      else { t.loot = {}; t.prog = Math.max(t.prog, t.dur - t.hv.tr); toast(r && r.shoo ? `${t.hv.name}'s guards chased ${w.name} off` : `${w.name} came up empty${r && r.why ? ' — ' + r.why : ''}`); }
    };
    if (!liveSend(key, { t: 'harvest', id, pid: t.hv.pid, res: t.hv.res, src: t.hv.src, hp: st.power, carry: st.carry })) { done(null); continue; }
    LIVE.claims.set(id, { key, cb: (ok, r) => done(r) });
    setTimeout(() => { const c = LIVE.claims.get(id); if (c) { LIVE.claims.delete(id); done(null); } }, 10000);
  }
}, 500);
function applyLoss(m) {
  const k = m.res; S.res[k] = Math.max(0, (S.res[k] || 0) - m.amt); save(); refresh(true);
  toast(`${m.by} harvested ${m.amt} ${k} from your ${m.src === 'pile' ? 'pile' : 'storage'}`); sfx('lose');
}

// ---------------------------------------------------------------- one map: village view ⇄ world map, crews and neighbours in the village view
// World-map units (World tab) ⇄ world tiles (Village tab). Villages snap to their Town Center tile.
const T2U = (tx, ty) => [tx / PX * 14, ty / PY * 14];
function U2T(ux, uy) {
  const gx = Math.round(ux / 14), gy = Math.round(uy / 14);
  if (Math.abs(ux - gx * 14) <= 4 && Math.abs(uy - gy * 14) <= 4) return [gx * PX, gy * PY];
  return [ux / 14 * PX, uy / 14 * PY];
}
function villageCenterTile() { const fi = (camX / (TW / 2) + camY / (TH / 2)) / 2, fj = (camY / (TH / 2) - camX / (TW / 2)) / 2; return [LIVE.OX + fi, LIVE.OY + fj]; }
function centerVillageOn(tx, ty) { const li = tx - LIVE.OX, lj = ty - LIVE.OY; camX = (li - lj) * TW / 2; camY = (li + lj) * TH / 2; }
let handoffAt = 0;
function villageToWorld() {
  if (Date.now() - handoffAt < 800) return; handoffAt = Date.now();
  const [ux, uy] = T2U(...villageCenterTile());
  CAM = CAM || { x: ux, y: uy, z: 38 }; CAM.x = ux; CAM.y = uy; CAM.z = 38;
  setView('orb'); loadWorld(true);
}
function worldToVillage(ux, uy) {
  if (Date.now() - handoffAt < 800) return; handoffAt = Date.now();
  setView('village'); ZM = .32; centerVillageOn(ux / 14 * PX, uy / 14 * PY);
}

// crews from the World tab (raids, gathers, intercepts) walking through the village view
let VMARCH = [], vmAt = 0;
async function pollVillageMarches(x0, y0, x1, y1) {
  if (!ME || Date.now() - vmAt < 4000) return; vmAt = Date.now();
  const a = T2U(x0, y0), b = T2U(x1, y1);
  const r = await api(`world?x0=${Math.floor(a[0]) - 3}&y0=${Math.floor(a[1]) - 3}&x1=${Math.ceil(b[0]) + 3}&y1=${Math.ceil(b[1]) + 3}`);
  if (r.ok) { VMARCH = r.marches; SKEW = r.now - Date.now(); }
}
function marchTilePos(m, t) {
  const F = U2T(m.fx, m.fy), T = U2T(m.tx, m.ty), lerp = (A, B, f) => [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f];
  if (m.status === 'back') {
    if (t < m.back_at) return { p: T, working: true };
    return { p: lerp(T, F, Math.min(1, Math.max(0, (t - m.back_at) / Math.max(1, m.ret - m.back_at)))), working: false };
  }
  return { p: lerp(F, T, Math.min(1, Math.max(0, (t - m.start) / Math.max(1, m.arrive - m.start)))), working: false };
}
const MARCH_HUE = c => c === '#fbbf24' ? 45 : c === '#ef4444' ? 0 : c === '#86efac' ? 130 : 210;
function marchObjects(objs, t, vw, vh) {
  const now = sNow();
  for (const m of VMARCH) {
    if (m.status === 'done') continue;
    const { p, working } = marchTilePos(m, now), [li, lj] = toLocal(p[0], p[1]);
    for (let k = 0; k < Math.min(m.crew, 5); k++) {
      const [sx, sy] = iso(li - .5 + (k % 3) * .35, lj - .5 + Math.floor(k / 3) * .35);
      if (sx < -40 || sx > vw + 40 || sy < -40 || sy > vh + 40) continue;
      const col = ME ? marchColor(m) : '#e2e8f0';
      const fw = { id: m.id * 7 + k, hue: MARCH_HUE(col), name: m.kind === 'raid' ? 'raider' : m.kind === 'gather' ? 'gatherer' : 'interceptor', owner: m.owner_name, label: `${m.kind} · ${m.target_name || ''}`, ext: true };
      objs.push({ d: li + lj - .3, f: () => { drawWorker(sx, sy, fw, t, working); if (k === 0) { mx.font = `bold ${Math.round(11 / ZM)}px system-ui`; mx.textAlign = 'center'; mx.fillStyle = col; mx.fillText(m.kind === 'raid' ? '⚔' : m.kind === 'gather' ? '⛏' : '🛡', sx, sy - 30); } } });
    }
  }
}
// arrows at the screen edge pointing to nearby villages you can't see yet
let ARROWS = [];
function knownVillages() {
  const out = new Map();
  for (const v of LIVE.snaps.values()) out.set(v.pid, { id: v.pid, name: v.name, tx: v.ox + VTCI, ty: v.oy + VTCJ, on: v.on });
  if (typeof ORB !== 'undefined' && ORB && ORB.players) for (const p of ORB.players) if (p.x != null && !out.has(p.id)) { const [tx, ty] = U2T(p.x, p.y); out.set(p.id, { id: p.id, name: p.name, tx, ty, on: p.online }); }
  if (ME) out.delete(ME.id);
  return [...out.values()];
}
function drawEdgeArrows(vw, vh) {
  ARROWS = [];
  const [cx, cy] = villageCenterTile();
  const list = knownVillages().map(v => ({ ...v, d: Math.hypot(v.tx - cx, v.ty - cy) })).sort((a, b) => a.d - b.d).slice(0, 6);
  mx.save();
  for (const v of list) {
    const [li, lj] = toLocal(v.tx, v.ty), [sx, sy] = iso(li, lj);
    if (sx > 30 && sx < vw - 30 && sy > 30 && sy < vh - 30) continue;   // on screen already
    const a = Math.atan2(sy - vh / 2, sx - vw / 2), m = 26 / ZM;
    const k = Math.min((vw / 2 - m) / Math.abs(Math.cos(a) || 1e-6), (vh / 2 - m) / Math.abs(Math.sin(a) || 1e-6));
    const ax = vw / 2 + Math.cos(a) * k, ay = vh / 2 + Math.sin(a) * k, r = 13 / ZM;
    mx.save(); mx.translate(ax, ay); mx.rotate(a);
    mx.fillStyle = v.on ? '#22c55e' : '#fbbf24'; mx.strokeStyle = '#0f1b3d'; mx.lineWidth = 2 / ZM;
    mx.beginPath(); mx.moveTo(r * 1.3, 0); mx.lineTo(-r * .6, -r * .8); mx.lineTo(-r * .6, r * .8); mx.closePath(); mx.fill(); mx.stroke(); mx.restore();
    mx.font = `bold ${Math.round(11 / ZM)}px system-ui`; mx.textAlign = 'center'; mx.lineWidth = 3 / ZM; mx.strokeStyle = 'rgba(0,0,0,.75)'; mx.fillStyle = '#fff';
    const lx = clamp(ax - Math.cos(a) * 28 / ZM, 40 / ZM, vw - 40 / ZM), ly = clamp(ay - Math.sin(a) * 22 / ZM, 14 / ZM, vh - 8 / ZM), txt = `${v.name} · ${Math.round(v.d)} tiles`;
    mx.strokeText(txt, lx, ly); mx.fillText(txt, lx, ly);
    ARROWS.push({ x: ax, y: ay, r: r * 2.2, v });
  }
  mx.restore();
}
function edgeArrowTap(px, py) {
  const a = ARROWS.find(q => Math.hypot(q.x - px, q.y - py) < q.r); if (!a) return false;
  centerVillageOn(a.v.tx, a.v.ty); ZM = Math.min(ZM, .6); toast(`${a.v.name}'s village`); return true;
}
// hook the extra layers into the village renderer
const _worldObjects = worldObjects;
worldObjects = function (objs, t, vw, vh) {
  _worldObjects(objs, t, vw, vh); marchObjects(objs, t, vw, vh);
  const [x0, y0, x1, y1] = viewTiles(vw, vh); pollVillageMarches(x0, y0, x1, y1);
};
setInterval(() => { if (ME && typeof ORB !== 'undefined' && !ORB && !orbLoading) loadOrb(); }, 15000);
