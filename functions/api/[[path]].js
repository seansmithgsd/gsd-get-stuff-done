// GSD: Get Stuff Done — game API (Cloudflare Pages Functions + D1)
// Bindings (set in the Pages project): DB = D1 database; secrets NOTICE_URL, NOTICE_TOKEN (GSD Client Notices Apps Script).

const ORB_SIZE = 100, MAX_TEAMS = 10, TEAM_MAX = 13;
const SHIELD_MS = 24 * 3600 * 1000;       // new players can't be harvested for 24h
const HARVEST_COOLDOWN_MS = 60 * 1000;     // one harvest per player per minute
const HARVEST_SHARE = 0.33;
const LINK_TTL_MS = 30 * 60 * 1000;
const SESSION_DAYS = 365;

// base building costs (server copy, for harvest payouts and score)
const BCOST = {
  hut: { wood: 15, money: 3 }, hunt: { wood: 10, money: 2 }, quarry: { wood: 20, money: 4 },
  lumber: { wood: 25, stone: 8, money: 5 }, farm: { wood: 20, stone: 6, money: 5 },
  kiln: { wood: 30, stone: 15, money: 8 }, mine: { wood: 30, stone: 20, money: 10 },
  smelter: { wood: 40, stone: 40, money: 15 }, mint: { stone: 50, iron: 10, money: 20 },
  townhall: { wood: 80, stone: 60, steel: 10, money: 40 },
};
const BTIER = { hut: 1, hunt: 1, quarry: 1, lumber: 2, farm: 2, kiln: 3, mine: 3, smelter: 4, mint: 4, townhall: 5 };

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
     orb INTEGER NOT NULL, slot INTEGER NOT NULL, team INTEGER, created INTEGER NOT NULL, save TEXT, save_t INTEGER DEFAULT 0,
     score INTEGER DEFAULT 0, level INTEGER DEFAULT 1, bcount INTEGER DEFAULT 0, last_harvest INTEGER DEFAULT 0, seen INTEGER DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS players_orb ON players(orb)`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, player INTEGER NOT NULL, created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS logins (token TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, created INTEGER NOT NULL, used INTEGER DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS logins_email ON logins(email, created)`,
  `CREATE TABLE IF NOT EXISTS teams (id INTEGER PRIMARY KEY AUTOINCREMENT, orb INTEGER NOT NULL, name TEXT NOT NULL, created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS losses (id INTEGER PRIMARY KEY AUTOINCREMENT, target INTEGER NOT NULL, attacker INTEGER NOT NULL,
     building_id INTEGER NOT NULL, building_type TEXT NOT NULL, created INTEGER NOT NULL, applied INTEGER DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS losses_target ON losses(target, applied)`,
];
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map(s => db.prepare(s)));
  schemaReady = true;
}

const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
const bad = (msg, status = 400) => json({ ok: false, error: msg }, status);
function randToken() { const a = new Uint8Array(32); crypto.getRandomValues(a); return [...a].map(b => b.toString(16).padStart(2, '0')).join(''); }
function cookie(req, name) { const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)')); return m ? m[1] : null; }
const cleanName = s => String(s || '').replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
const validEmail = s => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(s);

function scoreOf(save) {
  let s = Math.max(0, (save.level || 1) - 1) * 10, b = 0;
  for (const x of save.buildings || []) if (x.done && BTIER[x.type]) { s += (BTIER[x.type] + 1) * 20; b++; }
  s += (save.workers || []).length * 15;
  return { score: s, bcount: b, level: save.level || 1 };
}

async function me(req, env) {
  const t = cookie(req, 'gsd_s'); if (!t) return null;
  return await env.DB.prepare('SELECT p.* FROM sessions s JOIN players p ON p.id = s.player WHERE s.token = ?').bind(t).first();
}
function pub(p) { return { id: p.id, name: p.name, email: p.email, orb: p.orb, slot: p.slot, team: p.team, created: p.created, score: p.score }; }

async function seat(db) {
  // first orb with a free seat, else a new orb
  const row = await db.prepare('SELECT orb, COUNT(*) n FROM players GROUP BY orb HAVING n < ? ORDER BY orb LIMIT 1').bind(ORB_SIZE).first();
  const orb = row ? row.orb : ((await db.prepare('SELECT MAX(orb) m FROM players').first())?.m || 0) + 1;
  const taken = new Set((await db.prepare('SELECT slot FROM players WHERE orb = ?').bind(orb).all()).results.map(r => r.slot));
  // spread seats around the orb: 0, 50, 25, 75, ...
  const order = []; for (let step = ORB_SIZE; step >= 1; step = Math.floor(step / 2)) for (let i = 0; i < ORB_SIZE; i += step) if (!order.includes(i)) order.push(i);
  const slot = order.find(i => !taken.has(i));
  return { orb, slot };
}

export async function onRequest(ctx) {
  const { request: req, env } = ctx;
  if (!env.DB) return bad('server not configured (no DB binding)', 500);
  await ensureSchema(env.DB);
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, '');
  const now = Date.now();
  const body = async () => { try { return await req.json(); } catch { return {}; } };

  try {
    // ---- login: email a magic link
    if (path === 'login' && req.method === 'POST') {
      const b = await body();
      const email = String(b.email || '').trim().toLowerCase(), name = cleanName(b.name);
      if (!validEmail(email)) return bad('Enter a valid email');
      const recent = await env.DB.prepare('SELECT COUNT(*) n FROM logins WHERE email = ? AND created > ?').bind(email, now - 60000).first();
      if (recent.n > 0) return bad('A link was just sent — check your inbox (and spam)', 429);
      const token = randToken();
      await env.DB.prepare('INSERT INTO logins (token, email, name, created) VALUES (?, ?, ?, ?)').bind(token, email, name || email.split('@')[0].slice(0, 20), now).run();
      const link = `${url.origin}/api/verify?t=${token}`;
      if (!env.NOTICE_URL || !env.NOTICE_TOKEN) {
        const local = ['localhost', '127.0.0.1'].includes(url.hostname);
        return local ? json({ ok: true, devLink: link }) : bad('Email sending is not configured', 500);
      }
      const r = await fetch(env.NOTICE_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        token: env.NOTICE_TOKEN, to: email, subject: 'Your GSD: Get Stuff Done login link',
        body: `Tap to sign in and save your village:\n\n${link}\n\nThe link works once and expires in 30 minutes. If you didn't ask for it, ignore this email.\n\nGSD Consultants, LLC`,
      }) });
      let out = {}; try { out = await r.json(); } catch {}
      if (!out.ok) return bad('Could not send the email: ' + (out.error || r.status), 502);
      return json({ ok: true });
    }

    // ---- verify: open the link, start a session
    if (path === 'verify' && req.method === 'GET') {
      const t = url.searchParams.get('t') || '';
      const row = await env.DB.prepare('SELECT * FROM logins WHERE token = ?').bind(t).first();
      if (!row || row.used || now - row.created > LINK_TTL_MS) return Response.redirect(`${url.origin}/?login=expired`, 302);
      await env.DB.prepare('UPDATE logins SET used = 1 WHERE token = ?').bind(t).run();
      let p = await env.DB.prepare('SELECT * FROM players WHERE email = ?').bind(row.email).first();
      if (!p) {
        const { orb, slot } = await seat(env.DB);
        await env.DB.prepare('INSERT INTO players (email, name, orb, slot, created, seen) VALUES (?, ?, ?, ?, ?, ?)').bind(row.email, row.name, orb, slot, now, now).run();
        p = await env.DB.prepare('SELECT * FROM players WHERE email = ?').bind(row.email).first();
      }
      const s = randToken();
      await env.DB.prepare('INSERT INTO sessions (token, player, created) VALUES (?, ?, ?)').bind(s, p.id, now).run();
      return new Response(null, { status: 302, headers: {
        location: `${url.origin}/?login=ok`,
        'set-cookie': `gsd_s=${s}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`,
      } });
    }

    const p = await me(req, env);
    if (path === 'me' && req.method === 'GET') {
      if (!p) return bad('not signed in', 401);
      await env.DB.prepare('UPDATE players SET seen = ? WHERE id = ?').bind(now, p.id).run();
      const losses = (await env.DB.prepare('SELECT l.id, l.building_id, l.building_type, l.created, a.name attacker FROM losses l JOIN players a ON a.id = l.attacker WHERE l.target = ? AND l.applied = 0').bind(p.id).all()).results;
      return json({ ok: true, player: pub(p), save: p.save ? JSON.parse(p.save) : null, save_t: p.save_t, losses });
    }
    if (!p) return bad('not signed in', 401);

    if (path === 'logout' && req.method === 'POST') {
      await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(cookie(req, 'gsd_s')).run();
      return json({ ok: true }, 200, { 'set-cookie': 'gsd_s=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' });
    }

    if (path === 'save' && (req.method === 'PUT' || req.method === 'POST')) {
      const raw = await req.text();
      if (raw.length > 300000) return bad('save too large', 413);
      let b; try { b = JSON.parse(raw); } catch { return bad('bad json'); }
      if (!b.save || typeof b.save !== 'object') return bad('missing save');
      const sc = scoreOf(b.save);
      await env.DB.prepare('UPDATE players SET save = ?, save_t = ?, score = ?, level = ?, bcount = ?, seen = ? WHERE id = ?')
        .bind(JSON.stringify(b.save), Number(b.save.t) || now, sc.score, sc.level, sc.bcount, now, p.id).run();
      if (Array.isArray(b.applied) && b.applied.length) {
        const ids = b.applied.map(Number).filter(Number.isFinite).slice(0, 100);
        await env.DB.batch(ids.map(id => env.DB.prepare('UPDATE losses SET applied = 1 WHERE id = ? AND target = ?').bind(id, p.id)));
      }
      return json({ ok: true, score: sc.score });
    }

    if (path === 'losses' && req.method === 'GET') {
      const losses = (await env.DB.prepare('SELECT l.id, l.building_id, l.building_type, l.created, a.name attacker FROM losses l JOIN players a ON a.id = l.attacker WHERE l.target = ? AND l.applied = 0').bind(p.id).all()).results;
      return json({ ok: true, losses });
    }

    if (path === 'orb' && req.method === 'GET') {
      const players = (await env.DB.prepare('SELECT id, name, slot, team, score, level, bcount, created, seen FROM players WHERE orb = ? ORDER BY score DESC').bind(p.orb).all()).results
        .map(x => ({ ...x, shield: now - x.created < SHIELD_MS, online: now - x.seen < 120000 }));
      const teams = (await env.DB.prepare('SELECT t.id, t.name, COUNT(p.id) members, COALESCE(SUM(p.score),0) score FROM teams t LEFT JOIN players p ON p.team = t.id WHERE t.orb = ? GROUP BY t.id ORDER BY score DESC').bind(p.orb).all()).results;
      return json({ ok: true, orb: p.orb, size: ORB_SIZE, me: pub(p), players, teams, limits: { teams: MAX_TEAMS, teamMax: TEAM_MAX } });
    }

    if (path === 'team' && req.method === 'POST') {
      const b = await body();
      if (b.action === 'leave') {
        await env.DB.prepare('UPDATE players SET team = NULL WHERE id = ?').bind(p.id).run();
        await env.DB.prepare('DELETE FROM teams WHERE orb = ? AND id NOT IN (SELECT team FROM players WHERE team IS NOT NULL)').bind(p.orb).run();
        return json({ ok: true });
      }
      if (b.action === 'create') {
        const name = cleanName(b.name); if (!name) return bad('Team name required');
        const n = await env.DB.prepare('SELECT COUNT(*) n FROM teams WHERE orb = ?').bind(p.orb).first();
        if (n.n >= MAX_TEAMS) return bad(`This orb already has ${MAX_TEAMS} teams`);
        const r = await env.DB.prepare('INSERT INTO teams (orb, name, created) VALUES (?, ?, ?)').bind(p.orb, name, now).run();
        await env.DB.prepare('UPDATE players SET team = ? WHERE id = ?').bind(r.meta.last_row_id, p.id).run();
        await env.DB.prepare('DELETE FROM teams WHERE orb = ? AND id NOT IN (SELECT team FROM players WHERE team IS NOT NULL)').bind(p.orb).run();
        return json({ ok: true, team: r.meta.last_row_id });
      }
      if (b.action === 'join') {
        const t = await env.DB.prepare('SELECT * FROM teams WHERE id = ? AND orb = ?').bind(Number(b.id), p.orb).first();
        if (!t) return bad('No such team in your orb');
        const n = await env.DB.prepare('SELECT COUNT(*) n FROM players WHERE team = ?').bind(t.id).first();
        if (n.n >= TEAM_MAX) return bad(`Team is full (${TEAM_MAX})`);
        await env.DB.prepare('UPDATE players SET team = ? WHERE id = ?').bind(t.id, p.id).run();
        await env.DB.prepare('DELETE FROM teams WHERE orb = ? AND id NOT IN (SELECT team FROM players WHERE team IS NOT NULL)').bind(p.orb).run();
        return json({ ok: true });
      }
      return bad('unknown action');
    }

    if (path === 'harvest' && req.method === 'POST') {
      const b = await body();
      const tg = await env.DB.prepare('SELECT * FROM players WHERE id = ?').bind(Number(b.target)).first();
      if (!tg || tg.orb !== p.orb || tg.id === p.id) return bad('Target not in your orb');
      if (p.team && tg.team === p.team) return bad('Teammates are immune');
      if (now - tg.created < SHIELD_MS) return bad(`${tg.name} is under new-player protection`);
      if (now - p.last_harvest < HARVEST_COOLDOWN_MS) return bad('Your crews are still unloading — try again in a minute', 429);
      const save = tg.save ? JSON.parse(tg.save) : null;
      const pending = new Set((await env.DB.prepare('SELECT building_id FROM losses WHERE target = ? AND applied = 0').bind(tg.id).all()).results.map(r => r.building_id));
      const cands = (save?.buildings || []).filter(x => x.done && BCOST[x.type] && !pending.has(x.id));
      await env.DB.prepare('UPDATE players SET last_harvest = ? WHERE id = ?').bind(now, p.id).run();
      if (!cands.length) return json({ ok: true, empty: true, gained: {} });
      // lowest tier first: outer buildings fall before the core
      cands.sort((a, c) => BTIER[a.type] - BTIER[c.type]);
      const low = cands.filter(x => BTIER[x.type] === BTIER[cands[0].type]);
      const pick = low[Math.floor(Math.random() * low.length)];
      const gained = {};
      for (const [k, v] of Object.entries(BCOST[pick.type])) { const g = Math.floor(v * HARVEST_SHARE); if (g > 0) gained[k === 'money' ? 'copper' : k] = g; }
      await env.DB.prepare('INSERT INTO losses (target, attacker, building_id, building_type, created) VALUES (?, ?, ?, ?, ?)').bind(tg.id, p.id, pick.id, pick.type, now).run();
      return json({ ok: true, building: pick.type, from: tg.name, gained });
    }

    return bad('not found', 404);
  } catch (e) {
    return bad('server error: ' + (e && e.message || e), 500);
  }
}
