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

    // Update ball position
    const bf = recording.ballFrames;
    if (ballRef.current) ballRef.current.position.set(bf[f * 3], bf[f * 3 + 1], bf[f * 3 + 2]);

    // Update pin positions + quaternions
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

// ── CameraRig ─────────────────────────────────────────────────────────────────

function CameraRig({
  phase,
  ballRef,
}: {
  phase: BowlingPhase;
  ballRef: React.RefObject<THREE.Mesh>;
}) {
  const { camera } = useThree();
  const camTarget = useRef(new THREE.Vector3(0, 3.5, -1));
  const lookTarget = useRef(new THREE.Vector3(0, 0, 15));

  useFrame(() => {
    if (phase === 'aiming' || phase === 'throwing') {
      camTarget.current.set(0, 3.5, -1);
      lookTarget.current.set(0, 0, 15);
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
}: {
  pinState: boolean[];
  phase: BowlingPhase;
  recording: BowlingDecodedRecording | null;
  onReplayComplete: (knockedPins: boolean[]) => void;
}) {
  const pinRefs = useRef<(THREE.Mesh | null)[]>(Array(10).fill(null));
  const ballRef = useRef<THREE.Mesh>(null!);

  return (
    <>
      <CameraRig phase={phase} ballRef={ballRef} />

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

      {/* Pins — only rendered if standing; position reset via JSX prop each render */}
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
        <meshStandardMaterial color="#1a1a2e" roughness={0.4} metalness={0.3} />
      </mesh>
    </>
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

  // Wrap onThrow to inject current pinState (hook passes pinState: [])
  const handleThrowFromInput = useCallback(
    (params: ThrowParams) => {
      onThrow({ ...params, pinState });
    },
    [onThrow, pinState],
  );

  const { phase: gesturePhase, aimX } = useThrowInput(
    containerRef,
    isMyTurn && phase === 'aiming',
    handleThrowFromInput,
  );

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <Canvas camera={{ fov: 45, position: [0, 1.2, -2.5], near: 0.1, far: 100 }}>
        <SceneContents
          pinState={pinState}
          phase={phase}
          recording={recording}
          onReplayComplete={onReplayComplete}
        />
      </Canvas>

      {/* Aim indicator overlay */}
      {isMyTurn && phase === 'aiming' && (
        <div className="absolute bottom-8 left-0 right-0 flex flex-col items-center pointer-events-none select-none">
          {/* Direction arrow */}
          <div
            style={{
              transform: `translateX(${aimX * 64}px) rotate(${aimX * 25}deg)`,
              width: 0,
              height: 0,
              borderLeft: '12px solid transparent',
              borderRight: '12px solid transparent',
              borderBottom: '28px solid rgba(255,255,255,0.85)',
            }}
          />
          <p className="text-white text-sm mt-2 opacity-60 tracking-wide">
            {gesturePhase === 'throwing' ? 'Release to throw!' : 'Swipe up to throw'}
          </p>
        </div>
      )}
    </div>
  );
}
