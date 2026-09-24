# Pool (v2)

Neon 8-ball on a 7-ft bar box. Physics runs on the shooter's phone (custom 2D engine, no Rapier). Solo = you vs an NPC regular; online = 2 players via `docs/MULTIPLAYER.md`. Lab: `/pool-lab`. Room: `/session/[id]/pool`.

## Files
| File | Role |
|---|---|
| `src/lib/pool/pool-sim-core.ts` | Physics. Table geometry (cushion segments, pocket jaws), rack, `simulatePoolShot(table, {angle, speed, spin, side})` → frames (60 Hz × 16 × xz), `pocketedAt/pocketOf`, `firstHit`, events (ball/rail/pocket) |
| `src/lib/pool/pool-rules.ts` | 8-ball rules: `newGame`, `legalTargets`, `canPlaceCue`, `applyShot` → next `PoolState` with `lastCall` |
| `src/lib/pool/pool-bot.ts` | `planBotShot(state, skill, seed)` — ghost-ball candidates → vetted with the real sim → human aim error by skill |
| `src/components/game/pool-v2/PoolLab.tsx` | `PoolGame` (solo/online controller, HUD, controls) + `PoolLab` wrapper |
| `…/PoolScene.tsx` | R3F scene: balls, replay, aim guide + pocket highlight, cue stick, flashes, camera framing with insets |
| `…/PoolTableMesh.tsx` | Rails/felt as extruded outlines with real pocket cut-outs; cushions end on the jaws; pocket cups |
| `…/aimGuide.ts` | Pure guide geometry: ghost ball, object path, spin-aware cue path `(5·vt + 2·u)/7`, english on rail bounces |
| `…/SpinPicker.tsx` | Big-ball tip picker (x = english, y = follow/draw) + `SpinBadge` |
| `…/poolTextures.ts` | Numbered ball skins, felt |

## Physics model (`pool-sim-core.ts`)
- Table: bar box, half-size **0.495 × 0.99 m**. Balls **R = 0.032** (~12% over regulation so they read on a phone; pockets scaled to match). Constants exported: `TABLE_HALF_WIDTH/LENGTH`, `BALL_RADIUS`, `CORNER_MOUTH 0.092`, `SIDE_MOUTH 0.076`, `JAW`.
- Per ball: position, velocity `v`, roll velocity `u = ω×R`, side spin `w`. Sliding friction pulls v/u together (μ 0.2, u gains 2.5×) → natural 5/7 roll, stun/follow/draw emerge from ball–ball contacts (normal swap, spin kept). Rolling decel 0.16 m/s².
- Cushions: restitution 0.78; english kicks the rebound sideways (right english → shooter's right), `RAIL_GRIP 0.24` (full english ≈ 28° straight into a rail).
- Pocketing: a ball centre passing beyond the cushion line can only be in a mouth → pocketed (balls can rattle off jaws first).
- 360 Hz substeps, 60 Hz frames. Break ≈ 45 ms CPU on desktop.
- **Camera looks down +Z → screen-right is −X.**

## Rules (bar-friendly)
Open table after the break; first legally pocketed ball claims the group; fouls = scratch, no hit, wrong ball first (no "rail after contact" rule); ball in hand anywhere after a foul (kitchen only on the break); 8 on the break re-spots; 8 early or with a foul loses. Pocketing an opponent's ball along with your own is legal (standard). Possible future option: house rule where sinking an opponent's ball ends your turn.

## Controls / UX
Drag to swing the aim around the cue ball (damped near the ball) · tap to point · fine-aim roller (bottom) · slide-to-shoot bar (bottom, drag right, release to fire, slide back to cancel) · spin picker (bottom-left) · ball-in-hand: drag the cue ball (grab radius 0.16 m) · tap to fast-forward while balls roll · pocketed-ball trough in a 24 px left gutter · break callout "N DOWN ON THE BREAK". Power bar and roller paint via refs (no React state per move).

## Bot
`BOT_SKILL` 0.6 in `PoolLab.tsx`. Offline tournaments (bar box): equal bots split ~7–9; 0.35 vs 0.8 → 3–13; ~30–40 shots/game; ~5 ms think.
