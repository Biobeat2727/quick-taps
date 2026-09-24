'use client';

import { memo, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, Line } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode, type BloomEffect } from 'postprocessing';
import * as THREE from 'three';
import type { Line2 } from 'three-stdlib';
import { NUM_BALLS } from '@/lib/pool/pool-constants';
import { BALL_RADIUS as R, TABLE_HALF_WIDTH as W, TABLE_HALF_LENGTH as L, POCKETS, POOL_HZ, type PoolSimResult, type PoolTable } from '@/lib/pool/pool-sim-core';
import { TableMesh, RAIL_TOP, OUTER_W, OUTER_L, POCKET_R } from './PoolTableMesh';
import { ballTexture } from './poolTextures';
import { computeGuide } from './aimGuide';

type V = [number, number];

export interface AimState {
  angle: number;
  pull: number;        // 0..1 power pull-back (drives the cue stick)
  show: boolean;       // draw guide + cue
  cue: V | null;       // ball-in-hand override for the cue ball position
  placing: boolean;    // ball-in-hand ring
  legal: number[];     // balls it's legal to hit first (for guide colouring)
  striking: number;    // >0 while the stick is thrusting forward (seconds left)
  spin: { x: number; y: number }; // tip position: x side english, y follow(+)/draw(−)
}

export interface PoolPlayback { sim: PoolSimResult; from: PoolTable }

export interface ScreenApi {
  /** Screen point → table-plane point (x, z), or null off-table. */
  toTable: (clientX: number, clientY: number) => V | null;
  /** Table point (x, z) at rail height → client px. */
  toScreen: (x: number, z: number) => V;
  /** Bumps whenever the framing changes, so overlays can re-measure. */
  frameId: number;
}

interface Props {
  table: PoolTable;
  playback: PoolPlayback | null;
  aim: React.RefObject<AimState>;
  onEnd: () => void;
  onEvent?: (e: PoolSimResult['events'][number]) => void;
  apiRef: React.RefObject<ScreenApi | null>;
  /** Screen px reserved around the table (HUD above, controls below, trays beside). */
  insets?: { top: number; bottom: number; left?: number; right?: number };
  /** Playback speed multiplier (tap-to-fast-forward). */
  speedRef?: React.RefObject<number>;
  /** Called after the camera re-frames (mount, resize). */
  onFramed?: () => void;
}


// ── Static table ───────────────────────────────────────────────────────────

function useGlowTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
}

// ── Balls ──────────────────────────────────────────────────────────────────

function useBallMaterials() {
  return useMemo(() => Array.from({ length: NUM_BALLS }, (_, n) => new THREE.MeshPhysicalMaterial({
    map: ballTexture(n), roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0,
  })), []);
}

// ── Scene ──────────────────────────────────────────────────────────────────

function Scene({ table, playback, aim, onEnd, onEvent, apiRef, insets = { top: 64, bottom: 120 }, speedRef, onFramed }: Props) {
  const { camera, gl, size } = useThree();
  const ballGeo = useMemo(() => new THREE.SphereGeometry(R, 40, 28), []);
  const ballMats = useBallMaterials();
  const glowTex = useGlowTexture();
  const balls = useRef<(THREE.Mesh | null)[]>([]);
  const shadows = useRef<(THREE.Mesh | null)[]>([]);
  const cueStick = useRef<THREE.Group>(null);
  const ghost = useRef<THREE.Mesh>(null);
  const handRing = useRef<THREE.Mesh>(null);
  const lineAim = useRef<Line2>(null);
  const lineObj = useRef<Line2>(null);
  const lineCue = useRef<Line2>(null);
  const bloomRef = useRef<BloomEffect>(null);
  const railMats = useMemo(() => [0, 1, 2, 3].map(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#3ff2ff'), toneMapped: false })), []);
  // Free GPU memory on unmount — phones lock up if remounts leak buffers.
  useEffect(() => () => {
    ballGeo.dispose();
    ballMats.forEach((m) => m.dispose());
    railMats.forEach((m) => m.dispose());
    glowTex.dispose();
  }, [ballGeo, ballMats, railMats, glowTex]);
  const railFlash = useRef([0, 0, 0, 0]);
  const pocketRings = useRef<(THREE.Mesh | null)[]>([]);
  const pocketFlash = useRef([0, 0, 0, 0, 0, 0]);
  const st = useRef({ t: 0, ended: false, ev: 0, shake: 0, kick: 0 });
  const onEndRef = useRef(onEnd); const onEventRef = useRef(onEvent);
  useEffect(() => { onEndRef.current = onEnd; onEventRef.current = onEvent; });
  const q = useMemo(() => new THREE.Quaternion(), []);
  const camBase = useRef(new THREE.Vector3());
  const axis = useMemo(() => new THREE.Vector3(), []);

  // Screen → table raycast for the input layer
  useEffect(() => {
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -R);
    const hit = new THREE.Vector3();
    apiRef.current = {
      toTable: (cx, cy) => {
        const r = gl.domElement.getBoundingClientRect();
        ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
        return ray.ray.intersectPlane(plane, hit) ? [hit.x, hit.z] : null;
      },
      toScreen: (x, z) => {
        const r = gl.domElement.getBoundingClientRect();
        const v = new THREE.Vector3(x, RAIL_TOP, z).project(camera);
        return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
      },
      frameId: 0,
    };
  }, [camera, gl, apiRef]);

  // Frame the table as large as possible: fit the width, and fit the length into
  // whatever height is left after the HUD (top) and controls (bottom).
  const iL = insets.left ?? 0, iR = insets.right ?? 0;
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const needW = OUTER_W + 0.012, needL = OUTER_L + 0.012;
    const freeV = Math.max(0.4, 1 - (insets.top + insets.bottom) / size.height);
    const freeH = Math.max(0.5, 1 - (iL + iR) / size.width);
    const d = Math.max(needW / (tanV * cam.aspect * freeH), needL / (tanV * freeV));
    // shift so the table is centred in the free area (screen-right is world −X)
    const worldPerPx = (2 * d * tanV) / size.height;
    const shiftZ = ((insets.bottom - insets.top) / 2) * worldPerPx;
    const shiftX = ((iL - iR) / 2) * worldPerPx;
    const dir = new THREE.Vector3(0, 1, -0.1).normalize();
    cam.position.copy(dir.multiplyScalar(d)).add(new THREE.Vector3(shiftX, 0, -shiftZ));
    camBase.current.copy(cam.position);
    cam.lookAt(shiftX, 0, -shiftZ);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    if (apiRef.current) apiRef.current.frameId++;
    onFramed?.();
  }, [camera, size, insets.top, insets.bottom, iL, iR, apiRef, onFramed]);

  useEffect(() => { Object.assign(st.current, { t: 0, ended: false, ev: 0 }); }, [playback]);

  // Real racks sit in random orientations. Starting every ball upright shows a
  // stripe's white cap from above — it reads as a cue ball. Tip each one over.
  useEffect(() => {
    const e = new THREE.Euler();
    balls.current.forEach((m, b) => {
      if (!m || b === 0) return;
      e.set(Math.PI / 2 + (Math.sin(b * 12.9898) * 0.35), b * 2.399, Math.cos(b * 78.233) * 0.3);
      m.quaternion.setFromEuler(e);
    });
  }, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const s = st.current;
    const a = aim.current!;

    // ── Ball positions ──
    if (playback) {
      const { sim } = playback;
      s.t += dt * (speedRef?.current ?? 1);
      const f = Math.min(s.t * POOL_HZ, sim.numFrames - 1);
      const i0 = Math.floor(f), i1 = Math.min(i0 + 1, sim.numFrames - 1), k = f - i0;
      for (let b = 0; b < NUM_BALLS; b++) {
        const m = balls.current[b];
        if (!m) continue;
        if (!playback.from.active[b]) { m.visible = false; continue; }
        const o0 = (i0 * NUM_BALLS + b) * 2, o1 = (i1 * NUM_BALLS + b) * 2;
        let x = sim.frames[o0] + (sim.frames[o1] - sim.frames[o0]) * k;
        let z = sim.frames[o0 + 1] + (sim.frames[o1 + 1] - sim.frames[o0 + 1]) * k;
        let y = R;
        const pf = sim.pocketedAt[b];
        if (pf >= 0 && f >= pf) {
          // drop into the pocket: slide to its centre and sink under the rail
          const p = Math.min(1, (f - pf) / 9);
          const [px, pz] = POCKETS[sim.pocketOf[b]];
          x += (px - x) * p; z += (pz - z) * p; y = R - p * 3 * R;
        }
        const dx = x - m.position.x, dz = z - m.position.z;
        const dl = Math.hypot(dx, dz);
        if (dl > 1e-5 && dl < 0.5) {
          axis.set(dz, 0, -dx).normalize();
          m.quaternion.premultiply(q.setFromAxisAngle(axis, dl / R));
        }
        m.position.set(x, y, z);
        m.visible = y > -R;
      }
      // events up to now → juice
      while (s.ev < sim.events.length && sim.events[s.ev].f <= f) {
        const e = sim.events[s.ev++];
        if (e.type === 'rail') {
          const [bx, bz] = [sim.frames[(e.f * NUM_BALLS + e.a) * 2], sim.frames[(e.f * NUM_BALLS + e.a) * 2 + 1]];
          const side = Math.abs(bx) / W > Math.abs(bz) / L ? (bx > 0 ? 0 : 1) : (bz > 0 ? 2 : 3);
          railFlash.current[side] = Math.min(1.5, railFlash.current[side] + e.speed * 0.5);
        } else if (e.type === 'pocket') {
          pocketFlash.current[e.pocket] = 1;
          s.kick = Math.max(s.kick, e.a === 0 ? 0.3 : 1);
        } else if (e.type === 'ball' && e.speed > 3) {
          s.shake = Math.max(s.shake, Math.min(0.02, e.speed * 0.002));
        }
        onEventRef.current?.(e);
      }
      if (!s.ended && f >= sim.numFrames - 1) { s.ended = true; onEndRef.current(); }
    } else {
      for (let b = 0; b < NUM_BALLS; b++) {
        const m = balls.current[b];
        if (!m) continue;
        m.visible = table.active[b];
        const [x, z] = b === 0 && a.cue ? a.cue : table.pos[b];
        m.position.set(x, R, z);
      }
    }

    // Shadows track balls
    for (let b = 0; b < NUM_BALLS; b++) {
      const m = balls.current[b], sh = shadows.current[b];
      if (!m || !sh) continue;
      sh.visible = m.visible && m.position.y > 0;
      sh.position.set(m.position.x + 0.004, 0.0008, m.position.z - 0.006);
    }

    // ── Aim guide + cue stick ──
    let aimPocket = -1;
    const cueM = balls.current[0];
    const showAim = a.show && !playback && !!cueM;
    const stick = cueStick.current!;
    if (showAim && cueM) {
      const cx = cueM.position.x, cz = cueM.position.z;
      const g = computeGuide({ pos: table.pos.map((p, i) => (i === 0 ? [cx, cz] : p)) as V[], active: table.active }, a.angle, a.spin);
      const illegal = g.target >= 0 && a.legal.length > 0 && !a.legal.includes(g.target);
      lineAim.current?.geometry.setPositions([cx, R, cz, g.end[0], R, g.end[1]]);
      lineAim.current?.computeLineDistances();
      const gm = ghost.current!;
      gm.visible = true;
      gm.position.set(g.end[0], 0.002, g.end[1]);
      (gm.material as THREE.MeshBasicMaterial).color.set(illegal ? '#ff3355' : '#ffffff');
      aimPocket = -1;
      if (g.objDir && !illegal) {
        const t = g.target, tp = table.pos[t];
        // which pocket (if any) the object ball is lined up on
        let bestD = Infinity;
        POCKETS.forEach(([qx, qz], qi) => {
          const rx = qx - tp[0], rz = qz - tp[1];
          const along = rx * g.objDir![0] + rz * g.objDir![1];
          if (along <= 0) return;
          const off = Math.abs(rx * g.objDir![1] - rz * g.objDir![0]);
          if (off < POCKET_R[qi] * 0.7 && along < bestD) { bestD = along; aimPocket = qi; }
        });
        const reach = 0.55 * Math.cos(g.cut) + 0.05;
        lineObj.current!.visible = true;
        lineObj.current!.geometry.setPositions([tp[0], R, tp[1], tp[0] + g.objDir[0] * reach, R, tp[1] + g.objDir[1] * reach]);
      } else lineObj.current!.visible = false;
      if (g.cueDir && !illegal) {
        const reach = 0.34 * g.cueSpeed + 0.03;
        lineCue.current!.visible = true;
        lineCue.current!.geometry.setPositions([g.end[0], R, g.end[1], g.end[0] + g.cueDir[0] * reach, R, g.end[1] + g.cueDir[1] * reach]);
      } else if (g.bounce) {
        lineCue.current!.visible = true;
        lineCue.current!.geometry.setPositions([g.end[0], R, g.end[1], g.end[0] + g.bounce[0] * 0.3, R, g.end[1] + g.bounce[1] * 0.3]);
      } else lineCue.current!.visible = false;
      lineAim.current!.visible = true;

      // stick lies behind the cue ball along −aim, pulled back by power
      const back = R + 0.012 + a.pull * 0.28;
      stick.visible = true;
      stick.position.set(cx - Math.sin(a.angle) * back, 0.035, cz - Math.cos(a.angle) * back);
      stick.rotation.set(0, a.angle, 0);
    } else {
      for (const o of [lineAim.current, lineObj.current, lineCue.current, ghost.current]) if (o) o.visible = false;
      // follow-through: thrust forward briefly after release, then vanish
      if (a.striking > 0 && cueM) {
        a.striking -= dt;
        stick.position.x += Math.sin(a.angle) * dt * 4;
        stick.position.z += Math.cos(a.angle) * dt * 4;
        stick.visible = a.striking > 0;
      } else stick.visible = false;
    }

    // Ball-in-hand ring
    const hr = handRing.current!;
    hr.visible = a.placing && !playback && !!cueM;
    if (hr.visible && cueM) {
      hr.position.set(cueM.position.x, 0.002, cueM.position.z);
      const pulse = 1 + Math.sin(performance.now() / 180) * 0.12;
      hr.scale.setScalar(pulse);
    }

    // ── Neon reactivity ──
    railFlash.current.forEach((v, i) => {
      const k = 0.8 + v * 2.2;
      railMats[i].color.setRGB(0.25 * k, 0.95 * k, 1.0 * k);
      railFlash.current[i] = v * Math.exp(-5 * dt);
    });
    pocketFlash.current.forEach((v, i) => {
      const m = pocketRings.current[i];
      if (!m) return;
      const mat = m.material as THREE.MeshBasicMaterial;
      if (v < 0.05 && i === aimPocket && showAim) {
        // steady green: "this one's going in" (on the current line)
        mat.opacity = 0.55 + Math.sin(performance.now() / 160) * 0.2;
        mat.color.setRGB(0.4, 2.4, 1.2);
        m.scale.setScalar(1);
      } else {
        mat.opacity = v;
        mat.color.setRGB(3, 0.6, 2.6);
        m.scale.setScalar(1 + (1 - v) * 0.8);
      }
      pocketFlash.current[i] = v * Math.exp(-3 * dt);
    });
    s.kick *= Math.exp(-3 * dt);
    if (bloomRef.current) bloomRef.current.intensity = 0.7 + s.kick * 1.5;
    camera.position.copy(camBase.current);
    if (s.shake > 0.0003) {
      camera.position.x += (Math.random() - 0.5) * s.shake;
      camera.position.z += (Math.random() - 0.5) * s.shake;
      s.shake *= Math.exp(-8 * dt);
    }
  });

  const shadowTex = glowTex;
  // Built once. Re-rendering <Environment> re-bakes its cube map + PMREM on the
  // GPU; doing that on every React render is what froze phones mid-drag.
  const environment = useMemo(() => (
      <Environment resolution={128} frames={1} environmentIntensity={0.6}>
        {/* the overhead lamp — this is the highlight on every ball */}
        <Lightformer form="rect" intensity={6} color="#fff4e0" position={[0, 4, 0]} rotation-x={Math.PI / 2} scale={[1.2, 2.4, 1]} />
        <Lightformer form="rect" intensity={2} color="#ff3fd0" position={[-3, 1, 0]} rotation-y={Math.PI / 2} scale={[4, 0.5, 1]} />
        <Lightformer form="rect" intensity={2} color="#3ff2ff" position={[3, 1, 0]} rotation-y={-Math.PI / 2} scale={[4, 0.5, 1]} />
      </Environment>
  ), []);
  const lineCol = useMemo(() => new THREE.Color(2, 2, 2), []);

  return (
    <>
      {environment}
      <ambientLight intensity={0.25} color="#b9a8ff" />
      <spotLight position={[0, 3.2, 0]} angle={0.62} penumbra={0.8} intensity={30} distance={6} color="#fff1dc" />

      <TableMesh railMats={railMats} />

      {Array.from({ length: NUM_BALLS }, (_, b) => (
        <group key={b}>
          <mesh ref={(m) => { balls.current[b] = m; }} geometry={ballGeo} material={ballMats[b]} position={[0, R, 0]} />
          <mesh ref={(m) => { shadows.current[b] = m; }} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[R * 3.2, R * 3.2]} />
            <meshBasicMaterial map={shadowTex} color="#000" transparent opacity={0.55} depthWrite={false} />
          </mesh>
        </group>
      ))}

      {POCKETS.map(([x, z], i) => (
        <mesh key={i} ref={(m) => { pocketRings.current[i] = m; }} position={[x, RAIL_TOP + 0.002, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[POCKET_R[i], POCKET_R[i] + 0.012, 40]} />
          <meshBasicMaterial color={new THREE.Color(3, 0.6, 2.6)} transparent opacity={0} toneMapped={false} depthWrite={false} />
        </mesh>
      ))}

      {/* Guide */}
      <Line ref={lineAim} points={[[0, R, 0], [0, R, 1]]} color={lineCol} lineWidth={2} dashed dashSize={0.03} gapSize={0.02} transparent opacity={0.85} />
      <Line ref={lineObj} points={[[0, R, 0], [0, R, 1]]} color={new THREE.Color(1.6, 2.2, 2.4)} lineWidth={2.5} transparent opacity={0.9} />
      <Line ref={lineCue} points={[[0, R, 0], [0, R, 1]]} color={new THREE.Color(2.2, 1.2, 2.2)} lineWidth={1.5} transparent opacity={0.7} />
      <mesh ref={ghost} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[R * 0.9, R, 40]} />
        <meshBasicMaterial color="#fff" transparent opacity={0.9} toneMapped={false} />
      </mesh>
      <mesh ref={handRing} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[R * 1.35, R * 1.6, 40]} />
        <meshBasicMaterial color={new THREE.Color(0.8, 2.4, 2.6)} transparent opacity={0.9} toneMapped={false} />
      </mesh>

      {/* Cue stick: origin at the tip, extending back along −Z of its local frame */}
      <group ref={cueStick} visible={false}>
        <mesh position={[0, 0, -0.72]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.0065, 0.015, 1.44, 16]} />
          <meshPhysicalMaterial color="#d9b98a" roughness={0.35} clearcoat={1} />
        </mesh>
        <mesh position={[0, 0, -0.006]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.0066, 0.0066, 0.012, 12]} />
          <meshBasicMaterial color={new THREE.Color(0.4, 2.2, 2.6)} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0, -1.2]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.0135, 0.0152, 0.4, 16]} />
          <meshPhysicalMaterial color="#1a0f24" roughness={0.3} clearcoat={1} />
        </mesh>
      </group>

      <EffectComposer multisampling={TOUCH ? 0 : 4}>
        <Bloom ref={bloomRef} mipmapBlur luminanceThreshold={0.9} luminanceSmoothing={0.15} intensity={0.7} radius={0.45} />
        <Vignette offset={0.3} darkness={0.7} />
        <ToneMapping mode={ToneMappingMode.AGX} />
      </EffectComposer>
    </>
  );
}

// Phones: skip MSAA (the biggest GPU-memory cost) and lean on pixel density instead.
const TOUCH = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/** Memoised: HUD state (power, callouts…) must never re-render the 3D tree. */
export const PoolScene = memo(function PoolScene(props: Props & { onContextLost?: () => void }) {
  const { onContextLost, ...rest } = props;
  return (
    <Canvas
      flat
      dpr={TOUCH ? [1, 2] : [1, 1.75]}
      camera={{ fov: 32, near: 0.1, far: 30, position: [0, 6, -1] }}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
      style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); onContextLost?.(); });
      }}
    >
      <Scene {...rest} />
    </Canvas>
  );
});
