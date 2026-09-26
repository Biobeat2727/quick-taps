'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, Trail } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, Noise, ChromaticAberration, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode, type BloomEffect, type ChromaticAberrationEffect } from 'postprocessing';
import * as THREE from 'three';
import { PIN_POSITIONS, BALL_RADIUS } from '@/lib/bowling/bowling-constants';
import { BALL_STRIDE, PIN_STRIDE, SIM_HZ, type BowlSimResult } from '@/lib/bowling/bowl-sim-core';
import { CosmicAlley, type ChaseUniforms } from './CosmicAlley';
import { pinGeometry, pinMaterials, ballAssets, blobShadowTexture } from './assets';

export type Hype = 'strike' | 'big' | 'normal' | 'gutter';

/** Toggleable effects — exposed in an on-screen panel for diagnosing device issues. */
export const FX_KEYS = ['refl', 'bloom', 'chase', 'grain', 'sparkle', 'env', 'glow', 'aa'] as const;
export type FxKey = typeof FX_KEYS[number];
export type Fx = Record<FxKey, boolean>;
export const FX_LABELS: Record<FxKey, string> = {
  refl: 'Reflection', bloom: 'Bloom', chase: 'Gutter LEDs', grain: 'Grain',
  sparkle: 'Dust', env: 'Env light', glow: 'Ball glow', aa: 'Anti-alias',
};
export const DEFAULT_FX: Fx = { refl: true, bloom: true, chase: true, grain: true, sparkle: true, env: true, glow: true, aa: false };

export interface Playback {
  sim: BowlSimResult;
  endFrame: number;
  hype: Hype;
}

interface SceneProps {
  aimXRef: React.RefObject<number>; // world X of the ball while aiming
  playback: Playback | null;
  pinState: boolean[];
  throwId: number;
  onImpact: () => void;
  onEnd: () => void;
  /** Each recorded collision as playback reaches it (drives the pin sounds). */
  onHit?: (h: BowlSimResult['hits'][number]) => void;
  /** Per frame while the ball is on the lane: its distance down the lane and speed (m/s). */
  onRoll?: (z: number, speed: number) => void;
}

/** Last frame worth watching: pins have had their moment, or the ball is gone. */
export function playbackEndFrame(sim: BowlSimResult): number {
  const last = sim.numFrames - 1;
  if (sim.impactFrame >= 0) return Math.min(last, sim.impactFrame + 140);
  for (let f = 0; f < sim.numFrames; f++) {
    const z = sim.ballFrames[f * BALL_STRIDE + 2];
    const y = sim.ballFrames[f * BALL_STRIDE + 1];
    if (z > 19 || y < -0.4) return Math.min(last, f + 25);
  }
  return last;
}

const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);

// ── Aim guide ──────────────────────────────────────────────────────────────
// A faint dotted beam on the lane ahead of the ball while lining up. Shows
// *where you stand*, not where the ball will end up — hook is still on you.

const GUIDE_LEN = 7;
function createGuide() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime; uniform float uAlpha;
      varying vec2 vUv;
      void main() {
        float along = vUv.y;                        // 0 at the ball, 1 far end
        float dots = step(0.5, fract(along * 22.0 - uTime * 0.8));
        float core = 1.0 - smoothstep(0.15, 0.5, abs(vUv.x - 0.5));
        float fade = (1.0 - along) * smoothstep(0.0, 0.06, along);
        float a = core * fade * (0.35 + 0.65 * dots) * uAlpha;
        gl_FragColor = vec4(vec3(0.6, 0.95, 1.0) * 1.4 * a, a);
      }
    `,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    side: THREE.DoubleSide,
  });
  const geo = new THREE.PlaneGeometry(0.035, GUIDE_LEN);
  geo.rotateX(-Math.PI / 2);          // lie flat; +v now runs toward −Z…
  geo.scale(1, 1, -1);                 // …so flip it to run down-lane (+Z)
  geo.translate(0, 0.005, 0.45 + GUIDE_LEN / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, mat };
}

// ── Impact burst ───────────────────────────────────────────────────────────

const BURST_N = 140;
function useBurst() {
  return useMemo(() => createBurst(), []);
}

function createBurst() {
  {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(BURST_N * 3);
    const col = new Float32Array(BURST_N * 3);
    const vel = new Float32Array(BURST_N * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.035, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0,
    });
    const palette = ['#ff3fd0', '#3ff2ff', '#ffb424', '#ffffff'].map(c => new THREE.Color(c).multiplyScalar(3));
    const fire = (at: THREE.Vector3, power: number) => {
      for (let i = 0; i < BURST_N; i++) {
        pos[i * 3] = at.x; pos[i * 3 + 1] = at.y + 0.1; pos[i * 3 + 2] = at.z;
        const a = Math.random() * Math.PI * 2;
        const up = 0.4 + Math.random() * 1.6;
        const s = (0.6 + Math.random() * 1.8) * power;
        vel[i * 3] = Math.cos(a) * s; vel[i * 3 + 1] = up * power; vel[i * 3 + 2] = Math.sin(a) * s * 0.6 + 0.4;
        const c = palette[i % palette.length];
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      mat.opacity = 1;
    };
    const step = (dt: number) => {
      if (mat.opacity <= 0) return;
      for (let i = 0; i < BURST_N; i++) {
        vel[i * 3 + 1] -= 3.5 * dt;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = Math.max(0, mat.opacity - dt * 0.9);
    };
    return { points: new THREE.Points(geo, mat), fire, step };
  }
}

// ── Director: playback, camera, juice ──────────────────────────────────────

function Director({
  aimXRef, playback, pinState, throwId, onImpact, onEnd, onHit, onRoll, fx,
  ballRef, pinRefs, shadowRef, ballLightRef, chaseRef, bloomRef, caRef, burst, guide,
}: SceneProps & {
  fx: Fx;
  ballRef: React.RefObject<THREE.Mesh | null>;
  pinRefs: React.RefObject<(THREE.Mesh | null)[]>;
  shadowRef: React.RefObject<THREE.Mesh | null>;
  ballLightRef: React.RefObject<THREE.PointLight | null>;
  chaseRef: React.RefObject<ChaseUniforms[]>;
  bloomRef: React.RefObject<BloomEffect | null>;
  caRef: React.RefObject<ChromaticAberrationEffect | null>;
  burst: ReturnType<typeof useBurst>;
  guide: ReturnType<typeof createGuide>;
}) {
  const { camera } = useThree();
  const st = useRef({ t: 0, scale: 1, impactFired: false, ended: false, shake: 0, kick: 0, rainbow: 0, idle: 0, hitIdx: 0 });
  const camPos = useRef(new THREE.Vector3(0, 1.05, -2.1));
  const camLook = useRef(new THREE.Vector3(0, -1.8, 11));
  const tmpA = useMemo(() => new THREE.Quaternion(), []);
  const tmpB = useMemo(() => new THREE.Quaternion(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const onImpactRef = useRef(onImpact);
  const onEndRef = useRef(onEnd);
  const onHitRef = useRef(onHit);
  const onRollRef = useRef(onRoll);
  useEffect(() => { onImpactRef.current = onImpact; onEndRef.current = onEnd; onHitRef.current = onHit; onRollRef.current = onRoll; });

  // New throw → reset the clock
  useEffect(() => {
    Object.assign(st.current, { t: 0, scale: 1, impactFired: false, ended: false, hitIdx: 0 });
    if (!playback) st.current.rainbow = 0;
  }, [playback, throwId]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const s = st.current;
    s.idle += dt;
    const ball = ballRef.current!;
    const pins = pinRefs.current!;
    let ballZ = 0.3, ballX = aimXRef.current ?? 0;

    if (playback) {
      const { sim, endFrame, hype } = playback;
      const imp = sim.impactFrame;
      const slow = hype === 'strike' || hype === 'big';
      const f0 = s.t * SIM_HZ;
      // Bullet-time through the hit on big moments
      const target = slow && imp >= 0 && f0 > imp - 5 && f0 < imp + (hype === 'strike' ? 55 : 35) ? 0.22 : 1;
      s.scale += (target - s.scale) * damp(target < s.scale ? 30 : 4, dt);
      s.t += dt * s.scale;

      const f = Math.min(s.t * SIM_HZ, endFrame);
      const i0 = Math.floor(f), i1 = Math.min(i0 + 1, sim.numFrames - 1), a = f - i0;

      // Sound: collisions as playback reaches them (slow-mo stretches them too),
      // and the roll's speed while the ball is still on the lane
      const hits = sim.hits;
      while (s.hitIdx < hits.length && hits[s.hitIdx][0] <= f) onHitRef.current?.(hits[s.hitIdx++]);
      {
        const zb0 = sim.ballFrames[i0 * BALL_STRIDE + 2], zb1 = sim.ballFrames[i1 * BALL_STRIDE + 2];
        if (i1 > i0 && zb0 < 17.3 && sim.ballFrames[i0 * BALL_STRIDE + 1] > 0.05) onRollRef.current?.(zb0, (zb1 - zb0) * SIM_HZ);
      }

      const b0 = i0 * BALL_STRIDE, b1 = i1 * BALL_STRIDE, bf = sim.ballFrames;
      ball.position.set(
        bf[b0] + (bf[b1] - bf[b0]) * a,
        bf[b0 + 1] + (bf[b1 + 1] - bf[b0 + 1]) * a,
        bf[b0 + 2] + (bf[b1 + 2] - bf[b0 + 2]) * a,
      );
      tmpA.set(bf[b0 + 3], bf[b0 + 4], bf[b0 + 5], bf[b0 + 6]);
      tmpB.set(bf[b1 + 3], bf[b1 + 4], bf[b1 + 5], bf[b1 + 6]);
      ball.quaternion.slerpQuaternions(tmpA, tmpB, a);

      const pf = sim.pinFrames;
      for (let p = 0; p < 10; p++) {
        const m = pins[p];
        if (!m) continue;
        const o0 = (i0 * 10 + p) * PIN_STRIDE, o1 = (i1 * 10 + p) * PIN_STRIDE;
        m.visible = pf[o0 + 1] > -1;
        m.position.set(
          pf[o0] + (pf[o1] - pf[o0]) * a,
          pf[o0 + 1] + (pf[o1 + 1] - pf[o0 + 1]) * a,
          pf[o0 + 2] + (pf[o1 + 2] - pf[o0 + 2]) * a,
        );
        tmpA.set(pf[o0 + 3], pf[o0 + 4], pf[o0 + 5], pf[o0 + 6]);
        tmpB.set(pf[o1 + 3], pf[o1 + 4], pf[o1 + 5], pf[o1 + 6]);
        m.quaternion.slerpQuaternions(tmpA, tmpB, a);
      }

      if (!s.impactFired && imp >= 0 && f >= imp) {
        s.impactFired = true;
        const power = hype === 'strike' ? 1.3 : hype === 'big' ? 1 : 0.6;
        burst.fire(v.set(ball.position.x, 0.15, 17.6), power);
        s.shake = hype === 'strike' ? 0.06 : 0.03;
        s.kick = hype === 'strike' ? 2.5 : 1.2;
        if (hype === 'strike') s.rainbow = 1;
        onImpactRef.current();
      }
      if (!s.ended && f >= endFrame) {
        s.ended = true;
        onEndRef.current();
      }
      ballZ = ball.position.z;
      ballX = ball.position.x;
    } else {
      // Aiming — ball idles at the foul line, pins at rest
      ball.position.set(ballX, BALL_RADIUS, 0.3);
      ball.rotation.set(s.idle * 0.6, 0, 0.3);
      for (let p = 0; p < 10; p++) {
        const m = pins[p];
        if (!m) continue;
        const [px, py, pz] = PIN_POSITIONS[p];
        m.visible = pinState[p];
        m.position.set(px, py, pz);
        m.quaternion.identity();
      }
    }

    // Aim guide — fades in while lining up, out once the ball is released
    guide.mesh.position.x = ball.position.x;
    const gu = guide.mat.uniforms;
    gu.uTime.value = s.idle;
    gu.uAlpha.value += ((playback ? 0 : 1) - gu.uAlpha.value) * damp(playback ? 14 : 3, dt);
    guide.mesh.visible = gu.uAlpha.value > 0.01;

    // Blob shadow + underglow follow the ball (hidden once it drops into the pit)
    const sh = shadowRef.current!;
    sh.position.set(ball.position.x, Math.max(-0.245, Math.min(0.004, ball.position.y - BALL_RADIUS + 0.004)), ball.position.z);
    sh.visible = ball.position.y > -0.3;
    const bl = ballLightRef.current!;
    bl.position.set(ball.position.x, ball.position.y + 0.12, ball.position.z - 0.1);

    // ── Camera ──
    let px: number, py: number, pz: number, lx: number, ly: number, lz: number;
    if (!playback) {
      px = ballX * 0.5; py = 1.05; pz = -2.1;
      lx = ballX * 0.15; ly = -1.8; lz = 11;
    } else if (ballZ < 13.5) {
      const zc = Math.max(0.3, ballZ);
      px = ballX * 0.6; py = 0.95 - Math.min(0.25, zc * 0.02); pz = zc - 2.0;
      lx = ballX * 0.4; ly = -0.9 + Math.min(0.8, zc * 0.06); lz = Math.min(18, zc + 7);
    } else {
      const strike = playback.hype === 'strike' || playback.hype === 'big';
      // Hold on the deck; big hits get a lower, closer angle
      px = strike ? 0.22 : 0; py = strike ? 0.52 : 0.72; pz = strike ? 15.1 : 14.5;
      lx = 0; ly = strike ? 0.12 : 0.02; lz = 18;
    }
    const k = playback ? 5 : 6;
    camPos.current.lerp(v.set(px, py, pz), damp(k, dt));
    camLook.current.lerp(v.set(lx, ly, lz), damp(k, dt));
    camera.position.copy(camPos.current);
    if (s.shake > 0.0005) {
      camera.position.x += (Math.random() - 0.5) * s.shake;
      camera.position.y += (Math.random() - 0.5) * s.shake;
      s.shake *= Math.exp(-6 * dt);
    }
    camera.lookAt(camLook.current);

    // ── Post / neon reactivity ──
    s.kick *= Math.exp(-2.2 * dt);
    if (bloomRef.current) bloomRef.current.intensity = fx.bloom ? 0.9 + s.kick : 0;
    if (caRef.current) {
      const ca = (1 - s.scale) * 0.004 + s.shake * 0.02;
      caRef.current.offset.set(ca, ca * 0.6);
    }
    const rolling = playback && !s.impactFired ? 1 : 0;
    s.rainbow *= playback ? 1 : Math.exp(-2 * dt);
    for (const u of chaseRef.current ?? []) {
      u.uBoost.value += ((rolling ? 1 : 0) + s.kick * 0.4 - u.uBoost.value) * damp(4, dt);
      u.uSpeed.value = fx.chase ? 0.35 + u.uBoost.value * 1.4 : 0;
      u.uRainbow.value = s.rainbow;
    }
    burst.step(dt);
  });

  return null;
}

// ── Scene ──────────────────────────────────────────────────────────────────

function SceneContents({ tier, fx, ...props }: SceneProps & { tier: number; fx: Fx }) {
  const ballRef = useRef<THREE.Mesh>(null);
  const pinRefs = useRef<(THREE.Mesh | null)[]>([]);
  const shadowRef = useRef<THREE.Mesh>(null);
  const ballLightRef = useRef<THREE.PointLight>(null);
  const chaseRef = useRef<ChaseUniforms[]>([]);
  const bloomRef = useRef<BloomEffect>(null);
  const caRef = useRef<ChromaticAberrationEffect>(null);
  const burst = useBurst();
  const guide = useMemo(() => createGuide(), []);
  const pinGeo = pinGeometry();
  const pinMat = pinMaterials().body;
  const ball = ballAssets();
  const shadowTex = blobShadowTexture();
  const trailColor = useMemo(() => new THREE.Color(1.5, 0.35, 1.8), []);
  const caOffset = useMemo(() => new THREE.Vector2(0, 0), []);
  // Built once: re-rendering <Environment> re-bakes its cube map on the GPU.
  const environment = useMemo(() => (
    <Environment resolution={128} frames={1} environmentIntensity={0.55}>
        <Lightformer form="rect" intensity={3} color="#ff3fd0" position={[0, 4, 8]} rotation-x={Math.PI / 2} scale={[6, 1, 1]} />
        <Lightformer form="rect" intensity={2.5} color="#3ff2ff" position={[-4, 1.5, 6]} rotation-y={Math.PI / 2} scale={[8, 1, 1]} />
        <Lightformer form="rect" intensity={2} color="#b44bff" position={[4, 1.5, 6]} rotation-y={-Math.PI / 2} scale={[8, 1, 1]} />
        <Lightformer form="ring" intensity={2} color="#ffb424" position={[0, 2, -4]} scale={1.5} />
      </Environment>
  ), []);

  return (
    <>
      {fx.env && environment}

      <CosmicAlley chaseRef={chaseRef} tier={tier} fx={fx} />

      {PIN_POSITIONS.map(([x, y, z], i) => (
        <mesh key={i} ref={(m) => { pinRefs.current[i] = m; }} geometry={pinGeo} material={pinMat} position={[x, y, z]} />
      ))}

      <group key={props.throwId}>
        <Trail width={props.playback ? 0.3 : 0} length={4} decay={1.2} color={trailColor} attenuation={(t) => t * t}>
          <mesh ref={ballRef} geometry={ball.geo} material={ball.mat} position={[0, BALL_RADIUS, 0.3]} />
        </Trail>
      </group>
      <pointLight ref={ballLightRef} color="#ff5ae0" intensity={fx.glow ? 1.2 : 0} distance={1.4} decay={2} />
      <mesh ref={shadowRef} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.36, 0.36]} />
        <meshBasicMaterial map={shadowTex} transparent depthWrite={false} opacity={0.9} />
      </mesh>
      <primitive object={burst.points} />
      <primitive object={guide.mesh} />

      <Director {...props} fx={fx} ballRef={ballRef} pinRefs={pinRefs} shadowRef={shadowRef} ballLightRef={ballLightRef}
        chaseRef={chaseRef} bloomRef={bloomRef} caRef={caRef} burst={burst} guide={guide} />

      <EffectComposer multisampling={tier >= 2 || fx.aa ? 4 : 0}>
        <Bloom ref={bloomRef} mipmapBlur luminanceThreshold={0.75} luminanceSmoothing={0.2} intensity={fx.bloom ? 0.9 : 0} radius={0.72} />
        <ChromaticAberration ref={caRef} offset={caOffset} radialModulation modulationOffset={0.3} />
        <Vignette offset={0.28} darkness={0.78} />
        <Noise opacity={fx.grain ? 0.02 : 0} />
        <ToneMapping mode={ToneMappingMode.AGX} />
      </EffectComposer>
    </>
  );
}

// Quality tiers — 2: desktop, 1: phone (default on touch), 0: weak phone.
// Picked once at load and never switched mid-game: switching rebuilds the canvas
// and reflector buffers, which flickers and can exhaust mobile GPU memory.
const TIER_DPR = [1, 1.3, 1.75];

function initialTier() {
  if (typeof window === 'undefined') return 1;
  const forced = new URLSearchParams(window.location.search).get('tier');
  if (forced != null) return Math.max(0, Math.min(2, Number(forced)));
  return window.matchMedia('(pointer: coarse)').matches ? 1 : 2;
}

/** Tiny on-screen readout (fps · tier · context-lost) so device issues can be reported. */
function Stats({ tier, out }: { tier: number; out: React.RefObject<HTMLDivElement | null> }) {
  const gl = useThree((s) => s.gl);
  const acc = useRef({ n: 0, t: 0, lost: 0 });
  useEffect(() => {
    const c = gl.domElement;
    const onLost = (e: Event) => { e.preventDefault(); acc.current.lost++; };
    c.addEventListener('webglcontextlost', onLost);
    return () => c.removeEventListener('webglcontextlost', onLost);
  }, [gl]);
  useFrame((_, dt) => {
    const a = acc.current;
    a.n++; a.t += dt;
    if (a.t >= 1 && out.current) {
      out.current.textContent = `${Math.round(a.n / a.t)} fps · T${tier}${a.lost ? ` · GPU LOST ×${a.lost}` : ''}`;
      a.n = 0; a.t = 0;
    }
  });
  return null;
}

export function BowlScene(props: SceneProps) {
  const [tier] = useState(initialTier);
  const [fx, setFx] = useState<Fx>(DEFAULT_FX);
  const [panel, setPanel] = useState(false);
  const statsRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <Canvas
        flat
        dpr={TIER_DPR[tier]}
        camera={{ fov: 48, near: 0.1, far: 60, position: [0, 1.05, -2.1] }}
        gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
        style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
      >
        <SceneContents {...props} tier={tier} fx={fx} />
        <Stats tier={tier} out={statsRef} />
      </Canvas>
      <div className="absolute right-2 z-20 flex flex-col items-end gap-1" style={{ top: 'calc(max(10px, env(safe-area-inset-top)) + 88px)' }}>
        <button
          className="rounded-md px-2 py-1 text-[11px] font-mono"
          style={{ background: 'rgba(12,6,24,0.8)', color: '#c9b3ff', border: '1px solid rgba(180,140,255,0.3)' }}
          onClick={() => setPanel((p) => !p)}
        >
          FX
        </button>
        {panel && FX_KEYS.map((k) => (
          <button
            key={k}
            className="rounded-md px-2 py-1 text-[11px] font-mono"
            style={{
              background: fx[k] ? 'rgba(63,242,255,0.18)' : 'rgba(12,6,24,0.8)',
              color: fx[k] ? '#9bf6ff' : 'rgba(200,180,255,0.4)',
              border: `1px solid ${fx[k] ? 'rgba(63,242,255,0.5)' : 'rgba(180,140,255,0.2)'}`,
            }}
            onClick={() => setFx((f) => ({ ...f, [k]: !f[k] }))}
          >
            {FX_LABELS[k]} {fx[k] ? 'ON' : 'off'}
          </button>
        ))}
      </div>
      <div
        ref={statsRef}
        className="absolute right-2 pointer-events-none text-[10px] font-mono"
        style={{ bottom: 'max(6px, env(safe-area-inset-bottom))', color: 'rgba(200,180,255,0.5)' }}
      />
    </>
  );
}
