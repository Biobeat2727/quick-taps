'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  BALL_COLORS,
  BALL_START_POSITIONS,
  POCKET_POSITIONS,
  POCKET_RADIUS,
  TABLE_HALF_LENGTH,
  TABLE_HALF_WIDTH,
  BALL_RADIUS,
  ballGroup,
  NUM_BALLS,
} from '@/lib/pool/pool-constants';
import type {
  PoolDecodedRecording,
  PoolGameState,
  PoolShotParams,
  PoolShotResult,
} from '@/types/pool';
import type { SessionPlayer } from '@/types/session';
import type { PoolPhase } from './pool-shared';
import { useCueInput } from './useCueInput';

const RAIL_THICKNESS = 0.06;
const RAIL_HEIGHT = 0.04;

export interface PoolSceneProps {
  myPlayerId: string;
  gameState: PoolGameState | null;
  recording: PoolDecodedRecording | null;
  onShoot: (params: Pick<PoolShotParams, 'angle' | 'power'>) => void;
  onReplayComplete: (result: PoolShotResult) => void;
  phase: PoolPhase;
  isMyTurn: boolean;
  players: SessionPlayer[];
}

function TableFelt() {
  return (
    <mesh position={[0, 0, 0]}>
      <boxGeometry args={[TABLE_HALF_WIDTH * 2, 0.01, TABLE_HALF_LENGTH * 2]} />
      <meshStandardMaterial color="#1a5c1a" />
    </mesh>
  );
}

function Rails() {
  const longLen = TABLE_HALF_LENGTH * 2;
  const shortLen = TABLE_HALF_WIDTH * 2 + RAIL_THICKNESS * 2;
  const railY = RAIL_HEIGHT / 2;

  return (
    <>
      <mesh position={[-(TABLE_HALF_WIDTH + RAIL_THICKNESS / 2), railY, 0]}>
        <boxGeometry args={[RAIL_THICKNESS, RAIL_HEIGHT, longLen]} />
        <meshStandardMaterial color="#5c3a1a" />
      </mesh>
      <mesh position={[TABLE_HALF_WIDTH + RAIL_THICKNESS / 2, railY, 0]}>
        <boxGeometry args={[RAIL_THICKNESS, RAIL_HEIGHT, longLen]} />
        <meshStandardMaterial color="#5c3a1a" />
      </mesh>
      <mesh position={[0, railY, -(TABLE_HALF_LENGTH + RAIL_THICKNESS / 2)]}>
        <boxGeometry args={[shortLen, RAIL_HEIGHT, RAIL_THICKNESS]} />
        <meshStandardMaterial color="#5c3a1a" />
      </mesh>
      <mesh position={[0, railY, TABLE_HALF_LENGTH + RAIL_THICKNESS / 2]}>
        <boxGeometry args={[shortLen, RAIL_HEIGHT, RAIL_THICKNESS]} />
        <meshStandardMaterial color="#5c3a1a" />
      </mesh>
    </>
  );
}

function Pockets() {
  return (
    <>
      {POCKET_POSITIONS.map(([px, pz], i) => (
        <mesh key={i} position={[px, 0.006, pz]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[POCKET_RADIUS, 16]} />
          <meshStandardMaterial color="#111111" />
        </mesh>
      ))}
    </>
  );
}

function Balls({
  activeBalls,
  ballPositions,
  ballRefs,
}: {
  activeBalls: boolean[];
  ballPositions: [number, number][];
  ballRefs: React.MutableRefObject<(THREE.Object3D | null)[]>;
}) {
  return (
    <>
      {Array.from({ length: NUM_BALLS }, (_, i) => {
        if (!activeBalls[i]) return null;
        const [bx, bz] = ballPositions[i];
        const color = BALL_COLORS[i];
        const isStripe = ballGroup(i) === 'stripe';
        return (
          <group
            key={i}
            ref={(g) => { ballRefs.current[i] = g; }}
            position={[bx, BALL_RADIUS, bz]}
          >
            <mesh>
              <sphereGeometry args={[BALL_RADIUS, 12, 12]} />
              <meshStandardMaterial color={color} />
            </mesh>
            {isStripe && (
              <mesh position={[0, BALL_RADIUS * 0.85, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[BALL_RADIUS * 0.3, BALL_RADIUS * 0.82, 16]} />
                <meshStandardMaterial color="#ffffff" />
              </mesh>
            )}
          </group>
        );
      })}
    </>
  );
}

function PoolReplayDriver({
  recording,
  ballRefs,
  onReplayComplete,
}: {
  recording: PoolDecodedRecording;
  ballRefs: React.MutableRefObject<(THREE.Object3D | null)[]>;
  onReplayComplete: (result: PoolShotResult) => void;
}) {
  const elapsed = useRef(0);
  const lastFrameRef = useRef(-1);
  const done = useRef(false);
  const onCompleteRef = useRef(onReplayComplete);
  useEffect(() => { onCompleteRef.current = onReplayComplete; }, [onReplayComplete]);

  useEffect(() => {
    elapsed.current = 0;
    lastFrameRef.current = -1;
    done.current = false;
  }, [recording]);

  useFrame((_, delta) => {
    elapsed.current += delta;
    const f = Math.min(Math.floor(elapsed.current * 60), recording.numFrames - 1);
    if (f <= lastFrameRef.current) return;
    lastFrameRef.current = f;

    for (let b = 0; b < NUM_BALLS; b++) {
      const obj = ballRefs.current[b];
      if (!obj) continue;
      const pocketedAt = recording.pocketedAtFrame[b];
      if (pocketedAt !== -1 && f >= pocketedAt) {
        obj.position.set(0, -1, 0);
      } else {
        const bx = recording.ballFrames[(f * NUM_BALLS + b) * 2];
        const bz = recording.ballFrames[(f * NUM_BALLS + b) * 2 + 1];
        obj.position.set(bx, BALL_RADIUS, bz);
      }
    }

    if (f >= recording.numFrames - 1 && !done.current) {
      done.current = true;
      onCompleteRef.current({
        finalPocketed: recording.finalPocketed,
        cueBallPocketed: recording.cueBallPocketed,
      });
    }
  });

  return null;
}

function CueBallProjector({
  ballRefs,
  screenPosRef,
}: {
  ballRefs: React.MutableRefObject<(THREE.Object3D | null)[]>;
  screenPosRef: React.MutableRefObject<{ x: number; y: number }>;
}) {
  const { camera, size } = useThree();
  const vec = useRef(new THREE.Vector3());

  useFrame(() => {
    const ball = ballRefs.current[0];
    if (!ball) return;
    vec.current.copy(ball.position);
    vec.current.project(camera);
    screenPosRef.current = {
      x: (vec.current.x * 0.5 + 0.5) * size.width,
      y: (-vec.current.y * 0.5 + 0.5) * size.height,
    };
  });

  return null;
}

export function PoolScene({
  gameState,
  recording,
  onShoot,
  onReplayComplete,
  phase,
  isMyTurn,
}: PoolSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ballRefs = useRef<(THREE.Object3D | null)[]>(Array(NUM_BALLS).fill(null));
  const cueBallScreenPosRef = useRef({ x: 0, y: 0 });

  // Internal ball positions — tracks where balls are between shots
  const [ballPositions, setBallPositions] = useState<[number, number][]>(() =>
    BALL_START_POSITIONS.map(([x, , z]) => [x, z] as [number, number])
  );

  // Sync cue ball position from gameState
  const cpx = gameState?.cueBallPos[0] ?? 0;
  const cpz = gameState?.cueBallPos[1] ?? -0.686;
  useEffect(() => {
    setBallPositions(prev => {
      if (prev[0][0] === cpx && prev[0][1] === cpz) return prev;
      const next = [...prev];
      next[0] = [cpx, cpz];
      return next;
    });
  }, [cpx, cpz]);

  const activeBalls: boolean[] = gameState?.activeBalls ?? (Array(NUM_BALLS).fill(true) as boolean[]);

  // Cue input
  const { isDragging, aimAngle, power } = useCueInput(
    containerRef,
    isMyTurn && phase === 'aiming',
    cueBallScreenPosRef.current,
    onShoot,
  );

  // Replay complete: save final ball positions, then notify parent
  const handleInternalReplayComplete = useCallback(
    (result: PoolShotResult) => {
      if (recording) {
        const lastF = recording.numFrames - 1;
        setBallPositions(prev => {
          const next = [...prev];
          for (let i = 0; i < NUM_BALLS; i++) {
            if (result.finalPocketed[i] || (i === 0 && result.cueBallPocketed)) continue;
            next[i] = [
              recording.ballFrames[(lastF * NUM_BALLS + i) * 2],
              recording.ballFrames[(lastF * NUM_BALLS + i) * 2 + 1],
            ];
          }
          return next;
        });
      }
      onReplayComplete(result);
    },
    [recording, onReplayComplete],
  );

  // Aim line
  const showAimLine = isMyTurn && phase === 'aiming' && isDragging;
  const { x: cbScreenX, y: cbScreenY } = cueBallScreenPosRef.current;
  const lineLen = power * 200;
  const lineDx = Math.sin(aimAngle) * lineLen;
  const lineDy = Math.cos(aimAngle) * lineLen;

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        orthographic
        camera={{ position: [0, 10, 0], up: [0, 0, -1], zoom: 280, near: 0.01, far: 100 }}
        style={{ width: '100%', height: '100%' }}
      >
        <ambientLight intensity={0.8} />
        <directionalLight position={[0, 5, 0]} intensity={0.5} />
        <TableFelt />
        <Rails />
        <Pockets />
        <Balls activeBalls={activeBalls} ballPositions={ballPositions} ballRefs={ballRefs} />
        <CueBallProjector ballRefs={ballRefs} screenPosRef={cueBallScreenPosRef} />
        {recording && phase === 'replay' && (
          <PoolReplayDriver
            recording={recording}
            ballRefs={ballRefs}
            onReplayComplete={handleInternalReplayComplete}
          />
        )}
      </Canvas>

      {showAimLine && (
        <svg
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        >
          <line
            x1={cbScreenX}
            y1={cbScreenY}
            x2={cbScreenX + lineDx}
            y2={cbScreenY + lineDy}
            stroke="white"
            strokeWidth={2}
            strokeDasharray="8 6"
            opacity={0.8}
          />
        </svg>
      )}
    </div>
  );
}
