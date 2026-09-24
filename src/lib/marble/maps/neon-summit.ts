// Neon Summit — the first "streamer-style" marble map: one long, fast descent.
// Everything is positioned by turtle arc length so tweaking one section shifts
// the rest of the course with it. Tuned for pace: big sweeping banked turns
// instead of hairpins, a plunge, two jumps, and a fast helix.

import { Turtle, type MarbleMapDef, type Spinner, type Bumper, type Puncher, type Zone, type CamZone } from '../track';

const t = new Turtle(0, 300, -4);
const zones: Zone[] = [];
const spinners: Spinner[] = [];
const bumpers: Bumper[] = [];
const punchers: Puncher[] = [];
const pillars: MarbleMapDef['pillars'] = [];
const cams: CamZone[] = [];
const zone = (name: string, color: string) => zones.push({ name, s: t.s, color });

/** Straight → kicker → open air → wide catch ramp. */
function jump(gapLen: number, gapDrop: number, camSide: number) {
  t.fwd(4, -0.22, { step: 2 });                       // kicker
  const lip = t.s;
  t.fwd(gapLen, gapDrop, { gap: true, step: 2 });
  cams.push({ kind: 'fixed', from: lip - 14, to: t.s + 8, at: lip + gapLen / 2, side: camSide, up: 1.5 });
  const w = t.w, wall = t.wall;
  t.w = 12; t.wall = 3.2;
  t.fwd(12, 0.42, { step: 2 });                       // catch ramp
  t.w = w; t.wall = wall;
}

// ── Start: gate, then straight off a launch ramp ─────────────────────────────
zone('The Gate', '#ffb424');
t.w = 8; t.wall = 2.2;
t.fwd(9, 0.1, { step: 3 });
const gateS = t.s;
t.fwd(8, 0.3);
t.w = 6; t.wall = 1.9;
t.fwd(16, 0.4);

// ── Act 1: Slalom — sweeping banked S-bends on a steep grade ─────────────────
zone('Slalom', '#45e0ff');
const SR = 17, SG = 0.15;
t.turn(70, SR, SG).turn(-140, SR, SG).turn(140, SR, SG).turn(-70, SR, SG);
t.fwd(22, 0.24);
jump(6, 0.45, 9);
t.fwd(6, 0.2);

// ── Act 2: Pachinko — a steep peg board with pop-bumpers ─────────────────────
zone('Pachinko', '#b6ff3b');
t.w = 16; t.wall = 3.4;
t.fwd(8, 0.3);                                        // fan out onto the board
const board = t.s;
t.fwd(33, 0.5);
// No free rides down the walls: odd rows carry pins mounted flush on the
// walls (centred further out than a marble can reach, so they always deflect
// inward — never wedge), and two rows swap their outer pins for wall kickers
// that fire wall-huggers back into the field.
for (let r = 0; r < 9; r++) {
  const offs = r % 2 ? [-7.7, -4.8, -2.4, 0, 2.4, 4.8, 7.7] : [-6, -3.6, -1.2, 1.2, 3.6, 6];
  for (const o of offs) {
    const kicker = (r === 2 || r === 6) && Math.abs(o) === 6;
    const pop = (r === 3 && o === 0) || (r === 5 && Math.abs(o) === 3.6) || (r === 7 && o === 0);
    if (kicker) bumpers.push({ s: board + 3 + r * 3.4, offset: Math.sign(o) * 7.45, r: 0.55, pop: true });
    else bumpers.push({ s: board + 3 + r * 3.4, offset: o, r: pop ? 0.8 : 0.3, pop });
  }
}
cams.push({ kind: 'fixed', from: board - 6, to: board + 35, at: board + 10, side: 0, up: 16, back: 12 });
t.w = 6;
t.fwd(12, 0.3);                                       // funnel back down to a chute
t.wall = 3.6;
t.fwd(8, 0.2);

// ── Act 3: Wall of Death — a long 270° wall-ride ─────────────────────────────
zone('Wall of Death', '#ffb424');
t.turn(-270, 22, 0.1);
t.wall = 1.9;
t.fwd(12, 0.2);

// ── Act 4: Spinner deck ─────────────────────────────────────────────────────
zone('Spinner Deck', '#ff3fd0');
t.w = 13; t.wall = 2.4;
t.fwd(8, 0.15);
const deck = t.s;
t.fwd(66, 0.19);
// Spinners never span the full width — there's always a lane through, so
// they shuffle the order without trapping anyone against a wall.
spinners.push(
  { s: deck + 10, offset: -3.3, arm: 2.0, omega: 1.9, phase: 0 },
  { s: deck + 10, offset: 3.3, arm: 2.0, omega: 1.9, phase: 0.8 },
  { s: deck + 30, offset: 0, arm: 3.4, omega: 1.7, phase: 0.3 },
  { s: deck + 50, offset: -3.3, arm: 2.0, omega: -2.2, phase: 1.1 },
  { s: deck + 50, offset: 3.3, arm: 2.0, omega: -2.2, phase: 0.2 },
);
for (const o of [-2.2, 2.2]) bumpers.push({ s: deck + 20, offset: o, r: 0.5 });
for (const o of [-4.2, 0, 4.2]) bumpers.push({ s: deck + 40, offset: o, r: 0.45 });

// ── Act 5: The Plunge → The Leap ─────────────────────────────────────────────
zone('The Plunge', '#ff3fd0');
t.w = 6; t.wall = 3.2;
t.fwd(16, 0.2);                                       // tall walls while the deck funnels in
t.wall = 1.9;
t.fwd(34, 0.44);                                      // ~24° dive
t.fwd(10, 0.12);
zone('The Leap', '#ffb424');
t.fwd(8, 0.12);
jump(12, 0.5, 13);
t.wall = 3.2;                                         // bouncy landings: keep them in
t.fwd(10, 0.15);
t.fwd(12, 0.02);                                      // run-in flat: bleeds a little speed before the helix

// ── Act 6: The Helix ────────────────────────────────────────────────────────
zone('The Helix', '#45e0ff');
t.wall = 3.4;
t.fwd(8, 0.05);
const HR = 18;
const c = t.turnCentre(HR, 1);
const helixTop = t.y;
const helixIn = t.s;
t.turn(720, HR, 0.13);
t.wall = 1.9;
cams.push({ kind: 'orbit', from: helixIn + 6, to: t.s - 4, x: c.x, z: c.z, r: HR + 11 });
pillars.push({ x: c.x, z: c.z, y0: t.y - 40, y1: helixTop + 6, color: '#45e0ff' });

// ── Act 7: The Gauntlet — boxing gloves punch out of alternating walls ──────
zone('The Gauntlet', '#ff5a5a');
t.fwd(8, 0.12);
t.w = 7; t.wall = 3.2;
t.fwd(6, 0.12);
const gauntlet = t.s;
t.roof = true;                                        // glass tube: punched piles can't pop out
t.fwd(66, 0.12);
t.roof = false;
// Staggered timings so there's always a window, but never a free lane for long.
for (let k = 0; k < 7; k++) {
  punchers.push({ s: gauntlet + 6 + k * 9, side: k % 2 ? 1 : -1, reach: 3.6, period: 2.2 + (k % 3) * 0.35, phase: (k * 0.37) % 1 });
}
t.w = 6; t.wall = 3.8;                                // punched marbles exit hot
t.fwd(10, 0.14);

// ── Act 8: Bobsled — linked banked turns at speed ───────────────────────────
zone('Bobsled', '#ffb424');
t.fwd(10, 0.15);
t.wall = 3.4;
t.turn(-90, 20, 0.12).turn(120, 14, 0.12).turn(-150, 16, 0.12).turn(120, 14, 0.12);
t.fwd(14, 0.22);
t.turn(-100, 18, 0.12);
t.wall = 1.9;

// ── Act 9: Final Dive ───────────────────────────────────────────────────────
zone('Final Dive', '#ff3fd0');
t.fwd(10, 0.15);
t.turn(-50, 18, 0.16).turn(100, 18, 0.16).turn(-50, 18, 0.16);
t.fwd(30, 0.34);
t.fwd(16, 0.1);
const finishS = t.s;
t.w = 12; t.wall = 2.6;
t.fwd(10, 0.03, { step: 3 });
t.fwd(26, -0.04);                                     // uphill run-out bleeds speed in the basin

export const NEON_SUMMIT: MarbleMapDef = {
  id: 'neon-summit',
  name: 'Neon Summit',
  points: t.pts,
  gateS,
  finishS,
  spinners,
  bumpers,
  punchers,
  zones,
  pillars,
  cams,
  groundY: t.y - 40,
};
