# ARCHITECTURE.md — Quick Taps

## Overview
Quick Taps is a Next.js 15 app serving always-on bar mini games. No host role. Players 
scan a QR code, enter a name, pick a game, and join or create a session. Sessions are 
ephemeral — they exist only while active.

## Shared infrastructure
Quick Taps shares the following with What's on Tap?:
- **Neon** (PostgreSQL) — Quick Taps tables are prefixed `qt_`
- **Ably** — same app, Quick Taps uses its own channel namespace (`qt:*`)
- **Upstash Redis** — same instance, Quick Taps keys prefixed `qt:`
- **Vercel** — separate project, separate URL

## Player identity
- Player name stored in `localStorage` on first visit
- Returning players skip the name step and land directly on the session list
- No accounts, no auth

## Session model
Sessions are ephemeral and stored in Redis. PostgreSQL is not used for active session 
state — only for future leaderboard persistence (see Leaderboard section).

### Session lifecycle
1. First player picks a name and a game → session created in Redis
2. Session appears on the session list (home screen)
3. Other players join → added to session in Redis, Ably notifies all participants
4. Game starts when the creator clicks Start (or immediately if solo with NPCs)
5. Session deleted from Redis when:
   - All players leave
   - Idle timeout: 10 minutes of no activity

### Redis session shape
```ts
// Key: qt:session:{sessionId}
{
  id: string,
  game: 'marble_race',           // game identifier
  createdAt: number,             // unix timestamp
  lastActivity: number,          // unix timestamp — updated on any player action
  players: [
    {
      id: string,                // random UUID generated on join
      name: string,
      color: string,             // hex — player-chosen marble color
      isNpc: false
    }
  ]
}
```

### NPC fallback
- If a session starts with only one real player, NPC marbles fill the field to 6 total
- NPCs have fixed names: Big Mike, Hopsy, The Regular, Sudsy, Last Call, Tab
- NPC physics are identical to real players — outcomes are genuinely random
- NPCs are not stored in Redis, they are generated client-side at race start

## Ably channel structure
- `qt:sessions` — broadcast channel for session list updates (joins, leaves, new sessions)
- `qt:session:{sessionId}` — per-session channel for game state and player presence

## Pages
- `/` — session list (home screen): open sessions, player counts, join or create
- `/name` — name entry for first-time visitors (redirects to `/` after)
- `/session/[id]` — waiting room + game screen
- `/game/marble-race` — (future: may be handled within session route)

## Game modules
Each game is self-contained. A game module defines:
- Its waiting room UI
- Its game canvas/screen (projector view + phone view)
- Its NPC behavior
- Its win condition and result screen

Current games: Marble Race (see docs/MARBLE_RACE.md)

## Projector vs phone views
- **Phone** (`/session/[id]`) — follow-cam, scrolls with the player's own marble
- **Projector** — full track bird's eye view, all marbles visible. Served at the same 
  route with a `?projector=true` query param that renders the alternate layout
  

## Leaderboard
⚠️ Out of scope for v1 — focus on getting Marble Race functional first.
When added: persistent scores written to PostgreSQL (`qt_scores` table) after each 
session, queryable by game and venue.

## Database schema (Neon)
Not used for active session state. Reserved for future leaderboard tables.

```sql
-- Future
CREATE TABLE qt_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game TEXT NOT NULL,
  player_name TEXT NOT NULL,
  placement INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Environment variables
Same `.env.local` as What's on Tap?. No additional variables needed.