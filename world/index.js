// gsd-world: real-time referee for the shared world map.
// One Zone Durable Object per 4x4 block of village plots. Players' devices simulate their own villages;
// the zone only relays what workers are doing, keeps each village's last snapshot for offline viewing,
// and decides who gets a shared tree / rock first. WebSocket Hibernation keeps idle zones free.
import { DurableObject } from 'cloudflare:workers';
import { VW, PX, PY, ZONE, plotOrigin, plotOf, inPlot, zoneOf, wildAt, REGROW_MS, GOLEM_TYPES, GOLEM_AXE, GOLEM_IND, GOLEM_DIG, GOLEM_START, GOLEM_EAT, GOLEM_GROW, GOLEM_SPEED, GOLEM_HIT, HIT_MS, SOLDIER_HIT, golemLoot, golemXp, golemPos } from './shared.js';

const TICK_MS = 10000, SPAWN_GAP = 10 * 60 * 1000, CATCHUP_MS = 3600 * 1000;

const TICKET_MS = 12 * 3600 * 1000, MAX_MSG = 24000;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/zone\/(-?\d+)\/(-?\d+)$/);
    if (!m) return new Response('gsd-world', { status: 200 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
    // sign-in: the game site hands out short tickets stored in the shared D1 database
    const tk = url.searchParams.get('t') || '';
    const row = tk ? await env.DB.prepare('SELECT t.player, t.created, p.name, p.wx, p.wy, p.team FROM ws_tickets t JOIN players p ON p.id = t.player WHERE t.token = ?').bind(tk).first() : null;
    if (!row || Date.now() - row.created > TICKET_MS) return new Response('bad ticket', { status: 401 });
    const [gx, gy] = [Math.round(row.wx / 14), Math.round(row.wy / 14)];
    const zone = env.ZONE.getByName(`${m[1]},${m[2]}`);
    const h = new Headers(req.headers);
    h.set('x-who', JSON.stringify({ pid: row.player, name: row.name, gx, gy, team: row.team || 0, zx: +m[1], zy: +m[2] }));
    return zone.fetch(new Request(req.url, { headers: h }));
  },
};

export class Zone extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => { this._z = (await ctx.storage.get('z')) || null; });
    this.intents = new Map();   // pid -> latest worker intents (memory only; resent each trip)
  }
  async fetch(req) {
    const who = JSON.parse(req.headers.get('x-who'));
    if (!this._z) { this._z = [who.zx, who.zy]; await this.ctx.storage.put('z', this._z); }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment(who);
    // everything a newcomer needs: every village snapshot in the zone, what's been taken from the wilds, live workers
    const snaps = [...(await this.ctx.storage.list({ prefix: 'v:' })).values()];
    const wild = [...(await this.ctx.storage.list({ prefix: 'w:' })).entries()].map(([k, v]) => [k.slice(2), v.u, v.t]);
    const online = new Set(this.ctx.getWebSockets().map(ws => ws.deserializeAttachment()?.pid));
    // harvests that happened while this player was offline
    const losses = (await this.ctx.storage.get('loss:' + who.pid)) || [];
    if (losses.length) await this.ctx.storage.delete('loss:' + who.pid);
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 1000);
    const gl = (await this.ctx.storage.get('gl')) || [];
    pair[1].send(JSON.stringify({ t: 'gol', now: Date.now(), list: gl.map(gPub) }));
    pair[1].send(JSON.stringify({ t: 'hello', now: Date.now(), snaps: snaps.map(s => ({ ...s, on: online.has(s.pid) })), wild, intents: [...this.intents.values()], losses }));
    this.broadcast({ t: 'on', pid: who.pid, on: true }, pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  broadcast(msg, except) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) if (ws !== except) { try { ws.send(s); } catch (e) {} }
  }
  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MSG) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const who = ws.deserializeAttachment(); if (!who) return;
    const now = Date.now();
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong', now }));
    const home = zoneOf(who.gx, who.gy), mine = home[0] === who.zx && home[1] === who.zy;
    // village snapshot: buildings + how much is left on each resource (only into your own zone)
    if (m.t === 'snap' && mine) {
      const v = { pid: who.pid, name: who.name, team: who.team, gx: who.gx, gy: who.gy, seed: m.seed | 0, b: Array.isArray(m.b) ? m.b.slice(0, 400) : [], left: m.left && typeof m.left === 'object' ? m.left : {}, n: m.n && typeof m.n === 'object' ? m.n : {}, pl: Array.isArray(m.pl) ? m.pl.slice(0, 120) : [], st: m.st && typeof m.st === 'object' ? m.st : {}, gd: m.gd && typeof m.gd === 'object' ? { n: m.gd.n | 0, lvl: m.gd.lvl | 0 } : { n: 0, lvl: 0 }, lvl: m.lvl | 0, at: now,
        sd: Array.isArray(m.sd) ? m.sd.slice(0, 260).map(cleanSd) : [], tk: m.tk && typeof m.tk === 'object' ? { ax: m.tk.ax | 0, pk: m.tk.pk | 0, ind: !!m.tk.ind, dig: !!m.tk.dig } : { ax: 0, pk: 0, ind: false, dig: false } };
      const prev = await this.ctx.storage.get('v:' + who.pid);
      v.sdh = (prev && prev.sdh) || {};
      if (prev && prev.sd) { const old = new Map(prev.sd.map(x => [x[0], x])); for (const x of v.sd) { const o = old.get(x[0]); if (o && now - (v.sdh[x[0]] || 0) < 20000 && o[1] < x[1]) { x[1] = o[1]; x[7] = o[7]; if (o[7]) { x[4] = 0; x[5] = 0; } } } }
      for (const k in v.sdh) if (now - v.sdh[k] > 60000) delete v.sdh[k];
      await this.ctx.storage.put('v:' + who.pid, v);
      this.broadcast({ t: 'snap', v: { ...v, on: true } }, ws);
      return;
    }
    // worker intents: where each worker is headed, when it set out, how long the trip takes
    if (m.t === 'w' && mine && Array.isArray(m.w)) {
      const prev = this.intents.get(who.pid) || { pid: who.pid, w: {} };
      for (const it of m.w.slice(0, 120)) if (it && it.id != null) { if (it.gone) delete prev.w[it.id]; else prev.w[it.id] = it; }
      this.intents.set(who.pid, prev);
      this.broadcast({ t: 'w', pid: who.pid, w: m.w.slice(0, 120) }, ws);
      return;
    }
    // a harvester reached another player's pile or storage: roll against their guards, then load up
    if (m.t === 'harvest') {
      const r = o => ws.send(JSON.stringify({ t: 'hvr', id: m.id, ...o }));
      const v = await this.ctx.storage.get('v:' + (m.pid | 0));
      if (!v || v.pid === who.pid) return r({ ok: false, why: 'village not found' });
      if (who.team && v.team === who.team) return r({ ok: false, why: 'teammate' });
      const res = String(m.res).slice(0, 12), src = m.src === 'store' ? 'store' : 'pile';
      const hp = Math.max(0, Math.min(30, m.hp | 0)), carry = Math.max(1, Math.min(5000, m.carry | 0));
      const G = (v.gd?.n | 0) * (1 + (v.gd?.lvl | 0)), Hs = 1 + hp;
      const owners = this.ctx.getWebSockets().filter(o => o.deserializeAttachment()?.pid === v.pid);
      if (G > 0 && Math.random() < G / (G + Hs)) {
        for (const o of owners) { try { o.send(JSON.stringify({ t: 'shoo', by: who.name })); } catch (e) {} }
        return r({ ok: false, shoo: true });
      }
      const piles = (v.pl || []).filter(p => p[0] === res);
      const avail = src === 'pile' ? piles.reduce((a, p) => a + (p[3] | 0), 0) : (v.st?.[res] | 0);
      const take = Math.min(avail, Math.round(carry * (src === 'pile' ? 2 : .5)));
      if (take <= 0) return r({ ok: false, why: 'nothing left' });
      if (src === 'pile') { let left = take; for (const p of piles) { const d = Math.min(p[3], Math.ceil(take * p[3] / avail), left); p[3] -= d; left -= d; } v.pl = v.pl.filter(p => p[3] > 0); }
      else v.st[res] = (v.st[res] | 0) - take;
      await this.ctx.storage.put('v:' + v.pid, v);
      r({ ok: true, amt: take });
      const loss = { res, amt: take, src, by: who.name };
      if (owners.length) for (const o of owners) { try { o.send(JSON.stringify({ t: 'loss', list: [loss] })); } catch (e) {} }
      else { const q = (await this.ctx.storage.get('loss:' + v.pid)) || []; q.push(loss); await this.ctx.storage.put('loss:' + v.pid, q.slice(-50)); }
      this.broadcast({ t: 'snap', v: { ...v, on: owners.length > 0 } });
      return;
    }
    // claim one trip from a shared tile: wild land, or a resource inside someone's village
    if (m.t === 'claim') {
      const x = m.x | 0, y = m.y | 0, [gx, gy] = plotOf(x, y);
      if (zoneOf(gx, gy)[0] !== who.zx || zoneOf(gx, gy)[1] !== who.zy) return ws.send(JSON.stringify({ t: 'claim', id: m.id, ok: false, why: 'wrong zone' }));
      const v = [...(await this.ctx.storage.list({ prefix: 'v:' })).values()].find(s => inPlot(x, y, s.gx, s.gy));
      if (v) {
        const [ox, oy] = plotOrigin(v.gx, v.gy), k = String((y - oy) * VW + (x - ox)), left = v.left[k] | 0;
        if (left <= 0) return ws.send(JSON.stringify({ t: 'claim', id: m.id, ok: false, why: 'used up' }));
        v.left[k] = left - 1; await this.ctx.storage.put('v:' + v.pid, v);
        ws.send(JSON.stringify({ t: 'claim', id: m.id, ok: true }));
        this.broadcast({ t: 'took', pid: v.pid, k: +k, left: left - 1, by: who.pid, byName: who.name });
        return;
      }
      const n = wildAt(x, y); if (!n) return ws.send(JSON.stringify({ t: 'claim', id: m.id, ok: false, why: 'nothing there' }));
      const key = 'w:' + x + ',' + y; let u = (await this.ctx.storage.get(key)) || { u: 0, t: 0 };
      if (u.t && now > u.t) { u = { u: 0, t: 0 }; }
      if (u.u >= n.amt) return ws.send(JSON.stringify({ t: 'claim', id: m.id, ok: false, why: 'used up' }));
      u.u++; if (u.u >= n.amt) u.t = now + REGROW_MS;
      await this.ctx.storage.put(key, u);
      ws.send(JSON.stringify({ t: 'claim', id: m.id, ok: true }));
      this.broadcast({ t: 'wild', k: x + ',' + y, u: u.u, rt: u.t });
    }
  }
  // ------------------------------------------------------------ golems: one tick every TICK_MS while anyone is connected
  async alarm() {
    const now = Date.now(), socks = this.ctx.getWebSockets();
    const last = (await this.ctx.storage.get('glt')) || now;
    let dt = Math.min(CATCHUP_MS, Math.max(0, now - last));
    await this.ctx.storage.put('glt', now);
    let gl = (await this.ctx.storage.get('gl')) || [];
    const vs = new Map([...(await this.ctx.storage.list({ prefix: 'v:' })).values()].map(v => [v.pid, v]));
    const online = new Set(socks.map(w => w.deserializeAttachment()?.pid));
    const dirty = new Set(), out = new Map();   // pid -> messages for that player
    const tell = (pid, msg) => { if (!out.has(pid)) out.set(pid, []); out.get(pid).push(msg); };
    const zx = this.zx, zy = this.zy;
    // offline villages heal soldiers resting at home (online players heal on their own device)
    for (const v of vs.values()) if (!online.has(v.pid) && v.sd) for (const x of v.sd) if (x[4] === 0 && x[6] <= now && x[1] < x[2]) { x[1] = Math.min(x[2], x[1] + dt / 1000); if (x[1] >= x[2]) x[7] = 0; dirty.add(v.pid); }
    // spawn: at most one golem per village in the zone
    const sp = (await this.ctx.storage.get('gls')) || 0;
    if (vs.size && gl.length < vs.size && now - sp > SPAWN_GAP && zx != null) {
      const k = GOLEM_TYPES[(Math.random() * GOLEM_TYPES.length) | 0];
      const [ox, oy] = plotOrigin(zx * ZONE, zy * ZONE);
      let x = ox, y = oy;
      for (let n = 0; n < 40; n++) { x = ox + Math.floor(Math.random() * PX * ZONE); y = oy + Math.floor(Math.random() * PY * ZONE); if (![...vs.values()].some(v => inPlot(x, y, v.gx, v.gy))) break; }
      gl.push({ id: now.toString(36) + Math.floor(Math.random() * 1e4), k, m: GOLEM_START, mx: GOLEM_START, x, y, tx: x, ty: y, t0: now, sp: GOLEM_SPEED, eat: 0, acc: 0, ea: 0, dmg: {}, who: {}, nf: 0 });
      await this.ctx.storage.put('gls', now);
    }
    const dead = [];
    for (const g of gl) {
      let left = dt;
      while (left > 0) {
        const step = Math.min(left, HIT_MS); left -= step;
        const t = now - left;
        // 1) move / pick a target pile of our own kind
        const [px, py] = golemPos(g, t);
        if (!g.eat) {
          if (Math.hypot(g.tx - px, g.ty - py) < .6) {
            let best = null, bd = 1e9;
            for (const v of vs.values()) {
              const [ox, oy] = plotOrigin(v.gx, v.gy);
              for (const p of v.pl || []) if (p[0] === g.k && p[3] > 0) { const sd = p[4] || 1, cx = ox + p[1] + (sd - 1) / 2, cy = oy + p[2] + (sd - 1) / 2, d = Math.hypot(cx - px, cy - py); if (d < bd) { bd = d; best = { v, cx, cy }; } }
            }
            if (best && bd < .9) { g.eat = best.v.pid; g.x = g.tx = px; g.y = g.ty = py; g.t0 = t; }
            else if (best) { g.x = px; g.y = py; g.tx = best.cx; g.ty = best.cy + .8; g.t0 = t; }
            else { const [ox, oy] = plotOrigin(zx * ZONE, zy * ZONE); g.x = px; g.y = py; g.tx = Math.max(ox, Math.min(ox + PX * ZONE - 1, px + (Math.random() - .5) * 30)); g.ty = Math.max(oy, Math.min(oy + PY * ZONE - 1, py + (Math.random() - .5) * 30)); g.t0 = t; }
          }
        }
        // 2) eat: 10 a minute from the pile, grow by half of it
        if (g.eat) {
          const v = vs.get(g.eat), piles = v ? (v.pl || []).filter(p => p[0] === g.k && p[3] > 0) : [];
          if (!piles.length) { g.eat = 0; g.tx = g.x; g.ty = g.y; g.t0 = t; }
          else {
            g.acc += GOLEM_EAT * step / 1000;
            const bite = Math.floor(g.acc);
            if (bite > 0) {
              g.acc -= bite; let need = bite, got = 0;
              for (const p of piles) { const d = Math.min(p[3], need); p[3] -= d; need -= d; got += d; if (!need) break; }
              v.pl = v.pl.filter(p => p[3] > 0); dirty.add(v.pid);
              g.m += got * GOLEM_GROW; g.mx = Math.max(g.mx, g.m); g.ea = (g.ea || 0) + got;
              tell(v.pid, { kind: 'golem', res: g.k, amt: got, src: 'pile', by: 'A ' + g.k + ' golem' });
            }
          }
        }
        // 3) fight: defenders at home (when it's eating their pile) + hunters that have arrived
        const fighters = [];
        for (const v of vs.values()) for (const x of v.sd || []) {
          if (x[1] <= 0 || x[7]) continue;
          if ((x[4] === 1 && x[5] === g.id && x[6] <= t) || (x[4] === 0 && g.eat === v.pid && x[6] <= t)) fighters.push({ v, x });
        }
        g.nf = fighters.length;
        if (!fighters.length) continue;
        const ax = GOLEM_AXE.includes(g.k);
        for (const { v, x } of fighters) {
          const tk = v.tk || {};
          if ((GOLEM_IND.includes(g.k) && !tk.ind) || (GOLEM_DIG.includes(g.k) && !tk.dig)) continue;
          const d = SOLDIER_HIT * (1 + (ax ? tk.ax | 0 : tk.pk | 0)) * (x[3] || 1) * step / HIT_MS;
          g.m -= d; g.dmg[v.pid] = (g.dmg[v.pid] || 0) + d; (g.who[v.pid] = g.who[v.pid] || []); if (!g.who[v.pid].includes(x[0])) g.who[v.pid].push(x[0]);
        }
        // the golem swings at one soldier
        const tg = fighters[0];
        tg.x[1] = Math.max(0, tg.x[1] - GOLEM_HIT * step / HIT_MS);
        if (tg.x[1] <= 0) { tg.x[7] = 1; tg.x[4] = 0; tg.x[5] = 0; }
        tg.v.sdh = tg.v.sdh || {}; tg.v.sdh[tg.x[0]] = t; dirty.add(tg.v.pid);
        tell(tg.v.pid, { kind: 'shp', id: tg.x[0], hp: Math.round(tg.x[1] * 10) / 10, wnd: tg.x[7] ? 1 : 0 });
        if (g.m <= 0) { dead.push(g); break; }
      }
    }
    // 4) loot + experience split by damage share
    for (const g of dead) {
      const tot = Object.values(g.dmg).reduce((a, b) => a + b, 0) || 1, loot = golemLoot(g.mx), xp = golemXp(g.mx);
      for (const [pid, d] of Object.entries(g.dmg)) { const f = d / tot; tell(+pid, { kind: 'gain', res: g.k, amt: Math.round(loot * f), xp: Math.round(xp * f), ids: g.who[pid] || [], share: Math.round(f * 100), gmx: Math.round(g.mx) }); }
      this.broadcast({ t: 'gdead', id: g.id, k: g.k });
    }
    gl = gl.filter(g => !dead.includes(g));
    for (const pid of dirty) { const v = vs.get(pid); if (v) await this.ctx.storage.put('v:' + pid, v); }
    await this.ctx.storage.put('gl', gl);
    // deliver: live sockets now, otherwise queued with the harvest losses
    for (const [pid, list] of out) {
      const owners = socks.filter(o => o.deserializeAttachment()?.pid === pid);
      if (owners.length) for (const o of owners) { try { o.send(JSON.stringify({ t: 'loss', list })); } catch (e) {} }
      else {
        // offline: keep every pile bite and reward, but only the latest health for each soldier
        let q = (await this.ctx.storage.get('loss:' + pid)) || []; q.push(...list);
        const lastHp = new Map(); q.forEach((x, i) => { if (x.kind === 'shp') lastHp.set(x.id, i); });
        q = q.filter((x, i) => x.kind !== 'shp' || lastHp.get(x.id) === i);
        const bites = q.filter(x => x.kind === 'golem'), rest = q.filter(x => x.kind !== 'golem'), sum = {};
        for (const b of bites) { const key = b.res; sum[key] = sum[key] || { ...b, amt: 0 }; sum[key].amt += b.amt; }
        await this.ctx.storage.put('loss:' + pid, [...rest, ...Object.values(sum)].slice(-200));
      }
    }
    for (const pid of dirty) { const v = vs.get(pid); if (v) this.broadcast({ t: 'snap', v: { ...v, on: online.has(pid) } }); }
    this.broadcast({ t: 'gol', now, list: gl.map(gPub) });
    // mirror to D1 for the World tab map — at most every 30s, or right away when one spawns or dies
    const prevIds = (await this.ctx.storage.get('gld')) || '', ids = gl.map(g => g.id).join(',');
    if (zx != null && (ids !== prevIds || now - ((await this.ctx.storage.get('gla')) || 0) > 30000)) {
      try {
        const db = this.env.DB, zone = zx + ',' + zy;
        await db.prepare("CREATE TABLE IF NOT EXISTS golems (id TEXT PRIMARY KEY, zone TEXT NOT NULL, k TEXT NOT NULL, m REAL NOT NULL, mx REAL NOT NULL, x REAL NOT NULL, y REAL NOT NULL, tx REAL NOT NULL, ty REAL NOT NULL, t0 INTEGER NOT NULL, sp REAL NOT NULL, eat INTEGER, nf INTEGER, at INTEGER NOT NULL)").run();
        await db.batch([db.prepare('DELETE FROM golems WHERE zone = ?').bind(zone),
          ...gl.map(g => db.prepare('INSERT INTO golems (id, zone, k, m, mx, x, y, tx, ty, t0, sp, eat, nf, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(g.id, zone, g.k, Math.round(g.m), Math.round(g.mx), g.x, g.y, g.tx, g.ty, g.t0, g.sp, g.eat || 0, g.nf || 0, now))]);
        await this.ctx.storage.put('gld', ids); await this.ctx.storage.put('gla', now);
      } catch (e) { /* map mirror only — the zone keeps running */ }
    }
    if (socks.length) await this.ctx.storage.setAlarm(now + TICK_MS);
  }
  get zx() { return this._z ? this._z[0] : null; }
  get zy() { return this._z ? this._z[1] : null; }
  async webSocketClose(ws) {
    const who = ws.deserializeAttachment(); if (!who) return;
    if (!this.ctx.getWebSockets().some(o => o !== ws && o.deserializeAttachment()?.pid === who.pid)) { this.intents.delete(who.pid); this.broadcast({ t: 'on', pid: who.pid, on: false }, ws); }
    try { ws.close(); } catch (e) {}
  }
  async webSocketError(ws) { return this.webSocketClose(ws); }
}

// soldier roster entry from a client: [id, hp, maxHp, dmgMul, mode (0 home / 1 hunt), golemId, readyAt, wounded]
function cleanSd(x) { if (!Array.isArray(x)) return [0, 0, 0, 1, 0, 0, 0, 0]; return [x[0] | 0, Math.max(0, Math.min(500, +x[1] || 0)), Math.max(1, Math.min(500, +x[2] || 50)), Math.max(1, Math.min(3, +x[3] || 1)), x[4] === 1 ? 1 : 0, typeof x[5] === 'string' ? x[5].slice(0, 20) : 0, +x[6] || 0, x[7] ? 1 : 0]; }
const gPub = g => [g.id, g.k, Math.round(g.m), Math.round(g.mx), +g.x.toFixed(2), +g.y.toFixed(2), +g.tx.toFixed(2), +g.ty.toFixed(2), g.t0, g.sp, g.eat || 0, g.nf || 0, Object.fromEntries(Object.entries(g.dmg).map(([k, v]) => [k, Math.round(v)]))];
