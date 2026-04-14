# MARBLE_RACE.md — Marble Race

## Overview
Marble Race is the first Quick Taps game. Players pick a marble color and watch their
marble race down a three-act track. The phone follows their marble (follow-cam). The
projector shows the full track bird's eye view. First marble out of the funnel wins.

## Player experience
1. Player joins session and picks a marble color from available colors
2. Waiting room shows joined players and their colors
3. Session creator hits Start (or auto-starts if solo, filling remaining slots with NPCs)
4. Countdown: 3 — 2 — 1 — GO!
5. Race runs, phone scrolls with the player's marble
6. Results screen shows final placement for all marbles

## Track

### Canvas dimensions
- Width: 390px
- Height: 2800px
- The track is a fixed, hardcoded asset — not procedurally generated

### Channel width
The track channel (the chute the marbles roll through) is 60px wide throughout all acts.
Marbles are 16px diameter. Multiple marbles can be side by side within the channel.

### Three-act structure

---

#### Act 1 — Plinko drop (y: 0–800px)
A vertical plinko field. Marbles enter from the top center and bounce off pegs arranged
in a staggered grid, scattering horizontally before funneling into the crossing lanes.

- Entry point: x=195 (center), y=0
- Peg grid: 8 rows, staggered. Even rows have 5 pegs, odd rows have 4 pegs.
  Horizontal spacing: 60px. Vertical spacing: 80px. First row starts at y=80.
- Pegs are circular obstacles, radius 6px
- Channel walls on left (x=40) and right (x=350) keep marbles in bounds
- Act 1 exits into Act 2 at y=800, spread across the full channel width

**Purpose**: randomizes starting positions. Nobody knows who's ahead after this.

---

#### Act 2 — Crossing lanes (y: 800–2000px)
Four lanes that start parallel, then cross and interweave across three crossing zones.
This is where overtakes happen and positions shuffle.

Lane layout at y=800 (entry from Act 1):
- Lane A: x=80
- Lane B: x=160
- Lane C: x=230
- Lane D: x=310

Each lane is a bezier-curved chute. The lanes cross at three points:

**Crossing 1** (y≈1000–1100):
- Lane A curves right to x=230, Lane C curves left to x=80
- Lanes B and D cross similarly: B→x=310, D→x=160
- All four lanes have swapped sides by y=1100

**Crossing 2** (y≈1300–1400):
- Lanes return toward original positions but with a full swirl:
  all four lanes spiral clockwise around center (x=195), 180-degree rotation
- This is the most visually dramatic moment — lanes visibly wrap around each other

**Crossing 3** (y≈1600–1700):
- Shallow crossing: A and B swap, C and D swap
- Less dramatic, builds anticipation for the funnel

Lanes reconverge to center (x=195) between y=1900–2000, funneling into Act 3.

**Purpose**: creates overtakes and lead changes. Crowd pleaser.

---

#### Act 3 — Funnel (y: 2000–2800px)

A circular bowl that marbles enter from the top, spiral around the inner wall due to
centripetal force, and exit one at a time through a hole at the bottom center.

**Funnel geometry**:
- Outer rim: circle centered at x=195, y=2200, radius=140px
- Inner hole: circle centered at x=195, y=2200, radius=20px
- Marbles enter the funnel rim at y=2060 from the converging lanes
- Marbles travel along the inner wall of the funnel, spiraling inward
- Exit hole at x=195, y=2380 — marbles drop through one at a time

**Funnel physics** (important — do not fake this):
- On entering the funnel, each marble is given a tangential velocity based on its
  entry x position — marbles entering from the left get a clockwise spin,
  marbles from the right get counter-clockwise. This should resolve naturally as
  they spiral inward.
- Apply centripetal acceleration toward the funnel center at each physics step:
  `a = v² / r` where r is distance from funnel center
- As r decreases, speed increases (conservation of angular momentum approximation)
- Marbles exit when r < hole radius (20px) — record exit order as final placement
- Exit one at a time: once a marble exits, remaining marbles continue spiraling

**Post-funnel**:
- Exiting marbles drop down a short chute (x=195, y=2380 → y=2800)
- Finish line at y=2750
- Final placement locked in order of funnel exit

**Purpose**: the photo finish. Everyone converges, the order is uncertain until the
last marble drops. The most exciting 10 seconds of the race.

---

### Track rendering
- Track channel rendered as a thick stroked SVG path or canvas arc, color: #D3D1C7
- Channel has inner fill (slightly lighter) and outer wall stroke (2px, #888780)
- Pegs rendered as filled circles
- Funnel rendered as two concentric circles with the channel between them
- The full track SVG is pre-rendered as a static layer; marbles are drawn on top
  on a separate canvas layer

---

## Marble physics

### General
- Physics runs at 60fps via requestAnimationFrame
- Each marble has: position (x, y), velocity (vx, vy), and a reference to its
  current track segment
- Marbles are constrained to stay within the channel — collision with channel walls
  reflects velocity with a damping factor of 0.6
- Gravity: 0.3px/frame²
- Max velocity: 12px/frame

### Speed variation
Each marble is assigned a `speedMod` at race start: a value between 0.88 and 1.12,
randomly distributed. This creates natural speed differences without feeling rigged.
`speedMod` is fixed for the duration of the race — it is not re-randomized mid-race.

### Peg collisions (Act 1)
- On collision with a peg, reflect velocity off the peg's normal
- Add a small random lateral impulse (±2px/frame) to prevent deterministic paths
- Damping: 0.7 on collision

### Lane following (Act 2)
- Each marble is assigned to a lane on entry to Act 2 based on its x position
- Lane paths are defined as cubic bezier curves
- Marble follows its assigned lane path using t-parameter interpolation
- Marbles can collide with each other within a lane — elastic collision, mass=1
- At crossing zones, marbles stay on their assigned lane path through the cross

### Funnel physics (Act 3)
- See funnel physics section above
- Marbles that enter the funnel together will naturally separate due to slightly
  different entry velocities and positions — do not artificially serialize them
- Collision between marbles in the funnel: elastic, they nudge each other

---

## Views

### Phone view (follow-cam)
- Canvas viewport: 390×844px (standard phone)
- Camera tracks the player's marble, keeping it vertically centered at 40% from top
- Camera lerps to marble position (smoothing factor: 0.08) — no jarring cuts
- Other marbles visible when they are within the viewport
- Player's marble has a subtle pulsing ring to distinguish it
- Current placement shown in top-right corner (e.g. "3rd") — updates in real time
- Track background scrolls with camera

### Projector view (?projector=true)
- Full track visible at once, scaled to fit the projector canvas
- All marbles visible with player name labels
- Leaderboard sidebar showing current order, updates in real time
- No follow-cam — static bird's eye

---

## Color options
Players choose from 8 colors. Each color has a marble hex and a display name:

| Name   | Hex     |
|--------|---------|
| Red    | #E24B4A |
| Blue   | #378ADD |
| Green  | #639922 |
| Amber  | #EF9F27 |
| Purple | #7F77DD |
| Coral  | #D85A30 |
| Pink   | #D4537E |
| Teal   | #1D9E75 |

First player to join gets first pick. Colors are claimed — no two marbles share a color.

---

## NPC marbles
- Triggered when session starts with fewer than 6 real players
- NPCs fill remaining slots up to 6 total
- NPC names: Big Mike, Hopsy, The Regular, Sudsy, Last Call, Tab
- NPC colors assigned from remaining unchosen colors
- NPC physics identical to real players — no handicapping, outcomes genuinely random
- NPCs are generated client-side at race start, not stored in Redis

---

## Results screen
- Shows final placement 1st through Nth
- Podium layout for top 3 (2nd left, 1st center, 3rd right)
- Full ranked list below podium for 4+ players
- "Race again" button — starts a new session with the same players
- "Leave" button — returns to session list

---

## Timing
- Typical race duration: 45–90 seconds
- Act 1 (plinko): ~10–15s
- Act 2 (crossing lanes): ~20–30s
- Act 3 (funnel): ~10–20s
- Countdown pre-race: 3s

---

## Out of scope for v1
- Sound effects
- Power-ups or player interaction during the race
- Leaderboard persistence (see ARCHITECTURE.md)
- Multiple track variants