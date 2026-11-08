/* GSD: Get Stuff Done — research, ages, civs, prestige, late-game buildings.
   Loaded before game.js; everything here runs only when called, after game.js has defined its globals. */
'use strict';

// ---------------------------------------------------------------- pacing (~60h to top tier)
const RT_MIN = [0, 1, 3, 7, 14, 25, 40, 60, 85, 120];       // research minutes by tier (level 1)
const RCOST = [null,
  { wood: 30, money: 10 },
  { wood: 60, stone: 20, money: 25 },
  { wood: 120, stone: 60, iron: 10, money: 50 },
  { stone: 150, iron: 40, coal: 30, money: 100 },
  { stone: 250, iron: 80, steel: 20, money: 200 },
  { planks: 60, steel: 40, gold: 10, money: 400 },
  { planks: 150, steel: 100, gold: 30, money: 800 },
  { gears: 60, steel: 250, gold: 60, money: 1500 },
  { gears: 150, steel: 500, gold: 150, money: 3000 },
];
const AGE_NAME = { 6: 'Bronze Age', 7: 'Iron Age', 8: 'Industrial Age', 9: 'Digital Age' };
const PRESTIGE_COST = { gold: 200, steel: 200, money: 2000 };

// ---------------------------------------------------------------- research catalog
// #  = number on the 100-upgrade list. Buildings on the list live in EXTRA_BLD below.
const UPG = [
  // Food
  { id: 'baskets', no: 1, n: 'Berry Baskets', cat: 'Food', tier: 1, max: 3, d: '+1 food per berry trip per level' },
  { id: 'bow', no: 2, n: 'Bow Hunting', cat: 'Food', tier: 2, req: ['hunt'], d: 'Hunting +3 food' },
  { id: 'tracking', no: 3, n: 'Tracking', cat: 'Food', tier: 2, req: ['hunt'], d: '+50% deer on the map' },
  { id: 'irrigation', no: 4, n: 'Irrigation', cat: 'Food', tier: 3, req: ['farm'], d: 'Farm harvest 20% faster' },
  { id: 'rotation', no: 5, n: 'Crop Rotation', cat: 'Food', tier: 3, req: ['farm'], d: 'Farm +2 food' },
  { id: 'granary', no: 6, n: 'Granary', cat: 'Food', tier: 4, d: 'Food spoils above 300 — Granary raises the cap to 2,300' },
  { id: 'smokehouse', no: 7, n: 'Smokehouse', cat: 'Food', tier: 4, d: 'Workers eat every 75s instead of 60s' },
  { id: 'feast', no: 10, n: 'Feast Hall', cat: 'Food', tier: 5, d: '+10% work speed while food is above 200' },
  // Wood
  { id: 'axes', no: 11, n: 'Sharp Axes', cat: 'Wood', tier: 1, max: 3, d: 'Chopping 10% faster per level' },
  { id: 'doublebit', no: 12, n: 'Double-Bit Axe', cat: 'Wood', tier: 2, d: '10% chance of a double wood trip' },
  { id: 'forestry', no: 13, n: 'Forestry', cat: 'Wood', tier: 5, d: 'Felled trees regrow after 10 minutes' },
  { id: 'sled', no: 15, n: 'Log Sled', cat: 'Wood', tier: 3, d: 'Wood trips 15% faster' },
  { id: 'hardwood', no: 17, n: 'Hardwood', cat: 'Wood', tier: 4, d: 'Trees hold +5 trips' },
  { id: 'lumber2', no: 18, n: 'Lumber Yard II', cat: 'Wood', tier: 4, req: ['lumber'], d: 'Lumber Camp bonus ×2 → ×3' },
  { id: 'charcoal', no: 19, n: 'Charcoal Efficiency', cat: 'Wood', tier: 4, req: ['kiln'], d: 'Kiln uses 1 wood per coal' },
  { id: 'timber', no: 20, n: 'Timber Frames', cat: 'Wood', tier: 5, d: 'Buildings cost 15% less wood' },
  // Stone & ore
  { id: 'picks', no: 21, n: 'Iron Picks', cat: 'Stone & Ore', tier: 2, max: 3, req: ['quarry'], d: 'Quarrying 10% faster per level' },
  { id: 'deepquarry', no: 22, n: 'Deep Quarry', cat: 'Stone & Ore', tier: 4, d: 'Rocks hold +8 trips' },
  { id: 'carts', no: 23, n: 'Stone Carts', cat: 'Stone & Ore', tier: 3, d: 'Stone trips 15% faster' },
  { id: 'shafts', no: 24, n: 'Mine Shafts', cat: 'Stone & Ore', tier: 4, max: 3, req: ['mine'], d: 'Mine +1 iron per level' },
  { id: 'vein', no: 25, n: 'Copper Vein', cat: 'Stone & Ore', tier: 4, req: ['mine'], d: 'Mine +1 copper' },
  { id: 'seam', no: 26, n: 'Silver Seam', cat: 'Stone & Ore', tier: 5, req: ['mine'], d: 'Silver every 2nd mine trip instead of 3rd' },
  { id: 'prospect', no: 27, n: 'Prospecting', cat: 'Stone & Ore', tier: 6, d: 'Reveals gold rocks on the map (+1 gold per trip)' },
  { id: 'blastpowder', no: 28, n: 'Blast Powder', cat: 'Stone & Ore', tier: 5, req: ['mine'], d: 'Mine trips 25% faster' },
  { id: 'masonry', no: 29, n: 'Masonry', cat: 'Stone & Ore', tier: 5, d: 'Buildings cost 15% less stone' },
  // Industry
  { id: 'bellows', no: 31, n: 'Bellows', cat: 'Industry', tier: 5, req: ['smelter'], d: 'Smelting 20% faster' },
  { id: 'crucible', no: 33, n: 'Crucible Steel', cat: 'Industry', tier: 6, d: '10% chance of double steel' },
  { id: 'coinpress', no: 34, n: 'Coin Press', cat: 'Industry', tier: 6, req: ['mint'], d: 'Mint strikes 2 gold per steel' },
  { id: 'assay', no: 35, n: 'Assay Office', cat: 'Industry', tier: 6, d: 'Gold sells for 20% more at the Market' },
  { id: 'toolsmith', no: 37, n: 'Toolsmith', cat: 'Industry', tier: 6, d: 'Copper Shop tools cost 25% less' },
  // Housing & workers
  { id: 'bunks', no: 41, n: 'Bunk Beds', cat: 'Workers', tier: 2, max: 3, d: 'Each Hut houses +1 per level' },
  { id: 'recruit', no: 44, n: 'Recruitment Office', cat: 'Workers', tier: 5, d: 'Every 3rd win counts double toward recruits' },
  { id: 'training', no: 45, n: 'Training Yard', cat: 'Workers', tier: 5, d: 'Workers recruited after this work 10% faster' },
  { id: 'ranks', no: 46, n: 'Worker Ranks', cat: 'Workers', tier: 4, d: 'Workers gain +2% speed per 25 trips (max +40%)' },
  { id: 'specialists', no: 47, n: 'Specialists', cat: 'Workers', tier: 5, d: '+25% speed after 5 trips in a row on one job' },
  { id: 'lunch', no: 48, n: 'Lunch Breaks', cat: 'Workers', tier: 3, d: 'Hungry workers run at 75% instead of 50%' },
  { id: 'roads', no: 49, n: 'Roads', cat: 'Workers', tier: 4, d: 'All gathering trips 10% faster' },
  { id: 'wagons', no: 50, n: 'Wagons', cat: 'Workers', tier: 6, d: 'Gathering trips carry double but take 1.5× as long' },
  // Economy
  { id: 'caravan', no: 54, n: 'Trade Caravan', cat: 'Economy', tier: 7, d: 'Send resources to a teammate (World tab)' },
  { id: 'auction', no: 55, n: 'Auction House', cat: 'Economy', tier: 8, d: 'List resources for sale to every player (World tab)' },
  { id: 'silverex', no: 56, n: 'Silver Exchange', cat: 'Economy', tier: 6, d: 'Market converts copper ↔ silver ↔ gold' },
  { id: 'vault', no: 57, n: 'Vault', cat: 'Economy', tier: 6, d: 'Harvest crews take half as much from you' },
  { id: 'treasury', no: 58, n: 'Treasury', cat: 'Economy', tier: 3, max: 5, d: 'Speedup bank holds +30 min per level (base 2h)' },
  { id: 'guild', no: 59, n: 'Merchant Guild', cat: 'Economy', tier: 6, d: 'Copper Shop prices 10% lower' },
  { id: 'lucky', no: 60, n: 'Lucky Coin', cat: 'Economy', tier: 4, d: '5% chance to double puzzle copper' },
  // Puzzle
  { id: 'xmoves', no: 61, n: 'Extra Moves', cat: 'Puzzle', tier: 2, max: 3, d: '+1 starting move per level' },
  { id: 'rocketstart', no: 62, n: 'Rocket Start', cat: 'Puzzle', tier: 3, d: 'Every puzzle starts with a Row Clear' },
  { id: 'bombstart', no: 63, n: 'Bomb Start', cat: 'Puzzle', tier: 4, d: 'Every puzzle starts with a Bomb' },
  { id: 'propstart', no: 64, n: 'Propeller Start', cat: 'Puzzle', tier: 5, d: 'Every puzzle starts with a Propeller' },
  { id: 'colorstart', no: 65, n: 'Color Bomb Start', cat: 'Puzzle', tier: 7, d: 'Every puzzle starts with a Color Bomb' },
  { id: 'combomaster', no: 66, n: 'Combo Master', cat: 'Puzzle', tier: 6, d: 'Rocket combos clear 5 rows + 5 columns; bombs blast 5×5' },
  { id: 'streak', no: 67, n: 'Streak Bonus', cat: 'Puzzle', tier: 5, d: '3+ wins in a row: start with a random special' },
  { id: 'secondchance', no: 68, n: 'Second Chance', cat: 'Puzzle', tier: 4, d: 'First failed puzzle each day gets +5 free moves' },
  { id: 'effmoves', no: 69, n: 'Efficient Moves', cat: 'Puzzle', tier: 3, d: 'Leftover moves give 30s speedup instead of 20s' },
  { id: 'daily', no: 70, n: 'Daily Challenge', cat: 'Puzzle', tier: 6, d: 'A hard bonus puzzle once a day: 50 copper, 5 gold, 10 min speedup' },
  // Defense & PvP
  { id: 'walls', no: 73, n: 'Stone Walls', cat: 'Defense', tier: 7, d: 'Harvesters take 20% instead of 33%' },
  { id: 'militia', no: 74, n: 'Militia', cat: 'Defense', tier: 7, d: '25% chance to repel a raid at the gate; +1 strength for your interceptors' },
  { id: 'decoys', no: 75, n: 'Decoy Huts', cat: 'Defense', tier: 7, d: 'The first harvest each day hits a decoy' },
  { id: 'fastcrews', no: 76, n: 'Fast Crews', cat: 'Defense', tier: 6, d: 'Your crews travel 30% faster on the world map' },
  { id: 'bigcrews', no: 77, n: 'Big Crews', cat: 'Defense', tier: 8, d: 'Harvest crews take 2 buildings' },
  { id: 'scout', no: 78, n: 'Scouting', cat: 'Defense', tier: 6, d: 'See a village\'s buildings before you send a crew' },
  { id: 'spoils', no: 79, n: 'Spoils of War', cat: 'Defense', tier: 8, d: 'Your harvests take 40% instead of 33%' },
  { id: 'treaty', no: 80, n: 'Peace Treaty', cat: 'Defense', tier: 7, d: '8h protection after you\'re harvested' },
  // World & teams
  { id: 'storage', no: 82, n: 'Shared Storage', cat: 'World', tier: 7, d: 'Team bank: deposit and withdraw with teammates' },
  { id: 'wonder', no: 83, n: 'Team Wonder', cat: 'World', tier: 9, d: 'Contribute to your team\'s Wonder: +10% gathering for the whole team when done' },
  { id: 'orbmap', no: 84, n: 'World Map', cat: 'World', tier: 5, d: 'Village names on the world map at every zoom' },
  { id: 'expansion', no: 85, n: 'Expansion', cat: 'World', tier: 8, d: 'Claims new land: fresh forests and rock fields, +8 build slots' },
  { id: 'envoy', no: 87, n: 'Envoy', cat: 'World', tier: 8, d: 'Your team can ally with one other team (allies can\'t harvest each other)' },
  { id: 'banner', no: 88, n: 'Seasonal Banner', cat: 'World', tier: 6, d: 'Crown on your name while you\'re top 10 in the world' },
  { id: 'events', no: 89, n: 'World Events', cat: 'World', tier: 7, d: 'Join the weekly world-wide goal for a group reward' },
  { id: 'migration', no: 90, n: 'Migration', cat: 'World', tier: 6, d: 'Move your village to open land on the map: keep buildings, workers and research; resources reset' },
  // Ages
  { id: 'age6', no: 91, n: 'Bronze Age', cat: 'Ages', tier: 5, req: ['townhall'], d: 'Unlocks tier 6: Sawmill, Market, Docks and more', age: true },
  { id: 'age7', no: 92, n: 'Iron Age', cat: 'Ages', tier: 6, req: ['age6', 'sawmill'], d: 'Unlocks tier 7: Blast Furnace, Gearworks, Bank, Barracks', age: true },
  { id: 'age8', no: 93, n: 'Industrial Age', cat: 'Ages', tier: 7, req: ['age7', 'gearworks'], d: 'Unlocks tier 8: Factory, Power Plant, Outpost', age: true },
  { id: 'age9', no: 94, n: 'Digital Age', cat: 'Ages', tier: 8, req: ['age8', 'factory'], d: 'Tier 9 + AI workers work 50% faster (GSD Automation)', age: true },
];
const UPGI = Object.fromEntries(UPG.map(u => [u.id, u]));

// buildings on the list (tier 6–9). time in seconds.
const EXTRA_BLD = {
  sawmill:   { no: 16, n: 'Sawmill', tier: 6, time: 900, req: ['age6'], cost: { wood: 300, stone: 150, steel: 20, money: 150 }, desc: '2 wood → 1 plank' },
  market:    { no: 51, n: 'Market', tier: 6, time: 900, req: ['age6'], cost: { wood: 250, stone: 200, money: 200 }, desc: 'Trade resources for copper (tap it, or Build tab)' },
  taxoffice: { no: 53, n: 'Tax Office', tier: 6, time: 900, req: ['age6'], cost: { stone: 300, steel: 30, money: 250 }, desc: '+1 copper per worker per hour' },
  workshop:  { no: 36, n: 'Workshop', tier: 6, time: 900, req: ['age6'], cost: { wood: 300, iron: 80, money: 200 }, desc: 'Crafts a free puzzle tool every 30 min' },
  longhouse: { no: 42, n: 'Longhouse', tier: 6, time: 900, house: 6, repeat: true, req: ['age6'], cost: { wood: 400, stone: 200, planks: 20 }, desc: 'Houses 6 AI workers' },
  dock:      { no: 9, n: 'Fishing Dock', tier: 6, time: 900, req: ['age6'], cost: { wood: 350, stone: 100, money: 100 }, desc: 'Endless fish: +4 food per trip' },
  orchard:   { no: 8, n: 'Orchard', tier: 6, time: 900, req: ['age6'], cost: { wood: 200, food: 300, money: 100 }, desc: 'Picked-out berry bushes regrow after 10 min' },
  nursery:   { no: 14, n: 'Tree Nursery', tier: 6, time: 900, req: ['age6'], cost: { wood: 200, stone: 100, money: 100 }, desc: 'Plants a new tree every 5 min' },
  palisade:  { no: 71, n: 'Palisade', tier: 6, time: 900, req: ['age6'], cost: { wood: 600, planks: 40 }, desc: 'Harvest crews take twice as long to reach you' },
  watchtower:{ no: 72, n: 'Watchtower', tier: 6, time: 900, req: ['age6'], cost: { stone: 400, planks: 30 }, desc: 'Your interceptor crews move twice as fast' },
  blastfurnace: { no: 32, n: 'Blast Furnace', tier: 7, time: 1800, req: ['age7'], cost: { stone: 600, steel: 80, planks: 60, money: 400 }, desc: '2 iron + 1 coal → 2 steel' },
  gearworks: { no: 38, n: 'Gearworks', tier: 7, time: 1800, req: ['age7'], cost: { stone: 500, steel: 120, planks: 80, money: 400 }, desc: '1 steel + 2 planks → 1 gear' },
  bank:      { no: 52, n: 'Bank', tier: 7, time: 1800, req: ['age7', 'market'], cost: { stone: 600, steel: 100, gold: 20, money: 500 }, desc: 'Copper earns 1% per hour (max 100/h)' },
  barracks:  { no: 43, n: 'Barracks', tier: 7, time: 1800, house: 10, repeat: true, req: ['age7'], cost: { stone: 600, planks: 120, steel: 60 }, desc: 'Houses 10 AI workers' },
  quarry2:   { no: 30, n: 'Deep Quarry Pit', tier: 7, time: 1800, req: ['age7'], cost: { wood: 400, steel: 80, money: 300 }, desc: 'Endless stone: +3 per trip' },
  teamhall:  { no: 81, n: 'Team Hall', tier: 7, time: 1800, req: ['age7'], cost: { stone: 500, planks: 100, gold: 20 }, desc: '+5% gathering while you\'re on a team' },
  factory:   { no: 39, n: 'Factory', tier: 8, time: 3600, req: ['age8'], cost: { steel: 400, gears: 60, planks: 200, money: 1000 }, desc: 'Makes 1 steel a minute from iron + coal, no worker needed' },
  powerplant:{ no: 40, n: 'Power Plant', tier: 8, time: 3600, req: ['age8'], cost: { steel: 500, gears: 100, coal: 300, money: 1200 }, desc: 'Industry jobs 10% faster' },
  outpost:   { no: 86, n: 'Outpost', tier: 8, time: 3600, req: ['age8'], cost: { planks: 300, steel: 300, gold: 40 }, desc: '+10% gathering' },
  gsdtower:  { no: 98, n: 'Wonder: GSD Tower', tier: 9, time: 14400, req: ['age9'], cost: { steel: 1500, gears: 400, gold: 300, money: 5000 }, desc: '+1 AI worker every 5 puzzle wins' },
  moneyprinter: { no: 99, n: 'Wonder: Money Printer', tier: 9, time: 14400, req: ['age9'], cost: { steel: 1200, gears: 500, gold: 400, money: 6000 }, desc: 'Prints 1 gold every 10 minutes' },
};
const EXTRA_TASKS = {
  fish:  { n: 'Fish', node: 'dock', time: 25, gain: { food: 4 }, req: 'dock' },
  stone2:{ n: 'Dig the pit', node: 'quarry2', time: 30, gain: { stone: 3 }, req: 'quarry2' },
  dig:   { n: 'Cut stone at the Quarry', node: 'quarry', time: 45, gain: { stone: 1 }, req: 'quarry' },   // endless fallback once rocks run out
  saw:   { n: 'Saw planks', node: 'sawmill', time: 30, cost: { wood: 2 }, gain: { planks: 1 }, req: 'sawmill' },
  blast: { n: 'Run the furnace', node: 'blastfurnace', time: 45, cost: { iron: 2, coal: 1 }, gain: { steel: 2 }, req: 'blastfurnace' },
  gear:  { n: 'Cut gears', node: 'gearworks', time: 60, cost: { steel: 1, planks: 2 }, gain: { gears: 1 }, req: 'gearworks' },
  pan:   { n: 'Pan for gold', node: 'goldrock', time: 60, gain: { gold: 1 }, req: 'prospect' },
};
const INDUSTRY = ['coal', 'smelt', 'strike', 'blast', 'gear', 'saw'];
const CIVS = {
  gsd: { n: 'GSD Consultants', d: 'The Developers: every building costs 10% less', no: 95 },
  angm: { n: 'Act Now, Get Money', d: 'The Money civ: +20% copper from every source', no: 96 },
  client: { n: 'Your brand here', d: 'Client civ slots — sponsorship coming soon', no: 97, locked: true },
};

// ---------------------------------------------------------------- state helpers
const U = id => (S && S.upg && S.upg[id]) || 0;
const PRES = () => (S && S.prestige) || 0;
function reqMet(r) { return BLD[r] ? hasB(r) : U(r) > 0; }
function reqName(r) { return BLD[r] ? BLD[r].n : UPGI[r] ? UPGI[r].n : r; }
function tierNow() {
  for (let a = 9; a >= 6; a--) if (U('age' + a)) return a;
  let t = 1; for (const b of S.buildings) if (b.done && BLD[b.type] && BLD[b.type].tier > t && BLD[b.type].tier <= 5) t = BLD[b.type].tier;
  return t;
}
function upgCost(u, lvl) {
  const base = u.cost || RCOST[u.tier], m = Math.pow(1.8, lvl), out = {};
  for (const k in base) out[k] = Math.round(base[k] * m * (u.age ? 3 : 1));
  return out;
}
function upgTime(u, lvl) { return Math.round(RT_MIN[u.tier] * 60 * Math.pow(1.7, lvl) * (u.age ? 2 : 1)); }
function upgOpen(u) { return tierNow() >= u.tier && (!u.req || u.req.every(reqMet)); }

// ---------------------------------------------------------------- effects used by game.js
function starveMul() { return U('lunch') ? .75 : .5; }
function eatEvery() { return U('smokehouse') ? 75 : 60; }
function foodCap() { return 300 + (U('granary') ? 2000 : 0); }
function bankCap() { return 7200 + 1800 * U('treasury'); }
function perMove() { return U('effmoves') ? 30 : 20; }
function toolCost(k) { return Math.round(TOOLS[k].cost * (U('toolsmith') ? .75 : 1) * (U('guild') ? .9 : 1)); }
function workerSpeed(w) {
  let f = 1 + .05 * PRES();
  if (U('ranks')) f *= 1 + .02 * Math.min(20, Math.floor((w.trips || 0) / 25));
  if (U('specialists') && (w.streak || 0) >= 5) f *= 1.25;
  if (w.trained) f *= 1.1;
  if (U('feast') && S.res.food > 200) f *= 1.1;
  if (U('age9')) f *= 1.5;
  if (hasB('teamhall') && typeof ME !== 'undefined' && ME && ME.team) f *= 1.05;
  if (hasB('outpost')) f *= 1.1;
  if (S.teamWonder) f *= 1.1;
  return f;
}
function taskTime(w, kind) {
  let t = TASKS[kind].time;
  if (kind === 'chop') t *= (1 - .1 * U('axes')) * (U('sled') ? .85 : 1);
  if (kind === 'stone' || kind === 'stone2' || kind === 'dig') t *= (1 - .1 * U('picks')) * (U('carts') ? .85 : 1);
  if (kind === 'farm' && U('irrigation')) t *= .8;
  if (kind === 'mine' && U('blastpowder')) t *= .75;
  if ((kind === 'smelt' || kind === 'blast') && U('bellows')) t *= .8;
  if (INDUSTRY.includes(kind) && hasB('powerplant')) t *= .9;
  if (!INDUSTRY.includes(kind) && U('roads')) t *= .9;
  if (!INDUSTRY.includes(kind) && U('wagons')) t *= 1.5;
  return t / workerSpeed(w);
}
function taskCost(kind) {
  if (kind === 'coal' && U('charcoal')) return { wood: 1 };
  return TASKS[kind].cost;
}
function mkTask(w, kind, target, prog = 0) {
  if (w.lastKind === kind) w.streak = (w.streak || 0) + 1; else { w.streak = 0; w.lastKind = kind; }
  return { kind, dur: taskTime(w, kind), prog, target };
}
function yieldMods(kind, y, w) {
  if (kind === 'chop' && hasB('lumber') && U('lumber2')) for (const k in y) y[k] = Math.round(y[k] * 1.5);
  if (kind === 'berries') y.food += U('baskets');
  if (kind === 'hunt') y.food += 3 * U('bow');
  if (kind === 'farm') y.food += 2 * U('rotation');
  if (kind === 'mine') { y.iron += U('shafts'); y.copper += U('vein'); }
  if (kind === 'strike' && U('coinpress')) y.gold = 2;
  if (!INDUSTRY.includes(kind) && U('wagons')) for (const k in y) y[k] *= 2;
  return y;
}
function rollBonuses(kind, y) {
  if (kind === 'chop' && U('doublebit') && Math.random() < .1) for (const k in y) y[k] *= 2;
  if ((kind === 'smelt' || kind === 'blast') && U('crucible') && Math.random() < .1) y.steel *= 2;
  if (y.copper && S.civ === 'angm') y.copper = luckyRound(y.copper * 1.2);
  if (PRES()) for (const k in y) y[k] = luckyRound(y[k] * (1 + .05 * PRES()));
  return y;
}
function luckyRound(v) { const f = Math.floor(v); return f + (Math.random() < v - f ? 1 : 0); }
function silverEvery() { return U('seam') ? 2 : 3; }
function buildCost(type, c) {
  if (!c) return c;
  const out = {};
  for (const k in c) {
    let v = c[k];
    if (k === 'wood' && U('timber')) v *= .85;
    if (k === 'stone' && U('masonry')) v *= .85;
    if (S.civ === 'gsd') v *= .9;
    out[k] = Math.max(1, Math.round(v));
  }
  return out;
}
function hutHouse() { return 3 + U('bunks'); }
function treeBonus() { return U('hardwood') ? 5 : 0; }
function rockBonus() { return U('deepquarry') ? 8 : 0; }
function deerCount() { return U('tracking') ? 11 : 7; }
function puzzleCopper(c) { if (U('lucky') && Math.random() < .05) { toast('Lucky Coin: double copper!'); c *= 2; } if (S.civ === 'angm') c = Math.round(c * 1.2); return c; }

// ---------------------------------------------------------------- research
function startResearch(id) {
  const u = UPGI[id], lvl = U(id);
  if (S.rs) return toast('Already researching — speed it up or wait');
  if (!upgOpen(u) || lvl >= (u.max || 1)) return;
  const c = upgCost(u, lvl);
  if (!canPay(c)) return toast('Not enough resources');
  pay(c); S.rs = { id, prog: 0, dur: upgTime(u, lvl) };
  sfx('build'); toast(`Researching ${u.n}`); save(); refresh(true);
}
function finishResearch(quiet) {
  const id = S.rs.id, u = UPGI[id];
  S.upg = S.upg || {}; S.upg[id] = (S.upg[id] || 0) + 1; S.rs = null;
  if (id === 'tracking' || id === 'prospect' || id === 'hardwood' || id === 'deepquarry') { genMap(S.seed); S.buildings.forEach(b => { MAP.node[b.j * W + b.i] = null; }); }
  if (id === 'expansion') expandLand();
  if (u.age) { if (!quiet) modal(`<h2>${u.n}!</h2><p>${u.d}.</p><div class="btns"><button class="btn go" data-close>Onward</button></div>`); }
  if (!quiet) { toast(`${u.n} researched`); sfx('recruit'); }
  layerDirty = true; save();
}
function speedResearch(amt) {
  if (!S.rs || S.bank <= 0) return;
  const need = S.rs.dur - S.rs.prog, use = Math.min(S.bank, need, amt === 'all' ? Infinity : +amt);
  S.bank -= use; S.rs.prog += use; sfx('coin'); toast(`⏱ Used ${fmt(use)} of speedup`);
  if (S.rs.prog >= S.rs.dur - 1e-6) finishResearch(false);
  save(); refresh(true);
}
document.addEventListener('click', e => { const b = e.target.closest('[data-spr]'); if (b && !b.disabled) speedResearch(b.dataset.spr); });

// ---------------------------------------------------------------- passive economy (called from tick)
function passive(dt, quiet) {
  if (S.rs) { S.rs.prog += dt; if (S.rs.prog >= S.rs.dur) finishResearch(quiet); }
  const A = S.acc || (S.acc = {});
  const add = (k, v) => { A[k] = (A[k] || 0) + v; const whole = Math.floor(A[k]); if (whole >= 1) { A[k] -= whole; S.res[k] = (S.res[k] || 0) + whole; } };
  // spoilage above the food cap
  const cap = foodCap(); if (S.res.food > cap) { A.spoil = (A.spoil || 0) + (S.res.food - cap) * .02 / 60 * dt; const w = Math.floor(A.spoil); if (w) { A.spoil -= w; S.res.food = Math.max(cap, S.res.food - w); } }
  if (hasB('bank')) add('copper', Math.min(100, S.res.copper * .01) / 3600 * dt);
  if (hasB('taxoffice')) add('copper', S.workers.length / 3600 * dt);
  if (hasB('moneyprinter')) add('gold', dt / 600);
  if (hasB('factory') && S.res.iron >= 1 && S.res.coal >= 1) { A.fac = (A.fac || 0) + dt; if (A.fac >= 60) { A.fac -= 60; S.res.iron--; S.res.coal--; S.res.steel++; } }
  if (hasB('workshop')) { A.ws = (A.ws || 0) + dt; if (A.ws >= 1800) { A.ws -= 1800; const ks = Object.keys(TOOLS), k = ks[(Math.random() * ks.length) | 0]; S.tools = S.tools || {}; S.tools[k] = (S.tools[k] || 0) + 1; if (!quiet) toast(`Workshop crafted a ${TOOLS[k].n}`); } }
  if (hasB('nursery')) { A.nur = (A.nur || 0) + dt; if (A.nur >= 300) { A.nur -= 300; plantTree(); } }
  // regrowth of depleted trees / bushes
  if ((U('forestry') || hasB('orchard')) && S.dep) {
    const now = simNow();
    for (const k in S.dep) { const d = S.dep[k]; if (now - d.t < 600000) continue; if ((d.n === 'tree' && U('forestry')) || (d.n === 'bush' && hasB('orchard'))) { if (!S.buildings.some(b => b.j * W + b.i === +k)) { MAP.node[k] = d.n; S.used[k] = 0; layerDirty = true; } delete S.dep[k]; } }
  }
  if (S.bank > bankCap()) S.bank = bankCap();
}
function plantTree() {
  for (let tries = 0; tries < 60; tries++) {
    const i = (Math.random() * W) | 0, j = (Math.random() * H) | 0, k = j * W + i;
    if (MAP.node[k] || bAt(i, j) || near(i, j, TCI, TCJ) < 3) continue;
    S.planted = S.planted || {}; S.planted[k] = 'tree'; MAP.node[k] = 'tree'; MAP.amt[k] = 8 + treeBonus(); if (S.used) S.used[k] = 0; layerDirty = true; return;
  }
}
function expandLand() {
  const r = rng((S.seed ^ 0x1234567) >>> 0); S.planted = S.planted || {};
  for (let c = 0; c < 8; c++) {
    const type = c < 5 ? 'tree' : c < 7 ? 'rock' : 'bush', ci = (r() * W) | 0, cj = (r() * H) | 0;
    for (let n = 0; n < 9; n++) { const i = mod(ci + Math.round((r() - .5) * 5), W), j = Math.max(0, Math.min(H - 1, Math.round(cj + (r() - .5) * 5))), k = j * W + i; if (bAt(i, j) || near(i, j, TCI, TCJ) < 3) continue; S.planted[k] = type; }
  }
  genMap(S.seed); S.buildings.forEach(b => { MAP.node[b.j * W + b.i] = null; }); layerDirty = true;
}
// extra build slots after Expansion
const SLOTS2 = [[4, -2], [-2, 4], [-4, -2], [-2, -4], [5, 1], [1, 5], [-5, 1], [1, -5]];

// ---------------------------------------------------------------- puzzle boosts
function startBoosts() {
  const put = s => { const c = []; P.b.forEach((row, y) => row.forEach((q, x) => { if (q && q.t >= 0 && !q.s && !q.cov) c.push([x, y]); })); if (!c.length) return; const [x, y] = c[(Math.random() * c.length) | 0]; P.b[y][x].s = s; if (s === 'c' || s === 'p') P.b[y][x].t = -1; };
  if (U('rocketstart')) put(Math.random() < .5 ? 'h' : 'v');
  if (U('bombstart')) put('b');
  if (U('propstart')) put('p');
  if (U('colorstart')) put('c');
  if (U('streak') && (S.streak || 0) >= 3) put(['h', 'v', 'b', 'p'][(Math.random() * 4) | 0]);
}
const today = () => new Date().toISOString().slice(0, 10);
function startDaily() {
  if (!U('daily') || S.dailyDone === today()) return;
  const L = levelDef(S.level + 20); L.hard = true; L.daily = true; L.moves = Math.max(16, L.moves - 2);
  setView('puzzle'); startLevel(L); toast('Daily Challenge — good luck');
}

// ---------------------------------------------------------------- Tech tab
let techCat = 'All';
function renderTech(force) {
  const el = document.getElementById('v-tech'); if (!el) return;
  const s = 't' + JSON.stringify([S.upg, S.rs && S.rs.id, techCat, tierNow(), S.civ, PRES(), Math.floor(S.bank), Object.values(S.res).map(Math.floor)]);
  if (s === sig && !force) { if (S.rs) { const b = el.querySelector('[data-rsbar]'); if (b) b.style.width = (100 * S.rs.prog / S.rs.dur).toFixed(1) + '%'; const tl = el.querySelector('[data-rstl]'); if (tl) tl.textContent = fmt(S.rs.dur - S.rs.prog); } return; }
  sig = s;
  const tn = tierNow();
  let h = `<h2>Research <span class="small">Tier ${tn}${tn >= 6 ? ' · ' + AGE_NAME[tn] : ''}${PRES() ? ` · Prestige ${PRES()} (+${5 * PRES()}% all)` : ''}</span></h2>`;
  if (!S.civ) h += `<div class="card" style="border-color:var(--gold)"><div class="t">Choose your civilization</div><div class="d">Your civ gives a permanent bonus. You can re-pick when you prestige.</div><div class="civs">${Object.entries(CIVS).map(([k, c]) => `<button class="btn ${c.locked ? 'alt' : 'go'}" data-civ="${k}" ${c.locked ? 'disabled' : ''}><b>${c.n}</b><br><span class="small">${c.d}</span></button>`).join('')}</div></div>`;
  else h += `<div class="small">Civ: <b>${CIVS[S.civ].n}</b> — ${CIVS[S.civ].d}</div>`;
  if (S.rs) {
    const u = UPGI[S.rs.id];
    h += `<div class="card rsnow"><div class="t">Researching: ${u.n} ${u.max > 1 ? 'L' + (U(u.id) + 1) : ''}</div><div class="d">${u.d}</div>
      <div class="bar"><b data-rsbar style="width:${(100 * S.rs.prog / S.rs.dur).toFixed(1)}%"></b></div><div class="small"><span data-rstl>${fmt(S.rs.dur - S.rs.prog)}</span> left</div>
      <div class="spd"><button class="btn sm go" data-spr="60" ${S.bank > 0 ? '' : 'disabled'}>⏱ 1m</button><button class="btn sm go" data-spr="300" ${S.bank > 0 ? '' : 'disabled'}>⏱ 5m</button><button class="btn sm go" data-spr="1800" ${S.bank > 0 ? '' : 'disabled'}>⏱ 30m</button><button class="btn sm" data-spr="all" ${S.bank > 0 ? '' : 'disabled'}>Finish (${fmt(S.rs.dur - S.rs.prog)})</button><span class="small">bank ${fmt(S.bank)} / ${fmt(bankCap())}</span></div>${S.bank > 0 ? '' : whyHTML('Speedup bank is empty — win puzzles with moves left over to fill it')}</div>`;
  }
  // prestige + daily
  if (U('age6')) {
    const can = canPay(PRESTIGE_COST);
    h += `<div class="card"><div class="row"><div><div class="t">Prestige ${PRES() + 1}</div><div class="d">Restart your village with a permanent +5% to everything (stacks). Keeps puzzle level, tools and prestige; you re-pick your civ.</div><div class="cost">${costHTML(PRESTIGE_COST)}</div>${can ? '' : whyHTML('Need ' + shortBy(PRESTIGE_COST).join(', '))}</div><button class="btn sm" data-prestige ${can ? '' : 'disabled'}>Prestige</button></div></div>`;
  }
  const cats = ['All', ...new Set(UPG.map(u => u.cat))];
  h += `<div class="chips">${cats.map(c => `<button class="chip${c === techCat ? ' on' : ''}" data-cat="${c}">${c}</button>`).join('')}</div>`;
  for (let tier = 1; tier <= 9; tier++) {
    const list = UPG.filter(u => u.tier === tier && (techCat === 'All' || u.cat === techCat)); if (!list.length) continue;
    h += `<h3>Tier ${tier}${tier >= 6 ? ' · ' + AGE_NAME[tier] : ''}</h3>`;
    for (const u of list) {
      const lvl = U(u.id), max = u.max || 1, done = lvl >= max, open = upgOpen(u), c = upgCost(u, lvl);
      const why = done ? '' : [tierNow() < u.tier && (u.tier >= 6 ? `reach tier ${u.tier}: research ${AGE_NAME[u.tier]}` : `reach tier ${u.tier}: build any tier ${u.tier} building`),
        ...(u.req || []).filter(r => !reqMet(r)).map(reqHint), open && S.rs && `already researching ${UPGI[S.rs.id].n} — one at a time`, open && !canPay(c) && 'need ' + shortBy(c).join(', ')].filter(Boolean).join(' · ');
      h += `<div class="card${open || done ? '' : ' locked'}${u.age ? ' age' : ''}"><div class="row"><div style="flex:1"><div class="t"><span class="no">#${u.no}</span> ${u.n} ${max > 1 ? `<span class="small">${lvl}/${max}</span>` : ''}</div><div class="d">${u.d}</div>
        <div class="cost">${done ? 'Done' : costHTML(c) + ' · ' + fmt(upgTime(u, lvl))}</div>${whyHTML(why)}</div>
        ${done ? '<span class="small">✓</span>' : `<button class="btn sm" data-res="${u.id}" ${open && !S.rs && canPay(c) ? '' : 'disabled'}>Research</button>`}</div></div>`;
    }
  }
  h += `<div class="foot">Buildings from the list (#8, 9, 14, 16, 30, 32, 36, 38–40, 42, 43, 51–53, 71, 72, 81, 86, 98, 99) are on the Build tab once their age is researched.</div>`;
  el.innerHTML = h;
}
document.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t || !document.getElementById('v-tech') || !t.closest('#v-tech')) return;
  if (t.dataset.res) startResearch(t.dataset.res);
  else if (t.dataset.cat) { techCat = t.dataset.cat; renderTech(true); }
  else if (t.dataset.civ) { S.civ = t.dataset.civ; save(); toast(`Civilization: ${CIVS[S.civ].n}`); refresh(true); }
  else if (t.dataset.prestige !== undefined) modal(`<h2>Prestige ${PRES() + 1}?</h2><p>Your village, workers, buildings, research and resources reset. You keep puzzle level, tools, and gain a permanent +5% to everything.</p><div class="cost">${costHTML(PRESTIGE_COST)}</div><div class="btns"><button class="btn alt" data-close>Cancel</button><button class="btn go" data-act="prestige">Prestige</button></div>`);
});
function doPrestige() {
  if (!U('age6') || !canPay(PRESTIGE_COST)) return;
  const keep = { level: S.level, wins: S.wins, tools: S.tools, prestige: PRES() + 1, owner: S.owner, streak: S.streak, dailyDone: S.dailyDone };
  S = newState(); Object.assign(S, keep);
  genMap(S.seed); layerDirty = true; P = null; save(); setView('village'); sfx('win');
  modal(`<h2>Prestige ${S.prestige}</h2><p>Your new village gets +${5 * S.prestige}% to everything. Pick your civ on the Tech tab.</p><div class="btns"><button class="btn go" data-close>Begin</button></div>`);
}

// ---------------------------------------------------------------- Market
const PRICE = { food: .2, wood: .25, stone: .3, iron: 1, coal: 1, steel: 3, planks: 1, gears: 8, gold: 10, silver: 3 };
// how many lots per click: ×1, ×10, ×100, ×1000, or Max (everything you have / everything you can afford)
let MKT_X = 1;
const MKT_STEPS = [1, 10, 100, 1000, 'max'];
const mktSell = k => Math.max(.01, PRICE[k] * (k === 'gold' && U('assay') ? 1.2 : 1));
const mktLot = k => { const s1 = mktSell(k); return s1 < 1 ? Math.ceil(1 / s1) * 10 : 10; };
function mktQty(k, side) {
  const lot = mktLot(k);
  if (MKT_X !== 'max') return lot * MKT_X;
  if (side === 'sell') return Math.floor((S.res[k] || 0) / lot) * lot;
  return Math.floor(wallet() / Math.ceil(lot * PRICE[k] * 2)) * lot;
}
const mktGain = (k, q) => Math.floor(q * mktSell(k));
const mktCost = (k, q) => Math.ceil(q / mktLot(k)) * Math.ceil(mktLot(k) * PRICE[k] * 2);
const cc = n => big(n) + (n >= 1e4 ? ' copper' : 'c');
const big = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'k' : String(n);
function openMarket() {
  if (!hasB('market')) return toast('Build a Market first');
  const rows = Object.keys(PRICE).filter(k => k !== 'silver').map(k => {
    const have = Math.floor(S.res[k] || 0), qs = mktQty(k, 'sell'), qb = mktQty(k, 'buy'), g = mktGain(k, qs), c = mktCost(k, qb);
    const canS = qs > 0 && have >= qs, canB = qb > 0 && wallet() >= c;
    return `<tr><td>${k}</td><td>${big(have)}</td>
      <td><button class="btn sm" data-sell="${k}" data-q="${qs}" ${canS ? '' : 'disabled'}>Sell ${big(qs)} → ${cc(g)}</button>${canS ? '' : `<div class="why sm">${qs > 0 ? `need ${big(qs - have)} more` : `need ${mktLot(k)}`}</div>`}</td>
      <td><button class="btn sm alt" data-buyr="${k}" data-q="${qb}" ${canB ? '' : 'disabled'}>Buy ${big(qb)} for ${cc(c)}</button>${canB ? '' : `<div class="why sm">${qb > 0 ? needCoin(c) : needCoin(mktCost(k, mktLot(k)))}</div>`}</td></tr>`;
  }).join('');
  const seg = MKT_STEPS.map(x => `<button class="btn sm ${MKT_X === x ? '' : 'alt'}" data-mx="${x}">${x === 'max' ? 'Max' : '×' + x}</button>`).join('');
  modal(`<h2>Market</h2><div class="small">Copper ${big(S.res.copper)} · wallet ${big(wallet())}</div>
    <div class="mxrow">${seg}</div>
    <table class="lb mk"><tr><th>Res</th><th>Have</th><th>Sell</th><th>Buy</th></tr>${rows}</table>
    <div class="btns"><button class="btn sm alt" data-sellall>Sell all extra (keep 1,000 of each)</button></div>
    ${U('silverex') ? `<div class="btns"><button class="btn sm" data-ex="c2s" ${S.res.copper >= 30 ? '' : 'disabled'}>30 copper → 10 silver</button><button class="btn sm" data-ex="s2g" ${S.res.silver >= 10 ? '' : 'disabled'}>10 silver → 3 gold</button></div>` : '<div class="small">Research Silver Exchange (#56) to convert coins.</div>'}
    <div class="btns"><button class="btn alt" data-close>Done</button></div>`);
}
document.addEventListener('click', e => {
  const b = e.target.closest('#modal button'); if (!b) return;
  if (b.dataset.mx) { MKT_X = b.dataset.mx === 'max' ? 'max' : +b.dataset.mx; openMarket(); return; }
  if (b.dataset.sell) { const k = b.dataset.sell, q = +b.dataset.q; if (!q || (S.res[k] || 0) < q) return; S.res[k] -= q; S.res.copper += mktGain(k, q); sfx('coin'); save(); openMarket(); }
  else if (b.dataset.buyr) { const k = b.dataset.buyr, q = +b.dataset.q, c = mktCost(k, q); if (!q || wallet() < c) return; pay({ money: c }); S.res[k] = (S.res[k] || 0) + q; sfx('coin'); save(); openMarket(); }
  else if (b.dataset.sellall !== undefined) {
    let got = 0;
    for (const k of Object.keys(PRICE)) { if (k === 'silver' || k === 'copper') continue; const lot = mktLot(k), q = Math.floor(Math.max(0, (S.res[k] || 0) - 1000) / lot) * lot; if (q > 0) { S.res[k] -= q; const g = mktGain(k, q); S.res.copper += g; got += g; } }
    if (!got) return toast('Nothing above 1,000 to sell'); sfx('coin'); toast(`Sold extras for ${big(got)} copper`); save(); openMarket();
  }
  else if (b.dataset.ex === 'c2s' && S.res.copper >= 30) { S.res.copper -= 30; S.res.silver += 10; sfx('coin'); save(); openMarket(); }
  else if (b.dataset.ex === 's2g' && S.res.silver >= 10) { S.res.silver -= 10; S.res.gold += 3; sfx('coin'); save(); openMarket(); }
});

// ---------------------------------------------------------------- building art for tier 6–9 (generic, code-drawn)
const BCOL = {
  sawmill: ['#a07a4c', '#7f5e36', '#664a2b', '#5c3d22', '#47301a'], market: ['#fde68a', '#f59e0b', '#d97706', '#dc2626', '#991b1b'],
  taxoffice: ['#e5e7eb', '#cbd5e1', '#94a3b8', '#1e3a8a', '#172554'], workshop: ['#c08457', '#9a6a3a', '#7a4f2a', '#475569', '#334155'],
  longhouse: ['#b89a6a', '#9a7c50', '#7f6440', '#6b4a2e', '#553a22'], dock: ['#a07a4c', '#7f5e36', '#664a2b', '#0ea5e9', '#0369a1'],
  orchard: ['#86efac', '#4ade80', '#16a34a', '#dc2626', '#991b1b'], nursery: ['#bbf7d0', '#86efac', '#22c55e', '#166534', '#14532d'],
  palisade: ['#8b5a2b', '#6b4220', '#4a2a10', '#6b4220', '#4a2a10'], watchtower: ['#9aa3ab', '#7d858c', '#646b71', '#7b2e22', '#5e2219'],
  blastfurnace: ['#57534e', '#44403c', '#292524', '#f97316', '#c2410c'], gearworks: ['#94a3b8', '#64748b', '#475569', '#eab308', '#a16207'],
  bank: ['#f8fafc', '#e2e8f0', '#94a3b8', '#e8b923', '#c9971a'], barracks: ['#a8a29e', '#78716c', '#57534e', '#7f1d1d', '#450a0a'],
  quarry2: ['#8f969c', '#737a80', '#5d6368', '#5d6368', '#4a4f53'], teamhall: ['#ddd6fe', '#a78bfa', '#7c3aed', '#4c1d95', '#2e1065'],
  factory: ['#9ca3af', '#6b7280', '#4b5563', '#374151', '#1f2937'], powerplant: ['#fef08a', '#facc15', '#ca8a04', '#334155', '#1e293b'],
  outpost: ['#c4b5fd', '#8b5cf6', '#6d28d9', '#1e3a8a', '#172554'], gsdtower: ['#e0f2fe', '#7dd3fc', '#0284c7', '#fbbf24', '#b45309'],
  moneyprinter: ['#bbf7d0', '#4ade80', '#15803d', '#e8b923', '#c9971a'],
};
function drawExtraBuilding(b, x, y, t) {
  const c = BCOL[b.type] || ['#ccc', '#aaa', '#888', '#666', '#444'];
  const big = b.type === 'gsdtower' || b.type === 'moneyprinter';
  const h = big ? 70 : BLD[b.type].tier >= 8 ? 26 : 18, w = big ? 1.2 : .9;
  isoBox(x, y, w, h, c[0], c[1], c[2]);
  if (b.type === 'factory' || b.type === 'blastfurnace' || b.type === 'powerplant') {
    mx.fillStyle = '#374151'; mx.fillRect(x + 8, y - h - 30, 8, 30);
    mx.fillStyle = 'rgba(80,80,80,.45)'; for (let k = 0; k < 3; k++) { const p = (t * .6 + k / 3) % 1; mx.beginPath(); mx.arc(x + 12 + p * 6, y - h - 32 - p * 24, 4 + p * 6, 0, 7); mx.fill(); }
  } else if (b.type === 'gsdtower') {
    mx.fillStyle = '#fbbf24'; mx.font = 'bold 14px system-ui'; mx.textAlign = 'center'; mx.fillText('GSD', x, y - h - 4);
    mx.fillStyle = `rgba(125,211,252,${.5 + .5 * Math.sin(t * 3)})`; mx.beginPath(); mx.arc(x, y - h - 22, 6, 0, 7); mx.fill();
  } else if (b.type === 'moneyprinter') {
    mx.fillStyle = '#15803d'; for (let k = 0; k < 3; k++) { const p = (t * .5 + k / 3) % 1; mx.fillRect(x - 10 + k * 8, y - h - 10 - p * 30, 10, 5); }
  } else roof(x, y, w, h, 16, c[3], c[4]);
}
