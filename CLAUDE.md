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

## Environment variables
See `.env.local` (not committed). Uses same Ably and Neon credentials as What's on Tap?