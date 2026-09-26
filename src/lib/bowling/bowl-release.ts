// Release variance — the power vs accuracy trade-off. Isomorphic and pure (you
// pass the random source) so offline calibration can run it.
//
// A smooth, medium-speed throw goes where you aimed. The harder you throw, the
// more the release wanders: a touch of direction error, a board or so of
// drift, and a less consistent hook. Max power is a gamble, not a free strike.

export interface ReleaseIntent {
  startX: number;    // m, lane position
  direction: number; // rad, +right
  speed: number;     // m/s
  spin: number;      // −1..1
}

export const RELEASE = {
  controlSpeed: 7.0,   // m/s — at or below this the release is (almost) exact
  maxSpeed: 10.0,
  dirErrMin: 0.0008,   // rad σ at controlSpeed (≈1.4 cm at the pins)
  dirErrMax: 0.006,    // rad σ at maxSpeed (≈10 cm at the pins)
  driftMax: 0.02,      // m σ of startX at maxSpeed (≈1 board)
  spinErrMax: 0.12,    // σ of spin at maxSpeed (only on hooked throws)
};

/** Box–Muller normal sample. */
function gauss(rand: () => number) {
  const u = Math.max(1e-9, rand()), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** How wild a release at this speed is, 0 (controlled) → 1 (max power). */
export function powerOf(speed: number) {
  return Math.max(0, Math.min(1, (speed - RELEASE.controlSpeed) / (RELEASE.maxSpeed - RELEASE.controlSpeed)));
}

export function releaseThrow(t: ReleaseIntent, rand: () => number = Math.random): ReleaseIntent {
  const p = powerOf(t.speed);
  const k = p * p; // gentle at medium pace, steep near max
  const dirSigma = RELEASE.dirErrMin + (RELEASE.dirErrMax - RELEASE.dirErrMin) * k;
  return {
    startX: t.startX + gauss(rand) * RELEASE.driftMax * k,
    direction: t.direction + gauss(rand) * dirSigma,
    speed: t.speed,
    spin: t.spin === 0 ? 0 : Math.max(-1, Math.min(1, t.spin + gauss(rand) * RELEASE.spinErrMax * k)),
  };
}
