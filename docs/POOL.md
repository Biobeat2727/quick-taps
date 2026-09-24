> **Legacy.** This describes the original server-sim version (still behind `/pool-test`). The live game is v2 — see `docs/POOL_V2.md` and `docs/MULTIPLAYER.md`.

# Pool Game — Implementation Phases

## Overview
Top-down 8-ball pool. Turn-based multiplayer — one player shoots while everyone watches the replay. Uses the same server-sim + client-replay architecture as Bowling and Marble Race: Rapier runs server-side, records all ball positions, client replays via Three.js. No physics on the client.

**Game variant:** 8-ball. Two players. One shoots solids (1–7), one shoots stripes (9–15). Pocket all your group, then the 8-ball, to win. Fouls give opponent ball-in-hand.

---

## Coordinate System

- Table in **XZ plane**. Y is up.
- Origin at table center.
- Long axis = Z. Short axis = X.
- Table half-length (Z): **1.37m**. Table half-width (X): **0.686m**.
- Camera: orthographic, `position=[0, 10, 0]`, looking straight down at origin, `up=[0,0,-1]`.
- Ball radius: **0.0286m** (2.25 in diameter = 0.0572m)

---

## Table Dimensions

| Part | Value |
|---|---|
| Playing surface (XZ) | ±0.686 × ±1.37 |
| Rail thickness | 0.06m |
| Rail height (Rapier wall half-height) | 0.04m |
| Table floor Y | 0 |
| Ball radius | 0.0286m |
| Pocket detection radius | 0.064m |

---

## Pocket Positions (X, Z)

```
ID  X       Z       Location
 0  -0.686  +1.37   corner: far-left
 1  +0.686  +1.37   corner: far-right
 2  -0.686   0      side:   left-middle
 3  +0.686   0      side:   right-middle
 4  -0.686  -1.37   corner: near-left
 5  +0.686  -1.37   corner: near-right
```

"Near" = player breaks from near side (Z ≈ −1.0), rack is at far side (+Z).

---

## Ball Layout

Ball index 0 = cue ball, 1–7 = solids, 8 = eight-ball, 9–15 = stripes.

### Cue ball start
`[0, BALL_RADIUS, -0.686]` (on center line, near side)

### Rack — 15 object balls, apex at Z = +0.686 (foot spot)

Row spacing along Z: `BALL_DIAM * cos(30°) = 0.0572 * 0.866 = 0.0495m`
Half-ball offset along X: `BALL_DIAM / 2 = 0.0286m`

```
Row 0 (apex): z=0.686             → ball 1 (solid)
Row 1:        z=0.686+0.0495      → balls 2, 9
Row 2:        z=0.686+0.0990      → balls 3, 8, 10   ← 8-ball in center
Row 3:        z=0.686+0.1485      → balls 4, 5, 11, 12
Row 4:        z=0.686+0.1980      → balls 6, 7, 13, 14, 15
```

X positions within each row (centered, spaced by BALL_DIAM):
```
Row 0: [0]
Row 1: [-BALL_RADIUS, +BALL_RADIUS]
Row 2: [-BALL_DIAM, 0, +BALL_DIAM]
Row 3: [-3*BALL_RADIUS, -BALL_RADIUS, +BALL_RADIUS, +3*BALL_RADIUS]
Row 4: [-2*BALL_DIAM, -BALL_DIAM, 0, +BALL_DIAM, +2*BALL_DIAM]
```

All balls Y = BALL_RADIUS (resting on table surface).

---

## Recording Format

```
numBalls:       16               (cue + 15 object)
numFrames:      ≤ MAX_FRAMES     (1800 = 30s @ 60 Hz)
ballFramesBase64:  Float32Array  // numFrames × 16 × 2  (X, Z per ball per frame)
pocketedAtFrame:   number[16]    // frame index ball was pocketed, -1 = never
cueBallPocketed:   boolean       // whether cue ball went in (foul/scratch)
finalPocketed:     boolean[16]   // per-ball, true = pocketed this shot
```

At MAX_FRAMES=1800 with 16 balls × 2 components: `1800 × 16 × 2 × 4 = ~230KB` — acceptable.

Y is not recorded (constant). Replayer sets Y from pocketedAtFrame (balls drop off-screen when pocketed).

---

## Simulation Parameters (Rapier 3D)

**World:** gravity `{x:0, y:-9.81, z:0}`

**Table floor:** `ColliderDesc.cuboid(0.686, 0.005, 1.37)` at `[0, -0.005, 0]`, friction 0.07, restitution 0.0

**Rail walls** (4 cuboids, high friction to kill energy):
- Near/far rails: `cuboid(0.686, 0.04, 0.005)` at `[0, 0.04, ±1.375]`, friction 0.5, restitution 0.7
- Left/right rails: `cuboid(0.005, 0.04, 1.37)` at `[±0.691, 0.04, 0]`, friction 0.5, restitution 0.7

Note: pocket gaps are not modeled as physical holes — the walls are continuous. Pocket detection is purely post-step positional: if ball XZ distance to any pocket center ≤ POCKET_RADIUS, the ball is removed from the world that step.

**Balls:** `ColliderDesc.ball(BALL_RADIUS)`, friction 0.05, restitution 0.92, density 2.0, linearDamping 0.6, angularDamping 5.0

**Cue ball launch:** `setLinvel({ x: sin(angle)*speed, y: 0, z: cos(angle)*speed })` where `speed = MIN_SPEED + power * (MAX_SPEED - MIN_SPEED)`, `MIN_SPEED=1.0`, `MAX_SPEED=8.0`. No spin in Phase 1.

**Stopping condition:** all active balls have `linvel().length() < 0.01` for 30+ consecutive frames, OR `frame >= MAX_FRAMES`.

**Pocket detection (each step):**
```ts
for each active ball:
  for each pocket [px, pz]:
    if sqrt((ball.x-px)^2 + (ball.z-pz)^2) <= POCKET_RADIUS:
      record pocketedAtFrame[ballIndex] = currentFrame
      world.removeRigidBody(ballHandle)
      break
```

---

## Physics Constants File

```ts
// src/lib/pool/pool-constants.ts
export const TABLE_HALF_LENGTH = 1.37;    // Z
export const TABLE_HALF_WIDTH  = 0.686;   // X
export const BALL_RADIUS       = 0.0286;
export const BALL_DIAM         = 0.0572;
export const POCKET_RADIUS     = 0.064;
export const MAX_FRAMES        = 1800;
export const NUM_BALLS         = 16;      // 0=cue, 1–15=object

export const POCKET_POSITIONS: readonly [number, number][] = [
  [-0.686,  1.37],  // 0: far-left corner
  [ 0.686,  1.37],  // 1: far-right corner
  [-0.686,  0   ],  // 2: left-middle side
  [ 0.686,  0   ],  // 3: right-middle side
  [-0.686, -1.37],  // 4: near-left corner
  [ 0.686, -1.37],  // 5: near-right corner
];

export const CUE_BALL_START: [number, number, number] = [0, BALL_RADIUS, -0.686];

// Ball starting positions [x, y, z] — index 0=cue, 1–15=object
export const BALL_START_POSITIONS: readonly [number, number, number][] = [
  CUE_BALL_START, // 0: cue ball
  // Row 0 (apex)
  [0,                        BALL_RADIUS,  0.686],
  // Row 1
  [-BALL_RADIUS,             BALL_RADIUS,  0.686 + 0.0495],
  [ BALL_RADIUS,             BALL_RADIUS,  0.686 + 0.0495],
  // Row 2
  [-BALL_DIAM,               BALL_RADIUS,  0.686 + 0.0990],
  [0,                        BALL_RADIUS,  0.686 + 0.0990],  // 8-ball
  [ BALL_DIAM,               BALL_RADIUS,  0.686 + 0.0990],
  // Row 3
  [-3 * BALL_RADIUS,         BALL_RADIUS,  0.686 + 0.1485],
  [-BALL_RADIUS,             BALL_RADIUS,  0.686 + 0.1485],
  [ BALL_RADIUS,             BALL_RADIUS,  0.686 + 0.1485],
  [ 3 * BALL_RADIUS,         BALL_RADIUS,  0.686 + 0.1485],
  // Row 4
  [-2 * BALL_DIAM,           BALL_RADIUS,  0.686 + 0.1980],
  [-BALL_DIAM,               BALL_RADIUS,  0.686 + 0.1980],
  [0,                        BALL_RADIUS,  0.686 + 0.1980],
  [ BALL_DIAM,               BALL_RADIUS,  0.686 + 0.1980],
  [ 2 * BALL_DIAM,           BALL_RADIUS,  0.686 + 0.1980],
];

// Ball colors for rendering (index matches ball number)
export const BALL_COLORS: readonly string[] = [
  '#FFFFFF',  // 0: cue ball
  '#FFD700',  // 1: solid yellow
  '#0000CC',  // 2: solid blue
  '#CC0000',  // 3: solid red
  '#800080',  // 4: solid purple
  '#FF6600',  // 5: solid orange
  '#006600',  // 6: solid green
  '#800000',  // 7: solid maroon
  '#111111',  // 8: eight-ball black
  '#FFD700',  // 9:  stripe yellow
  '#0000CC',  // 10: stripe blue
  '#CC0000',  // 11: stripe red
  '#800080',  // 12: stripe purple
  '#FF6600',  // 13: stripe orange
  '#006600',  // 14: stripe green
  '#800000',  // 15: stripe maroon
];

// Is ball a solid (1–7), stripe (9–15), or neither?
export function ballGroup(ballIndex: number): 'solid' | 'stripe' | null {
  if (ballIndex >= 1 && ballIndex <= 7) return 'solid';
  if (ballIndex >= 9 && ballIndex <= 15) return 'stripe';
  return null;
}
```

---

## Types File

```ts
// src/types/pool.ts

export interface PoolShotParams {
  angle: number;        // radians, 0=toward +Z, positive=clockwise from above
  power: number;        // 0–1 → maps to 1–8 m/s
  cueBallX: number;     // X position of cue ball (for ball-in-hand shots)
  cueBallZ: number;     // Z position of cue ball (for ball-in-hand shots)
  activeBalls: boolean[]; // [16] true = ball still in play before this shot
}

export interface PoolRawRecording {
  numFrames: number;
  numBalls: number;     // always 16
  ballFramesBase64: string;  // Float32Array → base64 (numFrames × 16 × 2)
  pocketedAtFrame: number[]; // length 16, -1 = not pocketed
  cueBallPocketed: boolean;
  finalPocketed: boolean[];  // length 16
}

export interface PoolDecodedRecording {
  numFrames: number;
  ballFrames: Float32Array;   // numFrames × 16 × 2 (X, Z)
  pocketedAtFrame: number[];
  cueBallPocketed: boolean;
  finalPocketed: boolean[];
}

export type PoolGroup = 'solid' | 'stripe' | null;

export interface PoolGameState {
  activePlayerId: string;           // whose turn to shoot
  activeBalls: boolean[];           // [16] still in play
  playerGroups: Record<string, PoolGroup>; // assigned groups per player
  groupAssigned: boolean;           // false until first object ball pocketed
  shotCount: number;                // total shots fired this game
  ballInHand: boolean;              // true if current player has ball-in-hand
  cueBallPos: [number, number];     // [x, z] current cue ball position
  winner: string | null;            // playerId, null until game over
  gameOver: boolean;
}
```

---

## Cue Input (useCueInput.ts)

```ts
export function useCueInput(
  containerRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  cueBallScreenPos: { x: number; y: number },  // screen coords of cue ball center
  onShoot: (params: Pick<PoolShotParams, 'angle' | 'power'>) => void,
): { phase: 'aiming' | 'shooting'; aimAngle: number; power: number; }
```

**Gesture:**
- Pointer down anywhere → record start
- Pointer move → compute vector from cueBallScreenPos to pointer → derive `aimAngle` (the aim direction is FROM cue ball TOWARD pointer drag origin, i.e., shoot in the opposite direction of drag)
  - Actually: drag direction = where cue sits behind the ball. Shot direction = opposite. So `angle = atan2(startX - currentX, startZ - currentZ)` flipped.
  - Simpler: `aimAngle = atan2(pointerX - cueBallScreen.x, pointerY - cueBallScreen.y)` gives direction from cue ball toward target.
  - Drag distance (clamped 10–150px) → `power = dragDist / 150`
- Pointer up → if dragging was detected, call `onShoot({ angle: aimAngle, power })`

**Aim line rendering (React/DOM, not WebGL):**
- SVG overlay on top of canvas showing a dotted line from cue ball outward along aim direction
- Line length proportional to power

**Ball-in-hand mode:**
- When `ballInHand === true`: pointer tap places cue ball at that position (clamped to kitchen: Z < 0)
- Confirm button or second tap to lock placement and switch to aiming

---

## Phase 1 — Types, Constants, Server Simulation ✅ COMPLETE

**Goal:** Working Rapier simulation callable via test API. Verify with a fetch.

### Files to create

1. `src/lib/pool/pool-constants.ts` — copy from spec above
2. `src/types/pool.ts` — copy from spec above
3. `src/lib/physics/simulate-pool.ts`
4. `src/app/api/pool-test/simulate/route.ts`

### simulate-pool.ts structure

```ts
import RAPIER from '@dimforge/rapier3d-compat';
import { ... constants ... } from '@/lib/pool/pool-constants';
import type { PoolShotParams, PoolRawRecording } from '@/types/pool';

let rapierInited = false;
export async function simulatePool(params: PoolShotParams): Promise<PoolRawRecording>
```

- Init Rapier once
- Build world: floor + 4 rail walls
- Spawn active balls from `params.activeBalls` + `params.cueBallX/Z`
- Launch cue ball with `setLinvel`
- Step 60Hz loop, pocket detection each step
- Stop when all settled or MAX_FRAMES
- Pack Float32Array → base64
- Return `PoolRawRecording`

### Verification
```
POST /api/pool-test/simulate
Body: { angle: 0, power: 0.7, cueBallX: 0, cueBallZ: -0.686, activeBalls: [true×16] }
```
Expect: JSON with `numFrames`, `pocketedAtFrame`, two base64 strings.

---

## Phase 2 — Three.js Scene (Static) ✅ COMPLETE

**Goal:** `/pool-test` shows top-down pool table with 16 balls in starting position. No physics.

### Files to create

1. `src/components/game/pool/pool-shared.tsx` (`'use client'`)
   - `PoolPhase` type: `'aiming' | 'shooting' | 'replay' | 'results'`
   - `decodeRecording(raw: PoolRawRecording): PoolDecodedRecording`
   - `PoolResultsScreen` — stub
2. `src/components/game/pool/PoolScene.tsx` (`'use client'`)
3. `src/app/pool-test/page.tsx` (`'use client'`) — dev sandbox

### PoolScene props

```ts
interface PoolSceneProps {
  myPlayerId: string;
  gameState: PoolGameState | null;
  recording: PoolDecodedRecording | null;
  onShoot: (params: PoolShotParams) => void;
  onReplayComplete: (result: PoolShotResult) => void;
  phase: PoolPhase;
  isMyTurn: boolean;
  players: SessionPlayer[];
}
```

### Three.js scene (orthographic, top-down)

**Canvas:** `orthographic`, no resize needed, fill parent.
**Camera:** `position={[0, 10, 0]}`, `up={[0, 0, -1]}` (so +Z is "up" on screen), `zoom={300}` (adjust to fit table).

**Geometry:**
- Table felt: `<meshStandardMaterial color="#1a5c1a"/>`, `<boxGeometry args={[1.372, 0.01, 2.74]}/>` at `[0,0,0]`
- Rails (4): brown `#5c3a1a`, each a thin cuboid matching spec dimensions
- Pockets (6): `<circleGeometry args={[POCKET_RADIUS, 16]}/>` at each pocket XZ, flat on table, color `#111`
- Balls (16): `<sphereGeometry args={[BALL_RADIUS, 12, 12]}/>` at each BALL_START_POSITION, colored per BALL_COLORS. Stripe balls render a white band (can use `meshStandardMaterial` with second pass or just solid for now).
- Lighting: `<ambientLight intensity={0.8}/>` + `<directionalLight position={[0, 5, 0]} intensity={0.5}/>`

### Verification
Visit `/pool-test` — see green table from above, 6 dark pockets, 16 balls in triangle formation.

---

## Phase 3 — Replay Driver + Cue Input ✅ COMPLETE

**Goal:** Full shot loop in `/pool-test` — aim → shoot → watch balls roll → pocketed balls disappear.

### Files to create / update

1. `src/components/game/pool/useCueInput.ts` — implement gesture spec from above
2. Add `PoolReplayDriver` inside `PoolScene.tsx`
3. Add aim line overlay (SVG) to `PoolScene.tsx`
4. Update `src/app/pool-test/page.tsx` with full shot loop

### PoolReplayDriver

```ts
function PoolReplayDriver({ recording, ballRefs, onReplayComplete }) {
  const elapsed = useRef(0);
  const lastFrame = useRef(-1);
  const done = useRef(false);
  useFrame((_, delta) => {
    elapsed.current += delta;
    const f = Math.min(Math.floor(elapsed.current * 60), recording.numFrames - 1);
    if (f <= lastFrame.current) return;
    lastFrame.current = f;
    for (let b = 0; b < 16; b++) {
      const pocketedAt = recording.pocketedAtFrame[b];
      if (pocketedAt !== -1 && f >= pocketedAt) {
        // Move below table to hide
        ballRefs.current[b].position.set(0, -1, 0);
      } else {
        const bx = recording.ballFrames[(f * 16 + b) * 2];
        const bz = recording.ballFrames[(f * 16 + b) * 2 + 1];
        ballRefs.current[b].position.set(bx, BALL_RADIUS, bz);
      }
    }
    if (f >= recording.numFrames - 1 && !done.current) {
      done.current = true;
      onReplayComplete({ finalPocketed: recording.finalPocketed, cueBallPocketed: recording.cueBallPocketed });
    }
  });
}
```

Reset refs when `recording` changes (via useEffect).

### Aim line overlay

- Absolute-positioned SVG covering the canvas
- During `aiming` phase: compute cue ball screen coords (project from Three.js world pos to screen)
- Draw dashed white line from cue ball outward along aimAngle, length = power * 200px
- Draw ghost ball circles along reflected paths (optional, Phase 3 stretch goal)

### pool-test page shot loop

```ts
const [activeBalls, setActiveBalls] = useState(Array(16).fill(true));
const [cueBallPos, setCueBallPos] = useState<[number,number]>([0, -0.686]);
const [phase, setPhase] = useState<PoolPhase>('aiming');
const [recording, setRecording] = useState<PoolDecodedRecording | null>(null);

async function handleShoot(aimParams) {
  setPhase('shooting');
  const params: PoolShotParams = { ...aimParams, cueBallX: cueBallPos[0], cueBallZ: cueBallPos[1], activeBalls };
  const res = await fetch('/api/pool-test/simulate', { method: 'POST', body: JSON.stringify(params) });
  const raw: PoolRawRecording = await res.json();
  setRecording(decodeRecording(raw));
  setPhase('replay');
}

function handleReplayComplete({ finalPocketed, cueBallPocketed }) {
  const newActive = activeBalls.map((a, i) => a && !finalPocketed[i]);
  setActiveBalls(newActive);
  if (!cueBallPocketed) {
    // Read last cue ball position from recording
    const lastFrame = recording.numFrames - 1;
    const cx = recording.ballFrames[(lastFrame * 16 + 0) * 2];
    const cz = recording.ballFrames[(lastFrame * 16 + 0) * 2 + 1];
    setCueBallPos([cx, cz]);
  }
  setRecording(null);
  setPhase('aiming');
}
```

### Verification
- Drag to aim, release → balls scatter → pocketed balls disappear → returns to aiming
- Multiple shots work correctly, balls accumulate pocketing

---

## Phase 4 — Game Logic (8-ball Rules) ✅ COMPLETE

**Goal:** Full 8-ball rules, turn management, win/loss detection, UI status bar. Ready for multiplayer.

### Files to create / update

1. `src/lib/pool/pool-logic.ts` — server+client safe, no React
2. Update `src/components/game/pool/pool-shared.tsx` — status UI, results screen
3. Update `src/app/pool-test/page.tsx` — exercise full game rules

### pool-logic.ts exports

```ts
// Determine who gets which group after a shot
export function assignGroups(
  state: PoolGameState,
  finalPocketed: boolean[],
  playerIds: string[],
): PoolGameState

// Process a completed shot: update activeBalls, check win/foul, advance turn
export function processShot(
  state: PoolGameState,
  result: PoolShotResult,
  playerIds: string[],
): PoolGameState

// Did active player legally pocket one of their own balls?
export function didPocketOwn(state: PoolGameState, finalPocketed: boolean[]): boolean

// Was this a win shot? (pocketed 8-ball with all own balls already pocketed)
export function isWinShot(state: PoolGameState, finalPocketed: boolean[]): boolean

// Was this a foul? (scratch, no contact with own ball first — simplified: just scratch)
export function isFoul(state: PoolGameState, cueBallPocketed: boolean): boolean
```

**Turn rules (simplified for bar game feel):**
- If player pockets at least one of their own balls (and no foul): stay at table
- If player pockets 8-ball legally (all own balls already pocketed): WIN
- If scratch: opponent gets ball-in-hand (can place cue ball anywhere in kitchen Z < 0)
- If player pockets 8-ball early (own balls still on table): LOSE immediately
- If no own ball pocketed, or foul: turn passes to opponent

### Status bar UI (in pool-shared.tsx)

```tsx
export function PoolStatusBar({ gameState, players, myPlayerId }: ...) {
  // Shows: whose turn, what group they are, ball-in-hand indicator
  // Shows group assignment visually (solid circles vs stripe circles)
}
```

### Results screen

```tsx
export function PoolResultsScreen({ gameState, players, onPlayAgain, onLeave }: ...) {
  // "Player X wins!" with winner highlight
  // Play Again / Leave buttons
}
```

### Verification in pool-test
- Play through a game to completion in dev sandbox
- Scratch gives ball-in-hand, cue ball can be repositioned
- Early 8-ball pocket causes immediate loss
- Correct win condition fires

---

## Phase 5 — Multiplayer Wiring

**Goal:** Pool fully integrated with session system. Playable end-to-end via the home screen.

### Files to create / update

1. `src/types/session.ts` — add `'pool'` to `GameId`
2. `src/lib/constants.ts` — add `pool: "Pool"` to `GAME_LABELS`
3. `src/lib/ably/channels.ts` — add pool message types
4. `src/app/api/sessions/[id]/start-pool/route.ts`
5. `src/app/api/sessions/[id]/pool/route.ts` (GET state + POST shot)
6. `src/app/api/sessions/[id]/pool/recording/route.ts`
7. `src/app/session/[id]/pool/page.tsx`
8. `src/app/session/[id]/pool/pool-room.tsx`
9. `src/app/session/[id]/session-room.tsx` — add pool start button

### Ably message types to add

```ts
export interface PoolStartedMessage {
  name: "pool:started";
  data: { sessionId: string; };
}

export interface PoolShotMessage {
  name: "pool:shot";
  data: {
    playerId: string;
    shotIndex: number;
    result: PoolShotResult;
    gameState: PoolGameState;
  };
}

export interface PoolGameOverMessage {
  name: "pool:game:over";
  data: { winnerId: string; };
}
```

### Redis keys
```
qt:pool:state:{sessionId}          → PoolGameState JSON
qt:pool:recording:{sessionId}:{shotIndex}  → PoolRawRecording JSON
```

### start-pool route
- Validates session exists, ≥2 players
- Initializes `PoolGameState` (first player in list goes first)
- Stores in Redis
- Publishes `pool:started`
- All clients navigate to `/session/{id}/pool`

### pool POST route (shoot)
- Validates `playerId === gameState.activePlayerId`
- Runs `simulatePool(params)`
- Stores recording in Redis at `qt:pool:recording:{id}:{shotIndex}`
- Calls `processShot()` to get new state
- Stores new state in Redis
- Publishes `pool:shot`
- If game over, publishes `pool:game:over`
- Returns `{ shotIndex, gameState }`

### pool-room.tsx (mirrors bowling-room.tsx)
- Loads session + game state on mount
- Subscribes to `pool:shot` and `pool:game:over`
- On `pool:shot`: fetch recording by `shotIndex`, set phase to `replay`
- On replay complete: update local game state, set phase to `aiming` or `results`
- My turn check: `gameState.activePlayerId === myPlayerId`
- Render `<PoolScene>` + `<PoolStatusBar>`

### session-room.tsx update
- Add "Start Pool" button visible when `session.game === 'pool'` (same pattern as bowling)
- `onClick`: POST to `/api/sessions/{id}/start-pool`

### page.tsx (home) update
Already handled by adding `pool` to `GameId` and `GAME_LABELS` — the `GamePickerSheet` reads from a hardcoded list, so add `{ id: "pool", label: "Pool", description: "8-ball billiards" }` to the array.

### Verification
- Full end-to-end: two browser tabs, create pool session, join, start pool
- Both see the table; only active player's aim input is active
- Shots broadcast to both clients, replay plays simultaneously
- Win condition ends game for both players

---

## Key Pitfalls

- `pool-constants.ts` must have NO `'use client'` directive — imported by server sim
- Rapier 3D for a 2D-motion game: keep Y gravity but table floor prevents falling. Don't disable gravity.
- Rail walls are continuous — pocket gaps are NOT physical holes. Pocket detection is purely positional post-step.
- `PoolReplayDriver` must reset elapsed/lastFrame/done refs when `recording` prop changes — same pattern as `BowlingReplayDriver`
- `zoom` on orthographic canvas: start at 300 and tune until table fills screen width without showing table edge gutters
- Ball-in-hand: cue ball placement must be clamped to kitchen (Z < 0 in our system). Validate on server too.
- `activeBalls` must be passed in `PoolShotParams` so the server knows which balls to spawn in Rapier
- Float32Array base64 encoding/decoding: use `Buffer.from(arr.buffer)` on Node.js server, `btoa` pattern on client decode (same as bowling)
- `player.color` is the player's marble/avatar color, separate from ball group (solid/stripe)
