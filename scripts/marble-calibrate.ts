// Offline marble map calibration: npx tsx scripts/marble-calibrate.ts [runs] [marbles]
// Prints race length, spread, respawns and when the leader reaches each zone.
import RAPIER from '@dimforge/rapier3d-compat';
import { runRaceSim, REC_HZ, REC_STRIDE } from '../src/lib/marble/race-sim-core';
import { buildTrack } from '../src/lib/marble/track';
import { NEON_SUMMIT } from '../src/lib/marble/maps/neon-summit';

async function main() {
  await RAPIER.init();
  const runs = Number(process.argv[2] ?? 5);
  const n = Number(process.argv[3] ?? 8);
  const tr = buildTrack(NEON_SUMMIT);
  console.log(`track ${tr.length.toFixed(0)}u, finish at ${tr.finishS.toFixed(0)}, tris ${tr.indices.length / 3}, gaps ${JSON.stringify(tr.gapRanges.map(g => g.map(v => +v.toFixed(1))))}`);
  // Self-intersection check: stretches far apart along the course that come
  // within a track width horizontally with too little vertical clearance.
  const hits = new Set<string>();
  for (let i = 0; i < tr.frames.length; i += 4) for (let j = i + 80; j < tr.frames.length; j += 4) {
    const a = tr.frames[i], b = tr.frames[j];
    const dh = Math.hypot(a.p.x - b.p.x, a.p.z - b.p.z), dy = Math.abs(a.p.y - b.p.y);
    if (dh < (a.w + b.w) / 2 + 1 && dy < Math.max(a.wall, b.wall) + 3) hits.add(`${a.s.toFixed(0)}~${b.s.toFixed(0)} dy${dy.toFixed(1)}`);
  }
  console.log(hits.size ? `OVERLAPS: ${[...hits].slice(0, 12).join(', ')}` : 'no overlaps');
  console.log('zones', tr.zones.map(z => `${z.name}@${z.s.toFixed(0)}`).join(', '));
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    const res = runRaceSim(RAPIER, NEON_SUMMIT, n, 1000 + r * 7919);
    const ms = performance.now() - t0;
    const fin = res.finishFrame.filter((f): f is number => f !== null).map(f => f / REC_HZ).sort((a, b) => a - b);
    // leader arrival time at each zone
    const zt = tr.zones.map(z => {
      for (let f = 0; f < res.numFrames; f++)
        for (let i = 0; i < n; i++) if (res.frames[(f * n + i) * REC_STRIDE + 3] >= z.s) return (f / REC_HZ).toFixed(0);
      return '-';
    });
    const speeds: number[] = [];
    for (let f = 1; f < res.numFrames; f++) for (let i = 0; i < n; i++) {
      const a = ((f - 1) * n + i) * REC_STRIDE, b = (f * n + i) * REC_STRIDE, F = res.frames;
      const d = Math.hypot(F[b] - F[a], F[b + 1] - F[a + 1], F[b + 2] - F[a + 2]) * REC_HZ;
      if (d < 150) speeds.push(d);
    }
    speeds.sort((x, y) => x - y);
    const pct = (q: number) => speeds[Math.floor(q * (speeds.length - 1))].toFixed(0);
    console.log(`  speed p50 ${pct(0.5)} p90 ${pct(0.9)} max ${pct(0.999)} u/s`);
    console.log(`seed ${r}: sim ${ms.toFixed(0)}ms, frames ${res.numFrames}, finished ${fin.length}/${n}, 1st ${fin[0]?.toFixed(1)}s, last ${fin[fin.length - 1]?.toFixed(1)}s, respawns ${res.respawns}, zones@ ${zt.join('/')}`);
    for (const [s, st, d] of res.respawnLog) console.log(`   ${s}${st ? ' stuck' : ' fell'} ${d}`);
  }
}
main();
