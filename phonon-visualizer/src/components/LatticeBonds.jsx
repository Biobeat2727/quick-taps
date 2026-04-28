import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { dispersion } from '../physics/phonon'

// Max bonds for N=26: 2 * 26 * 25 = 1300
const MAX_BONDS = 1400

export function LatticeBonds({ paramsRef }) {
  const geomRef = useRef()
  const posArr = useMemo(() => new Float32Array(MAX_BONDS * 2 * 3), [])
  const colArr = useMemo(() => new Float32Array(MAX_BONDS * 2 * 3), [])

  const prevN = useRef(null)
  const bondPairsRef = useRef(null)
  const atomPosRef = useRef(null)

  useFrame(({ clock }) => {
    const geom = geomRef.current
    if (!geom) return

    const { kx, ky, mode, amplitude, speed, massRatio, N } = paramsRef.current

    // Rebuild bond pairs when N changes
    if (prevN.current !== N) {
      const pairs = []
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          if (i < N - 1) pairs.push([i * N + j, (i + 1) * N + j])
          if (j < N - 1) pairs.push([i * N + j, i * N + (j + 1)])
        }
      }
      bondPairsRef.current = pairs
      atomPosRef.current = new Float32Array(N * N * 2) // x, z per atom
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          atomPosRef.current[(i * N + j) * 2 + 0] = i - N / 2 + 0.5
          atomPosRef.current[(i * N + j) * 2 + 1] = j - N / 2 + 0.5
        }
      }
      prevN.current = N
    }

    const bondPairs = bondPairsRef.current
    const atomPos = atomPosRef.current
    if (!bondPairs) return

    const t = clock.getElapsedTime() * speed * 1.5
    const { acoustic, optical } = dispersion(kx, ky, massRatio)
    const omega = mode === 'acoustic' ? acoustic : optical
    const ratioB = mode === 'optical' ? -massRatio : 1.0

    // Compute y displacement for each atom
    const nAtoms = N * N
    // Reuse a temporary y array (stack allocation via Float32Array on atomPosRef)
    const yArr = new Float32Array(nAtoms)
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const idx = i * N + j
        const x = atomPos[idx * 2 + 0]
        const z = atomPos[idx * 2 + 1]
        const isA = (i + j) % 2 === 0
        const ratio = isA ? 1.0 : ratioB
        const phase = kx * x + ky * z - omega * t
        yArr[idx] = amplitude * ratio * Math.cos(phase)
      }
    }

    const nBonds = Math.min(bondPairs.length, MAX_BONDS)
    for (let k = 0; k < nBonds; k++) {
      const [ai, bi] = bondPairs[k]
      const ax = atomPos[ai * 2 + 0], az = atomPos[ai * 2 + 1], ay = yArr[ai]
      const bx = atomPos[bi * 2 + 0], bz = atomPos[bi * 2 + 1], by = yArr[bi]

      posArr[k * 6 + 0] = ax; posArr[k * 6 + 1] = ay; posArr[k * 6 + 2] = az
      posArr[k * 6 + 3] = bx; posArr[k * 6 + 4] = by; posArr[k * 6 + 5] = bz

      // Strain coloring: compression=blue tint, stretch=warm tint
      const strain = Math.abs(ay - by) / (amplitude + 0.001)
      const r = 0.1 + strain * 0.35
      const g = 0.18 + strain * 0.2
      const b = 0.28 + strain * 0.4

      colArr[k * 6 + 0] = r; colArr[k * 6 + 1] = g; colArr[k * 6 + 2] = b
      colArr[k * 6 + 3] = r; colArr[k * 6 + 4] = g; colArr[k * 6 + 5] = b
    }

    // Zero out unused bonds
    for (let k = nBonds; k < MAX_BONDS; k++) {
      posArr.fill(0, k * 6, k * 6 + 6)
    }

    geom.attributes.position.needsUpdate = true
    geom.attributes.color.needsUpdate = true
  })

  return (
    <lineSegments frustumCulled={false}>
      <bufferGeometry ref={geomRef}>
        <bufferAttribute attach="attributes-position" args={[posArr, 3]} usage={THREE.DynamicDrawUsage} />
        <bufferAttribute attach="attributes-color" args={[colArr, 3]} usage={THREE.DynamicDrawUsage} />
      </bufferGeometry>
      <lineBasicMaterial vertexColors toneMapped={false} />
    </lineSegments>
  )
}
