// gsd-world: real-time referee for the shared world map.
// One Zone Durable Object per 4x4 block of village plots. Players' devices simulate their own villages;
// the zone only relays what workers are doing, keeps each village's last snapshot for offline viewing,
// and decides who gets a shared tree / rock first. WebSocket Hibernation keeps idle zones free.
import { DurableObject } from 'cloudflare:workers';
import { VW, plotOrigin, plotOf, inPlot, zoneOf, wildAt, REGROW_MS } from './shared.js';

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
    this.intents = new Map();   // pid -> latest worker intents (memory only; resent each trip)
  }
  async fetch(req) {
    const who = JSON.parse(req.headers.get('x-who'));
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
      const v = { pid: who.pid, name: who.name, team: who.team, gx: who.gx, gy: who.gy, seed: m.seed | 0, b: Array.isArray(m.b) ? m.b.slice(0, 400) : [], left: m.left && typeof m.left === 'object' ? m.left : {}, n: m.n && typeof m.n === 'object' ? m.n : {}, pl: Array.isArray(m.pl) ? m.pl.slice(0, 120) : [], st: m.st && typeof m.st === 'object' ? m.st : {}, gd: m.gd && typeof m.gd === 'object' ? { n: m.gd.n | 0, lvl: m.gd.lvl | 0 } : { n: 0, lvl: 0 }, lvl: m.lvl | 0, at: now };
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
  async webSocketClose(ws) {
    const who = ws.deserializeAttachment(); if (!who) return;
    if (!this.ctx.getWebSockets().some(o => o !== ws && o.deserializeAttachment()?.pid === who.pid)) { this.intents.delete(who.pid); this.broadcast({ t: 'on', pid: who.pid, on: false }, ws); }
    try { ws.close(); } catch (e) {}
  }
  async webSocketError(ws) { return this.webSocketClose(ws); }
}
