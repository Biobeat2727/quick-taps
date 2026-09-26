# Bowling (v2)

Cosmic-neon 10-frame bowling. Physics (Rapier) runs on the bowler's phone for zero-latency release; multiplayer via `docs/MULTIPLAYER.md` (up to 6). Lab: `/bowl-lab`. Room: `/session/[id]/bowling`. Scoring reuses `src/lib/bowling/bowling-logic.ts` (`nextTurn`, `computeFrameScores`, `isGameComplete`).

## Files
| File | Role |
|---|---|
| `src/lib/bowling/bowl-sim-core.ts` | Isomorphic sim `runBowlSim(RAPIER, {startX, direction, speed, spin, pinState})` → ball/pin frames, `knockedPins`, `impactFrame`, `gutterFrame`. `TUNING` knobs exported for calibration scripts |
| `src/components/game/bowling-v2/BowlLab.tsx` | `BowlGame` (solo/online controller, scorecards, standings, callouts) + `BowlLab` wrapper |
| `…/BowlScene.tsx` | R3F scene: director (playback, slow-mo on big hits, camera path), aim guide, burst particles, FX toggles, quality tiers, stats readout |
| `…/CosmicAlley.tsx` | Reflective lane, LED chase gutters, capping, side lanes, light bars, masking unit, dust |
| `…/assets.ts` | Smoothed Catmull-Rom pin lathe, pin/ball materials |
| `…/textures.ts` | Lane wood + blacklight markings, pin stripes, galaxy ball, masking art |
| `…/useSwipeThrow.ts` | Gesture → `mapFlick` (pure) + board-snapped aim |

## Physics tuning (calibrated offline)
- `ballDensity 4.5` (≈4.8:1 ball:pin mass), `pinBellyR 0.0605` (real belly), **`carry 0.7`** — on a pocket hit each pin, when first set moving, is guaranteed a share of lateral motion away from the ball's line (rigid capsules otherwise get shoved straight back and leave 6-10 / 3-6-10). Scaled by pocket quality, so off-target throws gain nothing. Result: ~60–70% strikes on pocket hits.
- Hook: lateral impulse ramps in on the "dry backend" (z 8.5 → 13.5 m), `hookAccel 1.35`.
- Pin compound collider (flat base + belly + neck capsules) — the reasoning lived in the removed v1 `docs/BOWLING.md` ("Pin Physics"); see git history before the legacy cleanup.

## Controls (`mapFlick`)
Drag sideways = line up, snapping per lane board (39 boards, haptic tick). Flick up = bowl: speed 6.4–9 m/s (strong floor — any deliberate flick can strike), direction is a small nudge with a ±5° dead zone (±0.018 rad max), hook only past a ~20° bend (natural thumb arc = straight). mph + STRAIGHT/HOOK readout after release.
Simulated players: masher 18% strikes/2% gutters; careful straight 42%; hook bowler from outside 56%.

## Rendering notes
Quality tier fixed per load (touch → tier 1); FX panel toggles for device debugging; custom dust shader (drei Sparkles flickered on phones); `<Environment>` built once (memo).

## Known
- A dead-straight centre hit can still strike more often than real life.
- No sound yet.
