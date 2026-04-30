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

// Subset of pegs that act as pinball bumpers (must match simulate-race.ts)
const BUMPER_COORDS: [number, number][] = [
  [-6, 16], [6, 16], [9, 24], [0, 32], [-9, 40], [3, 40],
];
function isBumper(x: number, z: number) {
  return BUMPER_COORDS.some(([bx, bz]) => bx === x && bz === z);
}

// Each tube has a unique Y depth lane (≈+10, +4, -4, -10) so paths never
// physically intersect even when crossing on screen (adjacent lanes ≥6 units apart).
// Each tube has its own asymmetric shape — no mirroring.
const TUBE_PATHS: [number, number, number][][] = [
  // Tube 1: y≈+10 — sweeps right early, reverses hard back left mid-track, wanders to exit
  [[-9,0,87],[-9,0,100],[-9,10,115],[8,10,128],[11,10,140],[5,10,153],[-8,10,163],[-11,10,175],[-4,10,188],[6,10,200],[9,5,208],[9,0,215],[9,8,222]],
  // Tube 2: y≈+4  — dips left first, then flicks hard right, lazy hook back to exit
  [[-3,0,87],[-3,0,100],[-3,4,115],[-10,4,125],[2,4,138],[12,4,148],[7,4,162],[-5,4,177],[4,4,193],[-8,4,205],[3,3,210],[3,0,215],[3,5,222]],
  // Tube 3: y≈-4  — tight crinkle: many small direction reversals
  [[3,0,87],[3,0,100],[3,-4,115],[10,-4,127],[-9,-4,142],[5,-4,157],[-11,-4,172],[4,-4,188],[-5,-4,205],[-3,-3,210],[-3,0,215],[-3,-5,222]],
  // Tube 4: y≈-10 — stays near entry side, then sharp unexpected dart left, slow drift to exit
  [[9,0,87],[9,0,100],[9,-10,115],[9,-10,130],[6,-10,143],[-3,-10,155],[-12,-10,165],[-8,-10,178],[3,-10,192],[-2,-10,206],[-9,-5,210],[-9,0,215],[-9,-8,222]],
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

// ── Minimap constants ─────────────────────────────────────────────────────────
const MM_H     = 240; // px — must match container height in JSX
const MM_Z_MIN = -10;
const MM_Z_MAX = 258;

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
  const zoomRef  = useRef(10);
  const inFunnelRef = useRef(false);

  useFrame(() => {
    let tPosY: number, tPosZ: number, tLookZ: number;
    let tUpY: number, tUpZ: number, tZoom: number;

    if (!isProjector && myIdx >= 0 && meshRefs.current[myIdx]) {
      const marbleZ = meshRefs.current[myIdx]!.position.z;
      if (marbleZ >= FUNNEL_ENTRY_Z && !inFunnelRef.current) {
        inFunnelRef.current = true;
        camera.near = 0.1;
        camera.far  = 2000;
        camera.updateProjectionMatrix();
      }

      if (inFunnelRef.current) {
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
        tZoom  = 10;
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
    const prevZoom = zoomRef.current;
    zoomRef.current  += (tZoom  - zoomRef.current)  * α;

    camera.position.set(0, posYRef.current, posZRef.current);
    camera.up.set(0, upYRef.current, upZRef.current);
    camera.lookAt(0, 0, lookZRef.current);
    if (Math.abs(zoomRef.current - prevZoom) > 0.001) {
      camera.zoom = zoomRef.current;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}

// ── GlassTube ─────────────────────────────────────────────────────────────────

const TUBE_COLORS = ['#ff5555', '#5588ff', '#44cc77', '#ffdd33'];

function GlassTube({ path, color }: { path: [number, number, number][]; color: string }) {
  const outerGeom = useMemo(() => {
    const curve = new CatmullRomCurve3(path.map(([x, y, z]) => new Vector3(x, y, z)));
    return new TubeGeometry(curve, 120, 2.0, 16, false);
  }, [path]);

  return (
    <mesh geometry={outerGeom}>
      <meshStandardMaterial
        color={color}
        transparent
        opacity={0.22}
        roughness={0.05}
        metalness={0.1}
        side={DoubleSide}
      />
    </mesh>
  );
}

// ── Funnel ────────────────────────────────────────────────────────────────────

function Funnel() {
  const visGeom = useMemo(() => new CylinderGeometry(2, 20, 28, 64, 1, true), []);
  return (
    <mesh
      geometry={visGeom}
      position={[0, 0, 244]}
      rotation={[Math.PI / 2, 0, 0]}
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
  dotRefs,
  participants,
  myIdx,
  hudRef,
  phase,
  onAllFinished,
  onMarbleFinish,
}: {
  recording: DecodedRecording;
  meshRefs: React.RefObject<(Mesh | null)[]>;
  dotRefs: React.RefObject<(HTMLDivElement | null)[]>;
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

    // Only update if we've actually moved to a new frame
    if (targetFrame <= lastFrameRef.current) return;
    lastFrameRef.current = targetFrame;

    const { numMarbles, frames } = recording;
    const base = targetFrame * numMarbles * 3;

    // Update mesh positions + minimap dots
    for (let i = 0; i < numMarbles; i++) {
      const off = base + i * 3;
      meshRefs.current[i]?.position.set(frames[off], frames[off + 1], frames[off + 2]);
      const dot = dotRefs.current[i];
      if (dot) {
        const pct = Math.max(0, Math.min(1, (frames[off + 2] - MM_Z_MIN) / (MM_Z_MAX - MM_Z_MIN)));
        dot.style.top = `${pct * MM_H}px`;
      }
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

    // End the race as soon as every marble has visually exited (burst fired) OR
    // when the recording runs out (fallback for marbles that never reach z=258).
    const allExited = firedFinish.current.size >= numMarbles;
    const recordingDone = targetFrame >= recording.numFrames - 1;
    if (!doneRef.current && (allExited || recordingDone)) {
      doneRef.current = true;
      const ranked = recording.ranking
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
  const dotRefs  = useRef<(HTMLDivElement | null)[]>(Array(participants.length).fill(null));
  const hudRef   = useRef<HTMLDivElement>(null);

  // Initialise marble positions to frame 0 (pre-impulse rest positions)
  // so they're visible during the countdown.
  useEffect(() => {
    const { numMarbles, frames } = recording;
    for (let i = 0; i < numMarbles; i++) {
      const off = i * 3; // frame 0
      meshRefs.current[i]?.position.set(frames[off], frames[off + 1], frames[off + 2]);
      const dot = dotRefs.current[i];
      if (dot) {
        const pct = Math.max(0, Math.min(1, (frames[off + 2] - MM_Z_MIN) / (MM_Z_MAX - MM_Z_MIN)));
        dot.style.top = `${pct * MM_H}px`;
      }
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
        camera={{ position: [0, 50, 10], up: [0, 0, -1], zoom: 10 }}
      >
        <CameraRig meshRefs={meshRefs} myIdx={myIdx} isProjector={isProjector} />

        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 20, 5]} intensity={1.5} />
        <pointLight position={[0, 15, 155]} intensity={0.8} />

        {/* Act 1 back wall — seals the entry so bumper-launched marbles can't escape backward */}
        <mesh position={[0, 0, -13]}>
          <boxGeometry args={[32, 6, 1]} />
          <meshStandardMaterial color="#aaaaaa" />
        </mesh>

        {/* Outer walls (visual only) */}
        {[-15, 15].map(x => (
          <mesh key={`wall-${x}`} position={[x, 0, 110]}>
            <boxGeometry args={[1, 4, 240]} />
            <meshStandardMaterial color="#aaaaaa" />
          </mesh>
        ))}

        {/* Act 1 — ceiling & floor panels to contain bumper launches */}
        {[2.5, -2.5].map(y => (
          <mesh key={`pegcap-${y}`} position={[0, y, 29]}>
            <boxGeometry args={[30, 0.15, 78]} />
            <meshStandardMaterial color="#aaddff" transparent opacity={0.07} />
          </mesh>
        ))}

        {/* Act 1 — peg grid */}
        {PEGS.map(([x, y, z], i) => {
          const bumper = isBumper(x, z);
          return (
            <mesh key={`peg-${i}`} position={[x, y, z]}>
              <cylinderGeometry args={[bumper ? 0.75 : 0.6, bumper ? 0.75 : 0.6, 3, 12]} />
              <meshStandardMaterial
                color={bumper ? '#ff8800' : '#dddddd'}
                emissive={bumper ? '#ff5500' : '#000000'}
                emissiveIntensity={bumper ? 0.5 : 0}
              />
            </mesh>
          );
        })}

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
          <GlassTube key={`tube-${i}`} path={path} color={TUBE_COLORS[i]} />
        ))}

        {/* Act 3 — funnel */}
        <Funnel />

        {/* Marbles — positions driven by ReplayDriver */}
        {participants.map((p, i) => (
          <mesh
            key={p.id}
            ref={(el) => { meshRefs.current[i] = el; }}
          >
            <sphereGeometry args={[1, 16, 16]} />
            <meshStandardMaterial
              color={p.color}
              roughness={0.25}
              metalness={0.15}
              emissive={i === myIdx ? p.color : '#000000'}
              emissiveIntensity={i === myIdx ? 0.3 : 0}
            />
          </mesh>
        ))}

        <ReplayDriver
          recording={recording}
          meshRefs={meshRefs}
          dotRefs={dotRefs}
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

      <div style={{
          position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)',
          width: 28, height: MM_H, zIndex: 10, pointerEvents: 'none',
          background: 'rgba(0,0,0,0.70)', borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.12)',
          overflow: 'hidden',
        }}>
          {/* Act section colour bands */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '28%', background: 'rgba(120,160,255,0.10)' }} />
          <div style={{ position: 'absolute', top: '36%', left: 0, right: 0, height: '51%', background: 'rgba(100,255,160,0.07)' }} />
          <div style={{ position: 'absolute', top: '87%', left: 0, right: 0, height: '13%', background: 'rgba(255,200,80,0.13)' }} />
          {/* Finish line */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: '#ffdd33' }} />
          {/* Marble dots — positions updated each frame via dotRefs */}
          {participants.map((p, i) => (
            <div
              key={p.id}
              ref={(el) => { dotRefs.current[i] = el; }}
              style={{
                position: 'absolute', left: '50%',
                transform: 'translate(-50%, -50%)',
                width: i === myIdx ? 10 : 7,
                height: i === myIdx ? 10 : 7,
                borderRadius: '50%',
                background: p.color,
                top: 0,
                boxShadow: i === myIdx ? `0 0 5px ${p.color}` : undefined,
              }}
            />
          ))}
      </div>

      {phase === 'racing' && !isProjector && myIdx >= 0 && (
        <div
          style={{
            position: 'absolute', top: 16, right: 16, zIndex: 10,
            background: 'rgba(0,0,0,0.72)', borderRadius: 14,
            padding: '5px 14px',
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
