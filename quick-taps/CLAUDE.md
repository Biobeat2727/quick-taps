# CLAUDE.md — Quick Taps

## What is this?
Quick Taps is an always-on bar mini game suite, the third pillar in a suite of bar entertainment products built for IPA (a bar in Coeur d'Alene, ID). It lives at its own URL and requires no host or scheduled game night — players scan a QR code, pick a name, choose a game, and either join an open session or start their own.

Sister products:
- **Tapped In!** — hosted Jeopardy-style trivia
- **What's on Tap?** — hosted Jackbox-style party games

## How to orient at the start of a session
1. Read this file
2. Run `git log --oneline -10`
3. Run `find . -type f -name "*.ts" -o -name "*.tsx" | grep -v node_modules | grep -v .next | head -40`
4. Read TODO.md for current session goals
5. Do not read individual source files unless a task requires it

## Git repo note
The git root is `C:/Users/davey` (NOT `C:/Users/davey/quick-taps`). quick-taps is a subdirectory of a parent monorepo. Always `cd` into quick-taps before running git, and use `quick-taps/src/...` paths when staging. Use `git rev-parse --show-toplevel` to confirm.

## Tech stack
- **Framework**: Next.js 15, TypeScript, App Router
- **Styling**: Tailwind CSS, shadcn/ui, Framer Motion
- **Realtime**: Ably (shared app with What's on Tap?)
- **Database**: Neon (PostgreSQL, shared with What's on Tap? — Quick Taps tables prefixed with `qt_`)
- **Ephemeral state**: Upstash Redis (shared)
- **Deployment**: Vercel (auto-deploys on push to main)

## Key concepts
- No host role — the first player to create a session is just a player
- Sessions are open and discoverable via a session list (the home screen)
- Player names are persisted on-device (localStorage) so returning players skip the name step
- NPC fallback — if a player is alone, named NPC marbles fill the field
- Games are self-contained modules — each game has its own spec doc

## Repo structure (intended)
- `app/` — Next.js App Router pages
- `components/` — shared UI components
- `lib/` — shared utilities, Ably client, Prisma client
- `prisma/` — schema
- `docs/` — ARCHITECTURE.md, game specs

## Current games
- **Marble Race** — see docs/MARBLE_RACE.md
  - Has both a **2D** (canvas + custom JS physics via `useMarblePhysics`) and **3D** (Three.js + Rapier via `@react-three/rapier`) mode
  - **Mode is chosen by the host in the lobby** (`session-room.tsx`) before starting — NOT in the race room
  - When host clicks Start Race → picks 2D or 3D → API publishes `game:started` with `{ mode, seed }` → all clients navigate to `/race?mode=X&seed=N`
  - Shared UI/helpers live in `marble-race-shared.tsx` (imported by both modes)

## Marble Race — key file map
| File | Role |
|---|---|
| `components/game/marble-race/MarbleRace.tsx` | 2D mode (canvas, custom physics) |
| `components/game/marble-race/MarbleRaceScene.tsx` | 3D mode (Three.js/Rapier) |
| `components/game/marble-race/marble-race-shared.tsx` | Shared types, helpers, UI components (`Participant`, `Phase`, `buildParticipants`, `CountdownOverlay`, `ResultsScreen`) |
| `components/game/marble-race/useMarblePhysics.ts` | 2D physics hook |
| `components/game/marble-race/Track.tsx` | 2D SVG track |
| `app/session/[id]/session-room.tsx` | Lobby: player list, color picker, host-only Start Race + 2D/3D picker |
| `app/session/[id]/race/page.tsx` | Server component: reads `?mode` and `?seed` searchParams, passes to RaceRoom |
| `app/session/[id]/race/race-room.tsx` | Client component: fetches session players, mounts correct scene |
| `app/api/sessions/[id]/start/route.ts` | POST: validates host, adds NPCs if solo, publishes `game:started` with mode+seed |
| `lib/ably/channels.ts` | Channel/message type definitions |
| `app/track-test/page.tsx` | Dev sandbox — runs 3D scene with mock player |

## Multiplayer synchronization architecture
All clients run **independent but deterministic** physics simulations that produce identical races:

1. **Seed**: Server generates `raceSeed = Math.floor(Math.random() * 2**32)` in `start/route.ts` and includes it in the `game:started` Ably message.
2. **PRNG**: `MarbleRaceScene.tsx` has a `mulberry32(seed)` function. Marble starting positions use `mulberry32(seed)` and launch impulses use `mulberry32(seed + 1)`.
3. **Fixed timestep**: `<Physics timeStep={1/60}>` — Rapier WASM is cross-platform deterministic given identical inputs and step size.
4. **First-frame impulse**: `GameLoop` (inside Canvas) applies impulses on the first `useFrame` call after `phase === 'racing'`, not via `setTimeout`. Eliminates timing variance.
5. **Mode sync**: `game:started` carries `mode`; all clients navigate to `/race?mode=X&seed=N` simultaneously via Ably.

## 3D scene notes
- Orthographic camera, `zoom: 12` (track fills screen width)
- `CameraRig` lerps camera Z to follow player's marble; projector mode stays at z=130 overview
- **Funnel camera**: when marble enters funnel (`z >= 230`), camera sweeps to head-on view (`pos=[0,0,225]`, looking along +Z into funnel mouth). Dynamic zoom: `5 + 3*(1 - r/20)` wide at rim, tight at center. `camera.near=0.1` prevents geometry clipping.
- `<Physics gravity={[0,0,15]} paused={phase !== 'racing'} timeStep={1/60}>` — gravity along +Z, paused during countdown, fixed 60Hz step
- Finish detected in `GameLoop` when `rb.translation().z >= 258` (past funnel tip). Escaped marbles (entered funnel then `z<218` or `|x|>50` or `|y|>50`) are also marked finished.
- Track: Act 1 peg grid (z=0–65) → Act 2 glass tubes (z=87–222) → Act 3 funnel (z=230–258, catch floor z=263, `visible={false}`)
- Burst ring animation fires via `onMarbleFinish` callback when each marble passes z=258

## Environment variables
See `.env.local` (not committed). Uses same Ably and Neon credentials as What's on Tap?
