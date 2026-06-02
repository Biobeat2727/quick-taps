'use client';

import { useEffect, useRef, useCallback, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { PIN_POSITIONS, BALL_RADIUS, PIN_PROFILE } from '@/lib/bowling/bowling-constants';
import type { ThrowParams, BowlingDecodedRecording } from '@/types/bowling';
import type { BowlingPhase } from './bowling-shared';
import { useThrowInput } from './useThrowInput';

export interface BowlingSceneProps {
  myPlayerId:       string;
  pinState:         boolean[];
  recording:        BowlingDecodedRecording | null;
  onThrow:          (params: ThrowParams) => void;
  onReplayComplete: (knockedPins: boolean[]) => void;
  phase:            BowlingPhase;
  isMyTurn:         boolean;
}

// ── BowlingReplayDriver ────────────────────────────────────────────────────────

const REPLAY_HOLD_SECS = 0.5; // seconds to hold on final frame before signalling complete

function BowlingReplayDriver({
  recording,
  ballRef,
  pinRefs,
  holdRef,
  onReplayComplete,
}: {
  recording:        BowlingDecodedRecording;
  ballRef:          React.RefObject<THREE.Mesh>;
  pinRefs:          React.RefObject<(THREE.Mesh | null)[]>;
  holdRef:          React.RefObject<boolean>;
  onReplayComplete: (knockedPins: boolean[]) => void;
}) {
  const elapsed      = useRef(0);
  const lastFrame    = useRef(-1);
  const done         = useRef(false);
  const holdStart    = useRef<number | null>(null);

  useEffect(() => {
    elapsed.current   = 0;
    lastFrame.current = -1;
    done.current      = false;
    holdStart.current = null;
  }, [recording]);

  useFrame((_, delta) => {
    if (done.current) return;
    elapsed.current += delta;
    const f = Math.min(Math.floor(elapsed.current * 60), recording.numFrames - 1);

    if (f > lastFrame.current) {
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
    }

    // Once the recording ends, hold for REPLAY_HOLD_SECS so the player can see the result
    if (f >= recording.numFrames - 1) {
      if (holdStart.current === null) {
        holdStart.current = elapsed.current;
        holdRef.current = true; // signal camera to start easing back
      } else if (elapsed.current - holdStart.current >= REPLAY_HOLD_SECS) {
        done.current = true;
        onReplayComplete(recording.knockedPins);
      }
    }
  });

  return null;
}

// ── AimSystem ─────────────────────────────────────────────────────────────────
// Positions ball, draws curved trajectory based on spin.

const DOT_COUNT   = 14;
const DOT_SPACING = 1.3;
const DOT_Y       = 0.065;
// Lateral drift coefficient: spin=1 causes ~0.43 units hook at z=17.5
// 0.43 = k * (17.5 - 0.3)² → k ≈ 0.00145
const HOOK_K = 0.00145;

function AimSystem({
  aimXRef,
  spinRef,
  ballRef,
  dotRefs,
  phase,
}: {
  aimXRef: React.RefObject<number>;
  spinRef:  React.RefObject<number>;
  ballRef:  React.RefObject<THREE.Mesh>;
  dotRefs:  React.RefObject<THREE.Mesh[]>;
  phase:    BowlingPhase;
}) {
  useFrame(() => {
    const ball = ballRef.current;
    const dots = dotRefs.current;
    if (!ball || !dots) return;

    if (phase !== 'aiming') {
      dots.forEach(d => { if (d) d.visible = false; });
      return;
    }

    const aimX   = aimXRef.current ?? 0;
    const spin   = spinRef.current  ?? 0;
    const startX = aimX * 0.45;

    ball.position.set(startX, BALL_RADIUS, 0.3);

    for (let i = 0; i < DOT_COUNT; i++) {
      const dot = dots[i];
      if (!dot) continue;
      const dotZ = 0.3 + (i + 1) * DOT_SPACING;
      const dz   = dotZ - 0.3;
      dot.visible = true;
      dot.position.set(startX - spin * HOOK_K * dz * dz, DOT_Y, dotZ);
    }
  });

  return null;
}

// ── CameraRig ─────────────────────────────────────────────────────────────────

// When the ball passes this Z the camera locks to a fixed "pin action" view
const CAMERA_LOCK_Z = 15.0;

function CameraRig({
  phase,
  ballRef,
  aimXRef,
  holdRef,
}: {
  phase:   BowlingPhase;
  ballRef: React.RefObject<THREE.Mesh>;
  aimXRef: React.RefObject<number>;
  holdRef: React.RefObject<boolean>;
}) {
  const { camera } = useThree();
  const camTarget    = useRef(new THREE.Vector3(0, 1.0, -2));
  const lookTarget   = useRef(new THREE.Vector3(0, 0.3, 18));
  const cameraLocked = useRef(false);

  useFrame(() => {
    if (phase === 'aiming') {
      cameraLocked.current = false;
      const ballX = (aimXRef.current ?? 0) * 0.45;
      camTarget.current.set(ballX * 0.4, 1.0, -2);
      lookTarget.current.set(ballX * 0.15, 0.3, 18);
    } else if (phase === 'replay') {
      if (!cameraLocked.current) {
        const bx = ballRef.current?.position.x ?? 0;
        const bz = ballRef.current?.position.z ?? 0.3;
        if (bz >= CAMERA_LOCK_Z) {
          // Lock to a wide shot of the pin deck — camera stops following the ball
          cameraLocked.current = true;
          camTarget.current.set(0, 1.3, 12.5);
          lookTarget.current.set(0, 0.25, 18.2);
        } else {
          camTarget.current.set(bx * 0.3, 1.2, bz - 2.5);
          lookTarget.current.set(bx * 0.5, 0.3, bz + 3.0);
        }
      } else if (holdRef.current) {
        // Recording done — ease camera back toward the lane start while result is visible
        camTarget.current.set(0, 1.0, -2);
        lookTarget.current.set(0, 0.3, 18);
      }
      // cameraLocked and not in hold → targets frozen; camera lerps to pin deck and stays
    }
    camera.position.lerp(camTarget.current, 0.05);
    camera.lookAt(lookTarget.current);
  });

  return null;
}

// X positions shared by approach dots and rangefinder arrows (boards 5,10,15,20,25,30,35)
const MARKER_XS = [-0.42, -0.28, -0.14, 0, 0.14, 0.28, 0.42] as const;

// Chevron arrow constants — two angled box arms meeting at a tip
const CHV_HALF  = 0.030;  // half base-width of the V
const CHV_DEPTH = 0.065;  // distance from tip to base along the lane
const CHV_LEN   = Math.sqrt(CHV_HALF ** 2 + CHV_DEPTH ** 2); // arm length ≈ 0.072
const CHV_ANGLE = Math.atan2(CHV_HALF, CHV_DEPTH);            // arm angle ≈ 24.7°
const CHV_W     = 0.009;  // arm width

// ── SceneContents ─────────────────────────────────────────────────────────────

function SceneContents({
  pinState,
  phase,
  recording,
  onReplayComplete,
  aimXRef,
  spinRef,
}: {
  pinState:         boolean[];
  phase:            BowlingPhase;
  recording:        BowlingDecodedRecording | null;
  onReplayComplete: (knockedPins: boolean[]) => void;
  aimXRef:          React.RefObject<number>;
  spinRef:          React.RefObject<number>;
}) {
  const pinRefs = useRef<(THREE.Mesh | null)[]>(Array(10).fill(null));
  const ballRef = useRef<THREE.Mesh>(null!);
  const dotRefs = useRef<THREE.Mesh[]>([]);
  const holdRef = useRef(false);
  useEffect(() => { holdRef.current = false; }, [recording]);

  // Snap standing pins back to upright after replay finishes moving them around
  useEffect(() => {
    if (phase !== 'aiming') return;
    for (let i = 0; i < 10; i++) {
      const pin = pinRefs.current[i];
      if (!pin) continue;
      const [px, py, pz] = PIN_POSITIONS[i];
      pin.position.set(px, py, pz);
      pin.quaternion.set(0, 0, 0, 1);
    }
  }, [phase]);

  // Sync pin visibility and pose whenever pinState changes
  useEffect(() => {
    for (let i = 0; i < 10; i++) {
      const pin = pinRefs.current[i];
      if (pinState[i]) {
        if (pin) {
          pin.visible = true;
          const [px, py, pz] = PIN_POSITIONS[i];
          pin.position.set(px, py, pz);
          pin.quaternion.set(0, 0, 0, 1);
        }
      } else {
        if (pin) pin.visible = false;
      }
    }
  }, [pinState]);

  const pinGeometry = useMemo(() => {
    const points = PIN_PROFILE.map(([r, y]) => new THREE.Vector2(r, y));
    return new THREE.LatheGeometry(points, 16);
  }, []);
  useEffect(() => () => pinGeometry.dispose(), [pinGeometry]);

  // Board-stripe canvas texture: 39 alternating maple/pine boards across the lane width
  const laneTexture = useMemo(() => {
    const W = 512, H = 32;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const bw = W / 39;
    for (let i = 0; i < 39; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#D4A96A' : '#C49558';
      ctx.fillRect(Math.floor(i * bw), 0, Math.ceil(bw) + 1, H);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
  useEffect(() => () => laneTexture.dispose(), [laneTexture]);

  return (
    <>
      <CameraRig phase={phase} ballRef={ballRef} aimXRef={aimXRef} holdRef={holdRef} />
      <AimSystem aimXRef={aimXRef} spinRef={spinRef} ballRef={ballRef} dotRefs={dotRefs} phase={phase} />

      {recording && (
        <BowlingReplayDriver
          recording={recording}
          ballRef={ballRef}
          pinRefs={pinRefs}
          holdRef={holdRef}
          onReplayComplete={onReplayComplete}
        />
      )}

      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={1.2} />

      {/* Lane — board-stripe texture (U=width, stripes run down the length) */}
      <mesh position={[0, 0, 9.0]}>
        <boxGeometry args={[1.06, 0.01, 18.5]} />
        <meshStandardMaterial map={laneTexture} roughness={0.3} metalness={0.0} />
      </mesh>

      {/* Gutters — half-cylinder troughs; rotation=[PI/2,0,0] puts axis along Z */}
      {/* Left: thetaStart=PI so arc curves outward (-X), opening faces lane */}
      <mesh position={[-0.655, -0.14, 9.0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.125, 0.125, 18.5, 16, 1, true, Math.PI, Math.PI]} />
        <meshStandardMaterial color="#3D2B1A" roughness={0.9} side={THREE.BackSide} />
      </mesh>
      {/* Right: thetaStart=0 so arc curves outward (+X), opening faces lane */}
      <mesh position={[0.655, -0.14, 9.0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.125, 0.125, 18.5, 16, 1, true, 0, Math.PI]} />
        <meshStandardMaterial color="#3D2B1A" roughness={0.9} side={THREE.BackSide} />
      </mesh>

      {/* Gutter outer rails — sit just outside the half-cylinder rim at x=±0.78 */}
      {([-1, 1] as const).map((side) => (
        <mesh key={`rail-${side}`} position={[side * 0.80, -0.125, 9.0]}>
          <boxGeometry args={[0.008, 0.25, 18.5]} />
          <meshStandardMaterial color="#1a0f0a" roughness={0.9} />
        </mesh>
      ))}

      {/* Approach surface — sits behind the foul line, lowered to avoid z-fighting with lane */}
      <mesh position={[0, -0.001, -1.5]}>
        <boxGeometry args={[1.06, 0.01, 3.0]} />
        <meshStandardMaterial color="#C8A96E" roughness={0.8} />
      </mesh>

      {/* Foul line */}
      <mesh position={[0, 0.006, 0.15]}>
        <boxGeometry args={[1.06, 0.002, 0.03]} />
        <meshStandardMaterial color="#222222" />
      </mesh>

      {/* Approach dots — single row near the foul line */}
      {MARKER_XS.map((x, j) => (
        <mesh key={`ad-${j}`} position={[x, 0.006, 0.8]}>
          <cylinderGeometry args={[0.018, 0.018, 0.002, 16]} />
          <meshStandardMaterial color="#8B6F4E" roughness={0.7} />
        </mesh>
      ))}

      {/* Rangefinder arrows — chevron formation */}
      {([-0.42, -0.28, -0.14, 0, 0.14, 0.28, 0.42] as const).map((x, i) => {
        const zOffset = Math.abs(x) * 0.4; // center arrow furthest forward, outer arrows step back
        return (
          <group key={`arrow-${i}`} position={[x, 0.007, 4.6 - zOffset]}>
            {/* Left arm */}
            <mesh position={[-0.022, 0, -0.025]} rotation={[0, 0.42, 0]}>
              <boxGeometry args={[0.008, 0.002, 0.075]} />
              <meshStandardMaterial color="#6B5040" />
            </mesh>
            {/* Right arm */}
            <mesh position={[0.022, 0, -0.025]} rotation={[0, -0.42, 0]}>
              <boxGeometry args={[0.008, 0.002, 0.075]} />
              <meshStandardMaterial color="#6B5040" />
            </mesh>
          </group>
        );
      })}

      {/* Trajectory dots — curved by AimSystem via dotRefs */}
      {Array.from({ length: DOT_COUNT }, (_, i) => {
        const opacity = 0.9 - i * 0.055;
        const size    = 0.026 - i * 0.001;
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
            geometry={pinGeometry}
          >
            <meshStandardMaterial color="white" roughness={0.15} metalness={0.0} />
          </mesh>
        ) : null,
      )}

      {/* Pin spot dots — one per pin position */}
      {PIN_POSITIONS.map(([px, , pz], i) => (
        <mesh key={i} position={[px, 0.006, pz]}>
          <cylinderGeometry args={[0.025, 0.025, 0.002, 16]} />
          <meshStandardMaterial color="#8B6F4E" roughness={0.7} />
        </mesh>
      ))}

      {/* Pin deck — darker backing area behind the pins */}
      <mesh position={[0, 0, 19.5]}>
        <boxGeometry args={[1.06, 0.01, 1.0]} />
        <meshStandardMaterial color="#A8824A" roughness={0.6} />
      </mesh>

      {/* Ball — consistent material throughout aiming and replay */}
      <mesh ref={ballRef} position={[0, BALL_RADIUS, 0.3]}>
        <sphereGeometry args={[BALL_RADIUS, 16, 16]} />
        <meshStandardMaterial color="#1a1a2e" roughness={0.3} metalness={0.4} />
      </mesh>

      {/* Fascia overhang above the pins */}
      <NeonSignBoard />
    </>
  );
}

// ── NeonSignBoard ─────────────────────────────────────────────────────────────
// Canvas texture rendered on a dark backing board above the pin deck,
// like the fascia overhang in a real bowling alley.

function NeonSignBoard() {
  const matRef = useRef<THREE.MeshBasicMaterial>(null!);

  useEffect(() => {
    const W = 2048, H = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    let texture: THREE.CanvasTexture | null = null;

    document.fonts.load('700 240px "Dancing Script"').then(() => {
      ctx.clearRect(0, 0, W, H);

      function drawNeon(text: string, cx: number, cy: number, size: number, color: string) {
        ctx.font = `700 ${size}px "Dancing Script"`;
        ctx.textAlign = 'center';
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        // Ambient soft bloom
        ctx.globalAlpha = 0.12;
        ctx.strokeStyle = color;
        ctx.lineWidth = size * 0.18;
        ctx.shadowColor = color;
        ctx.shadowBlur = 90;
        ctx.strokeText(text, cx, cy);

        // Dark glass tube rim
        ctx.globalAlpha = 0.8;
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = size * 0.075;
        ctx.strokeText(text, cx, cy);

        // Colored neon gas
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = color;
        ctx.lineWidth = size * 0.048;
        ctx.shadowColor = color;
        ctx.shadowBlur = 32;
        ctx.strokeText(text, cx, cy);

        // Hot white core
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = 'white';
        ctx.lineWidth = size * 0.018;
        ctx.shadowBlur = 12;
        ctx.strokeText(text, cx, cy);

        // Specular glass highlight (offset up slightly)
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = 'white';
        ctx.lineWidth = size * 0.008;
        ctx.shadowBlur = 0;
        ctx.strokeText(text, cx, cy - size * 0.022);

        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
      }

      drawNeon('Quick Taps', W / 2, 390, 310, '#ff2d78');
      drawNeon('Bowling',    W / 2, 790, 250, '#00e5ff');

      texture = new THREE.CanvasTexture(canvas);
      if (matRef.current) {
        matRef.current.map = texture;
        matRef.current.needsUpdate = true;
      }
    });

    return () => { texture?.dispose(); };
  }, []);

  // Board: 4 m wide × 2 m tall — matches canvas 2:1 aspect ratio
  const bW = 4.0, bH = 2.0;

  return (
    // y=2.2 centers the board at 2.2 m — bottom edge at 1.2 m, well above the pins (max y≈0.38)
    // z=19.0 places it just behind the back row of pins (z≈18.3)
    <group position={[0, 2.2, 19.0]}>
      {/* Dark backing board */}
      <mesh>
        <boxGeometry args={[bW + 0.1, bH + 0.1, 0.06]} />
        <meshStandardMaterial color="#0d0a04" roughness={0.9} metalness={0.1} />
      </mesh>
      {/* Sign face — rotated 180° around Y to face the bowler (camera is in −z) */}
      <mesh rotation={[0, Math.PI, 0]} position={[0, 0, -0.032]}>
        <planeGeometry args={[bW, bH]} />
        <meshBasicMaterial ref={matRef} transparent />
      </mesh>
    </group>
  );
}

// ── PowerBar (oscillating) ─────────────────────────────────────────────────────
// DOM mutation only — no React state at 60 fps.

function PowerBar({
  powerRef,
  enabled,
}: {
  powerRef: React.RefObject<number>;
  enabled:  boolean;
}) {
  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) {
      if (fillRef.current) fillRef.current.style.transform = 'scaleY(0)';
      return;
    }
    let raf: number;
    function tick() {
      if (fillRef.current) {
        fillRef.current.style.transform = `scaleY(${powerRef.current})`;
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, powerRef]);

  return (
    <div style={{
      position: 'absolute', right: 16, top: '25%', height: '48%',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
      pointerEvents: 'none',
    }}>
      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: 1,
        color: enabled ? '#F0C040' : '#555',
        transition: 'color 0.3s',
        writingMode: 'vertical-rl', textOrientation: 'mixed',
        transform: 'rotate(180deg)',
      }}>
        POWER
      </span>
      {/* Track */}
      <div style={{
        flex: 1, width: 8, background: '#111', borderRadius: 4,
        border: `1px solid ${enabled ? '#555' : '#333'}`,
        transition: 'border-color 0.3s',
        position: 'relative', overflow: 'hidden',
        display: 'flex', alignItems: 'flex-end',
      }}>
        {/* Sweet spot zone 65–85% */}
        <div style={{
          position: 'absolute',
          bottom: '65%', left: 0, right: 0, height: '20%',
          background: 'rgba(240,192,64,0.12)',
          borderTop: '1px solid rgba(240,192,64,0.3)',
          borderBottom: '1px solid rgba(240,192,64,0.3)',
          pointerEvents: 'none',
        }} />
        {/* Fill — green → yellow → red */}
        <div
          ref={fillRef}
          style={{
            width: '100%', height: '100%',
            background: 'linear-gradient(to top, #2ecc71 0%, #F0C040 60%, #e74c3c 100%)',
            transformOrigin: 'bottom', transform: 'scaleY(0)',
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

  const handleThrowFromInput = useCallback(
    (params: ThrowParams) => {
      onThrow({ ...params, pinState });
    },
    [onThrow, pinState],
  );

  const { aimXRef, powerRef, spinRef, setSpinDir, doThrow } = useThrowInput(
    containerRef,
    isMyTurn && phase === 'aiming',
    handleThrowFromInput,
  );

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
          spinRef={spinRef}
        />
      </Canvas>

      {/* Oscillating power bar */}
      {canThrow && <PowerBar powerRef={powerRef} enabled={canThrow} />}

      {/* Hint */}
      {canThrow && (
        <p style={{
          position: 'absolute', bottom: 220, left: 0, right: 0,
          textAlign: 'center', color: 'rgba(255,255,255,0.75)',
          fontSize: 11, margin: 0, pointerEvents: 'none', userSelect: 'none',
        }}>
          Drag to aim · Hold ↺↻ to hook
        </p>
      )}

      {/* Bottom controls: [hook-L]  [THROW]  [hook-R] */}
      {canThrow && (
        <div style={{
          position: 'absolute', bottom: 24,
          left: 0, right: 0,
          display: 'flex', justifyContent: 'center',
          alignItems: 'center', gap: 16,
        }}>
          {/* Hook left */}
          <button
            onPointerDown={() => setSpinDir(-1)}
            onPointerUp={() => setSpinDir(0)}
            onPointerCancel={() => setSpinDir(0)}
            style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'transparent', border: '2px solid #555',
              color: '#aaa', fontSize: 22,
              cursor: 'pointer', touchAction: 'none', userSelect: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ↺
          </button>

          {/* Throw */}
          <button
            onPointerDown={doThrow}
            style={{
              width: 72, height: 72, borderRadius: '50%',
              background: 'transparent', border: '3px solid #aaa',
              color: '#fff', fontSize: 12, fontWeight: 900, letterSpacing: 1,
              cursor: 'pointer', touchAction: 'none', userSelect: 'none',
            }}
          >
            THROW
          </button>

          {/* Hook right */}
          <button
            onPointerDown={() => setSpinDir(1)}
            onPointerUp={() => setSpinDir(0)}
            onPointerCancel={() => setSpinDir(0)}
            style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'transparent', border: '2px solid #555',
              color: '#aaa', fontSize: 22,
              cursor: 'pointer', touchAction: 'none', userSelect: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ↻
          </button>
        </div>
      )}
    </div>
  );
}
