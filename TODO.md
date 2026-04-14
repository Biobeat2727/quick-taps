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

## Next: Session 4 — Marble Race game UI
- See docs/MARBLE_RACE.md for full spec
