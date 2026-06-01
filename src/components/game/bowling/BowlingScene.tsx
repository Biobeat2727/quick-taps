'use client';

import { useEffect, useRef, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { PIN_POSITIONS, BALL_RADIUS } from '@/lib/bowling/bowling-constants';
import type { ThrowParams, BowlingDecodedRecording } from '@/types/bowling';
import type { BowlingPhase } from './bowling-shared';
import { useThrowInput } from './useThrowInput';

export interface BowlingSceneProps {
  myPlayerId: string;
  pinState: boolean[];
  recording: BowlingDecodedRecording | null;
  onThrow: (params: ThrowParams) => void;
  onReplayComplete: (knockedPins: boolean[]) => void;
  phase: BowlingPhase;
  isMyTurn: boolean;
}

// ── BowlingReplayDriver ────────────────────────────────────────────────────────

function BowlingReplayDriver({
  recording,
  ballRef,
  pinRefs,
  onReplayComplete,
}: {
  recording: BowlingDecodedRecording;
  ballRef: React.RefObject<THREE.Mesh>;
  pinRefs: React.RefObject<(THREE.Mesh | null)[]>;
  onReplayComplete: (knockedPins: boolean[]) => void;
}) {
  const elapsed = useRef(0);
  const lastFrame = useRef(-1);
  const done = useRef(false);

  useEffect(() => {
    elapsed.current = 0;
    lastFrame.current = -1;
    done.current = false;
  }, [recording]);

  useFrame((_, delta) => {
    if (done.current) return;
    elapsed.current += delta;
    const f = Math.min(Math.floor(elapsed.current * 60), recording.numFrames - 1);
    if (f <= lastFrame.current) return;
    lastFrame.current = f;

    const bf = recording.ballFrames;
    if (ballRef.current) ballRef.current.position.set(bf[f * 3], bf[f * 3 + 1], bf[f * 3 + 2]);

    const pf = recording.pinFrames;
    for (let i = 0; i < 10; i++) {
      const pin = pinRefs.current?.[i];
      if (!pin) continue;
      const o = f * 70 + i * 7;
      pin.position.set(pf[o], pf[o + 1], pf[o + 2]);
      pin.quaternion.set(pf[o + 3], pf[o + 4], pf[o + 5], pf[o + 6]);
    }

    if (f >= recording.numFrames - 1 && !done.current) {
      done.current = true;
      onReplayComplete(recording.knockedPins);
    }
  });

  return null;
}

// ── AimSystem ─────────────────────────────────────────────────────────────────
// Moves ball laterally and renders trajectory dots.

const DOT_COUNT = 7;
const DOT_SPACING = 2; // units between dots
const DOT_Y = 0.065;   // slightly above lane surface

function AimSystem({
  aimXRef,
  ballRef,
  dotRefs,
  phase,
}: {
  aimXRef: React.RefObject<number>;
  ballRef: React.RefObject<THREE.Mesh>;
  dotRefs: React.RefObject<THREE.Mesh[]>;
  phase: BowlingPhase;
}) {
  useFrame(() => {
    const ball = ballRef.current;
    const dots = dotRefs.current;
    if (!ball || !dots) return;

    if (phase !== 'aiming') {
      dots.forEach(d => { if (d) d.visible = false; });
      return;
    }

    const aimX = aimXRef.current ?? 0;
    const dir = aimX * (Math.PI / 6);
    const startX = Math.max(-0.45, Math.min(0.45, Math.sin(dir) * 0.5));

    ball.position.set(startX, BALL_RADIUS, 0.3);

    for (let i = 0; i < DOT_COUNT; i++) {
      const dot = dots[i];
      if (!dot) continue;
      const t = (i + 1) * DOT_SPACING;
      dot.visible = true;
      dot.position.set(
        startX + Math.sin(dir) * t,
        DOT_Y,
        0.3 + Math.cos(dir) * t,
      );
    }
  });

  return null;
}

// ── CameraRig ─────────────────────────────────────────────────────────────────

function CameraRig({
  phase,
  ballRef,
  aimXRef,
}: {
  phase: BowlingPhase;
  ballRef: React.RefObject<THREE.Mesh>;
  aimXRef: React.RefObject<number>;
}) {
  const { camera } = useThree();
  const camTarget = useRef(new THREE.Vector3(0, 1.0, -2));
  const lookTarget = useRef(new THREE.Vector3(0, 0.3, 18));

  useFrame(() => {
    if (phase === 'aiming' || phase === 'throwing') {
      const aimX = aimXRef.current ?? 0;
      const dir = aimX * (Math.PI / 6);
      const ballX = Math.max(-0.45, Math.min(0.45, Math.sin(dir) * 0.5));
      camTarget.current.set(ballX * 0.4, 1.0, -2);
      lookTarget.current.set(ballX * 0.15, 0.3, 18);
    } else if (phase === 'replay') {
      const bx = ballRef.current?.position.x ?? 0;
      const bz = ballRef.current?.position.z ?? 0.3;
      camTarget.current.set(bx * 0.3, 1.2, bz - 2.5);
      lookTarget.current.set(bx * 0.5, 0.3, bz + 3.0);
    }
    camera.position.lerp(camTarget.current, 0.06);
    camera.lookAt(lookTarget.current);
  });

  return null;
}

// ── SceneContents ─────────────────────────────────────────────────────────────

function SceneContents({
  pinState,
  phase,
  recording,
  onReplayComplete,
  aimXRef,
}: {
  pinState: boolean[];
  phase: BowlingPhase;
  recording: BowlingDecodedRecording | null;
  onReplayComplete: (knockedPins: boolean[]) => void;
  aimXRef: React.RefObject<number>;
}) {
  const pinRefs = useRef<(THREE.Mesh | null)[]>(Array(10).fill(null));
  const ballRef = useRef<THREE.Mesh>(null!);
  const dotRefs = useRef<THREE.Mesh[]>([]);

  return (
    <>
      <CameraRig phase={phase} ballRef={ballRef} aimXRef={aimXRef} />
      <AimSystem aimXRef={aimXRef} ballRef={ballRef} dotRefs={dotRefs} phase={phase} />

      {recording && (
        <BowlingReplayDriver
          recording={recording}
          ballRef={ballRef}
          pinRefs={pinRefs}
          onReplayComplete={onReplayComplete}
        />
      )}

      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={1.2} />

      {/* Lane */}
      <mesh position={[0, 0, 9.0]}>
        <boxGeometry args={[1.06, 0.01, 18.5]} />
        <meshStandardMaterial color="#C8A96E" />
      </mesh>

      {/* Gutters */}
      <mesh position={[-0.655, -0.005, 9.0]}>
        <boxGeometry args={[0.25, 0.01, 18.5]} />
        <meshStandardMaterial color="#8B6F4E" />
      </mesh>
      <mesh position={[0.655, -0.005, 9.0]}>
        <boxGeometry args={[0.25, 0.01, 18.5]} />
        <meshStandardMaterial color="#8B6F4E" />
      </mesh>

      {/* Foul line */}
      <mesh position={[0, 0.006, 0.15]}>
        <boxGeometry args={[1.06, 0.002, 0.03]} />
        <meshStandardMaterial color="#222222" />
      </mesh>

      {/* Trajectory dots — populated by AimSystem via dotRefs */}
      {Array.from({ length: DOT_COUNT }, (_, i) => {
        const opacity = 0.85 - i * 0.1;
        const size = 0.024 - i * 0.002;
        return (
          <mesh
            key={i}
            ref={(el) => { dotRefs.current[i] = el!; }}
            visible={false}
          >
            <sphereGeometry args={[size, 8, 8]} />
            <meshBasicMaterial color="#F0C040" opacity={opacity} transparent />
          </mesh>
        );
      })}

      {/* Pins */}
      {PIN_POSITIONS.map(([px, py, pz], i) =>
        pinState[i] ? (
          <mesh
            key={i}
            ref={(el) => { pinRefs.current[i] = el; }}
            position={[px, py, pz]}
          >
            <cylinderGeometry args={[0.06, 0.06, 0.38, 12]} />
            <meshStandardMaterial color="white" />
          </mesh>
        ) : null,
      )}

      {/* Ball */}
      <mesh ref={ballRef} position={[0, BALL_RADIUS, 0.3]}>
        <sphereGeometry args={[BALL_RADIUS, 16, 16]} />
        <meshStandardMaterial
          color="#1a1a2e"
          roughness={0.4}
          metalness={0.3}
          emissive={phase === 'aiming' ? '#2244aa' : '#000000'}
          emissiveIntensity={phase === 'aiming' ? 0.4 : 0}
        />
      </mesh>
    </>
  );
}

// ── PowerBar ──────────────────────────────────────────────────────────────────
// Updates fill via direct DOM mutation — no React state re-renders at 60fps.

function PowerBar({
  chargeProgressRef,
  isCharging,
}: {
  chargeProgressRef: React.RefObject<number>;
  isCharging: boolean;
}) {
  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isCharging) {
      if (fillRef.current) fillRef.current.style.transform = 'scaleY(0)';
      return;
    }
    let raf: number;
    function tick() {
      if (fillRef.current) {
        fillRef.current.style.transform = `scaleY(${chargeProgressRef.current})`;
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isCharging, chargeProgressRef]);

  return (
    <div
      style={{
        position: 'absolute', right: 16, top: '25%', height: '48%',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
      }}
    >
      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: 1,
        color: isCharging ? '#F0C040' : '#666', transition: 'color 0.15s',
        writingMode: 'vertical-rl', textOrientation: 'mixed',
        transform: 'rotate(180deg)',
      }}>
        POWER
      </span>
      {/* Track */}
      <div style={{
        flex: 1, width: 8, background: '#222', borderRadius: 4,
        border: `1px solid ${isCharging ? '#F0C040' : '#444'}`,
        transition: 'border-color 0.15s',
        position: 'relative', overflow: 'hidden',
        display: 'flex', alignItems: 'flex-end',
      }}>
        {/* Fill */}
        <div
          ref={fillRef}
          style={{
            width: '100%', height: '100%',
            background: 'linear-gradient(to top, #EF9F27, #F0C040)',
            transformOrigin: 'bottom', transform: 'scaleY(0)',
            transition: isCharging ? 'none' : 'transform 0.2s ease-out',
          }}
        />
      </div>
    </div>
  );
}

// ── BowlingScene ──────────────────────────────────────────────────────────────

export function BowlingScene({
  myPlayerId: _myPlayerId,
  pinState,
  recording,
  onThrow,
  onReplayComplete,
  phase,
  isMyTurn,
}: BowlingSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const aimXRef = useRef(0);

  const handleThrowFromInput = useCallback(
    (params: ThrowParams) => {
      onThrow({ ...params, pinState });
    },
    [onThrow, pinState],
  );

  const { aimX, isCharging, chargeProgressRef, startCharge, releaseCharge } = useThrowInput(
    containerRef,
    isMyTurn && phase === 'aiming',
    handleThrowFromInput,
  );

  aimXRef.current = aimX;

  const canThrow = isMyTurn && phase === 'aiming';

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <Canvas camera={{ fov: 55, position: [0, 1.0, -2], near: 0.1, far: 100 }}>
        <SceneContents
          pinState={pinState}
          phase={phase}
          recording={recording}
          onReplayComplete={onReplayComplete}
          aimXRef={aimXRef}
        />
      </Canvas>

      {/* Power bar */}
      {canThrow && (
        <PowerBar chargeProgressRef={chargeProgressRef} isCharging={isCharging} />
      )}

      {/* Throw button */}
      {canThrow && (
        <button
          onPointerDown={startCharge}
          onPointerUp={releaseCharge}
          onPointerCancel={releaseCharge}
          style={{
            position: 'absolute', bottom: 24,
            left: '50%', transform: 'translateX(-50%)',
            width: 72, height: 72, borderRadius: '50%',
            background: isCharging ? '#F0C040' : 'transparent',
            border: `3px solid ${isCharging ? '#F0C040' : '#aaa'}`,
            color: isCharging ? '#1C1B16' : '#fff',
            fontSize: 12, fontWeight: 900, letterSpacing: 1,
            cursor: 'pointer', touchAction: 'none',
            transition: 'background 0.1s, border-color 0.1s, color 0.1s',
            userSelect: 'none',
          }}
        >
          THROW
        </button>
      )}

      {/* Aim hint */}
      {canThrow && !isCharging && (
        <p style={{
          position: 'absolute', bottom: 108, left: 0, right: 0,
          textAlign: 'center', color: 'rgba(255,255,255,0.45)',
          fontSize: 13, margin: 0, pointerEvents: 'none', userSelect: 'none',
        }}>
          Drag to aim
        </p>
      )}
    </div>
  );
}
