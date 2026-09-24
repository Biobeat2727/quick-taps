# TODO — Quick Taps

_Last updated 2026-09-24._

## Current state
- **Marble Race** — multiplayer, 2D + 3D, NPC fill, rematch. Neon theme. (Stable.)
- **Bowling v2** — cosmic neon, swipe-to-bowl, on-phone Rapier, calibrated pin carry, multiplayer up to 6. `docs/BOWLING_V2.md`
- **Pool v2** — neon 7-ft bar box, custom 2D physics (spin, english, jaws), 8-ball rules, NPC bot, spin picker, multiplayer (2). `docs/POOL_V2.md`
- **Turn-based match system** shared by bowling + pool. `docs/MULTIPLAYER.md`
- Home picker: Pool / Bowling / Marble Race. Non-marble games auto-assign a colour (no marble picker).
- Deployed from `main` to https://quick-taps.vercel.app (Vercel Root Directory fixed to repo root).

## ⚠️ Blocking production (Davey — account actions)
- [ ] Create a new Redis DB: Vercel → Storage → Upstash Redis, region **Oregon (us-west-2)**, connect to the project
- [ ] Delete the old `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` env vars in Vercel (they point at the deleted DB and override the new `KV_REST_API_*`)
- [ ] Vercel → Settings → Functions → Function Region → **Portland (pdx1)**
- [ ] Redeploy; then check `GET /api/sessions` returns 200 on production
- [ ] Locally: update `.env.local` with the new Redis values and delete `.env.development.local` (it forces the in-memory dev Redis)

## Next up (suggested order)
1. **Turn timer / AFK handling** for bowling + pool — a player who walks off without leaving stalls the match (e.g. 45 s shot clock, then auto-skip / concede; host can kick).
2. **Sound** for both games — ball roll/clicks, break crack, pocket drops, pin crash, strike sting. WebAudio, respect a mute toggle.
3. **Scores + nightly leaderboard** — nothing writes `QtScore` yet. Add a venue id to every score now so multi-bar licensing doesn't need a backfill.
4. **"At the bar now" presence** on the home screen (Ably presence) + tap-to-challenge.
5. **Legacy cleanup** — delete old bowling/pool code & routes (list in CLAUDE.md "Legacy"), the lobby's `bowl:started` handler, and `public/Neon_sign/` (a whole Vite project inside `public/`).
6. **At-the-bar gating** (rotating QR token or geofence) — needed before a second bar.

## Polish backlog
- Pool: show the remote player's cue swing/aim before their shot plays; optional house rule "sinking opponent's ball ends turn"; bot difficulty option; casual bot fouls a lot (~4/game).
- Bowling: straight centre hits strike a bit too easily; split detection callouts; pinsetter sweep animation instead of pins snapping back; turkey/double callouts.
- Both: lobby still says "Waiting for players" styling from marble era — fine, but could show game-specific copy.
- Session TTL is 10 min idle (heartbeat keeps it alive); match TTL 30 min.

## Deferred (by decision)
- Player profiles (see memory: vision) — not yet.
