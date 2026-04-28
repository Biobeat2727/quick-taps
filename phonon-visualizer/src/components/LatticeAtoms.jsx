import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { dispersion } from '../physics/phonon'

const ATOM_RADIUS = 0.22
const SPHERE_SEGS = 14

// Precompute atom grid for a given N
function buildAtomGrid(N) {
  const aAtoms = [], bAtoms = []
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = (i - N / 2 + 0.5)
      const z = (j - N / 2 + 0.5)
      const isA = (i + j) % 2 === 0
      ;(isA ? aAtoms : bAtoms).push({ x, z, i, j })
    }
  }
  return { aAtoms, bAtoms }
}

export function LatticeAtoms({ paramsRef }) {
  const meshARef = useRef()
  const meshBRef = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const colorA = useMemo(() => new THREE.Color(), [])
  const colorB = useMemo(() => new THREE.Color(), [])

  // Rebuild atom arrays when N changes — use a stable ref
  const gridRef = useRef(null)
  const prevN = useRef(null)

  useFrame(({ clock }) => {
    const { kx, ky, mode, amplitude, speed, massRatio, N } = paramsRef.current
    const mA = meshARef.current
    const mB = meshBRef.current
    if (!mA || !mB) return

    // Rebuild grid if N changed
    if (prevN.current !== N) {
      gridRef.current = buildAtomGrid(N)
      prevN.current = N
    }
    const { aAtoms, bAtoms } = gridRef.current

    const t = clock.getElapsedTime() * speed * 1.5
    const { acoustic, optical } = dispersion(kx, ky, massRatio)
    const omega = mode === 'acoustic' ? acoustic : optical
    // optical B-atom displacement ratio: -m/M = -massRatio (momentum conservation)
    const ratioB = mode === 'optical' ? -massRatio : 1.0

    // Update A atoms
    for (let idx = 0; idx < aAtoms.length; idx++) {
      const atom = aAtoms[idx]
      const phase = kx * atom.x + ky * atom.z - omega * t
      const y = amplitude * Math.cos(phase)
      dummy.position.set(atom.x, y, atom.z)
      dummy.updateMatrix()
      mA.setMatrixAt(idx, dummy.matrix)

      // Color: blue (HSL 0.62) when down → bright cyan (HSL 0.52) when up
      const norm = (y / (amplitude || 1) + 1) / 2 // 0..1
      colorA.setHSL(0.62 - norm * 0.1, 1.0, 0.2 + norm * 0.8)
      mA.setColorAt(idx, colorA)
    }
    mA.instanceMatrix.needsUpdate = true
    if (mA.instanceColor) mA.instanceColor.needsUpdate = true

    // Update B atoms
    for (let idx = 0; idx < bAtoms.length; idx++) {
      const atom = bAtoms[idx]
      const phase = kx * atom.x + ky * atom.z - omega * t
      const y = amplitude * ratioB * Math.cos(phase)
      dummy.position.set(atom.x, y, atom.z)
      dummy.updateMatrix()
      mB.setMatrixAt(idx, dummy.matrix)

      // Color: dark orange (HSL 0.06) when down → bright yellow (HSL 0.13) when up
      const norm = (y / (amplitude * Math.abs(ratioB) || 1) + 1) / 2
      colorB.setHSL(0.06 + norm * 0.07, 1.0, 0.2 + norm * 0.8)
      mB.setColorAt(idx, colorB)
    }
    mB.instanceMatrix.needsUpdate = true
    if (mB.instanceColor) mB.instanceColor.needsUpdate = true
  })

  // Instance counts — allocate for max N=26 (676/2 ≈ 338 each)
  const MAX_INSTANCES = 340

  return (
    <>
      <instancedMesh ref={meshARef} args={[null, null, MAX_INSTANCES]} frustumCulled={false}>
        <sphereGeometry args={[ATOM_RADIUS, SPHERE_SEGS, SPHERE_SEGS]} />
        <meshBasicMaterial toneMapped={false} vertexColors />
      </instancedMesh>
      <instancedMesh ref={meshBRef} args={[null, null, MAX_INSTANCES]} frustumCulled={false}>
        <sphereGeometry args={[ATOM_RADIUS * 1.18, SPHERE_SEGS, SPHERE_SEGS]} />
        <meshBasicMaterial toneMapped={false} vertexColors />
      </instancedMesh>
    </>
  )
}
