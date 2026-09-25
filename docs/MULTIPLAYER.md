# Turn-based multiplayer (bowling, pool)

One shared "match" system serves every turn-based game. Marble Race uses its own older flow (`start` route + server sim), not this.

## Model: shooter simulates, server rules, spectators replay
1. The shooter's phone runs the physics locally → instant feedback, plays the shot immediately.
2. It POSTs the **result** (not just inputs) with the shot index `seq`.
3. The server checks `seq` and whose turn it is, **applies the game rules itself** (`nextTurn` / `applyShot`), stores the replay in Redis, and publishes `match:shot` on Ably with the new match.
4. Everyone else fetches the replay and plays it, then adopts the server's state.

Trade-off (accepted): physics results are trusted from the client, so a determined player could fake a shot. Rules, turn order and state are server-side. Nobody needs cross-device determinism.

## Files
| File | Role |
|---|---|
| `src/types/match.ts` | `Match` (`BowlingMatch` \| `PoolMatch`), `MatchPlayer`, shot payloads, recordings, Ably message shapes |
| `src/lib/match/match-server.ts` | `createMatch`, `activeActor`, `maySubmit`, `applyBowl`, `applyPool`, `dropPlayer`, Redis get/set for match + recordings |
| `src/lib/match/codec.ts` | Float32Array ⇄ base64 (isomorphic) |
| `src/lib/match/useMatch.ts` | Client hook: identity, match load, Ably events, retrying `submit`, `fetchRec`, `rematch` (memoised `net`) |
| `src/app/api/sessions/[id]/match/route.ts` | `GET` current match |
| `…/match/start/route.ts` | `POST {playerId}` — host only; creates/restarts (rematch) the match; sets session `playing`; publishes `match:started {game}` |
| `…/match/shot/route.ts` | `POST {playerId, seq, payload}` — zod-validated; 409 on stale `seq`, 403 not your turn; publishes `match:shot {seq, actorId, match}` |
| `…/match/rec/route.ts` | `GET ?seq=N` — the replay for shot N |
| `…/match/timeout/route.ts` | `POST {playerId, seq}` — any human reports the shot clock ran out; 425 if early, 409 if stale |
| `src/lib/match/shot-clock.ts` | Clock length per game (shared client/server) |
| `src/lib/session/remove-player.ts` | Leave / timeout drop: `dropPlayer`, publishes `player:left` + `match:update`, deletes empty tables |
| `src/components/game/ShotClock.tsx` | Countdown pill; urgent + buzz for the shooter's last 10 s |
| `src/app/api/sessions/[id]/leave/route.ts` | Calls `removePlayer` |
| `src/app/session/[id]/pool/pool-room.tsx`, `…/bowling/bowling-room.tsx` | Rooms: `useMatch` → `PoolGame` / `BowlGame` (`key={match.startedAt}` so a rematch remounts) |

## Redis keys (TTL)
- `qt:match:{sessionId}` — the `Match` (30 min)
- `qt:match:rec:{sessionId}:{seq}` — replay for shot `seq` (15 min). Bowling ≈ 200 KB base64 per throw; pool ≈ 20–60 KB.
- `qt:match:claim:{sessionId}:{startedAt}:{seq}` — `SET NX` claim (2 min): exactly one shot *or* timeout can change the match at each `seq`.

## Ably (`qt:session:{id}`)
- `match:started {game}` — lobby routes everyone to `/session/{id}/{game}`; rooms reload (rematch)
- `match:shot {seq, actorId, match}` — `seq` = index of the shot just applied; `match.seq` is after it
- `match:update {match, reason, actorId?, now}` — out-of-band change: `left`, or `timeout` (clock ran out / dropped)
- Every match message carries `now` (and `GET /match` carries `serverNow`) so phones correct the deadline for clock skew

## Client game contract (`PoolGame` / `BowlGame`)
- Props: `players`, `meId`, `hostId`, `initial`, `initialSeq`, optional `net`, `sync`, `onLeave`. No `net` ⇒ local lab mode.
- `seqRef` counts shots applied locally. Own shot: submit with the current `seq`, then `seqRef++`.
- Incoming events go through a queue pumped only when no playback is pending:
  - `seq < seqRef` → my own (or my bot's) shot echoing back — ignore
  - `seq === seqRef` → fetch the replay, play it, adopt `e.match.state`
  - `seq > seqRef` → missed something — jump straight to `e.match.state`
- `sync` = the hook's `match` object (memoised by identity) — only applied when it changes (a reload after a failed submit). Never pass a fresh object each render.
- **NPC turns:** only the host's client plans and submits them (`maySubmit` allows host → NPC).

## Rules of the room
- Start/rematch: first human in `session.players` (the host).
- Join blocked while `status === 'playing'`; pool max 2 humans, bowling 6 (`MAX_PLAYERS` / join route).
- When a match ends, the session goes back to `lobby` (new players can join between games).
- Leaving mid-match: **pool** → opponent wins; **bowling** → player removed from the rotation, lane passes on (frame advances if they were last).
- Leaving happens only via the explicit "Leave" button (the rooms don't auto-leave on unload — a phone refresh must not forfeit).

## Shot clock
- Human turns get `turnDeadline` = time the turn began + a replay allowance (bowling 9 s, pool 8 s, 4 s at the start) + the clock (bowling 30 s, pool 45 s). NPC turns have none.
- Every phone at the table arms a timer for the deadline (+ jitter) and `POST`s `/match/timeout`; the server checks the deadline, claims the `seq`, and applies it once.
- Timeout = bowling: 0 pins for that throw; pool: foul (`lastCall.reason: 'timeout'`), ball in hand to the opponent. Shooting resets your count.
- 2 timeouts in a row → removed from the table exactly like Leave (pool: opponent wins). The dropped phone shows "You timed out twice…".

## Known gaps
- Remote shots show the ball moving but not the other player's cue/aim animation.
- Session TTL is kept alive by a 60 s heartbeat from `useMatch`.
