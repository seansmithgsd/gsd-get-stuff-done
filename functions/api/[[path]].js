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
  sawmill: { wood: 300, stone: 150, steel: 20, money: 150 }, market: { wood: 250, stone: 200, money: 200 }, taxoffice: { stone: 300, steel: 30, money: 250 },
  workshop: { wood: 300, iron: 80, money: 200 }, longhouse: { wood: 400, stone: 200, planks: 20 }, dock: { wood: 350, stone: 100, money: 100 },
  orchard: { wood: 200, food: 300, money: 100 }, nursery: { wood: 200, stone: 100, money: 100 }, palisade: { wood: 600, planks: 40 }, watchtower: { stone: 400, planks: 30 },
  blastfurnace: { stone: 600, steel: 80, planks: 60, money: 400 }, gearworks: { stone: 500, steel: 120, planks: 80, money: 400 }, bank: { stone: 600, steel: 100, gold: 20, money: 500 },
  barracks: { stone: 600, planks: 120, steel: 60 }, quarry2: { wood: 400, steel: 80, money: 300 }, teamhall: { stone: 500, planks: 100, gold: 20 },
  factory: { steel: 400, gears: 60, planks: 200, money: 1000 }, powerplant: { steel: 500, gears: 100, coal: 300, money: 1200 }, outpost: { planks: 300, steel: 300, gold: 40 },
  gsdtower: { steel: 1500, gears: 400, gold: 300, money: 5000 }, moneyprinter: { steel: 1200, gears: 500, gold: 400, money: 6000 },
};
const BTIER = { hut: 1, hunt: 1, quarry: 1, lumber: 2, farm: 2, kiln: 3, mine: 3, smelter: 4, mint: 4, townhall: 5,
  sawmill: 6, market: 6, taxoffice: 6, workshop: 6, longhouse: 6, dock: 6, orchard: 6, nursery: 6, palisade: 6, watchtower: 6,
  blastfurnace: 7, gearworks: 7, bank: 7, barracks: 7, quarry2: 7, teamhall: 7, factory: 8, powerplant: 8, outpost: 8, gsdtower: 9, moneyprinter: 9 };
const WONDER_GOAL = 5000, EVENT_GOAL = 50000, TREATY_MS = 8 * 3600 * 1000, WEEK_MS = 7 * 86400 * 1000;
const RES_OK = ['food', 'wood', 'stone', 'iron', 'coal', 'steel', 'planks', 'gears', 'copper', 'silver', 'gold'];
function cleanRes(o) { const r = {}; for (const k of RES_OK) { const v = Math.floor(Number(o && o[k]) || 0); if (v > 0) r[k] = Math.min(v, 1e7); } return r; }
// flags pulled from a save at write time, so harvest/orb never parse other players' saves
function flagsOf(save) {
  const u = save.upg || {}, has = t => (save.buildings || []).some(b => b.type === t && b.done);
  return { palisade: has('palisade'), watchtower: has('watchtower'), treaty: !!u.treaty, walls: !!u.walls, militia: !!u.militia, decoys: !!u.decoys,
    vault: !!u.vault, spoils: !!u.spoils, bigcrews: !!u.bigcrews, scout: !!u.scout, envoy: !!u.envoy, banner: !!u.banner, caravan: !!u.caravan,
    storage: !!u.storage, wonder: !!u.wonder, auction: !!u.auction, events: !!u.events, migration: !!u.migration, tier: [9, 8, 7, 6].find(a => u['age' + a]) || 0 };
}

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
  `CREATE TABLE IF NOT EXISTS incoming (id INTEGER PRIMARY KEY AUTOINCREMENT, target INTEGER NOT NULL, attacker INTEGER NOT NULL, eta INTEGER NOT NULL, created INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS incoming_target ON incoming(target)`,
  `CREATE TABLE IF NOT EXISTS gifts (id INTEGER PRIMARY KEY AUTOINCREMENT, to_player INTEGER NOT NULL, from_name TEXT NOT NULL, res TEXT NOT NULL, note TEXT, created INTEGER NOT NULL, applied INTEGER DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS gifts_to ON gifts(to_player, applied)`,
  `CREATE TABLE IF NOT EXISTS team_bank (team INTEGER PRIMARY KEY, res TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS listings (id INTEGER PRIMARY KEY AUTOINCREMENT, orb INTEGER NOT NULL, seller INTEGER NOT NULL, seller_name TEXT NOT NULL, res TEXT NOT NULL, amt INTEGER NOT NULL, price INTEGER NOT NULL, created INTEGER NOT NULL, sold INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS events (orb INTEGER NOT NULL, week INTEGER NOT NULL, total INTEGER DEFAULT 0, PRIMARY KEY (orb, week))`,
  `CREATE TABLE IF NOT EXISTS event_claims (player INTEGER NOT NULL, week INTEGER NOT NULL, PRIMARY KEY (player, week))`,
];
const ALTERS = ['ALTER TABLE players ADD COLUMN flags TEXT', 'ALTER TABLE players ADD COLUMN harvested_at INTEGER DEFAULT 0', 'ALTER TABLE players ADD COLUMN decoy_day TEXT',
  'ALTER TABLE teams ADD COLUMN ally INTEGER', 'ALTER TABLE teams ADD COLUMN wonder INTEGER DEFAULT 0'];
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map(s => db.prepare(s)));
  for (const a of ALTERS) { try { await db.prepare(a).run(); } catch (e) { /* column exists */ } }
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
      const team = p.team ? await env.DB.prepare('SELECT wonder FROM teams WHERE id = ?').bind(p.team).first() : null;
      return json({ ok: true, player: pub(p), save: p.save ? JSON.parse(p.save) : null, save_t: p.save_t, losses, teamWonder: !!(team && team.wonder >= WONDER_GOAL) });
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
      await env.DB.prepare('UPDATE players SET save = ?, save_t = ?, score = ?, level = ?, bcount = ?, seen = ?, flags = ? WHERE id = ?')
        .bind(JSON.stringify(b.save), Number(b.save.t) || now, sc.score, sc.level, sc.bcount, now, JSON.stringify(flagsOf(b.save)), p.id).run();
      if (Array.isArray(b.appliedGifts) && b.appliedGifts.length) {
        const ids = b.appliedGifts.map(Number).filter(Number.isFinite).slice(0, 100);
        await env.DB.batch(ids.map(id => env.DB.prepare('UPDATE gifts SET applied = 1 WHERE id = ? AND to_player = ?').bind(id, p.id)));
      }
      if (Array.isArray(b.applied) && b.applied.length) {
        const ids = b.applied.map(Number).filter(Number.isFinite).slice(0, 100);
        await env.DB.batch(ids.map(id => env.DB.prepare('UPDATE losses SET applied = 1 WHERE id = ? AND target = ?').bind(id, p.id)));
      }
      return json({ ok: true, score: sc.score });
    }

    if (path === 'losses' && req.method === 'GET') {
      const losses = (await env.DB.prepare('SELECT l.id, l.building_id, l.building_type, l.created, a.name attacker FROM losses l JOIN players a ON a.id = l.attacker WHERE l.target = ? AND l.applied = 0').bind(p.id).all()).results;
      const gifts = (await env.DB.prepare('SELECT id, from_name, res, note FROM gifts WHERE to_player = ? AND applied = 0').bind(p.id).all()).results.map(g => ({ ...g, res: JSON.parse(g.res) }));
      const fl = p.flags ? JSON.parse(p.flags) : {};
      await env.DB.prepare('DELETE FROM incoming WHERE eta < ?').bind(now - 60000).run();
      const incoming = fl.watchtower ? (await env.DB.prepare('SELECT i.eta, a.name attacker FROM incoming i JOIN players a ON a.id = i.attacker WHERE i.target = ?').bind(p.id).all()).results : [];
      return json({ ok: true, losses, gifts, incoming });
    }
    if (path === 'raidstart' && req.method === 'POST') {
      const b = await body();
      await env.DB.prepare('INSERT INTO incoming (target, attacker, eta, created) VALUES (?, ?, ?, ?)').bind(Number(b.target), p.id, now + Math.min(3600, Math.max(10, Number(b.secs) || 60)) * 1000, now).run();
      return json({ ok: true });
    }
    if (path === 'scout' && req.method === 'GET') {
      const fl = p.flags ? JSON.parse(p.flags) : {};
      if (!fl.scout) return bad('Research Scouting first');
      const t = await env.DB.prepare('SELECT name, save, orb FROM players WHERE id = ?').bind(Number(url.searchParams.get('id'))).first();
      if (!t || t.orb !== p.orb) return bad('Not in your orb');
      const sv = t.save ? JSON.parse(t.save) : {}, counts = {};
      for (const x of sv.buildings || []) if (x.done && x.type !== 'tc') counts[x.type] = (counts[x.type] || 0) + 1;
      return json({ ok: true, name: t.name, buildings: counts, workers: (sv.workers || []).length });
    }
    if (path === 'gift' && req.method === 'POST') {
      const b = await body(), fl = p.flags ? JSON.parse(p.flags) : {};
      if (!fl.caravan) return bad('Research Trade Caravan first');
      const to = await env.DB.prepare('SELECT id, team FROM players WHERE id = ?').bind(Number(b.to)).first();
      if (!to || !p.team || to.team !== p.team || to.id === p.id) return bad('You can only send to a teammate');
      const res = cleanRes(b.res); if (!Object.keys(res).length) return bad('Nothing to send');
      await env.DB.prepare('INSERT INTO gifts (to_player, from_name, res, note, created) VALUES (?, ?, ?, ?, ?)').bind(to.id, p.name, JSON.stringify(res), 'caravan', now).run();
      return json({ ok: true });
    }
    if (path === 'teambank') {
      if (!p.team) return bad('Join a team first');
      const row = await env.DB.prepare('SELECT res FROM team_bank WHERE team = ?').bind(p.team).first(), bank = row ? JSON.parse(row.res) : {};
      if (req.method === 'GET') return json({ ok: true, bank });
      const b = await body(), fl = p.flags ? JSON.parse(p.flags) : {};
      if (!fl.storage) return bad('Research Shared Storage first');
      const res = cleanRes(b.res);
      if (b.action === 'deposit') for (const k in res) bank[k] = (bank[k] || 0) + res[k];
      else if (b.action === 'withdraw') { for (const k in res) if ((bank[k] || 0) < res[k]) return bad(`Team bank only has ${bank[k] || 0} ${k}`); for (const k in res) bank[k] -= res[k]; }
      else return bad('unknown action');
      await env.DB.prepare('INSERT INTO team_bank (team, res) VALUES (?, ?) ON CONFLICT(team) DO UPDATE SET res = excluded.res').bind(p.team, JSON.stringify(bank)).run();
      return json({ ok: true, bank });
    }
    if (path === 'wonder' && req.method === 'POST') {
      const b = await body(), fl = p.flags ? JSON.parse(p.flags) : {};
      if (!fl.wonder) return bad('Research Team Wonder first'); if (!p.team) return bad('Join a team first');
      const amt = Math.max(0, Math.min(1e6, Math.floor(Number(b.amt) || 0)));
      await env.DB.prepare('UPDATE teams SET wonder = COALESCE(wonder, 0) + ? WHERE id = ?').bind(amt, p.team).run();
      const t = await env.DB.prepare('SELECT wonder FROM teams WHERE id = ?').bind(p.team).first();
      return json({ ok: true, wonder: t.wonder, goal: WONDER_GOAL });
    }
    if (path === 'ally' && req.method === 'POST') {
      const b = await body(), fl = p.flags ? JSON.parse(p.flags) : {};
      if (!fl.envoy) return bad('Research Envoy first'); if (!p.team) return bad('Join a team first');
      const t = await env.DB.prepare('SELECT * FROM teams WHERE id = ? AND orb = ?').bind(Number(b.team), p.orb).first();
      if (!t || t.id === p.team) return bad('Pick another team in your orb');
      await env.DB.batch([env.DB.prepare('UPDATE teams SET ally = NULL WHERE ally = ?').bind(p.team), env.DB.prepare('UPDATE teams SET ally = ? WHERE id = ?').bind(t.id, p.team), env.DB.prepare('UPDATE teams SET ally = ? WHERE id = ?').bind(p.team, t.id)]);
      return json({ ok: true });
    }
    if (path === 'migrate' && req.method === 'POST') {
      const fl = p.flags ? JSON.parse(p.flags) : {};
      if (!fl.migration) return bad('Research Migration first');
      const row = await env.DB.prepare('SELECT orb, COUNT(*) n FROM players WHERE orb != ? GROUP BY orb HAVING n < ? ORDER BY orb LIMIT 1').bind(p.orb, ORB_SIZE).first();
      const orb = row ? row.orb : ((await env.DB.prepare('SELECT MAX(orb) m FROM players').first())?.m || 0) + 1;
      const taken = new Set((await env.DB.prepare('SELECT slot FROM players WHERE orb = ?').bind(orb).all()).results.map(r => r.slot));
      let slot = 0; while (taken.has(slot)) slot++;
      // migrating costs your stockpile: resources go back to the starting amounts
      const sv = p.save ? JSON.parse(p.save) : null;
      if (sv) { sv.res = { food: 10, wood: 12, stone: 0, iron: 0, coal: 0, steel: 0, planks: 0, gears: 0, copper: 6, silver: 0, gold: 0 }; sv.t = now; }
      await env.DB.prepare('UPDATE players SET orb = ?, slot = ?, team = NULL, save = COALESCE(?, save), save_t = ? WHERE id = ?').bind(orb, slot, sv ? JSON.stringify(sv) : null, now, p.id).run();
      return json({ ok: true, orb });
    }
    if (path === 'listings' && req.method === 'GET') {
      const rows = (await env.DB.prepare('SELECT id, seller, seller_name, res, amt, price FROM listings WHERE orb = ? AND sold = 0 ORDER BY created DESC LIMIT 50').bind(p.orb).all()).results;
      return json({ ok: true, listings: rows });
    }
    if (path === 'list' && req.method === 'POST') {
      const b = await body(), fl = p.flags ? JSON.parse(p.flags) : {};
      if (!fl.auction) return bad('Research Auction House first');
      if (!RES_OK.includes(b.res) || b.res === 'copper') return bad('Pick a resource');
      const amt = Math.floor(Number(b.amt) || 0), price = Math.floor(Number(b.price) || 0);
      if (amt <= 0 || price <= 0) return bad('Amount and price must be above 0');
      await env.DB.prepare('INSERT INTO listings (orb, seller, seller_name, res, amt, price, created) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(p.orb, p.id, p.name, b.res, amt, price, now).run();
      return json({ ok: true });
    }
    if (path === 'buy' && req.method === 'POST') {
      const b = await body();
      const l = await env.DB.prepare('SELECT * FROM listings WHERE id = ? AND orb = ? AND sold = 0').bind(Number(b.id), p.orb).first();
      if (!l) return bad('Already sold');
      if (l.seller === p.id) { await env.DB.prepare('UPDATE listings SET sold = 1 WHERE id = ?').bind(l.id).run(); return json({ ok: true, cancelled: true, res: l.res, amt: l.amt }); }
      const r = await env.DB.prepare('UPDATE listings SET sold = 1 WHERE id = ? AND sold = 0').bind(l.id).run();
      if (!r.meta.changes) return bad('Already sold');
      await env.DB.prepare('INSERT INTO gifts (to_player, from_name, res, note, created) VALUES (?, ?, ?, ?, ?)').bind(l.seller, p.name, JSON.stringify({ copper: l.price }), 'auction sale', now).run();
      return json({ ok: true, res: l.res, amt: l.amt, price: l.price });
    }
    if (path === 'event') {
      const week = Math.floor(now / WEEK_MS);
      await env.DB.prepare('INSERT OR IGNORE INTO events (orb, week, total) VALUES (?, ?, 0)').bind(p.orb, week).run();
      if (req.method === 'POST') {
        const b = await body(), fl = p.flags ? JSON.parse(p.flags) : {};
        if (!fl.events) return bad('Research Orb Events first');
        if (b.action === 'claim') {
          const e = await env.DB.prepare('SELECT total FROM events WHERE orb = ? AND week = ?').bind(p.orb, week).first();
          if (e.total < EVENT_GOAL) return bad('Goal not reached yet');
          const r = await env.DB.prepare('INSERT OR IGNORE INTO event_claims (player, week) VALUES (?, ?)').bind(p.id, week).run();
          if (!r.meta.changes) return bad('Already claimed this week');
          return json({ ok: true, reward: { copper: 300, gold: 15, speed: 1800 } });
        }
        const amt = Math.max(0, Math.min(1e6, Math.floor(Number(b.amt) || 0)));
        await env.DB.prepare('UPDATE events SET total = total + ? WHERE orb = ? AND week = ?').bind(amt, p.orb, week).run();
      }
      const e = await env.DB.prepare('SELECT total FROM events WHERE orb = ? AND week = ?').bind(p.orb, week).first();
      const claimed = !!(await env.DB.prepare('SELECT 1 FROM event_claims WHERE player = ? AND week = ?').bind(p.id, week).first());
      return json({ ok: true, total: e.total, goal: EVENT_GOAL, res: 'wood', ends: (week + 1) * WEEK_MS, claimed });
    }

    if (path === 'orb' && req.method === 'GET') {
      const players = (await env.DB.prepare('SELECT id, name, slot, team, score, level, bcount, created, seen, flags, harvested_at FROM players WHERE orb = ? ORDER BY score DESC').bind(p.orb).all()).results
        .map(x => { const f = x.flags ? JSON.parse(x.flags) : {}; delete x.flags;
          return { ...x, shield: now - x.created < SHIELD_MS, treaty: !!(f.treaty && now - (x.harvested_at || 0) < TREATY_MS), online: now - x.seen < 120000, palisade: !!f.palisade, banner: !!f.banner, tier: f.tier || 0 }; });
      const teams = (await env.DB.prepare('SELECT t.id, t.name, t.ally, COALESCE(t.wonder,0) wonder, COUNT(p.id) members, COALESCE(SUM(p.score),0) score FROM teams t LEFT JOIN players p ON p.team = t.id WHERE t.orb = ? GROUP BY t.id ORDER BY score DESC').bind(p.orb).all()).results;
      return json({ ok: true, orb: p.orb, size: ORB_SIZE, me: pub(p), players, teams, limits: { teams: MAX_TEAMS, teamMax: TEAM_MAX }, wonderGoal: WONDER_GOAL });
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
      if (p.team && tg.team) { const mt = await env.DB.prepare('SELECT ally FROM teams WHERE id = ?').bind(p.team).first(); if (mt && mt.ally === tg.team) return bad('Allied teams are immune'); }
      if (now - tg.created < SHIELD_MS) return bad(`${tg.name} is under new-player protection`);
      if (now - p.last_harvest < HARVEST_COOLDOWN_MS) return bad('Your crews are still unloading — try again in a minute', 429);
      const tf = tg.flags ? JSON.parse(tg.flags) : {}, af = p.flags ? JSON.parse(p.flags) : {};
      await env.DB.prepare('DELETE FROM incoming WHERE attacker = ? AND target = ?').bind(p.id, tg.id).run();
      if (tf.treaty && now - (tg.harvested_at || 0) < TREATY_MS) return bad(`${tg.name} is under a peace treaty`);
      if (tf.militia && Math.random() < .25) { await env.DB.prepare('UPDATE players SET last_harvest = ? WHERE id = ?').bind(now, p.id).run(); return json({ ok: true, repelled: true, gained: {} }); }
      const day = new Date(now).toISOString().slice(0, 10);
      if (tf.decoys && tg.decoy_day !== day) { await env.DB.batch([env.DB.prepare('UPDATE players SET decoy_day = ? WHERE id = ?').bind(day, tg.id), env.DB.prepare('UPDATE players SET last_harvest = ? WHERE id = ?').bind(now, p.id)]); return json({ ok: true, decoy: true, gained: {} }); }
      const save = tg.save ? JSON.parse(tg.save) : null;
      const pending = new Set((await env.DB.prepare('SELECT building_id FROM losses WHERE target = ? AND applied = 0').bind(tg.id).all()).results.map(r => r.building_id));
      const cands = (save?.buildings || []).filter(x => x.done && BCOST[x.type] && !pending.has(x.id));
      await env.DB.prepare('UPDATE players SET last_harvest = ? WHERE id = ?').bind(now, p.id).run();
      if (!cands.length) return json({ ok: true, empty: true, gained: {} });
      // lowest tier first: outer buildings fall before the core
      cands.sort((a, c) => BTIER[a.type] - BTIER[c.type]);
      let share = af.spoils ? .40 : HARVEST_SHARE; if (tf.walls) share = Math.min(share, .20); if (tf.vault) share /= 2;
      const take = af.bigcrews ? 2 : 1, picks = [], gained = {};
      for (let n = 0; n < take && cands.length; n++) {
        const low = cands.filter(x => BTIER[x.type] === BTIER[cands[0].type]);
        const pick = low[Math.floor(Math.random() * low.length)]; picks.push(pick); cands.splice(cands.indexOf(pick), 1);
        for (const [k, v] of Object.entries(BCOST[pick.type])) { const g = Math.floor(v * share); if (g > 0) { const kk = k === 'money' ? 'copper' : k; gained[kk] = (gained[kk] || 0) + g; } }
      }
      await env.DB.batch([...picks.map(pick => env.DB.prepare('INSERT INTO losses (target, attacker, building_id, building_type, created) VALUES (?, ?, ?, ?, ?)').bind(tg.id, p.id, pick.id, pick.type, now)),
        env.DB.prepare('UPDATE players SET harvested_at = ? WHERE id = ?').bind(now, tg.id)]);
      return json({ ok: true, building: picks.map(x => x.type).join(' + '), from: tg.name, gained });
    }

    return bad('not found', 404);
  } catch (e) {
    return bad('server error: ' + (e && e.message || e), 500);
  }
}
