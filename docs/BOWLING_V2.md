# Bowling (v2)

Cosmic-neon 10-frame bowling. Physics (Rapier) runs on the bowler's phone for zero-latency release; multiplayer via `docs/MULTIPLAYER.md` (up to 6). Lab: `/bowl-lab`. Room: `/session/[id]/bowling`. Scoring reuses `src/lib/bowling/bowling-logic.ts` (`nextTurn`, `computeFrameScores`, `isGameComplete`).

## Files
| File | Role |
|---|---|
| `src/lib/bowling/bowl-sim-core.ts` | Isomorphic sim `runBowlSim(RAPIER, {startX, direction, speed, spin, pinState, laneWear?, variance?, rand?})` → ball/pin frames, `knockedPins`, `impactFrame`, `gutterFrame`, `entry` (x + entry angle on the deck), `hits` (every collision, for sound). `TUNING` knobs exported for calibration |
| `src/lib/bowling/bowl-release.ts` | `releaseThrow` — power vs accuracy: release error grows above 7 m/s (`RELEASE` knobs) |
| `src/lib/bowling/bowl-read.ts` | `laneWear(state)` (shared by every phone: total throws so far), `laneCondition`, `pocketRead(entry)` → POCKET/HIGH/LIGHT/WIDE/BROOKLYN |
| `scripts/bowl-calibrate.ts` | `npx tsx scripts/bowl-calibrate.ts [throws]` — strike %, avg pins, leave variety and repeat rate for simulated bowlers |
| `src/components/game/bowling-v2/BowlLab.tsx` | `BowlGame` (solo/online controller, scorecards, standings, callouts) + `BowlLab` wrapper |
| `…/BowlScene.tsx` | R3F scene: director (playback, slow-mo on big hits, camera path), aim guide, burst particles, FX toggles, quality tiers, stats readout |
| `…/CosmicAlley.tsx` | Reflective lane, LED chase gutters, capping, side lanes, light bars, masking unit, dust |
| `…/assets.ts` | Smoothed Catmull-Rom pin lathe, pin/ball materials |
| `…/textures.ts` | Lane wood + blacklight markings, pin stripes, galaxy ball, masking art |
| `…/useSwipeThrow.ts` | Gesture → `mapFlick` (pure) + board-snapped aim |

## Skill model (rework, 2026-09-25)
The old game was bit-deterministic: same board + a maxed flick → the identical strike every time. Now:
- **Power vs accuracy** (`bowl-release.ts`): speed tops out at 10 m/s, but above 7 m/s the release wanders (direction σ up to 0.006 rad ≈ 10 cm at the pins, ~1 board of drift, hook inconsistency).
- **Entry angle** (`carryEntryFull` 0.05 rad, `carryEntryMin` 0.45): the carry assist needs the ball driving into the pocket at an angle; a dead-straight ball gets 45% of it. Entry is measured as the ball arrives on the deck (z 17.25) — "impact" is detected a few frames late, after the ball has already deflected.
- **Per-rack pin variation**: spots ±3 mm, lean ±0.006 rad, pin friction/restitution ±15%, carry ±25% per throw. Impact detection compares against each pin's *actual* spawn spot.
- **Lane wear** (`laneWear`: 0 → 0.85 over ~19 throws per bowler): the hook starts up to 2 m earlier and is up to 40% stronger — the fresh-lane line goes high late in the game; players must move. HUD shows `LANE · FRESH/DRYING/DRY` and announces changes.
- **Feedback**: every first ball shows a pocket read under the count (POCKET · 3.1°, HIGH, LIGHT, WIDE, BROOKLYN), including for spectators (`BowlRecording.entry`).

Calibration (150 first balls each): casual 5–9% strikes · masher (spot, max power, straight) ~20% with ~30 different leaves (was 100%, one leave) · controlled straight ~30% · good hook line ~70% · same hook line late game without adjusting ~10% · adjusted ~55% · good hook at max power ~21%.

Known: very wide balls (deck x 0.3–0.4 m) still strike 20–35% via corner-pin chains — worth a look.

## Sound
`hits` in the sim come from Rapier contact-force events (new or sharply harder contacts only): ball→pin, pin→pin, pin→deck, pin→kickback/gutter, pit. They ride in the recording and `BowlScene` fires `onHit` as playback reaches each frame (slow-mo stretches them); `bowlSfx.hit` voices each by kind, strength and stereo position. `onRoll` drives the roll rumble from the ball's live speed, grittier on the dry backend.

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
- See the skill-model notes above for calibration and the wide-ball quirk.
