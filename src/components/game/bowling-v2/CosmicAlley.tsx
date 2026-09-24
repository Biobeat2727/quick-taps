'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { MeshReflectorMaterial } from '@react-three/drei';
import * as THREE from 'three';
import type { Fx } from './BowlScene';
import { LANE_HALF_WIDTH, PIN_POSITIONS } from '@/lib/bowling/bowling-constants';
import { makeLaneTextures, makeMaskTexture, LANE_END } from './textures';
import { pinGeometry, pinMaterials } from './assets';

const LANE_LEN = LANE_END;
const LANE_MID = LANE_LEN / 2;
const GUTTER_R = 0.125;
const GUTTER_X = LANE_HALF_WIDTH + GUTTER_R;

// ── LED chase strip shader ─────────────────────────────────────────────────
// Dashes run toward the pins. `uBoost` is driven by the scene director
// (rolling ball → faster chase, strike → rainbow flood).

const chaseVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const chaseFrag = /* glsl */ `
  uniform float uTime; uniform float uSpeed; uniform float uCount;
  uniform vec3 uColorA; uniform vec3 uColorB; uniform float uBoost; uniform float uRainbow;
  varying vec2 vUv;
  vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
  void main() {
    float p = fract(vUv.y * uCount - uTime * uSpeed);
    float dash = smoothstep(0.0, 0.08, p) * (1.0 - smoothstep(0.35, 0.6, p));
    vec3 base = mix(uColorA, uColorB, vUv.y);
    base = mix(base, hue(fract(vUv.y * 2.0 - uTime * 0.6)), uRainbow);
    float glow = 0.25 + dash * (1.2 + uBoost * 2.5);
    gl_FragColor = vec4(base * glow, 1.0);
  }
`;

export type ChaseUniforms = {
  uTime: { value: number }; uSpeed: { value: number }; uBoost: { value: number }; uRainbow: { value: number };
};

export function useChaseMaterial(a: string, b: string, count: number): [THREE.ShaderMaterial, ChaseUniforms] {
  return useMemo(() => {
    const uniforms = {
      uTime: { value: 0 }, uSpeed: { value: 0.35 }, uCount: { value: count },
      uColorA: { value: new THREE.Color(a) }, uColorB: { value: new THREE.Color(b) },
      uBoost: { value: 0 }, uRainbow: { value: 0 },
    };
    const m = new THREE.ShaderMaterial({ uniforms, vertexShader: chaseVert, fragmentShader: chaseFrag, toneMapped: false });
    return [m, uniforms];
  }, [a, b, count]);
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function neon(color: string, intensity = 3) {
  const c = new THREE.Color(color).multiplyScalar(intensity);
  return <meshBasicMaterial color={c} toneMapped={false} />;
}

function MainLane({ tier }: { tier: number }) {
  const { map, emissiveMap } = useMemo(() => makeLaneTextures(), []);
  useEffect(() => () => { map.dispose(); emissiveMap.dispose(); }, [map, emissiveMap]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, LANE_MID]}>
      <planeGeometry args={[LANE_HALF_WIDTH * 2, LANE_LEN]} />
      {tier === 0 ? (
        <meshStandardMaterial map={map} emissiveMap={emissiveMap} emissive="#ffffff" emissiveIntensity={2.2} roughness={0.35} />
      ) : <MeshReflectorMaterial
        map={map}
        emissiveMap={emissiveMap}
        emissive="#ffffff"
        emissiveIntensity={2.2}
        roughness={0.35}
        metalness={0.1}
        blur={[180, 40]}
        mixBlur={0.9}
        mixStrength={3.2}
        mixContrast={1.1}
        resolution={tier >= 2 ? 512 : 256}
        mirror={0.85}
        depthScale={0.6}
        minDepthThreshold={0.4}
        maxDepthThreshold={1.2}
        reflectorOffset={0.001}
      />}
    </mesh>
  );
}

/** Half-pipe gutter with an LED chase strip running along its floor. */
function Gutter({ side, chase }: { side: -1 | 1; chase: THREE.ShaderMaterial }) {
  return (
    <group position={[side * GUTTER_X, -GUTTER_R, LANE_MID]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[GUTTER_R, GUTTER_R, LANE_LEN, 24, 1, true, -Math.PI / 2, Math.PI]} />
        <meshStandardMaterial color="#1a1426" metalness={0.8} roughness={0.35} side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, -GUTTER_R + 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]} material={chase}>
        <planeGeometry args={[0.03, LANE_LEN]} />
      </mesh>
    </group>
  );
}

/** Ball-return capping between lanes, with a neon edge line. */
function Capping({ x, chase }: { x: number; chase: THREE.ShaderMaterial }) {
  return (
    <group position={[x, 0, LANE_MID]}>
      <mesh position={[0, 0.03, 0]}>
        <boxGeometry args={[0.24, 0.1, LANE_LEN]} />
        <meshStandardMaterial color="#120d1d" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.082, 0]} rotation={[-Math.PI / 2, 0, 0]} material={chase}>
        <planeGeometry args={[0.02, LANE_LEN]} />
      </mesh>
    </group>
  );
}

/** Neighbouring lanes — cheap (no reflector), for depth and life at the edges of frame. */
function SideLane({ x }: { x: number }) {
  const geo = pinGeometry();
  const mats = pinMaterials();
  return (
    <group position={[x, 0, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, LANE_MID]}>
        <planeGeometry args={[LANE_HALF_WIDTH * 2 + 0.5, LANE_LEN]} />
        <meshStandardMaterial color="#0d0812" roughness={0.55} metalness={0} envMapIntensity={0.25} />
      </mesh>
      {PIN_POSITIONS.map(([px, py, pz], i) => (
        <mesh key={i} geometry={geo} material={mats.body} position={[px, py, pz]} />
      ))}
    </group>
  );
}

/** Cross-lane blacklight bars — these are what streak down the glossy lane. */
function LightBars() {
  const bars = useMemo(() => {
    const cols = ['#b44bff', '#3ff2ff', '#ff3fd0'];
    return Array.from({ length: 8 }, (_, i) => ({ z: 1.5 + i * 2.4, color: cols[i % 3] }));
  }, []);
  return (
    <>
      {bars.map(({ z, color }, i) => (
        <mesh key={i} position={[0, 2.7, z]}>
          <boxGeometry args={[5.5, 0.03, 0.05]} />
          {neon(color, 2.4)}
        </mesh>
      ))}
    </>
  );
}

function PinDeck() {
  const mask = useMemo(() => makeMaskTexture(), []);
  const target = useMemo(() => { const o = new THREE.Object3D(); o.position.set(0, 0.2, 18); return o; }, []);
  useEffect(() => () => mask.dispose(), [mask]);
  return (
    <group>
      {/* Deck — slightly lighter, lit by the UV flood */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 17.9]}>
        <planeGeometry args={[LANE_HALF_WIDTH * 2, 1.2]} />
        <meshStandardMaterial color="#2b1d3a" roughness={0.5} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
      {/* Pit — black void behind the deck, with a violet glow wall */}
      <mesh position={[0, 0.6, 21.25]}>
        <planeGeometry args={[6, 3]} />
        <meshBasicMaterial color="#07030d" />
      </mesh>
      <mesh position={[0, 0.25, 21.2]}>
        <planeGeometry args={[1.8, 0.5]} />
        {neon('#5a1aa8', 0.9)}
      </mesh>
      {/* Masking unit */}
      <mesh position={[0, 1.4, 18.9]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[3.2, 0.8]} />
        <meshBasicMaterial map={mask} toneMapped={false} color={new THREE.Color(0.95, 0.95, 0.95)} />
      </mesh>
      <mesh position={[0, 0.97, 18.9]}>
        <boxGeometry args={[3.2, 0.03, 0.05]} />
        {neon('#ff3fd0', 3)}
      </mesh>
      {/* UV flood on the pins */}
      <spotLight
        position={[0, 1.8, 16.2]}
        target={target}
        angle={0.6}
        penumbra={0.7}
        intensity={14}
        distance={6}
        color="#c9b3ff"
      />
      <primitive object={target} />
      <pointLight position={[0, 0.5, 19.4]} intensity={3} distance={3} color="#ff3fd0" />
    </group>
  );
}

// ── Dust ───────────────────────────────────────────────────────────────────
// Slow-drifting motes in the pin-deck light. Replaces drei <Sparkles>, whose
// per-particle twinkle flickered hard on phones (low-precision shader math,
// and its bright points tripped bloom every frame). Here: highp, gentle
// shimmer, brightness kept under the bloom threshold.

const dustVert = /* glsl */ `
  precision highp float;
  uniform float uTime; uniform float uPx;
  attribute float aSeed;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    float t = uTime * 0.12 + aSeed * 6.2831;
    p.x += sin(t) * 0.15;
    p.y += sin(t * 0.7 + aSeed * 3.0) * 0.12;
    p.z += cos(t * 0.5) * 0.2;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(uPx * (1.0 + aSeed) * 30.0 / -mv.z, 18.0);
    vAlpha = 0.35 + 0.25 * sin(uTime * 0.6 + aSeed * 12.0);
  }
`;
const dustFrag = /* glsl */ `
  precision highp float;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vAlpha;
    gl_FragColor = vec4(vec3(0.62, 0.55, 0.85) * a, a);
  }
`;

function Dust() {
  const [geo, mat] = useMemo(() => {
    const N = 70;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    let s = 11;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (r() - 0.5) * 3;
      pos[i * 3 + 1] = 0.2 + r() * 1.6;
      pos[i * 3 + 2] = 13 + r() * 6;
      seed[i] = r();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPx: { value: 1 } },
      vertexShader: dustVert, fragmentShader: dustFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    return [g, m] as const;
  }, []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useFrame((state) => {
    mat.uniforms.uTime.value = state.clock.elapsedTime % 1000;
    mat.uniforms.uPx.value = state.viewport.dpr;
  });
  return <points geometry={geo} material={mat} frustumCulled={false} />;
}

function Approach() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, -2.5]}>
        <planeGeometry args={[6, 5]} />
        <meshStandardMaterial color="#140e1c" roughness={0.6} />
      </mesh>
      {[-0.4, -0.2, 0, 0.2, 0.4].map((x) =>
        [-1.2, -3.6].map((z) => (
          <mesh key={`${x}${z}`} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.003, z]}>
            <circleGeometry args={[0.018, 16]} />
            {neon('#9bf6ff', 2)}
          </mesh>
        )),
      )}
    </group>
  );
}

export function CosmicAlley({ chaseRef, tier, fx }: { chaseRef: React.MutableRefObject<ChaseUniforms[]>; tier: number; fx: Fx }) {
  const [gutterMat, gutterU] = useChaseMaterial('#3ff2ff', '#b44bff', 70);
  const [capMat, capU] = useChaseMaterial('#ff3fd0', '#ffb424', 40);
  chaseRef.current = [gutterU, capU];

  const t = useRef(0);
  useFrame((_, dt) => {
    t.current += dt;
    gutterU.uTime.value = t.current;
    capU.uTime.value = t.current;
  });

  const capX = GUTTER_X + GUTTER_R + 0.12;
  return (
    <group>
      <color attach="background" args={['#07040c']} />
      <fogExp2 attach="fog" args={['#0b0614', 0.045]} />
      <hemisphereLight args={['#6b4bff', '#12051f', 0.35]} />
      <directionalLight position={[2, 4, -3]} intensity={0.6} color="#d8ccff" />

      <MainLane tier={fx.refl ? tier : 0} />
      <Gutter side={-1} chase={gutterMat} />
      <Gutter side={1} chase={gutterMat} />
      <Capping x={-capX} chase={capMat} />
      <Capping x={capX} chase={capMat} />
      <SideLane x={-(capX * 2)} />
      <SideLane x={capX * 2} />
      <LightBars />
      <PinDeck />
      <Approach />
      {fx.sparkle && <Dust />}
    </group>
  );
}
