# TODO — Quick Taps

_Last updated 2026-09-25._

## Direction (Davey, 2026-09-25)
- **Pool is the benchmark** — it's legitimately fun; next is wrapping it in a dopamine loop.
- **Bowling** should reach pool's level: the rework below (physics-driven sound, less repeatable play).
- **Marble race** is close but feels lifeless — some sections too long, not enough excitement. Davey is gathering feedback before changes.
- **Focus now:** polish, the bowling rework, a sharper UI, **profiles** (no longer deferred), and a professional feel across the whole app.
- **Deferred:** at-the-bar gating — only if the app gets popular.

## Current state
- **Marble Race** — multiplayer 3D on the new streamer-style map system (Neon Summit: pachinko, spinners, jumps, helix, boxing-glove gauntlet), chase cam, NPC fill, rematch. 2D removed; original 3D map archived at `/marble-classic`.
- **Bowling v2** — cosmic neon, swipe-to-bowl, on-phone Rapier, calibrated pin carry, multiplayer up to 6. `docs/BOWLING_V2.md`
- **Pool v2** — neon 7-ft bar box, custom 2D physics (spin, english, jaws), 8-ball rules, NPC bot, spin picker, multiplayer (2). `docs/POOL_V2.md`
- **Turn-based match system** shared by bowling + pool. `docs/MULTIPLAYER.md`
- Home picker: Pool / Bowling / Marble Race. Non-marble games auto-assign a colour (no marble picker).
- Deployed from `main` to https://quick-taps.vercel.app (Vercel Root Directory fixed to repo root).

## Production
- New Upstash Redis (Oregon) connected and working as of 2026-09-25.
- [ ] Locally: `.env.development.local` still forces the in-memory dev Redis (`QT_MEMORY_REDIS=1`) — delete it to hit the real Redis from dev.

## Next up (suggested order)
1. **Bowling rework — built 2026-09-25, awaiting Davey's play-test.** Skill model + physics-driven sound (see docs/BOWLING_V2.md). Follow-ups: tune from real play; wide balls still strike 20–35%.
2. **UI / professional pass** — audit every screen (name, home, lobby, games, results, leaderboard); consistent design system, motion, loading/empty/error states, haptics.
3. **Profiles + the dopamine loop** — persistent identity (fixes name spoofing on the board), stats and history, XP/levels, streaks, achievements, nightly champion.
4. **Marble race pass** — once Davey has feedback: trim the long sections, add more moments.

## Polish backlog
- **Bowling rework (Davey, 2026-09-25 — do after the to-do list):**
  - *Sound is bland and pre-queued.* The pin crash is a canned burst fired at impact, not driven by the physics. Make it physics-based: emit per-contact events from the sim (ball→pin, pin→pin, pin→lane/kickback, with impulse), and voice each one (like pool's ball events), plus a richer roll (lane boards, speed/hook-dependent) and pin-deck rattle.
  - *Gameplay is too rigid/repeatable.* Find a good spot, throw full speed, and you get the identical strike with identical pin action every time. Needs variance and skill depth: e.g. per-throw release noise that grows with speed (power vs accuracy trade-off), lane oil/transition that changes as the game goes on, pin deflection/scatter randomness, and a hook that rewards touch over max speed.
- Marble: more maps (registry in `lib/marble/maps`; pick per race or let the host choose); bigger fields (8–12 marbles); recording is ~70 KB/marble — quantize to Int16 if Redis size becomes an issue.
- Pool: show the remote player's cue swing/aim before their shot plays; optional house rule "sinking opponent's ball ends turn"; bot difficulty option; casual bot fouls a lot (~4/game).
- Bowling: straight centre hits strike a bit too easily; split detection callouts; pinsetter sweep animation instead of pins snapping back; turkey/double callouts.
- Both: lobby still says "Waiting for players" styling from marble era — fine, but could show game-specific copy.
- Presence + challenges (done 2026-09-25): rate-limit challenges (no spam protection yet); anyone can request a lobby token for any device id and read that inbox (challenges only — low stakes; tighten with profiles/gating); maybe a sound/vibrate when a challenge arrives.
- Leaderboard (done 2026-09-25): all-time / weekly boards; name squatting (anyone can type any name) — solve with profiles later; maybe show the board on a bar TV (projector view).
- Sound (done 2026-09-25, `lib/audio/sfx.ts`, all synthesized): tune levels/voices from real play on phones; lobby/home UI sounds; ambient bar hum?
- Shot clock (done 2026-09-25): maybe a host "kick" button for someone who's present but stalling; tune clock lengths from real play.
- Session TTL is 10 min idle (heartbeat keeps it alive); match TTL 30 min.

## Deferred (by decision)
- At-the-bar gating (rotating QR token or geofence) — only if the app gets popular.
