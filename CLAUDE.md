# CLAUDE.md — Quick Taps

## What is this?
Quick Taps is an always-on bar mini game suite, the third pillar in a suite of bar entertainment products (pilot bar: IPA, Coeur d'Alene, ID — but keep the app bar-agnostic: no bar branding in code). Players scan a QR code, pick a name, choose a game, and either join an open table or start their own. Long-term vision: a licensed in-bar digital arcade / social game layer on your phone.

Sister products:
- **Tapped In!** — hosted Jeopardy-style trivia
- **What's on Tap?** — hosted Jackbox-style party games

## How to orient at the start of a session
1. Read this file
2. `git log --oneline -10`
3. Read `TODO.md` for current status and next steps
4. Read the relevant game doc in `docs/` only if the task touches that game
5. Don't read individual source files unless a task requires it

## Git / deploy
- The git root **is** `quick-taps/` (it used to be a subfolder of `C:/Users/davey` — that's no longer true). Remote: `github.com/Biobeat2727/quick-taps`, branch `main`.
- Vercel auto-deploys on push to `main`. Production: https://quick-taps.vercel.app
- Vercel project settings: Root Directory must be **blank** (repo root). Recommended Function Region: Portland `pdx1`, with Redis in Oregon `us-west-2` (colocate functions + Redis).
- Don't commit `.claude/settings.local.json` or the `public/Neon_sign/` line-ending noise.

## Tech stack
- **Framework**: Next.js 16 (App Router), React 19, TypeScript
- **Styling**: Tailwind v4 — "back-bar neon" theme tokens in `src/app/globals.css` (Bungee display font, amber/ice/magenta neon on near-black violet)
- **3D**: three.js + @react-three/fiber + drei + @react-three/postprocessing
- **Physics**: Rapier (`@dimforge/rapier3d-compat`) for bowling & marble race; a custom 2D engine for pool
- **Realtime**: Ably (shared app with What's on Tap?)
- **Ephemeral state**: Upstash Redis — see "Redis" below
- **DB**: Neon Postgres via Prisma (`qt_` tables; `QtScore` exists but nothing writes to it yet)

## Redis (important)
- Upstash Redis (Oregon, `us-west-2`), connected through Vercel Storage (replaced 2026-09-25 after the original DB was deleted). `src/lib/redis/client.ts` accepts either `UPSTASH_REDIS_REST_URL/TOKEN` or Vercel's `KV_REST_API_URL/TOKEN`.
- Local dev: `QT_MEMORY_REDIS=1` in git-ignored `.env.development.local` swaps in an in-process Redis stand-in (dev only). Delete that file to hit real Redis locally.
- Ably is still the live shared app — local test tables publish there.

## Games
| Game | Status | Doc |
|---|---|---|
| **Marble Race** | Multiplayer 3D, streamer-style maps (Neon Summit), chase cam, server-sim + replay | Section below (`docs/Marble_race.md` is the legacy 2D spec) |
| **Bowling (v2)** | Cosmic-neon, swipe-to-bowl, on-phone physics, multiplayer | `docs/BOWLING_V2.md` |
| **Pool (v2)** | Neon 7-ft bar box, custom 2D physics, 8-ball rules, NPC bot, multiplayer | `docs/POOL_V2.md` |

Turn-based multiplayer (bowling, pool) shares one match system: `docs/MULTIPLAYER.md`.

**Lab routes (solo, no network — best for iterating):** `/bowl-lab`, `/pool-lab`, `/marble-lab` (current map; `?n=8&seed=…&t=48&projector`), `/marble-classic` (archived original 3D map).
**Legacy (superseded, safe to delete once confirmed unused):** `/bowl-test`, `/pool-test`, `src/components/game/bowling/*`, `src/components/game/pool/*`, `src/lib/physics/simulate-bowling.ts`, `simulate-pool.ts`, `src/lib/pool/pool-logic.ts`, `src/types/pool.ts`, API routes `start-bowling`, `bowl`, `bowl/recording`, `/api/*-test`, and the lobby's `bowl:started` handler.

## Key concepts
- No host role beyond "first human starts the game / rematches"
- Tables are open and listed on the home screen; player identity is per-table in `localStorage` (`qt:player:{sessionId}`), name in `localStorage`
- Marble Race asks for a marble colour; other games auto-assign a free colour (it's the scorecard dot)
- Solo fallback: NPC marbles (race), NPC opponent (pool). Bowling solo is just single-player.
- Session statuses: `lobby` | `racing` (marble) | `playing` (turn-based match). Joining is blocked while racing/playing; pool caps at 2 humans, bowling 6.

## Marble Race — key file map
| File | Role |
|---|---|
| `lib/marble/track.ts` | Map system: `Turtle` authoring → banked U-trough trimesh (auto-bank, taller outer walls on turns, gaps, roofs), shared by sim + render |
| `lib/marble/maps/index.ts` | Map registry (`getMap`, `DEFAULT_MAP_ID`) — add new maps here |
| `lib/marble/maps/neon-summit.ts` | Neon Summit: Slalom, Pachinko, Wall of Death, Spinner Deck, Plunge/Leap, Helix, Gauntlet, Bobsled, Final Dive |
| `lib/marble/race-sim-core.ts` | Isomorphic Rapier sim (120 Hz, no CCD): spinners, punchers, bumpers, respawn/anti-stall, 30 Hz recording |
| `components/game/marble-race/MapRaceScene.tsx` | Renderer: chase cam + map camera zones, name tags, live leaderboard, progress bar |
| `components/game/marble-race/MarbleLab.tsx` | `/marble-lab`: sims in the browser |
| `scripts/marble-calibrate.ts` | `npx tsx scripts/marble-calibrate.ts [runs] [marbles]` — race length, speeds, respawns, self-overlap check |
| `components/game/marble-race/marble-race-shared.tsx` | Shared types/helpers/UI (countdown, results) |
| `app/session/[id]/session-room.tsx` | Lobby for all games (start buttons, routing on `game:started` / `match:started`) |
| `app/session/[id]/race/*` | Race room — decodes the recording, renders `MapRaceScene` |
| `app/api/sessions/[id]/start/route.ts` | Starts a race: NPC fill if solo, runs the sim, stores `RaceRecording` (`types/race.ts`) in Redis, publishes `game:started {seed}` |
| `components/game/marble-race/classic/*`, `lib/marble/classic/*` | **Archived** original 3D map (Classic Funnel) — not in the live game |

Marble architecture: server runs Rapier at 120 Hz and records `[x, y, z, progress]` per marble at 30 Hz (~420 KB for 6 marbles). The recording carries the map id and the marble list, so every client builds the same course and replays it (no client physics). Moving obstacles are pure functions of race time, so clients animate them in sync. Tuning a map: edit it, run the calibrate script (target winner ~70–90 s, <1 respawn/race, no overlaps), then check `/marble-lab`.

## Hard-won lessons (read before touching the 3D games)
- **Never set React state on every pointermove in a game screen.** Re-rendering the R3F tree re-bakes drei `<Environment>` (cube map + PMREM) and froze phones. Paint high-frequency UI straight to the DOM via refs; keep scenes `memo`'d with stable props; build `<Environment>` once in a `useMemo`.
- **Camera orientation:** both lanes/tables are viewed looking down +Z, so **screen-right is world −X**. Input code mirrors X/spin accordingly.
- **drei `<Sparkles>` flickered badly on phones** (mediump shader + bloom). Pool/bowling use custom highp point shaders.
- **Bloom bleeds from thin bright emissives** (rail neon, diamonds) — keep idle emissives under the threshold and flash on events.
- Phones: no MSAA (`pointer: coarse`), fixed quality tier per load (never switch tiers mid-game — rebuilding render targets flickers / loses the GPU context), dispose GPU resources on unmount, handle `webglcontextlost`.
- `setPointerCapture` can throw — wrap it.
- **Sound** is procedural WebAudio in `src/lib/audio/sfx.ts` (`poolSfx`, `bowlSfx`, `marbleSfx`, `rumble`) — no audio files. Phones unlock audio on the first tap; calls before that are silent no-ops. Mute is per phone (`qt:muted`), toggled by `components/game/SoundToggle.tsx`. Rate-limit anything that can fire in bursts (break clacks, marble clacks).
- Keep game physics/rules pure and isomorphic (`lib/*/…-core.ts`, `…-rules.ts`) so they run on the phone, on the server, and in offline calibration scripts (`npx tsx`).

## Testing on a phone (dev)
- Dev server listens on the LAN; `next.config.ts` has `allowedDevOrigins` for the PC's LAN IP (currently `192.168.4.27` — update if it changes). Open `http://<ip>:3000/pool-lab` etc.; generate a QR with `npx qrcode`.
- Don't leave a phone tab open during heavy live edits — repeated HMR remounts of the WebGL scene can lock mobile Chrome.
- Two-player local test: two browser origins (`localhost` + LAN IP) have separate `localStorage`, so they act as two players.

## Environment variables
See `.env.local` (not committed): Ably key(s), Neon `DATABASE_URL`, Upstash Redis URL/token (or Vercel KV names), `NEXT_PUBLIC_APP_URL`.
