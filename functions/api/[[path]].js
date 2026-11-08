// GSD: Get Stuff Done — game API (Cloudflare Pages Functions + D1)
// Bindings (set in the Pages project): DB = D1 database; secrets NOTICE_URL, NOTICE_TOKEN (GSD Client Notices Apps Script).

const WORLD = 1, MAX_TEAMS = 100, TEAM_MAX = 13;
// one shared world map: villages sit on plots ~SPACING tiles apart, spiralling out from 0,0
const SPACING = 14, CHUNK = 24, NODES_PER_CHUNK = 5, VIEW_MAX = 160, MAX_CREWS = 6;
const WORK_SECS = 30, REGROW_MS = 30 * 60 * 1000;
// contested wild resources on the world map: what one worker carries home per trip
const WILD = { grove: { res: 'wood', max: 500, carry: 25 }, rocks: { res: 'stone', max: 400, carry: 20 }, ore: { res: 'iron', max: 250, carry: 12 }, goldvein: { res: 'gold', max: 40, carry: 2 } };
const WILD_ODDS = [['grove', .4], ['rocks', .3], ['ore', .2], ['goldvein', .1]];
const travelSecs = (d, fast) => Math.min(1800, Math.round((15 + d * 4) * (fast ? .7 : 1)));
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const SHIELD_MS = 24 * 3600 * 1000;       // new players can't be harvested for 24h
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
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`,
  // short-lived tickets the live world server (gsd-world Worker) checks when a player's device connects
  `CREATE TABLE IF NOT EXISTS ws_tickets (token TEXT PRIMARY KEY, player INTEGER NOT NULL, created INTEGER NOT NULL)`,
  // devices playing without signing in (guests never appear on the map) — counted so we can see who tried it
  `CREATE TABLE IF NOT EXISTS guests (device TEXT PRIMARY KEY, first INTEGER NOT NULL, last INTEGER NOT NULL, level INTEGER DEFAULT 1, plays INTEGER DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS wild (id INTEGER PRIMARY KEY AUTOINCREMENT, x INTEGER NOT NULL, y INTEGER NOT NULL, type TEXT NOT NULL, amt INTEGER NOT NULL, max INTEGER NOT NULL, regrow INTEGER DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS wild_xy ON wild(x, y)`,
  `CREATE TABLE IF NOT EXISTS chunks (cx INTEGER NOT NULL, cy INTEGER NOT NULL, PRIMARY KEY (cx, cy))`,
  // crews walking the world: raid (to a village), gather (to a wild node), intercept (out to meet a raid on the road)
  `CREATE TABLE IF NOT EXISTS marches (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, owner INTEGER NOT NULL, owner_name TEXT NOT NULL, owner_team INTEGER,
     target INTEGER NOT NULL, target_name TEXT, target_player INTEGER, fx REAL NOT NULL, fy REAL NOT NULL, tx REAL NOT NULL, ty REAL NOT NULL, crew INTEGER NOT NULL,
     start INTEGER NOT NULL, arrive INTEGER NOT NULL, back_at INTEGER NOT NULL, ret INTEGER NOT NULL, status TEXT NOT NULL, result TEXT, loot TEXT)`,
  `CREATE INDEX IF NOT EXISTS marches_status ON marches(status, arrive)`,
  `CREATE INDEX IF NOT EXISTS marches_owner ON marches(owner, status)`,
];
const ALTERS = ['ALTER TABLE players ADD COLUMN flags TEXT', 'ALTER TABLE players ADD COLUMN harvested_at INTEGER DEFAULT 0', 'ALTER TABLE players ADD COLUMN decoy_day TEXT',
  'ALTER TABLE teams ADD COLUMN ally INTEGER', 'ALTER TABLE teams ADD COLUMN wonder INTEGER DEFAULT 0',
  'ALTER TABLE players ADD COLUMN wx INTEGER', 'ALTER TABLE players ADD COLUMN wy INTEGER'];
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map(s => db.prepare(s)));
  for (const a of ALTERS) { try { await db.prepare(a).run(); } catch (e) { /* column exists */ } }
  // one-time move from 100-player orbs to the single world map
  const m = await db.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('world1', ?)").bind(String(Date.now())).run();
  if (m.meta.changes) {
    await db.batch([db.prepare('UPDATE players SET orb = ?').bind(WORLD), db.prepare('UPDATE teams SET orb = ?').bind(WORLD), db.prepare('UPDATE listings SET orb = ?').bind(WORLD),
      db.prepare('DELETE FROM events WHERE orb != ?').bind(WORLD), db.prepare('DELETE FROM incoming')]);
  }
  const homeless = (await db.prepare('SELECT id FROM players WHERE wx IS NULL ORDER BY score DESC').all()).results;
  for (const h of homeless) { const { x, y } = await plot(db); await db.prepare('UPDATE players SET wx = ?, wy = ? WHERE id = ?').bind(x, y, h.id).run(); await clearWild(db, x, y); }
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
function pub(p) { return { id: p.id, name: p.name, email: p.email, orb: p.orb, x: p.wx, y: p.wy, team: p.team, created: p.created, score: p.score }; }

// small deterministic hash -> [0,1)
function h01(a, b, c = 0) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
// next free village plot, spiralling out from the centre
async function plot(db) {
  const taken = (await db.prepare('SELECT wx, wy FROM players WHERE wx IS NOT NULL').all()).results;
  for (let r = 0; r < 200; r++) {
    const ring = [];
    for (let gx = -r; gx <= r; gx++) for (let gy = -r; gy <= r; gy++) if (Math.max(Math.abs(gx), Math.abs(gy)) === r) ring.push([gx, gy]);
    ring.sort((A, B) => Math.atan2(A[1], A[0]) - Math.atan2(B[1], B[0]));
    for (const [gx, gy] of ring) {
      const x = gx * SPACING + Math.round((h01(gx, gy, 1) - .5) * 6), y = gy * SPACING + Math.round((h01(gx, gy, 2) - .5) * 6);
      if (!taken.some(t => dist(t.wx, t.wy, x, y) < SPACING * .6)) return { x, y };
    }
  }
  return { x: Math.round(Math.random() * 4000), y: Math.round(Math.random() * 4000) };
}
const clearWild = (db, x, y) => db.prepare('DELETE FROM wild WHERE x BETWEEN ? AND ? AND y BETWEEN ? AND ?').bind(x - 4, x + 4, y - 4, y + 4).run();
// lay out wild resource nodes the first time anyone looks at a chunk
async function ensureChunks(db, x0, y0, x1, y1) {
  const want = [];
  for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) want.push([cx, cy]);
  if (!want.length) return;
  const have = new Set((await db.prepare('SELECT cx, cy FROM chunks WHERE cx BETWEEN ? AND ? AND cy BETWEEN ? AND ?').bind(Math.floor(x0 / CHUNK), Math.floor(x1 / CHUNK), Math.floor(y0 / CHUNK), Math.floor(y1 / CHUNK)).all()).results.map(r => r.cx + ',' + r.cy));
  const todo = want.filter(([cx, cy]) => !have.has(cx + ',' + cy)); if (!todo.length) return;
  const homes = (await db.prepare('SELECT wx, wy FROM players WHERE wx BETWEEN ? AND ? AND wy BETWEEN ? AND ?').bind(x0 - CHUNK - 5, x1 + CHUNK + 5, y0 - CHUNK - 5, y1 + CHUNK + 5).all()).results;
  const stmts = [];
  for (const [cx, cy] of todo) {
    stmts.push(db.prepare('INSERT OR IGNORE INTO chunks (cx, cy) VALUES (?, ?)').bind(cx, cy));
    for (let n = 0; n < NODES_PER_CHUNK; n++) {
      const x = cx * CHUNK + Math.floor(h01(cx, cy, 10 + n) * CHUNK), y = cy * CHUNK + Math.floor(h01(cx, cy, 30 + n) * CHUNK);
      if (homes.some(hh => dist(hh.wx, hh.wy, x, y) < 5)) continue;
      let roll = h01(cx, cy, 50 + n), type = 'grove'; for (const [t, o] of WILD_ODDS) { if (roll < o) { type = t; break; } roll -= o; }
      stmts.push(db.prepare('INSERT INTO wild (x, y, type, amt, max) VALUES (?, ?, ?, ?, ?)').bind(x, y, type, WILD[type].max, WILD[type].max));
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
}
const flagsOfRow = r => (r && r.flags ? JSON.parse(r.flags) : {});
const crewNote = (txt, res) => ({ note: 'crew:' + txt, res: res || {} });
// resolve every crew whose moment has come: intercepts meet raids, raids dismantle, gatherers load up, everyone home delivers
async function settle(db, now) {
  await db.prepare('UPDATE wild SET amt = max, regrow = 0 WHERE regrow > 0 AND regrow < ?').bind(now).run();
  await db.prepare("UPDATE marches SET status = 'out' WHERE status = 'busy' AND arrive < ?").bind(now - 120000).run();
  const due = (await db.prepare("SELECT * FROM marches WHERE (status = 'out' AND arrive <= ?) OR (status = 'back' AND ret <= ?) ORDER BY CASE status WHEN 'out' THEN arrive ELSE ret END LIMIT 200").bind(now, now).all()).results;
  for (const m of due) {
    if (m.status === 'back') {
      // crew is home: deliver the haul (or the report) as a gift
      const r = await db.prepare("UPDATE marches SET status = 'done' WHERE id = ? AND status = 'back'").bind(m.id).run(); if (!r.meta.changes) continue;
      const n = m.result ? JSON.parse(m.result) : {};
      await db.prepare('INSERT INTO gifts (to_player, from_name, res, note, created) VALUES (?, ?, ?, ?, ?)').bind(m.owner, m.owner_name, m.loot || '{}', 'crew:' + (n.msg || 'Crew is home'), now).run();
      continue;
    }
    const claim = await db.prepare("UPDATE marches SET status = 'busy' WHERE id = ? AND status = 'out'").bind(m.id).run(); if (!claim.meta.changes) continue;   // another request is resolving it
    const home = async (msg, loot, backFrom) => {   // turn the crew around
      const bx = backFrom ? backFrom[0] : m.tx, by = backFrom ? backFrom[1] : m.ty, at = backFrom ? backFrom[2] : m.arrive + (m.kind === 'gather' ? WORK_SECS * 1000 : 0);
      const ret = at + travelSecs(dist(bx, by, m.fx, m.fy), m.kind !== 'intercept' && m.fast) * 1000;
      await db.prepare("UPDATE marches SET status = 'back', tx = ?, ty = ?, arrive = ?, back_at = ?, ret = ?, result = ?, loot = ? WHERE id = ?")
        .bind(bx, by, backFrom ? backFrom[2] : m.arrive, at, ret, JSON.stringify({ msg }), JSON.stringify(loot || {}), m.id).run();
    };
    const owner = await db.prepare('SELECT flags FROM players WHERE id = ?').bind(m.owner).first(); m.fast = !!flagsOfRow(owner).fastcrews;
    if (m.kind === 'intercept') {
      const raid = await db.prepare('SELECT * FROM marches WHERE id = ?').bind(m.target).first();
      if (!raid || raid.status !== 'out') { await home(`Interceptors found no one on the road`); continue; }
      const df = flagsOfRow(owner), atk = await db.prepare('SELECT flags FROM players WHERE id = ?').bind(raid.owner).first(), af = flagsOfRow(atk);
      const defStr = m.crew + (df.militia ? 1 : 0), atkStr = raid.crew + (af.bigcrews ? 1 : 0);
      if (Math.random() < defStr / (defStr + atkStr)) {
        // raid stopped: the raiders walk home from the meeting point with nothing
        const back = travelSecs(dist(m.tx, m.ty, raid.fx, raid.fy), af.fastcrews) * 1000;
        const st = await db.prepare("UPDATE marches SET status = 'back', tx = ?, ty = ?, arrive = ?, back_at = ?, ret = ?, result = ?, loot = '{}' WHERE id = ? AND status = 'out'")
          .bind(m.tx, m.ty, m.arrive, m.arrive, m.arrive + back, JSON.stringify({ msg: `${m.owner_name}'s crew stopped your raid on ${raid.target_name} on the road` }), raid.id).run();
        await home(st.meta.changes ? `Your interceptors stopped ${raid.owner_name}'s raid on ${raid.target_name}` : 'Interceptors found no one on the road');
      } else await home(`${raid.owner_name}'s raiders broke through your interceptors`);
      continue;
    }
    if (m.kind === 'gather') {
      const node = await db.prepare('SELECT * FROM wild WHERE id = ?').bind(m.target).first();
      if (!node || node.amt <= 0) { await home(`The ${node ? node.type : 'site'} was picked clean before your crew got there`); continue; }
      const W = WILD[node.type], take = Math.min(node.amt, W.carry * m.crew), left = node.amt - take;
      await db.prepare('UPDATE wild SET amt = ?, regrow = ? WHERE id = ?').bind(left, left <= 0 ? now + REGROW_MS : 0, node.id).run();
      await home(`Crew back from the wild with ${take} ${W.res}`, { [W.res]: take }); continue;
    }
    // raid: dismantle the target's lowest-tier building
    const tg = await db.prepare('SELECT * FROM players WHERE id = ?').bind(m.target).first();
    if (!tg) { await home('The village was gone'); continue; }
    const tf = flagsOfRow(tg), af = flagsOfRow(owner);
    if (tf.treaty && now - (tg.harvested_at || 0) < TREATY_MS) { await home(`${tg.name} was under a peace treaty`); continue; }
    if (tf.militia && Math.random() < .25) { await home(`${tg.name}'s militia drove your crew off`); continue; }
    const day = new Date(now).toISOString().slice(0, 10);
    if (tf.decoys && tg.decoy_day !== day) { await db.prepare('UPDATE players SET decoy_day = ? WHERE id = ?').bind(day, tg.id).run(); await home(`Your crew dismantled a decoy hut at ${tg.name}'s — nothing gained`); continue; }
    const save = tg.save ? JSON.parse(tg.save) : null;
    const pending = new Set((await db.prepare('SELECT building_id FROM losses WHERE target = ? AND applied = 0').bind(tg.id).all()).results.map(r => r.building_id));
    const cands = (save?.buildings || []).filter(x => x.done && BCOST[x.type] && !pending.has(x.id));
    if (!cands.length) { await home(`${tg.name} had nothing left to dismantle`); continue; }
    cands.sort((a, c) => BTIER[a.type] - BTIER[c.type]);
    let share = af.spoils ? .40 : HARVEST_SHARE; if (tf.walls) share = Math.min(share, .20); if (tf.vault) share /= 2;
    const take = af.bigcrews ? 2 : 1, picks = [], gained = {};
    for (let n = 0; n < take && cands.length; n++) {
      const low = cands.filter(x => BTIER[x.type] === BTIER[cands[0].type]);
      const pick = low[Math.floor(Math.random() * low.length)]; picks.push(pick); cands.splice(cands.indexOf(pick), 1);
      for (const [k, v] of Object.entries(BCOST[pick.type])) { const g = Math.floor(v * share); if (g > 0) { const kk = k === 'money' ? 'copper' : k; gained[kk] = (gained[kk] || 0) + g; } }
    }
    await db.batch([...picks.map(pick => db.prepare('INSERT INTO losses (target, attacker, building_id, building_type, created) VALUES (?, ?, ?, ?, ?)').bind(tg.id, m.owner, pick.id, pick.type, now)),
      db.prepare('UPDATE players SET harvested_at = ? WHERE id = ?').bind(now, tg.id)]);
    await home(`Your crew dismantled ${tg.name}'s ${picks.map(x => x.type).join(' + ')}`, gained);
  }
}
const MARCH_COLS = 'id, kind, owner, owner_name, owner_team, target, target_name, target_player, fx, fy, tx, ty, crew, start, arrive, back_at, ret, status, result';

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
        const { x, y } = await plot(env.DB);
        await env.DB.prepare('INSERT INTO players (email, name, orb, slot, created, seen, wx, wy) VALUES (?, ?, ?, 0, ?, ?, ?, ?)').bind(row.email, row.name, WORLD, now, now, x, y).run();
        await clearWild(env.DB, x, y);
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
    if (path === 'hello' && req.method === 'POST') {
      const b = await body(), dev = String(b.device || '').replace(/[^a-z0-9]/gi, '').slice(0, 32), lvl = Math.max(1, Math.min(9999, Math.floor(Number(b.level) || 1)));
      if (dev.length < 8 || p) return json({ ok: true });
      await env.DB.prepare('INSERT INTO guests (device, first, last, level) VALUES (?, ?, ?, ?) ON CONFLICT(device) DO UPDATE SET last = excluded.last, level = MAX(level, excluded.level), plays = plays + 1').bind(dev, now, now, lvl).run();
      return json({ ok: true });
    }
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
      await settle(env.DB, now);
      const losses = (await env.DB.prepare('SELECT l.id, l.building_id, l.building_type, l.created, a.name attacker FROM losses l JOIN players a ON a.id = l.attacker WHERE l.target = ? AND l.applied = 0').bind(p.id).all()).results;
      const gifts = (await env.DB.prepare('SELECT id, from_name, res, note FROM gifts WHERE to_player = ? AND applied = 0').bind(p.id).all()).results.map(g => ({ ...g, res: JSON.parse(g.res) }));
      const incoming = (await env.DB.prepare("SELECT id, arrive eta, owner_name attacker FROM marches WHERE kind = 'raid' AND target = ? AND status = 'out'").bind(p.id).all()).results;
      const mine = (await env.DB.prepare(`SELECT ${MARCH_COLS} FROM marches WHERE owner = ? AND status != 'done'`).bind(p.id).all()).results;
      return json({ ok: true, losses, gifts, incoming, marches: mine, now });
    }
    if (path === 'scout' && req.method === 'GET') {
      const fl = p.flags ? JSON.parse(p.flags) : {};
      if (!fl.scout) return bad('Research Scouting first');
      const t = await env.DB.prepare('SELECT name, save, orb FROM players WHERE id = ?').bind(Number(url.searchParams.get('id'))).first();
      if (!t) return bad('No such village');
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
      if (!t || t.id === p.team) return bad('Pick another team');
      await env.DB.batch([env.DB.prepare('UPDATE teams SET ally = NULL WHERE ally = ?').bind(p.team), env.DB.prepare('UPDATE teams SET ally = ? WHERE id = ?').bind(t.id, p.team), env.DB.prepare('UPDATE teams SET ally = ? WHERE id = ?').bind(p.team, t.id)]);
      return json({ ok: true });
    }
    if (path === 'wsticket' && req.method === 'POST') {
      await env.DB.prepare('DELETE FROM ws_tickets WHERE created < ?').bind(now - 13 * 3600 * 1000).run();
      const t = randToken();
      await env.DB.prepare('INSERT INTO ws_tickets (token, player, created) VALUES (?, ?, ?)').bind(t, p.id, now).run();
      return json({ ok: true, ticket: t, gx: Math.round(p.wx / SPACING), gy: Math.round(p.wy / SPACING), now });
    }
    if (path === 'relocate' && req.method === 'POST') {
      const fl = p.flags ? JSON.parse(p.flags) : {};
      if (!fl.migration) return bad('Research Migration first');
      // villages sit on a fixed plot grid so the live world can lay them side by side
      const b = await body(), x = Math.round(Number(b.x) / SPACING) * SPACING, y = Math.round(Number(b.y) / SPACING) * SPACING;
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 5000 || Math.abs(y) > 5000) return bad('Pick a spot on the map');
      const near = await env.DB.prepare('SELECT name FROM players WHERE id != ? AND wx BETWEEN ? AND ? AND wy BETWEEN ? AND ? LIMIT 1').bind(p.id, x - 7, x + 7, y - 7, y + 7).first();
      if (near) return bad(`Too close to ${near.name} — pick open land`);
      const out = await env.DB.prepare("SELECT COUNT(*) n FROM marches WHERE owner = ? AND status = 'out'").bind(p.id).first();
      if (out.n) return bad('Wait for your crews to come home first');
      // moving costs your stockpile: resources go back to the starting amounts
      const sv = p.save ? JSON.parse(p.save) : null;
      if (sv) { sv.res = { food: 10, wood: 12, stone: 0, iron: 0, coal: 0, steel: 0, planks: 0, gears: 0, copper: 6, silver: 0, gold: 0 }; sv.t = now; }
      await env.DB.prepare('UPDATE players SET wx = ?, wy = ?, save = COALESCE(?, save), save_t = ? WHERE id = ?').bind(x, y, sv ? JSON.stringify(sv) : null, now, p.id).run();
      await clearWild(env.DB, x, y);
      return json({ ok: true, x, y });
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

    // the world around a viewport: villages, wild nodes and every crew on the road
    if (path === 'world' && req.method === 'GET') {
      await settle(env.DB, now);
      const q = k => Math.round(Number(url.searchParams.get(k)) || 0);
      let x0 = q('x0'), y0 = q('y0'), x1 = q('x1'), y1 = q('y1');
      if (x1 < x0 || y1 < y0) return bad('bad box');
      if (x1 - x0 > VIEW_MAX) { const c = (x0 + x1) >> 1; x0 = c - VIEW_MAX / 2; x1 = c + VIEW_MAX / 2; }
      if (y1 - y0 > VIEW_MAX) { const c = (y0 + y1) >> 1; y0 = c - VIEW_MAX / 2; y1 = c + VIEW_MAX / 2; }
      await ensureChunks(env.DB, x0, y0, x1, y1);
      const villages = (await env.DB.prepare('SELECT id, name, wx x, wy y, team, score, level, bcount, created, seen, flags, harvested_at FROM players WHERE wx BETWEEN ? AND ? AND wy BETWEEN ? AND ?').bind(x0 - 2, x1 + 2, y0 - 2, y1 + 2).all()).results
        .map(v => { const f = flagsOfRow(v); delete v.flags; return { ...v, shield: now - v.created < SHIELD_MS, treaty: !!(f.treaty && now - (v.harvested_at || 0) < TREATY_MS), online: now - v.seen < 120000, palisade: !!f.palisade, banner: !!f.banner, tier: f.tier || 0 }; });
      const wild = (await env.DB.prepare('SELECT id, x, y, type, amt, max, regrow FROM wild WHERE x BETWEEN ? AND ? AND y BETWEEN ? AND ?').bind(x0, x1, y0, y1).all()).results;
      const marches = (await env.DB.prepare(`SELECT ${MARCH_COLS} FROM marches WHERE status IN ('out', 'back') AND MAX(fx, tx) >= ? AND MIN(fx, tx) <= ? AND MAX(fy, ty) >= ? AND MIN(fy, ty) <= ? LIMIT 400`).bind(x0, x1, y0, y1).all()).results;
      return json({ ok: true, now, me: pub(p), villages, wild, marches, box: [x0, y0, x1, y1] });
    }
    if (path === 'board' && req.method === 'GET') {
      const players = (await env.DB.prepare('SELECT id, name, wx x, wy y, team, score, level, bcount, created, seen, flags, harvested_at FROM players ORDER BY score DESC LIMIT 100').all()).results
        .map(x => { const f = flagsOfRow(x); delete x.flags; return { ...x, shield: now - x.created < SHIELD_MS, treaty: !!(f.treaty && now - (x.harvested_at || 0) < TREATY_MS), online: now - x.seen < 120000, palisade: !!f.palisade, banner: !!f.banner, tier: f.tier || 0 }; });
      const rank = (await env.DB.prepare('SELECT COUNT(*) n FROM players WHERE score > ?').bind(p.score || 0).first()).n + 1;
      const total = (await env.DB.prepare('SELECT COUNT(*) n FROM players').first()).n;
      const guests = await env.DB.prepare('SELECT COUNT(*) n, COALESCE(SUM(last > ?), 0) week FROM guests').bind(now - 7 * 86400000).first();
      const teams = (await env.DB.prepare('SELECT t.id, t.name, t.ally, COALESCE(t.wonder,0) wonder, COUNT(p.id) members, COALESCE(SUM(p.score),0) score FROM teams t LEFT JOIN players p ON p.team = t.id WHERE t.orb = ? GROUP BY t.id ORDER BY score DESC').bind(p.orb).all()).results;
      return json({ ok: true, me: pub(p), rank, total, guests: guests.n, guestsWeek: guests.week, players, teams, limits: { teams: MAX_TEAMS, teamMax: TEAM_MAX }, wonderGoal: WONDER_GOAL });
    }
    // send a crew: raid a village, gather at a wild node, or intercept a raid on the road
    if (path === 'march' && req.method === 'POST') {
      await settle(env.DB, now);
      const b = await body(), kind = b.kind, crew = Math.max(1, Math.min(5, Math.floor(Number(b.crew) || 1)));
      const fl = flagsOfRow(p);
      const out = await env.DB.prepare("SELECT COALESCE(SUM(crew), 0) n FROM marches WHERE owner = ? AND status != 'done'").bind(p.id).first();
      if (out.n + crew > MAX_CREWS + (fl.bigcrews ? 2 : 0)) return bad(`Too many workers on the road (max ${MAX_CREWS + (fl.bigcrews ? 2 : 0)})`);
      const ins = (o) => env.DB.prepare(`INSERT INTO marches (kind, owner, owner_name, owner_team, target, target_name, target_player, fx, fy, tx, ty, crew, start, arrive, back_at, ret, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'out')`)
        .bind(kind, p.id, p.name, p.team || null, o.target, o.target_name || null, o.target_player || null, p.wx, p.wy, o.tx, o.ty, crew, now, o.arrive, o.back_at, o.ret).run();
      if (kind === 'raid') {
        const tg = await env.DB.prepare('SELECT * FROM players WHERE id = ?').bind(Number(b.target)).first();
        if (!tg || tg.id === p.id) return bad('Pick another village');
        if (p.team && tg.team === p.team) return bad('Teammates are immune');
        if (p.team && tg.team) { const mt = await env.DB.prepare('SELECT ally FROM teams WHERE id = ?').bind(p.team).first(); if (mt && mt.ally === tg.team) return bad('Allied teams are immune'); }
        if (now - tg.created < SHIELD_MS) return bad(`${tg.name} is under new-player protection`);
        const tf = flagsOfRow(tg);
        if (tf.treaty && now - (tg.harvested_at || 0) < TREATY_MS) return bad(`${tg.name} is under a peace treaty`);
        const go = travelSecs(dist(p.wx, p.wy, tg.wx, tg.wy), fl.fastcrews) * (tf.palisade ? 2 : 1) * 1000, back = travelSecs(dist(p.wx, p.wy, tg.wx, tg.wy), fl.fastcrews) * 1000;
        const r = await ins({ target: tg.id, target_name: tg.name, target_player: tg.id, tx: tg.wx, ty: tg.wy, arrive: now + go, back_at: now + go, ret: now + go + back });
        return json({ ok: true, id: r.meta.last_row_id, now, arrive: now + go, ret: now + go + back });
      }
      if (kind === 'gather') {
        const node = await env.DB.prepare('SELECT * FROM wild WHERE id = ?').bind(Number(b.target)).first();
        if (!node) return bad('That spot is gone');
        if (node.amt <= 0) return bad('Picked clean — it grows back soon');
        const t = travelSecs(dist(p.wx, p.wy, node.x, node.y), fl.fastcrews) * 1000, arrive = now + t, back_at = arrive + WORK_SECS * 1000;
        const r = await ins({ target: node.id, target_name: node.type, tx: node.x, ty: node.y, arrive, back_at, ret: back_at + t });
        return json({ ok: true, id: r.meta.last_row_id, now, arrive, ret: back_at + t });
      }
      if (kind === 'intercept') {
        const raid = await env.DB.prepare('SELECT * FROM marches WHERE id = ?').bind(Number(b.target)).first();
        if (!raid || raid.kind !== 'raid' || raid.status !== 'out') return bad('That crew is no longer on the road');
        const tgt = await env.DB.prepare('SELECT team FROM players WHERE id = ?').bind(raid.target).first();
        if (raid.target !== p.id && !(p.team && tgt && tgt.team === p.team)) return bad('You can only intercept raids on you or your teammates');
        // find the first moment our crew can reach the raiders on their road
        const speed = 1 / (4 * (fl.watchtower ? .5 : 1) * (fl.fastcrews ? .7 : 1));   // tiles per second after a 15s muster
        const at = s => { const f = Math.min(1, Math.max(0, (s - raid.start) / (raid.arrive - raid.start))); return [raid.fx + (raid.tx - raid.fx) * f, raid.fy + (raid.ty - raid.fy) * f]; };
        let meet = null;
        for (let s = now + 1000; s < raid.arrive - 2000; s += 1000) { const [x, y] = at(s), need = 15 + dist(p.wx, p.wy, x, y) / speed; if (need * 1000 <= s - now) { meet = [s, x, y]; break; } }
        if (!meet) return bad('Too late — they will reach the village before your crew can catch them');
        const back = travelSecs(dist(p.wx, p.wy, meet[1], meet[2]), fl.fastcrews) * 1000;
        const r = await ins({ target: raid.id, target_name: raid.owner_name, target_player: raid.owner, tx: meet[1], ty: meet[2], arrive: meet[0], back_at: meet[0], ret: meet[0] + back });
        return json({ ok: true, id: r.meta.last_row_id, now, arrive: meet[0], ret: meet[0] + back });
      }
      return bad('unknown crew type');
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
        if (n.n >= MAX_TEAMS) return bad(`The world already has ${MAX_TEAMS} teams`);
        const r = await env.DB.prepare('INSERT INTO teams (orb, name, created) VALUES (?, ?, ?)').bind(p.orb, name, now).run();
        await env.DB.prepare('UPDATE players SET team = ? WHERE id = ?').bind(r.meta.last_row_id, p.id).run();
        await env.DB.prepare('DELETE FROM teams WHERE orb = ? AND id NOT IN (SELECT team FROM players WHERE team IS NOT NULL)').bind(p.orb).run();
        return json({ ok: true, team: r.meta.last_row_id });
      }
      if (b.action === 'join') {
        const t = await env.DB.prepare('SELECT * FROM teams WHERE id = ? AND orb = ?').bind(Number(b.id), p.orb).first();
        if (!t) return bad('No such team');
        const n = await env.DB.prepare('SELECT COUNT(*) n FROM players WHERE team = ?').bind(t.id).first();
        if (n.n >= TEAM_MAX) return bad(`Team is full (${TEAM_MAX})`);
        await env.DB.prepare('UPDATE players SET team = ? WHERE id = ?').bind(t.id, p.id).run();
        await env.DB.prepare('DELETE FROM teams WHERE orb = ? AND id NOT IN (SELECT team FROM players WHERE team IS NOT NULL)').bind(p.orb).run();
        return json({ ok: true });
      }
      return bad('unknown action');
    }

    return bad('not found', 404);
  } catch (e) {
    return bad('server error: ' + (e && e.message || e), 500);
  }
}
