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

## Tech stack
- **Framework**: Next.js 15, TypeScript, App Router
- **Styling**: Tailwind CSS, shadcn/ui, Framer Motion
- **Realtime**: Ably (shared app with What's on Tap?)
- **Database**: Neon (PostgreSQL, shared with What's on Tap? — Quick Taps tables prefixed with `qt_`)
- **Ephemeral state**: Upstash Redis (shared)
- **Deployment**: Vercel

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
  - Mode is chosen at race start via `ModePicker` in `race-room.tsx`; both modes use identical `Props`
  - Shared UI/helpers live in `marble-race-shared.tsx` (imported by both modes)

## Marble Race — key file map
| File | Role |
|---|---|
| `components/game/marble-race/MarbleRace.tsx` | 2D mode (canvas, custom physics) |
| `components/game/marble-race/MarbleRaceScene.tsx` | 3D mode (Three.js/Rapier) |
| `components/game/marble-race/marble-race-shared.tsx` | Shared types, helpers, UI components |
| `components/game/marble-race/useMarblePhysics.ts` | 2D physics hook |
| `components/game/marble-race/Track.tsx` | 2D SVG track |
| `app/session/[id]/race/race-room.tsx` | Fetches session, shows ModePicker, mounts game |
| `app/track-test/page.tsx` | Dev sandbox — runs 3D scene with mock player |

## 3D scene notes
- Orthographic camera, `zoom: 12` (track fills screen width)
- `CameraRig` lerps camera Z to follow player's marble; projector mode stays at z=130 overview
- `<Physics paused={phase !== 'racing'}>` freezes marbles during countdown
- Finish detected when `rb.translation().z >= 258` (past funnel exit)
- Track: Act 1 peg grid (z=0–65) → Act 2 glass tubes (z=87–222) → Act 3 funnel (z=230–258, catch floor z=263)

## Environment variables
See `.env.local` (not committed). Uses same Ably and Neon credentials as What's on Tap?