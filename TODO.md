# TODO — Quick Taps

## Done: Session 1 — Scaffold
- [x] Repo structure, config files, package.json
- [x] Prisma + Ably + Redis lib setup
- [x] App pages (stubs): `/`, `/name`, `/session/[id]`
- [x] API routes: sessions CRUD, join, leave, Ably token

## Done: Session 2 — Session List UI
- [x] `/name` — name entry, saves to localStorage, auto-skips if already set
- [x] `/` — session list with live Ably subscription (`qt:sessions`)
- [x] Color picker bottom sheet (claimed colors grayed out)
- [x] "Start a game" → create session + redirect to `/session/[id]`
- [x] "Join" → join session + redirect to `/session/[id]`
- [x] `src/lib/constants.ts` — marble colors, NPC names, game labels
- [x] Ably token route made sessionId optional (home page uses browse-only token)

## Done: Session 3 — Session Room (`/session/[id]`)
- [x] Waiting room: show joined players + their colors
- [x] Color picker (8 options, claimed colors grayed out) — also allows color change in waiting room
- [x] Subscribe to `qt:session:{id}` for live player join/leave
- [x] "Start race" button for session creator
- [x] NPC fill logic when starting solo (fills to 6 with NPC_NAMES)
- [x] Heartbeat: ping PATCH /api/sessions/[id]/heartbeat every 60s to refresh Redis TTL while player is in waiting room
- [x] PATCH /api/sessions/[id]/color — change player color in waiting room
- [x] POST /api/sessions/[id]/start — starts race, fills NPCs, publishes game:started
- [x] Leave on tab close via sendBeacon; explicit Leave button

## Session 4 — Track Rendering (static, no physics)
- [ ] Create `src/components/game/marble-race/Track.tsx` — canvas component, 390×2800px
- [ ] Render Act 1: plinko field — channel walls (x=40, x=350), staggered peg grid (8 rows, alternating 5/4 pegs, 60px horizontal spacing, 80px vertical spacing, starting y=80), pegs radius 6px
- [ ] Render Act 2: four bezier lane paths — lanes at x=80,160,230,310 at entry (y=800), three crossing zones as described in MARBLE_RACE.md
- [ ] Render Act 3: funnel — outer circle (center x=195 y=2200 r=140), inner hole (r=20), entry chute converging from lanes, exit chute to y=2800
- [ ] Finish line rendered at y=2750
- [ ] Track is a static pre-rendered canvas layer — no animation yet
- [ ] Verify full track looks correct in browser at 390px width before moving on

## Session 5 — Marble Physics
- [ ] Create `src/components/game/marble-race/useMarblePhysics.ts` — physics hook
- [ ] Implement per-marble state: position (x,y), velocity (vx,vy), current act, speedMod (0.88–1.12, fixed at race start)
- [ ] Act 1 physics: gravity (0.3px/frame²), peg collision with reflection + random lateral impulse (±2px), wall bounce with damping 0.6, max velocity 12px/frame
- [ ] Act 2 physics: assign marble to lane by entry x position, t-parameter interpolation along bezier lane path, elastic marble-marble collision within lanes
- [ ] Act 3 physics: centripetal force toward funnel center (a = v²/r), tangential entry velocity based on entry x, exit when r < 20px, record exit order as final placement
- [ ] NPC marbles included in physics loop — identical treatment to real players
- [ ] Render marbles on a second canvas layer on top of the static track

## Session 6 — Views + Results
- [ ] Phone follow-cam: viewport 390×844px, camera lerps to player marble at 40% from top (smoothing 0.08), player marble has pulsing ring, current placement shown top-right
- [ ] Projector view (?projector=true): full track scaled to fit screen, all marbles visible, player name labels, live leaderboard sidebar
- [ ] Results screen: podium layout (2nd left, 1st center, 3rd right), full ranked list below, "Race again" and "Leave" buttons
- [ ] Wire game:started event → transition from waiting room to race canvas
- [ ] Wire race finish → transition to results screen
