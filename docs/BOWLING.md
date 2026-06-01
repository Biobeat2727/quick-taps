# Bowling Game — Implementation Phases

## Overview
Full 10-frame bowling game. Turn-based multiplayer (one player bowls at a time, everyone watches) plus single player. Full 10-frame scoring with strikes/spares. Touch input for direction, power, and spin/hook.

**Architecture:** Identical to Marble Race — server-side Rapier physics generates a recording, client replays it with Three.js. No Rapier on client.

---

## Coordinate System

- Lane runs down **+Z**. Foul line at z=0, head pin at z≈18.3
- Lane center x=0, floor y=0
- Ball radius: 0.108m, starts at `[startX, 0.108, 0.3]`
- Pin height center: y=0.191 (pin stands 0.382m tall, center at half-height)
- Lane half-width: 0.53m (full width 1.06m)

## PIN_POSITIONS (center-to-center = 0.305m)
```
Index  [x,       y,     z      ]
  0    [ 0,      0.191, 18.295 ]   ← head pin
  1    [-0.1524, 0.191, 18.031 ]
  2    [ 0.1524, 0.191, 18.031 ]
  3    [-0.3048, 0.191, 17.767 ]
  4    [ 0,      0.191, 17.767 ]
  5    [ 0.3048, 0.191, 17.767 ]
  6    [-0.4572, 0.191, 17.503 ]
  7    [-0.1524, 0.191, 17.503 ]
  8    [ 0.1524, 0.191, 17.503 ]
  9    [ 0.4572, 0.191, 17.503 ]
```

## Recording Format
```
ballFrames:  Float32Array   // numFrames × 3   (x, y, z per frame)
pinFrames:   Float32Array   // numFrames × 10 × 7   (x,y,z, qx,qy,qz,qw per pin per frame)
knockedPins: boolean[10]    // final state: pin.translation().y < 0.08
```
At MAX_FRAMES=600 (10s @ 60Hz): ~175KB total — safe for Redis + Ably.

---

## Phase 1 — Foundation: Types, Constants, Server Simulation

**Goal:** Working Rapier sim callable via a test API route. Verify with a fetch.

### Files to create

#### `src/lib/bowling/bowling-constants.ts`
No directive. Safe to import from both server and client.
```ts
export const PIN_POSITIONS: readonly [number, number, number][] = [ /* 10 entries above */ ];
export const LANE_HALF_WIDTH = 0.53;
export const LANE_LENGTH = 19.0;
export const BALL_RADIUS = 0.108;
export const PIN_HALF_HEIGHT = 0.191;
export const PIN_RADIUS = 0.06;
```

#### `src/types/bowling.ts`
```ts
export interface ThrowParams {
  direction: number;     // radians, 0=straight, +right/-left, range ±(π/6)
  power: number;         // 0–1 → maps to speed 2–8 m/s
  spin: number;          // -1 to +1 → angular velocity on Y
  pinState: boolean[];   // [10] true=standing — for 2nd throw
}

export interface BowlingRawRecording {
  numFrames: number;
  ballFramesBase64: string;   // Float32Array → base64
  pinFramesBase64: string;    // Float32Array → base64
  knockedPins: boolean[];
}

export interface BowlingDecodedRecording {
  numFrames: number;
  ballFrames: Float32Array;   // numFrames × 3
  pinFrames: Float32Array;    // numFrames × 70 (10 pins × 7 components)
  knockedPins: boolean[];
}
```

#### `src/lib/physics/simulate-bowling.ts`
```
export const runtime = 'nodejs';  // NOT here — this goes on API routes only
import RAPIER from '@dimforge/rapier3d-compat';
import { PIN_POSITIONS, LANE_HALF_WIDTH, ... } from '@/lib/bowling/bowling-constants';
import type { ThrowParams, BowlingRawRecording } from '@/types/bowling';

let rapierInited = false;
export async function simulateBowl(params: ThrowParams): Promise<BowlingRawRecording>
```

**Rapier world:**
- Gravity: `{ x:0, y:-9.81, z:0 }`
- Static lane floor: `ColliderDesc.cuboid(0.53, 0.01, 9.5)` at `[0, -0.01, 9.0]`, friction 0.12, restitution 0.3
- Static gutter floors: `cuboid(0.125, 0.01, 9.5)` at `[±0.655, -0.01, 9.0]`
- Static gutter inner walls: `cuboid(0.01, 0.1, 9.5)` at `[±0.53, 0.09, 9.0]`
- Static outer walls: `cuboid(0.01, 0.2, 9.5)` at `[±0.78, 0.1, 9.0]`
- Static pin backstop: `cuboid(0.6, 0.5, 0.01)` at `[0, 0.25, 19.5]`
- Dynamic pins: `ColliderDesc.cylinder(0.191, 0.06)` only where `pinState[i]===true`; friction 0.3, restitution 0.4, density 1.5
- Dynamic ball: `ColliderDesc.ball(0.108)`; startX = `clamp(sin(direction)*0.5, ±0.45)`; friction 0.2, restitution 0.35, density 3.0
- **Launch:** `ball.setLinvel({ x: sin(dir)*speed, y:0, z: cos(dir)*speed })` where `speed = 2 + power*6`; `ball.setAngvel({ x:0, y: spin*15, z:0 })`

**Sim loop:**
- MAX_FRAMES = 600
- Record ball and all 10 pin positions/quaternions each frame
- Stop when all bodies sleeping AND frame > 30

**Post-sim:** `knockedPins[i] = world.getRigidBody(pinHandles[i]).translation().y < 0.08`

**Pack recording:** base64-encode both Float32Arrays. Return `BowlingRawRecording`.

#### `src/app/api/bowl-test/simulate/route.ts`
```ts
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const params = await request.json() as ThrowParams;
  const recording = await simulateBowl(params);
  return Response.json(recording);
}
```

### Verification
```
POST /api/bowl-test/simulate
Body: { direction: 0, power: 0.8, spin: 0, pinState: [true×10] }
```
Expect: JSON with `numFrames` (100–600), `knockedPins` array, two base64 strings.

---

## Phase 2 — Three.js Scene (Static)

**Goal:** `/bowl-test` shows lane + 10 standing pins + ball in behind-the-ball camera. No physics replay yet.

### Files to create

#### `src/components/game/bowling/bowling-shared.tsx`
`'use client'`
```ts
export type BowlingPhase = 'aiming' | 'throwing' | 'replay' | 'results';

// decode helper (same pattern as race-room.tsx)
export function decodeRecording(raw: BowlingRawRecording): BowlingDecodedRecording

// ScoreCard — stub for now, just renders player names
export function ScoreCard({ ... }) { ... }
```

#### `src/components/game/bowling/BowlingScene.tsx`
`'use client'`

**Props:**
```ts
interface BowlingSceneProps {
  myPlayerId: string;
  pinState: boolean[];                          // which pins standing
  recording: BowlingDecodedRecording | null;    // null during aiming
  onThrow: (params: ThrowParams) => void;
  phase: BowlingPhase;
  isMyTurn: boolean;
}
```

**Canvas setup:** perspective camera, `fov:45`, initial pos `[0, 1.2, -2.5]`, near 0.1

**Geometry:**
- Lane: `<boxGeometry args={[1.06, 0.01, 18.5]}/>` at `[0, 0, 9.0]`, color `#C8A96E`
- Gutters: `<boxGeometry args={[0.25, 0.01, 18.5]}/>` at `[±0.655, -0.005, 9.0]`, color `#8B6F4E`
- Foul line: `<boxGeometry args={[1.06, 0.002, 0.03]}/>` at `[0, 0.006, 0.15]`, color `#222`
- Pins: 10 `<cylinderGeometry args={[0.06, 0.06, 0.38, 12]}/>`, white, `pinRefs` array
- Ball: `<sphereGeometry args={[0.108, 16, 16]}/>` at ball start pos
- Lighting: `<ambientLight intensity={0.6}/>` + `<directionalLight position={[5,10,5]} intensity={1.2}/>`

**CameraRig** (`useFrame`, no setState):
- During `aiming` phase: lerp to overview pos `[0, 3.5, -1]` looking at `[0, 0, 15]`
- During `replay` phase: lerp camera Z to `ballPos.z - 2.5`, X to `ballPos.x * 0.3`; `lookAt(ballPos.x*0.5, 0.3, ballPos.z + 3.0)`
- Lerp factor: 0.06

#### `src/app/bowl-test/page.tsx`
`'use client'` — renders `<BowlingScene>` with static `pinState` all true, no recording, `phase='aiming'`, `isMyTurn={true}`, `onThrow={()=>{}}`.

### Verification
Visit `/bowl-test` — see lane, 10 white pins at far end, camera positioned behind the ball.

---

## Phase 3 — Replay Driver + Touch Input

**Goal:** Full throw loop — swipe to throw → fetch sim → watch ball roll + pins fall.

### Files to create

#### `src/components/game/bowling/useThrowInput.ts`
```ts
export function useThrowInput(
  containerRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  onThrow: (params: ThrowParams) => void,
): { phase: 'aiming' | 'throwing'; aimX: number; }
```

**Gesture logic:**
- `touchstart` → record start pos, enter aiming phase
- `touchmove` (horizontal): `aimX = (touch.clientX - centerX) / (width/2)`, clamped ±1
- `touchmove` (upward, dy < −20px from aim-lock): switch to throw phase, start tracking swipe path
- `touchend`: compute `power = min(1, totalSwipeDist/300)`, `spin` from path curve (`midX deviation / 50`), fire `onThrow({ direction: aimX*(π/6), power, spin, pinState })`
- Register with `{ passive: false }`, call `e.preventDefault()` during throwing phase

#### Add `BowlingReplayDriver` inside `BowlingScene.tsx`
```ts
function BowlingReplayDriver({ recording, ballRef, pinRefs, onReplayComplete }) {
  const elapsed = useRef(0);
  const lastFrame = useRef(0);
  const done = useRef(false);
  useFrame((_, delta) => {
    elapsed.current += delta;
    const f = min(floor(elapsed.current * 60), recording.numFrames - 1);
    if (f <= lastFrame.current) return;
    lastFrame.current = f;
    // mutate ballRef.current.position from ballFrames[f*3 .. f*3+2]
    // mutate pinRefs.current[i].position + .quaternion from pinFrames[f*70 + i*7 .. +6]
    if (f >= recording.numFrames - 1 && !done.current) {
      done.current = true;
      onReplayComplete(recording.knockedPins);
    }
  });
}
```
Reset `elapsed/lastFrame/done` refs whenever `recording` changes.

#### Update `src/app/bowl-test/page.tsx`
```ts
// State:
const [pinState, setPinState] = useState(Array(10).fill(true));
const [recording, setRecording] = useState<BowlingDecodedRecording | null>(null);
const [phase, setPhase] = useState<BowlingPhase>('aiming');
const throwCount = useRef(0);

async function handleThrow(params: ThrowParams) {
  setPhase('replay');
  const res = await fetch('/api/bowl-test/simulate', { method: 'POST', body: JSON.stringify(params) });
  const raw = await res.json();
  setRecording(decodeRecording(raw));
}

function handleReplayComplete(knockedPins: boolean[]) {
  const newPins = pinState.map((s, i) => s && !knockedPins[i]);
  throwCount.current++;
  const strike = knockedPins.every(Boolean) && throwCount.current === 1;
  if (strike || throwCount.current >= 2) {
    setTimeout(() => { setPinState(Array(10).fill(true)); setRecording(null); setPhase('aiming'); throwCount.current = 0; }, 2500);
  } else {
    setPinState(newPins); setRecording(null); setPhase('aiming');
  }
}
```

### Verification
- Swipe → ball rolls down lane → pins fall in correct direction → reset
- Strike rolls carry all 10 pins
- Second-throw respects remaining pins (correct `pinState` on body creation)

---

## Phase 4 — Full Game Loop + Scoring

**Goal:** 10-frame scoring, turn tracking, `ScoreCard` UI, results screen. Ready to wire into session system.

### Work items

**Scoring logic** (`bowling-shared.tsx`):
```ts
export function computeFrameScores(throws: number[]): (number | null)[]
// Standard bowling scoring: 10 frames, strikes/spares with bonus balls
// Returns cumulative score per frame (null if bonus balls not yet thrown)
```

**`ScoreCard` component** — full implementation:
- 10 frame boxes, each showing throw symbols (X, /, 1-9, –)
- Cumulative running total below each frame
- 10th frame shows up to 3 throw slots
- Highlight active frame, grey out future frames

**`BowlingGameState`** (in `bowling-shared.tsx`):
```ts
export interface BowlingGameState {
  currentFrame: number;        // 0–9
  currentThrow: number;        // 1 or 2 (3 for 10th frame bonus)
  activePlayerId: string;
  pinState: boolean[];
  throwHistory: Record<string, number[][]>;  // playerId → frames → throws (pin counts)
}
```

**Game logic helpers:**
- `nextTurn(state, knockedCount)` → updated `BowlingGameState`
- `isFrameComplete(frameThrows, frameIndex)` → boolean
- `isGameComplete(state)` → boolean

**Results screen** — show all players' final scores, sorted descending, "Bowl Again" / "Leave" buttons. Same style as marble race `ResultsScreen`.

**Update `/bowl-test`** to use full `BowlingGameState` so the sandbox exercises real scoring.

### Verification
- Play through all 10 frames solo
- Score is correct for mix of strikes/spares/opens
- 10th frame: spare gives 1 bonus ball, strike gives 2 bonus balls
- Max score 300 (perfect game) verified in a unit test or console check

---

## Future: Multiplayer Wiring (Phase 5)

After Phase 4 is solid, wiring into sessions requires:

1. Add `'bowling'` to `GameId` union in `src/types/session.ts`
2. Add bowling message types to `src/lib/ably/channels.ts`:
   - `bowl:throw` — `{ playerId, throwIndex, recording: BowlingRawRecording, gameState: BowlingGameState }`
   - `bowl:game:over` — `{ finalScores }`
3. New API route: `POST /api/sessions/[id]/bowl` — validates turn, runs `simulateBowl`, updates Redis game state, publishes `bowl:throw` via Ably
4. New pages: `app/session/[id]/bowling/page.tsx` + `bowling-room.tsx` (mirrors `race/page.tsx` + `race-room.tsx`)
5. Update `session-room.tsx` to support bowling game start (no mode picker needed for bowling)
6. Update `POST /api/sessions/[id]/start` (or add separate start route for bowling)

---

## Key Pitfalls (all phases)

- `PIN_POSITIONS` **must** live in `bowling-constants.ts` (no `'use client'` directive) — the server sim imports it
- Rapier `ColliderDesc.cylinder(halfHeight, radius)` aligns on **Y axis** by default — correct for standing pins
- Use inline Rapier init (`let rapierInited = false`) same as `simulate-race.ts` — do NOT share the singleton across files in Phase 1
- `<Canvas>` — do NOT add `orthographic` prop — bowling uses perspective projection
- Touch listeners need `{ passive: false }` + `e.preventDefault()` to suppress scroll during throw gesture
- `BowlingReplayDriver` must reset its `elapsed`/`lastFrame`/`done` refs when `recording` prop changes (use `useEffect` watching `recording` to reset, or key the component on a throw counter)
