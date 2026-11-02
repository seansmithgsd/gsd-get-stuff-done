# GSD: Get Stuff Done

Browser game for play.gsdconsultantsllc.com. Static files, no build step — Cloudflare Pages deploys `main` on every push.

## v0.1
- Match-3 puzzle with specials (4 = line clear, L/T = bomb, 5 = color bomb)
- 2 puzzle wins = 1 AI worker (workers only come from puzzles)
- Workers gather food / wood / stone on an isometric map that wraps east–west (the orb)
- Food upkeep: 1 food per worker per minute; no food = half speed
- Money: copper / silver / gold (1 / 3 / 10); every task costs coin + time
- Leftover puzzle moves bank as speedup time
- Tech tree tiers 1–2 (Hut, Hunting Post, Quarry, Lumber Camp, Farm Plot); tiers 3–5 shown as coming soon
- Guest save in localStorage, offline progress up to 3 days

## Next
Magic-link accounts + server save · shared 100-player orb (async, Durable Objects) · teams/leaderboards · harvesting other players (33%) · civs (GSD, ANGM, client slots) · ANGM video / Google H5 ad speedups · Claude player under human-pace rules
