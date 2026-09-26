# Bowling (v2)

Cosmic-neon 10-frame bowling. Physics (Rapier) runs on the bowler's phone for zero-latency release; multiplayer via `docs/MULTIPLAYER.md` (up to 6). Lab: `/bowl-lab`. Room: `/session/[id]/bowling`. Scoring reuses `src/lib/bowling/bowling-logic.ts` (`nextTurn`, `computeFrameScores`, `isGameComplete`).

## Files
| File | Role |
|---|---|
| `src/lib/bowling/bowl-sim-core.ts` | Isomorphic sim `runBowlSim(RAPIER, {startX, direction, speed, spin, pinState, variance?, rand?})` → ball/pin frames, `knockedPins`, `impactFrame`, `gutterFrame`, `entry` (x + entry angle on the deck, used for carry), `hits` (every collision, for sound). `TUNING` knobs exported for calibration |
| `src/lib/bowling/bowl-release.ts` | `releaseThrow` — power vs accuracy: release error grows above 7 m/s (`RELEASE` knobs) |
| `scripts/bowl-calibrate.ts` | `npx tsx scripts/bowl-calibrate.ts [throws]` — simulated thumbs through the real `mapFlick`: strike %, avg pins, leave variety, repeat rate |
| `src/components/game/bowling-v2/BowlLab.tsx` | `BowlGame` (solo/online controller, scorecards, standings, callouts) + `BowlLab` wrapper |
| `…/BowlScene.tsx` | R3F scene: director (playback, slow-mo on big hits, camera path), aim guide, burst particles, FX toggles, quality tiers, stats readout |
| `…/CosmicAlley.tsx` | Reflective lane, LED chase gutters, capping, side lanes, light bars, masking unit, dust |
| `…/assets.ts` | Smoothed Catmull-Rom pin lathe, pin/ball materials |
| `…/textures.ts` | Lane wood + blacklight markings, pin stripes, galaxy ball, masking art |
| `…/useSwipeThrow.ts` | Gesture → `mapFlick` (pure) + board-snapped aim |

## Feel and skill (rework, 2026-09-25 — second pass after Davey's play-test)
Modelled on popular swipe-bowling games (Bowling King, Galaxy Bowling, My Bowling 3D) and Wii Sports' "capture the feeling, not the real thing". Davey rejected sim-realism extras (lane oil wear, a POCKET/entry-angle readout) — keep it obvious from play.
- **Positioning**: the ball follows your finger smoothly (no board snapping); a light haptic tick per board.
- **Hook = the curve of your swipe**, with a plateau so a normal curve is reliable: measured `arc` < 0.10 straight · ~0.20–0.45 the standard hook (same every time — a wobbly curve doesn't scatter the ball) · past 0.45 an exaggerated curve adds more, up to full. The hook ramps in from 4 m down the lane so it visibly sweeps (`hookAccel` 0.9 ≈ 0.25 m break for the standard hook at a normal pace; faster balls hook less).
- **Swipe trail**: the throw stroke is drawn on screen (DOM-direct SVG) — ice while straight, magenta once it's a hook.
- **Power vs accuracy**: a normal flick (≤ 8.3 m/s) is accurate; harder flicks, up to 10 m/s, wander.
- **Carry**: needs some entry angle (straight balls get 45% of the assist), and angled balls get a slightly wider pocket; pins vary a little per rack so no two strikes look identical. Impact detection compares against each pin's actual spawn spot.

Calibration (150 first balls per simulated thumb): casual ~7% strikes · masher (centre, hardest flick) ~15% · straight centre, medium flick ~35% · clean hook from x 0.30 ~67% · sloppy hook ~51% · hook at max power ~19%.

## Sound
`hits` in the sim come from Rapier contact-force events (new or sharply harder contacts only): ball→pin, pin→pin, pin→deck, pin→kickback/gutter, pit. They ride in the recording and `BowlScene` fires `onHit` as playback reaches each frame (slow-mo stretches them); `bowlSfx.hit` voices each by kind, strength and stereo position. `onRoll` drives the roll rumble from the ball's live speed, grittier once it's hooking.

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
- Very wide balls can still strike off corner-pin chains now and then.
