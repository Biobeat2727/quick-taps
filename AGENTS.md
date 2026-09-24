# AGENTS.md — Quick Taps (mirror of CLAUDE.md — keep in sync)

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
- The original Upstash DB was deleted (found 2026-09-23). Production needs a new one: Vercel → Storage → Upstash Redis (Oregon), then **delete the old `UPSTASH_REDIS_REST_*` env vars** in Vercel (they override) and redeploy. `src/lib/redis/client.ts` accepts either `UPSTASH_REDIS_REST_URL/TOKEN` or Vercel's `KV_REST_API_URL/TOKEN`.
- Local dev: `QT_MEMORY_REDIS=1` in git-ignored `.env.development.local` swaps in an in-process Redis stand-in (dev only). Delete that file to hit real Redis locally.
- Ably is still the live shared app — local test tables publish there.

## Games
| Game | Status | Doc |
|---|---|---|
| **Marble Race** | Multiplayer, 2D + 3D modes, server-sim + replay | `docs/Marble_race.md` + section below |
| **Bowling (v2)** | Cosmic-neon, swipe-to-bowl, on-phone physics, multiplayer | `docs/BOWLING_V2.md` |
| **Pool (v2)** | Neon 7-ft bar box, custom 2D physics, 8-ball rules, NPC bot, multiplayer | `docs/POOL_V2.md` |

Turn-based multiplayer (bowling, pool) shares one match system: `docs/MULTIPLAYER.md`.

**Lab routes (solo, no network — best for iterating):** `/bowl-lab`, `/pool-lab`, `/track-test` (marble 3D).
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
| `components/game/marble-race/MarbleRace.tsx` | 2D mode (canvas, custom physics) |
| `components/game/marble-race/MarbleRaceScene.tsx` | 3D mode (Three.js replay) |
| `components/game/marble-race/marble-race-shared.tsx` | Shared types/helpers/UI |
| `app/session/[id]/session-room.tsx` | Lobby for all games (start buttons, routing on `game:started` / `match:started`) |
| `app/session/[id]/race/*` | Race room |
| `app/api/sessions/[id]/start/route.ts` | Starts a race: NPCs if solo, server sim, publishes `game:started {mode, seed}` |
| `lib/physics/simulate-race.ts` | Server Rapier sim → Float32 recording in Redis |

Marble architecture: server runs Rapier at 60 Hz, records positions (numFrames × marbles × 3) to Redis; clients replay with a `ReplayDriver` (no client physics). Finish = first frame z ≥ 258. Orthographic camera follows your marble; funnel camera at z ≥ 230; DOM minimap.

## Hard-won lessons (read before touching the 3D games)
- **Never set React state on every pointermove in a game screen.** Re-rendering the R3F tree re-bakes drei `<Environment>` (cube map + PMREM) and froze phones. Paint high-frequency UI straight to the DOM via refs; keep scenes `memo`'d with stable props; build `<Environment>` once in a `useMemo`.
- **Camera orientation:** both lanes/tables are viewed looking down +Z, so **screen-right is world −X**. Input code mirrors X/spin accordingly.
- **drei `<Sparkles>` flickered badly on phones** (mediump shader + bloom). Pool/bowling use custom highp point shaders.
- **Bloom bleeds from thin bright emissives** (rail neon, diamonds) — keep idle emissives under the threshold and flash on events.
- Phones: no MSAA (`pointer: coarse`), fixed quality tier per load (never switch tiers mid-game — rebuilding render targets flickers / loses the GPU context), dispose GPU resources on unmount, handle `webglcontextlost`.
- `setPointerCapture` can throw — wrap it.
- Keep game physics/rules pure and isomorphic (`lib/*/…-core.ts`, `…-rules.ts`) so they run on the phone, on the server, and in offline calibration scripts (`npx tsx`).

## Testing on a phone (dev)
- Dev server listens on the LAN; `next.config.ts` has `allowedDevOrigins` for the PC's LAN IP (currently `192.168.4.27` — update if it changes). Open `http://<ip>:3000/pool-lab` etc.; generate a QR with `npx qrcode`.
- Don't leave a phone tab open during heavy live edits — repeated HMR remounts of the WebGL scene can lock mobile Chrome.
- Two-player local test: two browser origins (`localhost` + LAN IP) have separate `localStorage`, so they act as two players.

## Environment variables
See `.env.local` (not committed): Ably key(s), Neon `DATABASE_URL`, Upstash Redis URL/token (or Vercel KV names), `NEXT_PUBLIC_APP_URL`.
