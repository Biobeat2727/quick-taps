'use client';

import { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  CatmullRomCurve3,
  TubeGeometry,
  CylinderGeometry,
  Vector3,
  DoubleSide,
  type Mesh,
} from 'three';
import {
  buildParticipants, ordinal, CountdownOverlay, ResultsScreen,
  type Participant, type Phase,
} from './marble-race-shared';
import type { SessionPlayer } from '@/types/session';
import type { DecodedRecording } from '@/types/race';

// ── Track geometry constants (visual only — physics runs server-side) ─────────

const PEGS: [number, number, number][] = [];
for (let row = 0; row < 8; row++) {
  const z = row * 8;
  const xs = row % 2 === 0 ? [-11, -6, 0, 6, 11] : [-9, -3, 3, 9];
  for (const x of xs) PEGS.push([x, 0, z]);
}

const TUBE_PATHS: [number, number, number][][] = [
  [[-9,0,87],[-9,0,100],[-9,8,130],[0,8,155],[9,8,180],[9,4,205],[9,0,215],[9,8,222]],
  [[-3,0,87],[-3,0,100],[-3,3,130],[0,3,155],[3,3,180],[3,1,205],[3,0,215],[3,5,222]],
  [[ 3,0,87],[ 3,0,100],[ 3,-3,130],[0,-3,155],[-3,-3,180],[-3,-1,205],[-3,0,215],[-3,-5,222]],
  [[ 9,0,87],[ 9,0,100],[ 9,-8,130],[0,-8,155],[-9,-8,180],[-9,-4,205],[-9,0,215],[-9,-8,222]],
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  players: SessionPlayer[];
  myPlayerId: string;
  isProjector?: boolean;
  seed?: number;
  recording: DecodedRecording;
  onLeave: () => void;
  onRaceAgain: () => void;
  onRaceFinished?: () => void;
}

// ── CameraRig ─────────────────────────────────────────────────────────────────
// Reads marble positions from the mesh refs (updated each frame by ReplayDriver).

const FUNNEL_ENTRY_Z = 230;
const FUNNEL_CENTER_Z = 244;

function CameraRig({
  meshRefs,
  myIdx,
  isProjector,
}: {
  meshRefs: React.RefObject<(Mesh | null)[]>;
  myIdx: number;
  isProjector: boolean;
}) {
  const { camera } = useThree();
  const posYRef  = useRef(50);
  const posZRef  = useRef(10);
  const lookZRef = useRef(10);
  const upYRef   = useRef(0);
  const upZRef   = useRef(-1);
  const zoomRef  = useRef(12);
  const inFunnelRef = useRef(false);

  useFrame(() => {
    let tPosY: number, tPosZ: number, tLookZ: number;
    let tUpY: number, tUpZ: number, tZoom: number;

    if (!isProjector && myIdx >= 0 && meshRefs.current[myIdx]) {
      const marbleZ = meshRefs.current[myIdx]!.position.z;
      if (marbleZ >= FUNNEL_ENTRY_Z) inFunnelRef.current = true;

      if (inFunnelRef.current) {
        camera.near = 0.1;
        camera.far  = 2000;
        tPosY  = 0;
        tPosZ  = 225;
        tLookZ = FUNNEL_CENTER_Z;
        tUpY   = 1;
        tUpZ   = 0;
        const mPos = meshRefs.current[myIdx]?.position;
        const r = mPos ? Math.sqrt(mPos.x * mPos.x + mPos.y * mPos.y) : 40;
        tZoom = 5 + 3 * Math.max(0, 1 - r / 20);
      } else {
        tPosY  = 50;
        tPosZ  = marbleZ;
        tLookZ = marbleZ;
        tUpY   = 0;
        tUpZ   = -1;
        tZoom  = 12;
      }
    } else {
      tPosY  = 50;
      tPosZ  = 130;
      tLookZ = 130;
      tUpY   = 0;
      tUpZ   = -1;
      tZoom  = 12;
    }

    const α = inFunnelRef.current ? 0.1 : 0.06;
    posYRef.current  += (tPosY  - posYRef.current)  * α;
    posZRef.current  += (tPosZ  - posZRef.current)  * α;
    lookZRef.current += (tLookZ - lookZRef.current) * α;
    upYRef.current   += (tUpY   - upYRef.current)   * α;
    upZRef.current   += (tUpZ   - upZRef.current)   * α;
    zoomRef.current  += (tZoom  - zoomRef.current)  * α;

    camera.position.set(0, posYRef.current, posZRef.current);
    camera.up.set(0, upYRef.current, upZRef.current);
    camera.lookAt(0, 0, lookZRef.current);
    camera.zoom = zoomRef.current;
    camera.updateProjectionMatrix();
  });

  return null;
}

// ── GlassTube ─────────────────────────────────────────────────────────────────

function GlassTube({ path }: { path: [number, number, number][] }) {
  const outerGeom = useMemo(() => {
    const curve = new CatmullRomCurve3(path.map(([x, y, z]) => new Vector3(x, y, z)));
    return new TubeGeometry(curve, 120, 2.0, 16, false);
  }, [path]);

  return (
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
  );
}

// ── Funnel ────────────────────────────────────────────────────────────────────

function Funnel() {
  const visGeom = useMemo(() => new CylinderGeometry(2, 40, 28, 64, 1, true), []);
  return (
    <mesh
      geometry={visGeom}
      position={[0, 0, 244]}
      rotation={[Math.PI / 2, 0, 0]}
      receiveShadow
    >
      <meshStandardMaterial color="#6699aa" side={DoubleSide} transparent opacity={0.6} />
    </mesh>
  );
}

// ── ReplayDriver ──────────────────────────────────────────────────────────────
// Advances through recorded frames each render tick. Updates mesh positions
// directly (no React state) for maximum performance.

// Physics was recorded at exactly 60 Hz. We accumulate real elapsed time and
// derive the target frame index so playback is always at real-time speed,
// matching @react-three/rapier's fixed-timestep accumulator behaviour regardless
// of the display refresh rate (30 Hz phone, 60 Hz laptop, 144 Hz monitor, etc).
const PHYSICS_HZ = 60;

function ReplayDriver({
  recording,
  meshRefs,
  participants,
  myIdx,
  hudRef,
  phase,
  onAllFinished,
  onMarbleFinish,
}: {
  recording: DecodedRecording;
  meshRefs: React.RefObject<(Mesh | null)[]>;
  participants: Participant[];
  myIdx: number;
  hudRef: React.RefObject<HTMLDivElement | null>;
  phase: Phase;
  onAllFinished: (ranking: Participant[]) => void;
  onMarbleFinish: (color: string) => void;
}) {
  // Accumulate real seconds elapsed since racing started.
  // Frame 0 is the pre-impulse rest position (shown during countdown); racing
  // begins at frame 1. elapsed=0 → frame 1, elapsed=1/60 → frame 2, etc.
  const elapsedRef  = useRef(0);
  const lastFrameRef = useRef(0);
  const doneRef     = useRef(false);
  const firedFinish = useRef(new Set<number>());

  // delta is the real seconds since last render call (provided by @react-three/fiber)
  useFrame((_, delta) => {
    if (phase !== 'racing' || doneRef.current) return;

    elapsedRef.current += delta;
    // +1 because frame 0 is the pre-race rest pose
    const targetFrame = Math.min(
      1 + Math.floor(elapsedRef.current * PHYSICS_HZ),
      recording.numFrames - 1,
    );

    // Race over — fire completion callback once
    if (targetFrame >= recording.numFrames - 1 && elapsedRef.current * PHYSICS_HZ >= recording.numFrames - 1) {
      if (!doneRef.current) {
        doneRef.current = true;
        const ranked = recording.ranking
          .map(id => participants.find(p => p.id === id))
          .filter((p): p is Participant => !!p);
        onAllFinished(ranked);
      }
      return;
    }

    // Only update if we've actually moved to a new frame
    if (targetFrame <= lastFrameRef.current) return;
    lastFrameRef.current = targetFrame;

    const { numMarbles, frames } = recording;
    const base = targetFrame * numMarbles * 3;

    // Update mesh positions
    for (let i = 0; i < numMarbles; i++) {
      const off = base + i * 3;
      meshRefs.current[i]?.position.set(frames[off], frames[off + 1], frames[off + 2]);
    }

    // Rank HUD (DOM mutation, no setState)
    if (myIdx >= 0 && hudRef.current && meshRefs.current[myIdx]) {
      const myZ = meshRefs.current[myIdx]!.position.z;
      let rank = 1;
      for (let i = 0; i < numMarbles; i++) {
        if (i !== myIdx && (meshRefs.current[i]?.position.z ?? -Infinity) > myZ) rank++;
      }
      hudRef.current.textContent = ordinal(rank);
    }

    // Burst ring when a marble first reaches the funnel tip
    for (let i = 0; i < numMarbles; i++) {
      if (!firedFinish.current.has(i)) {
        const z = frames[base + i * 3 + 2];
        if (z >= 258) {
          firedFinish.current.add(i);
          onMarbleFinish(participants[i].color);
        }
      }
    }
  });

  return null;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MarbleRaceScene({
  players,
  myPlayerId,
  isProjector = false,
  recording,
  onLeave,
  onRaceAgain,
  onRaceFinished,
}: Props) {
  const [phase, setPhase] = useState<Phase>('countdown');
  const [countVal, setCountVal] = useState<number | null>(3);
  const [finalRanking, setFinalRanking] = useState<Participant[]>([]);
  const [burst, setBurst] = useState<{ color: string; key: number } | null>(null);
  const burstKeyRef = useRef(0);

  const participants = useMemo(() => buildParticipants(players), [players]);
  const myIdx = participants.findIndex(p => p.id === myPlayerId);

  // Mesh refs — one per marble (Three.js Mesh, no physics)
  const meshRefs = useRef<(Mesh | null)[]>(Array(participants.length).fill(null));
  const hudRef   = useRef<HTMLDivElement>(null);

  // Initialise marble positions to frame 0 (pre-impulse rest positions)
  // so they're visible during the countdown.
  useEffect(() => {
    const { numMarbles, frames } = recording;
    for (let i = 0; i < numMarbles; i++) {
      const off = i * 3; // frame 0
      meshRefs.current[i]?.position.set(frames[off], frames[off + 1], frames[off + 2]);
    }
  }, [recording]);

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

  const handleAllFinished = useCallback((ranking: Participant[]) => {
    setFinalRanking(ranking);
    setPhase('finished');
    onRaceFinished?.();
  }, [onRaceFinished]);

  const handleMarbleFinish = useCallback((color: string) => {
    setBurst({ color, key: ++burstKeyRef.current });
  }, []);

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
        <CameraRig meshRefs={meshRefs} myIdx={myIdx} isProjector={isProjector} />

        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 20, 5]} intensity={1.5} castShadow />
        <pointLight position={[0, 15, 155]} intensity={0.8} />

        {/* Outer walls (visual only) */}
        {[-15, 15].map(x => (
          <mesh key={`wall-${x}`} position={[x, 0, 110]}>
            <boxGeometry args={[1, 4, 240]} />
            <meshStandardMaterial color="#aaaaaa" />
          </mesh>
        ))}

        {/* Act 1 — peg grid */}
        {PEGS.map(([x, y, z], i) => (
          <mesh key={`peg-${i}`} position={[x, y, z]}>
            <cylinderGeometry args={[0.6, 0.6, 3, 12]} />
            <meshStandardMaterial color="#dddddd" />
          </mesh>
        ))}

        {/* Transition — channel dividers */}
        {[-6, 0, 6].map(cx => (
          <mesh key={`divider-${cx}`} position={[cx, 0, 79]}>
            <boxGeometry args={[2, 4, 28]} />
            <meshStandardMaterial color="#999999" />
          </mesh>
        ))}

        {/* Transition — angled outer closing walls */}
        {([1, -1] as const).map(side => (
          <mesh
            key={`chute-outer-${side}`}
            position={[side * 13, 0, 78]}
            rotation={[0, -side * Math.atan2(4, 26), 0]}
          >
            <boxGeometry args={[0.5, 4, Math.sqrt(4 * 4 + 26 * 26)]} />
            <meshStandardMaterial color="#999999" />
          </mesh>
        ))}

        {/* Act 2 — glass tubes */}
        {TUBE_PATHS.map((path, i) => (
          <GlassTube key={`tube-${i}`} path={path} />
        ))}

        {/* Act 3 — funnel */}
        <Funnel />

        {/* Marbles — positions driven by ReplayDriver */}
        {participants.map((p, i) => (
          <mesh
            key={p.id}
            ref={(el) => { meshRefs.current[i] = el; }}
            castShadow
          >
            <sphereGeometry args={[1, 32, 32]} />
            <meshPhysicalMaterial
              color={p.color}
              roughness={0.2}
              metalness={0.1}
              emissive={i === myIdx ? p.color : '#000000'}
              emissiveIntensity={i === myIdx ? 0.3 : 0}
            />
          </mesh>
        ))}

        <ReplayDriver
          recording={recording}
          meshRefs={meshRefs}
          participants={participants}
          myIdx={myIdx}
          hudRef={hudRef}
          phase={phase}
          onAllFinished={handleAllFinished}
          onMarbleFinish={handleMarbleFinish}
        />
      </Canvas>

      {phase === 'countdown' && <CountdownOverlay val={countVal} />}

      <style>{`@keyframes marblePop{from{transform:scale(0.1);opacity:1}to{transform:scale(14);opacity:0}}`}</style>
      {burst && (
        <div
          key={burst.key}
          onAnimationEnd={() => setBurst(null)}
          style={{
            position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{
            width: 50, height: 50, borderRadius: '50%',
            border: `8px solid ${burst.color}`,
            boxShadow: `0 0 28px ${burst.color}`,
            animation: 'marblePop 0.75s ease-out forwards',
          }} />
        </div>
      )}

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
