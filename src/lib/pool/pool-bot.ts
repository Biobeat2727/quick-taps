// NPC opponent. Pure + isomorphic; uses the real physics to vet its shots.
//
// 1. Enumerate (legal ball × pocket) pots; aim at the ghost-ball point.
// 2. Drop blocked lines (cue → ghost, ball → pocket) and extreme cuts.
// 3. Score by cut angle and distances; simulate the best few at a couple of
//    speeds and keep the one that pots a legal ball without scratching.
// 4. Apply human-ish aim error by skill, so it misses believably.
// No pot available → a safe-ish tap at the easiest legal ball.

import { NUM_BALLS } from './pool-constants';
import { BALL_RADIUS as R, TABLE_HALF_WIDTH as W, TABLE_HALF_LENGTH as L, simulatePoolShot, POCKETS, type PoolShot } from './pool-sim-core';
import { legalTargets, canPlaceCue, groupOf, type PoolState } from './pool-rules';

export interface BotPlan {
  shot: PoolShot;
  cue?: [number, number]; // placement when it has ball in hand
}

type V = [number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const len = (a: V) => Math.hypot(a[0], a[1]);
const norm = (a: V): V => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];

/** Does a ball travelling a→b pass within 2R of any other active ball? */
function blocked(s: PoolState, a: V, b: V, ignore: number[]): boolean {
  const d = sub(b, a), dl = len(d), u = norm(d);
  for (let i = 0; i < NUM_BALLS; i++) {
    if (!s.table.active[i] || ignore.includes(i)) continue;
    const p = s.table.pos[i];
    const t = dot(sub(p, a), u);
    if (t < 0 || t > dl) continue;
    const perp = len(sub(p, [a[0] + u[0] * t, a[1] + u[1] * t]));
    if (perp < 2 * R - 0.002) return true;
  }
  return false;
}

interface Cand { target: number; pocket: number; angle: number; dist: number; score: number }

function candidates(s: PoolState, cue: V): Cand[] {
  const out: Cand[] = [];
  for (const t of legalTargets(s)) {
    const tp = s.table.pos[t] as V;
    POCKETS.forEach((pk, pi) => {
      // aim at a point just inside the pocket mouth, not its drawn centre
      const mouth: V = [Math.max(-W + 0.02, Math.min(W - 0.02, pk[0])), Math.max(-L + 0.02, Math.min(L - 0.02, pk[1]))];
      const toPocket = norm(sub(mouth, tp));
      const ghost: V = [tp[0] - toPocket[0] * 2 * R, tp[1] - toPocket[1] * 2 * R];
      const toGhost = sub(ghost, cue);
      const cut = Math.acos(Math.max(-1, Math.min(1, dot(norm(toGhost), toPocket))));
      if (cut > 1.35) return; // > ~77°: not makeable
      if (blocked(s, cue, ghost, [0, t]) || blocked(s, tp, mouth, [0, t])) return;
      const d1 = len(toGhost), d2 = len(sub(mouth, tp));
      const sidePocket = pi === 2 || pi === 3;
      // side pockets hate steep approach angles
      const approach = sidePocket ? Math.abs(toPocket[1]) : 0;
      const score = Math.cos(cut) ** 2 / (0.3 + d1 * 0.6 + d2) - approach * 0.8 + (groupOf(t) ? 0 : 0.05);
      out.push({ target: t, pocket: pi, angle: Math.atan2(toGhost[0], toGhost[1]), dist: d1 + d2, score });
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Rough speed to pot a ball `dist` total metres away, with a little extra for cuts. */
const potSpeed = (dist: number) => Math.min(4.5, 0.9 + dist * 1.1);

function place(s: PoolState, rnd: () => number): V {
  // Try spots that give a straight-ish pot on the best open ball.
  let best: V = [0, -L / 2], bestScore = -Infinity;
  for (let k = 0; k < 40; k++) {
    const p: V = [(rnd() - 0.5) * 2 * (W - 0.1), s.isBreak ? -L / 2 - rnd() * (L / 2 - 0.1) : (rnd() - 0.5) * 2 * (L - 0.1)];
    if (!canPlaceCue(s, p[0], p[1])) continue;
    const c = candidates(s, p)[0];
    const sc = c ? c.score : -1;
    if (sc > bestScore) { bestScore = sc; best = p; }
  }
  return best;
}

/**
 * @param skill 0..1 — 0.35 ≈ casual bar player, 0.7 ≈ league, 0.95 ≈ shark
 */
export function planBotShot(s: PoolState, skill: number, seed: number, simulate = simulatePoolShot): BotPlan {
  let rs = (seed >>> 0) || 1;
  const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());

  if (s.isBreak) {
    const cue: V = [(rnd() - 0.5) * 0.3, -L / 2 - 0.05];
    const apex = s.table.pos[1] as V;
    const a = Math.atan2(apex[0] - cue[0], apex[1] - cue[1]) + gauss() * 0.004;
    return { cue, shot: { angle: a, speed: 7 + rnd() * 1.8, spin: 0 } };
  }

  const cue: V = s.ballInHand ? place(s, rnd) : (s.table.pos[0] as V);
  const table = s.ballInHand ? { ...s.table, pos: s.table.pos.map((p, i) => (i === 0 ? cue : p)) as V[] } : s.table;
  const st = { ...s, table };
  const cands = candidates(st, cue).slice(0, 5);

  let chosen: PoolShot | null = null;
  for (const c of cands) {
    for (const spin of [0, -0.4, 0.4]) {
      const shot = { angle: c.angle, speed: potSpeed(c.dist), spin };
      const sim = simulate(table, shot);
      const ok = sim.pocketedAt[c.target] >= 0 && sim.pocketedAt[0] < 0 && (c.target !== 8 || sim.pocketedAt[8] >= 0);
      if (ok) { chosen = shot; break; }
    }
    if (chosen) break;
  }

  let safety = false;
  if (!chosen) {
    // Nothing clean: make a legal hit. Prefer the nearest legal ball with a clear
    // line; test a few aims (full, and thin either side) with the real physics.
    safety = true;
    const legal = legalTargets(st);
    const byDist = legal
      .map((b) => ({ b, d: len(sub(table.pos[b] as V, cue)), clear: !blocked(st, cue, table.pos[b] as V, [0, b]) }))
      .sort((x, y) => Number(y.clear) - Number(x.clear) || x.d - y.d);
    for (const { b, d } of byDist.slice(0, 4)) {
      const tp = table.pos[b] as V;
      const base = Math.atan2(tp[0] - cue[0], tp[1] - cue[1]);
      const thin = Math.asin(Math.min(1, (1.2 * R) / Math.max(d, 2 * R)));
      for (const off of [0, thin, -thin]) {
        const shot = { angle: base + off, speed: 1.2 + d * 0.5, spin: 0 };
        const sim = simulate(table, shot);
        if (sim.firstHit >= 0 && legal.includes(sim.firstHit) && sim.pocketedAt[0] < 0 && sim.pocketedAt[8] < 0) { chosen = shot; break; }
      }
      if (chosen) break;
    }
    if (!chosen) {
      const tp = (table.pos[byDist[0]?.b ?? 0] ?? [0, 0]) as V;
      chosen = { angle: Math.atan2(tp[0] - cue[0], tp[1] - cue[1]), speed: 1.6, spin: 0 };
    }
  }

  // Human error: aim wobble (degrees) and speed wobble shrink with skill.
  // A safety just needs contact, so it's played with half the wobble.
  const aimErrDeg = (0.15 + (1 - skill) * 1.6) * (safety ? 0.5 : 1);
  return {
    cue: s.ballInHand ? cue : undefined,
    shot: {
      angle: chosen.angle + gauss() * aimErrDeg * (Math.PI / 180),
      speed: Math.max(0.4, chosen.speed * (1 + gauss() * (0.04 + (1 - skill) * 0.12))),
      spin: chosen.spin,
    },
  };
}
