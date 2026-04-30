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

## Multiplayer architecture — server simulation + client replay
The server runs the full Rapier physics simulation and streams a compact recording to clients. No physics runs on the client.

1. **Simulation**: `lib/physics/simulate-race.ts` — runs Rapier at 60 Hz server-side, records all marble positions as a flat `Float32Array` (numFrames × numMarbles × 3), base64-encodes to Redis.
2. **Seed**: `start/route.ts` generates `raceSeed`, passes to `simulateRace()`. PRNG `mulberry32(seed)` for start positions, `mulberry32(seed+1)` for impulses.
3. **Recording format**: `{ numMarbles, numFrames, framesBase64, ranking }` — `ranking` is derived post-hoc by scanning frames for first frame each marble's z≥258.
4. **Replay**: `ReplayDriver` component inside the Canvas accumulates real elapsed time, maps to a target frame index, and updates Three.js mesh positions directly (no React state). Frame 0 is the pre-impulse rest pose shown during countdown.
5. **Race end**: Client ends the race as soon as all marble burst animations have fired (all marbles visually crossed z=258), not when the recording runs out. Falls back to recording end for marbles that never exit.
6. **Safety cap**: `MAX_FRAMES = 3600` (1 min at 60 Hz).

## 3D scene notes
- Orthographic camera, `zoom: 12` (track fills screen width)
- `CameraRig` lerps camera Z to follow player's marble; projector mode stays at z=130 overview
- **Funnel camera**: when marble enters funnel (`z >= 230`), camera sweeps to head-on view (`pos=[0,0,225]`, looking along +Z into funnel mouth). Dynamic zoom: `5 + 3*(1 - r/20)` wide at rim, tight at center. `camera.near=0.1` prevents geometry clipping.
- Track: **Act 1** peg grid + bumpers (z=−10–65), back wall at z=−13 seals entry. **Act 2** glass tubes (z=87–222). **Act 3** funnel (z=230–258, tip radius=2, catch floor z=263).
- Finish: first frame marble z≥258. Escaped marbles (entered funnel then `z<218` or `|x|>50` or `|y|>50`) or OOB marbles are marked done in simulation but ranked last by max-z reached.
- Burst ring animation fires via `onMarbleFinish` callback when each marble first passes z=258 in the replay.
- **Minimap**: DOM overlay on left side (28×240 px), updates marble dot positions each frame via `dotRefs` (no setState). Constants: `MM_H=240`, `MM_Z_MIN=−10`, `MM_Z_MAX=258`. Shows act section colour bands + yellow finish line.

## Environment variables
See `.env.local` (not committed). Uses same Ably and Neon credentials as What's on Tap?
