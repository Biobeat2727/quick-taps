'use client';

import { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Physics, RigidBody, TrimeshCollider, type RapierRigidBody } from '@react-three/rapier';
import {
  CatmullRomCurve3,
  TubeGeometry,
  CylinderGeometry,
  Vector3,
  DoubleSide,
} from 'three';
import {
  buildParticipants, ordinal, CountdownOverlay, ResultsScreen,
  type Participant, type Phase,
} from './marble-race-shared';
import type { SessionPlayer } from '@/types/session';

// ── Act 1: Peg grid (z=0–56, row spacing 8) ─────────────────────────────────

const PEGS: [number, number, number][] = [];
for (let row = 0; row < 8; row++) {
  const z = row * 8;
  const xs = row % 2 === 0 ? [-11, -6, 0, 6, 11] : [-9, -3, 3, 9];
  for (const x of xs) PEGS.push([x, 0, z]);
}

// ── Act 2: Glass tube control-point paths ────────────────────────────────────

const TUBE_PATHS: [number, number, number][][] = [
  [[-9,0,87], [-9,0,100], [-9,8,130], [0,8,155], [9,8,180], [9,4,205], [9,0,215], [9,8,222]],
  [[-3,0,87], [-3,0,100], [-3,3,130], [0,3,155], [3,3,180], [3,1,205], [3,0,215], [3,5,222]],
  [[ 3,0,87], [ 3,0,100], [ 3,-3,130], [0,-3,155], [-3,-3,180], [-3,-1,205], [-3,0,215], [-3,-5,222]],
  [[ 9,0,87], [ 9,0,100], [ 9,-8,130], [0,-8,155], [-9,-8,180], [-9,-4,205], [-9,0,215], [-9,-8,222]],
];

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  players: SessionPlayer[];
  myPlayerId: string;
  isProjector?: boolean;
  onLeave: () => void;
  onRaceAgain: () => void;
  onRaceFinished?: () => void;
}

// ── CameraRig ────────────────────────────────────────────────────────────────
// Phone: smoothly follows the player's marble along the Z axis.
// Projector: sits at a fixed overview position (mid-track).

function CameraRig({
  marbleRefs,
  myIdx,
  isProjector,
}: {
  marbleRefs: React.RefObject<(RapierRigidBody | null)[]>;
  myIdx: number;
  isProjector: boolean;
}) {
  const { camera } = useThree();
  const camZRef = useRef(10);

  useFrame(() => {
    let targetZ: number;
    if (!isProjector && myIdx >= 0 && marbleRefs.current[myIdx]) {
      targetZ = marbleRefs.current[myIdx]!.translation().z;
    } else {
      targetZ = 130; // mid-track overview
    }
    camZRef.current += (targetZ - camZRef.current) * 0.06;
    const z = camZRef.current;
    camera.position.set(0, 50, z);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, z);
  });

  return null;
}

// ── GlassTube ────────────────────────────────────────────────────────────────

function GlassTube({ path }: { path: [number, number, number][] }) {
  const { outerGeom, physVerts, physIdx } = useMemo(() => {
    const curve = new CatmullRomCurve3(path.map(([x, y, z]) => new Vector3(x, y, z)));
    const outerGeom = new TubeGeometry(curve, 120, 2.0, 16, false);
    const physGeom = new TubeGeometry(curve, 60, 1.8, 12, false);
    const physVerts = new Float32Array(physGeom.attributes.position.array);
    const physIdx = new Uint32Array(physGeom.index!.array);
    for (let i = 0; i < physIdx.length; i += 3) {
      const t = physIdx[i]; physIdx[i] = physIdx[i + 1]; physIdx[i + 1] = t;
    }
    physGeom.dispose();
    return { outerGeom, physVerts, physIdx };
  }, [path]);

  return (
    <RigidBody type="fixed" colliders={false} friction={0.4} restitution={0.3}>
      <TrimeshCollider args={[physVerts, physIdx]} />
      <mesh geometry={outerGeom}>
        <meshPhysicalMaterial
          color="#aaddff"
          transmission={0.85}
          roughness={0}
          thickness={0.5}
          transparent
          opacity={0.25}
          side={DoubleSide}
        />
      </mesh>
    </RigidBody>
  );
}

// ── Funnel ───────────────────────────────────────────────────────────────────

function Funnel() {
  const { visGeom, physVerts, physIdx } = useMemo(() => {
    const visGeom = new CylinderGeometry(2, 40, 28, 64, 1, true);
    const physGeom = new CylinderGeometry(2, 40, 28, 64, 1, true);
    const physVerts = new Float32Array(physGeom.attributes.position.array);
    const physIdx = new Uint32Array(physGeom.index!.array);
    for (let i = 0; i < physIdx.length; i += 3) {
      const t = physIdx[i]; physIdx[i] = physIdx[i + 1]; physIdx[i + 1] = t;
    }
    physGeom.dispose();
    return { visGeom, physVerts, physIdx };
  }, []);

  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[0, 0, 244]}
      rotation={[Math.PI / 2, 0, 0]}
      friction={0.04}
      restitution={0.75}
    >
      <TrimeshCollider args={[physVerts, physIdx]} />
      <mesh geometry={visGeom} receiveShadow>
        <meshStandardMaterial color="#6699aa" side={DoubleSide} transparent opacity={0.6} />
      </mesh>
    </RigidBody>
  );
}

// ── GameLoop ─────────────────────────────────────────────────────────────────
// Runs inside the Canvas every frame. Handles finish detection, rank HUD, and
// fires onAllFinished once every marble has passed the funnel exit (z ≥ 258).

function GameLoop({
  marbleRefs,
  participants,
  myIdx,
  hudRef,
  onAllFinished,
}: {
  marbleRefs: React.RefObject<(RapierRigidBody | null)[]>;
  participants: Participant[];
  myIdx: number;
  hudRef: React.RefObject<HTMLDivElement | null>;
  onAllFinished: (ranking: Participant[]) => void;
}) {
  const finishedSet = useRef(new Set<number>());
  const placementsRef = useRef<string[]>([]);
  const doneRef = useRef(false);

  useFrame(() => {
    if (doneRef.current) return;

    const rbs = marbleRefs.current;

    // Finish detection — marble has fallen through funnel tip
    for (let i = 0; i < participants.length; i++) {
      if (finishedSet.current.has(i)) continue;
      const rb = rbs[i];
      if (!rb) continue;
      if (rb.translation().z >= 258) {
        finishedSet.current.add(i);
        placementsRef.current.push(participants[i].id);
      }
    }

    // Rank HUD — update via direct DOM ref (no React setState in hot path)
    if (myIdx >= 0 && hudRef.current && rbs[myIdx]) {
      const myZ = rbs[myIdx]!.translation().z;
      const myDone = finishedSet.current.has(myIdx);
      let rank = 1;
      for (let i = 0; i < participants.length; i++) {
        if (i === myIdx) continue;
        const rb = rbs[i];
        if (!rb) continue;
        const oDone = finishedSet.current.has(i);
        if (oDone && !myDone) rank++;
        else if (!oDone && !myDone && rb.translation().z > myZ) rank++;
      }
      hudRef.current.textContent = ordinal(rank);
    }

    // All finished?
    if (placementsRef.current.length >= participants.length) {
      doneRef.current = true;
      const ranked = placementsRef.current
        .map(id => participants.find(p => p.id === id))
        .filter((p): p is Participant => !!p);
      onAllFinished(ranked);
    }
  });

  return null;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MarbleRaceScene({
  players,
  myPlayerId,
  isProjector = false,
  onLeave,
  onRaceAgain,
  onRaceFinished,
}: Props) {
  const [phase, setPhase] = useState<Phase>('countdown');
  const [countVal, setCountVal] = useState<number | null>(3);
  const [finalRanking, setFinalRanking] = useState<Participant[]>([]);

  const participants = useMemo(() => buildParticipants(players), [players]);
  const myIdx = participants.findIndex(p => p.id === myPlayerId);

  const marbleRefs = useRef<(RapierRigidBody | null)[]>(Array(participants.length).fill(null));
  const hudRef = useRef<HTMLDivElement>(null);

  // Stable per-race random values
  const marbleStarts = useMemo<[number, number, number][]>(() =>
    participants.map((_, i) => {
      const x = -10 + (i / Math.max(participants.length - 1, 1)) * 20 + (Math.random() * 3 - 1.5);
      return [x, 0, -10];
    }), [participants],
  );

  const marbleImpulses = useMemo(() =>
    participants.map(() => Math.random() * 6 - 3), [participants],
  );

  // Countdown: 3 → 2 → 1 → GO! → racing
  useEffect(() => {
    const timers = [
      setTimeout(() => setCountVal(2), 1000),
      setTimeout(() => setCountVal(1), 2000),
      setTimeout(() => setCountVal(null), 3000),
      setTimeout(() => setPhase('racing'), 3800),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  // Apply X impulses once physics unpauses
  useEffect(() => {
    if (phase !== 'racing') return;
    const id = setTimeout(() => {
      marbleRefs.current.forEach((rb, i) => {
        if (!rb) return;
        rb.applyImpulse({ x: marbleImpulses[i], y: 0, z: 0 }, true);
      });
    }, 50);
    return () => clearTimeout(id);
  }, [phase, marbleImpulses]);

  const handleAllFinished = useCallback((ranking: Participant[]) => {
    setFinalRanking(ranking);
    setPhase('finished');
    onRaceFinished?.();
  }, [onRaceFinished]);

  if (phase === 'finished') {
    return (
      <ResultsScreen
        ranking={finalRanking}
        myPlayerId={myPlayerId}
        onLeave={onLeave}
        onRaceAgain={onRaceAgain}
      />
    );
  }

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: '#1C1B16' }}>
      <Canvas
        style={{ width: '100%', height: '100%' }}
        orthographic
        camera={{ position: [0, 50, 10], up: [0, 0, -1], zoom: 12 }}
      >
        <CameraRig marbleRefs={marbleRefs} myIdx={myIdx} isProjector={isProjector} />

        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 20, 5]} intensity={1.5} castShadow />
        <pointLight position={[0, 15, 155]} intensity={0.8} />

        {/* Physics paused during countdown so marbles sit still */}
        <Physics gravity={[0, 0, 15]} paused={phase !== 'racing'}>

          {/* Outer walls — z=-10 to z=230 */}
          {[-15, 15].map(x => (
            <RigidBody key={`wall-${x}`} type="fixed" friction={0.1} restitution={0.5}>
              <mesh position={[x, 0, 110]}>
                <boxGeometry args={[1, 4, 240]} />
                <meshStandardMaterial color="#aaaaaa" />
              </mesh>
            </RigidBody>
          ))}

          {/* Act 1 — staggered peg grid */}
          {PEGS.map(([x, y, z], i) => (
            <RigidBody key={`peg-${i}`} type="fixed" restitution={0.6} friction={0.1} colliders="hull">
              <mesh position={[x, y, z]}>
                <cylinderGeometry args={[0.6, 0.6, 3, 12]} />
                <meshStandardMaterial color="#dddddd" />
              </mesh>
            </RigidBody>
          ))}

          {/* Transition — channel dividers */}
          {[-6, 0, 6].map(cx => (
            <RigidBody key={`divider-${cx}`} type="fixed" friction={0.1} restitution={0.3}>
              <mesh position={[cx, 0, 79]}>
                <boxGeometry args={[2, 4, 28]} />
                <meshStandardMaterial color="#999999" />
              </mesh>
            </RigidBody>
          ))}

          {/* Transition — angled outer closing walls */}
          {([1, -1] as const).map(side => (
            <RigidBody key={`chute-outer-${side}`} type="fixed" friction={0.1} restitution={0.3}>
              <mesh
                position={[side * 13, 0, 78]}
                rotation={[0, -side * Math.atan2(4, 26), 0]}
              >
                <boxGeometry args={[0.5, 4, Math.sqrt(4 * 4 + 26 * 26)]} />
                <meshStandardMaterial color="#999999" />
              </mesh>
            </RigidBody>
          ))}

          {/* Act 2 — glass tubes */}
          {TUBE_PATHS.map((path, i) => (
            <GlassTube key={`tube-${i}`} path={path} />
          ))}

          {/* Act 3 — funnel */}
          <Funnel />

          {/* Catch floor below funnel tip */}
          <RigidBody type="fixed">
            <mesh position={[0, 0, 263]}>
              <boxGeometry args={[30, 4, 1]} />
              <meshStandardMaterial color="#555555" />
            </mesh>
          </RigidBody>

          {/* Marbles — one per participant */}
          {participants.map((p, i) => (
            <RigidBody
              key={p.id}
              ref={(el) => { marbleRefs.current[i] = el; }}
              position={marbleStarts[i]}
              restitution={0.5}
              friction={0.4}
              colliders="ball"
            >
              <mesh castShadow>
                <sphereGeometry args={[1, 32, 32]} />
                <meshPhysicalMaterial
                  color={p.color}
                  roughness={0.2}
                  metalness={0.1}
                  emissive={i === myIdx ? p.color : '#000000'}
                  emissiveIntensity={i === myIdx ? 0.3 : 0}
                />
              </mesh>
            </RigidBody>
          ))}

          <GameLoop
            marbleRefs={marbleRefs}
            participants={participants}
            myIdx={myIdx}
            hudRef={hudRef}
            onAllFinished={handleAllFinished}
          />

        </Physics>
      </Canvas>

      {/* Countdown overlay */}
      {phase === 'countdown' && <CountdownOverlay val={countVal} />}

      {/* Rank HUD (phone only) */}
      {phase === 'racing' && !isProjector && myIdx >= 0 && (
        <div
          style={{
            position: 'absolute', top: 16, right: 16, zIndex: 10,
            background: 'rgba(0,0,0,0.58)', borderRadius: 14,
            padding: '5px 14px', backdropFilter: 'blur(4px)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          <div
            ref={hudRef}
            style={{
              color: '#fff', fontWeight: 800, fontSize: 22,
              fontFamily: 'system-ui, sans-serif', letterSpacing: '-0.5px',
            }}
          >
            1st
          </div>
        </div>
      )}
    </div>
  );
}
