// 2D Diatomic Square Lattice Phonon Dispersion
// Lattice constant a = 1 (normalized). kx, ky in [0, π].
// massRatio β = m/M (light/heavy atom mass ratio), range (0, 1].
//
// Dispersion (checkerboard diatomic, nearest-neighbor spring K=1):
//   S(kx,ky) = sin²(kx/2) + sin²(ky/2)
//   Δ        = √( (1 + 1/β)² − 4S/β )
//   ω_ac(k)  = √( (1+1/β) − Δ )   ← acoustic branch (ω→0 at Γ)
//   ω_op(k)  = √( (1+1/β) + Δ )   ← optical branch (gap at Γ)

export function dispersion(kx, ky, massRatio = 0.5) {
  const b = massRatio
  const S = Math.sin(kx / 2) ** 2 + Math.sin(ky / 2) ** 2
  const base = 1 + 1 / b
  const disc = Math.max(0, base * base - 4 * S / b)
  const delta = Math.sqrt(disc)
  return {
    acoustic: Math.sqrt(Math.max(0, base - delta)),
    optical: Math.sqrt(Math.max(0, base + delta)),
  }
}

// Maximum optical frequency (at Γ, k=0), used for y-axis scaling
export function maxFreq(massRatio = 0.5) {
  return dispersion(0, 0, massRatio).optical
}

// Compute ω along the high-symmetry path Γ(0,0)→X(π,0)→M(π,π)→Γ(0,0)
// Returns { points: [{t, kx, ky, acoustic, optical}], labels: [{t, name}] }
export function computeDispersionPath(massRatio = 0.5, nPts = 240) {
  const pi = Math.PI
  const segs = [
    { from: [0, 0],   to: [pi, 0],  len: pi },
    { from: [pi, 0],  to: [pi, pi], len: pi },
    { from: [pi, pi], to: [0, 0],   len: pi * Math.SQRT2 },
  ]
  const labelNames = ['Γ', 'X', 'M', 'Γ']
  const totalLen = segs.reduce((s, g) => s + g.len, 0)

  const points = []
  const labels = []
  let cumLen = 0

  segs.forEach((seg, si) => {
    const segPts = Math.round(nPts * seg.len / totalLen)
    labels.push({ t: cumLen / totalLen, name: labelNames[si] })

    for (let i = 0; i < segPts; i++) {
      const u = i / segPts
      const kx = seg.from[0] + u * (seg.to[0] - seg.from[0])
      const ky = seg.from[1] + u * (seg.to[1] - seg.from[1])
      const t = (cumLen + u * seg.len) / totalLen
      points.push({ t, kx, ky, ...dispersion(kx, ky, massRatio) })
    }
    cumLen += seg.len
  })

  // Final Γ point
  points.push({ t: 1, kx: 0, ky: 0, ...dispersion(0, 0, massRatio) })
  labels.push({ t: 1, name: 'Γ' })

  return { points, labels }
}
