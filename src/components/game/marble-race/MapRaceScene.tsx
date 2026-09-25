'use client';

// Streamer-style 3D marble race: a big map, a perspective chase cam, name tags,
// and a live leaderboard. Replays a recording from lib/marble/race-sim-core
// (no physics here). Everything per-frame goes straight to three objects or
// the DOM via refs — the React tree only re-renders on phase changes.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { buildTrack, frameAt, frameQuat, puncherCycle, trackPoint, type BuiltTrack, type MarbleMapDef } from '@/lib/marble/track';
import {
  REC_HZ, REC_STRIDE, MARBLE_R, SPINNER_H, SPINNER_T, SPINNER_Y, BUMPER_H, GLOVE, spinnerPose, puncherPose,
} from '@/lib/marble/race-sim-core';
import { ordinal, CountdownOverlay, ResultsScreen, type Participant } from './marble-race-shared';
import { SoundToggle } from '../SoundToggle';
import { marbleSfx, type Rumble } from '@/lib/audio/sfx';

export interface MapRecording {
  numMarbles: number;
  numFrames: number;
  frames: Float32Array;          // numFrames × numMarbles × REC_STRIDE
  finishFrame: (number | null)[];
  ranking: number[];             // marble indices, winner first
}

interface Props {
  map: MarbleMapDef;
  participants: Participant[];   // index-aligned with the recording
  myPlayerId: string;
  isProjector?: boolean;
  recording: MapRecording;
  onLeave: () => void;
  onRaceAgain: () => void;
  onRaceFinished?: () => void;
  /** Lab only: playback speed multiplier. */
  timeScale?: React.RefObject<number>;
  /** Lab only: start the replay this many seconds in. */
  startAt?: number;
}

type CamMode = 'me' | 'leader';

interface Hud {
  board: (HTMLDivElement | null)[];
  boardTime: (HTMLSpanElement | null)[];
  dots: (HTMLDivElement | null)[];
  rank: HTMLDivElement | null;
  timer: HTMLDivElement | null;
  zone: HTMLDivElement | null;
  flash: HTMLDivElement | null;
  watching: HTMLDivElement | null;
}

const TOUCH = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
const ROW_H = 24;

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}

// Per-frame DOM writes go through these so the React Compiler doesn't treat
// them as prop mutations.
function setText(el: HTMLElement | null | undefined, text: string) {
  if (el && el.textContent !== text) el.textContent = text;
}
function setStyle(el: HTMLElement | null | undefined, key: 'left' | 'transform' | 'color', v: string) {
  if (el) el.style[key] = v;
}

function setFov(cam: THREE.PerspectiveCamera, fov: number) {
  cam.fov = fov;
  cam.updateProjectionMatrix();
}

function glow(hex: string, k: number) {
  return new THREE.Color(hex).multiplyScalar(k);
}

// ── Textures ─────────────────────────────────────────────────────────────────

function marbleTexture(hex: string) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = hex;
  g.fillRect(0, 0, 128, 64);
  // A white swirl and a dark band so the roll reads at a glance
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 7;
  g.beginPath();
  for (let x = 0; x <= 128; x += 4) g.lineTo(x, 32 + Math.sin((x / 128) * Math.PI * 4) * 14);
  g.stroke();
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, 6, 128, 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function tagTexture(name: string, hex: string, mine: boolean) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = mine ? 'rgba(255,180,36,0.92)' : 'rgba(10,8,18,0.7)';
  g.beginPath();
  g.roundRect(4, 8, 248, 48, 24);
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = hex;
  g.stroke();
  g.fillStyle = mine ? '#1a1024' : '#fff';
  g.font = 'bold 30px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(mine ? 'YOU' : name.slice(0, 12), 128, 33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function chevronTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#fff';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(34, 40); g.lineTo(64, 80); g.lineTo(94, 40);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ── Static course ───────────────────────────────────────────────────────────

function Course({ tr }: { tr: BuiltTrack }) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(tr.positions, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(tr.uvs, 2));
    g.setIndex(new THREE.BufferAttribute(tr.indices, 1));
    g.addGroup(0, tr.floorIndexCount, 0);
    g.addGroup(tr.floorIndexCount, tr.indices.length - tr.floorIndexCount, 1);
    g.computeVertexNormals();
    return g;
  }, [tr]);

  const materials = useMemo(() => {
    const chev = chevronTexture();
    return [
      new THREE.MeshStandardMaterial({
        color: '#2a2140', roughness: 0.45, metalness: 0.3, side: THREE.DoubleSide,
        emissive: '#6b4bd6', emissiveMap: chev, emissiveIntensity: 0.35,
      }),
      new THREE.MeshStandardMaterial({
        color: '#8fe6ff', roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.09,
        side: THREE.DoubleSide, depthWrite: false, emissive: '#45e0ff', emissiveIntensity: 0.06,
      }),
    ];
  }, []);

  const rails = useMemo(() => tr.rails.map(({ pts, zone }) => {
    const curve = new THREE.CatmullRomCurve3(pts);
    return {
      geom: new THREE.TubeGeometry(curve, Math.max(2, pts.length), 0.07, 5, false),
      color: glow(tr.zones[zone]?.color ?? '#45e0ff', 2.4),
    };
  }), [tr]);

  // Posts render here; pop-bumpers live in the Director (they flash); thin
  // pegs are instanced — a pachinko board has dozens.
  const bumpers = useMemo(() => tr.bumpers.filter((b) => !b.pop && b.r > 0.3).map((b) => {
    const fr = frameAt(tr, b.s);
    return { pos: trackPoint(fr, b.offset, BUMPER_H), q: frameQuat(fr), r: b.r };
  }), [tr]);

  const pegs = useMemo(() => {
    const list = tr.bumpers.filter((b) => !b.pop && b.r <= 0.3);
    if (!list.length) return null;
    const posts = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, BUMPER_H * 2, 12),
      new THREE.MeshStandardMaterial({ color: '#d8d2ea', metalness: 0.85, roughness: 0.2 }),
      list.length,
    );
    const caps = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 16),
      new THREE.MeshBasicMaterial({ color: glow('#b6ff3b', 2.4), toneMapped: false }),
      list.length,
    );
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), capQ = new THREE.Quaternion();
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    list.forEach((b, i) => {
      const fr = frameAt(tr, b.s);
      q.copy(frameQuat(fr));
      m.compose(trackPoint(fr, b.offset, BUMPER_H), q, new THREE.Vector3(b.r, 1, b.r));
      posts.setMatrixAt(i, m);
      capQ.copy(q).multiply(tilt);
      m.compose(trackPoint(fr, b.offset, BUMPER_H * 2 + 0.01), capQ, new THREE.Vector3(b.r * 0.95, b.r * 0.95, 1));
      caps.setMatrixAt(i, m);
    });
    return { posts, caps };
  }, [tr]);
  useEffect(() => () => {
    if (!pegs) return;
    for (const im of [pegs.posts, pegs.caps]) { im.geometry.dispose(); (im.material as THREE.Material).dispose(); im.dispose(); }
  }, [pegs]);

  const finish = useMemo(() => {
    const fr = frameAt(tr, tr.finishS);
    const c = document.createElement('canvas');
    c.width = 256; c.height = 32;
    const g = c.getContext('2d')!;
    for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) {
      g.fillStyle = (i + j) % 2 ? '#111' : '#f5eddf';
      g.fillRect(i * 16, j * 16, 16, 16);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { fr, q: frameQuat(fr), tex };
  }, [tr]);

  return (
    <>
      <mesh geometry={geom} material={materials} />
      {rails.map((r, i) => (
        <mesh key={i} geometry={r.geom}>
          <meshBasicMaterial color={r.color} toneMapped={false} />
        </mesh>
      ))}
      {pegs && <primitive object={pegs.posts} />}
      {pegs && <primitive object={pegs.caps} />}
      {bumpers.map((b, i) => (
        <group key={i} position={b.pos} quaternion={b.q}>
          <mesh>
            <cylinderGeometry args={[b.r, b.r, BUMPER_H * 2, 20]} />
            <meshStandardMaterial color="#ff3fd0" emissive="#ff3fd0" emissiveIntensity={0.5} metalness={0.3} roughness={0.3} />
          </mesh>
          <mesh position={[0, BUMPER_H - 0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[b.r, 0.07, 8, 24]} />
            <meshBasicMaterial color={glow('#ff3fd0', 2.6)} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {/* Finish line: checker strip on the floor + an arch */}
      <group position={trackPoint(finish.fr, 0, 0.03)} quaternion={finish.q}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[finish.fr.w - 0.4, 1.2]} />
          <meshBasicMaterial map={finish.tex} />
        </mesh>
        {[-1, 1].map((sd) => (
          <mesh key={sd} position={[(sd * finish.fr.w) / 2, 2.2, 0]}>
            <boxGeometry args={[0.25, 4.4, 0.25]} />
            <meshBasicMaterial color={glow('#ffb424', 2.4)} toneMapped={false} />
          </mesh>
        ))}
        <mesh position={[0, 4.4, 0]}>
          <boxGeometry args={[finish.fr.w + 0.25, 0.7, 0.2]} />
          <meshBasicMaterial map={finish.tex} />
        </mesh>
      </group>
      {tr.def.pillars.map((p, i) => (
        <group key={i} position={[p.x, (p.y0 + p.y1) / 2, p.z]}>
          <mesh>
            <cylinderGeometry args={[1.6, 1.6, p.y1 - p.y0, 24]} />
            <meshStandardMaterial color="#1a1430" metalness={0.5} roughness={0.35} />
          </mesh>
          {Array.from({ length: 8 }, (_, k) => (
            <mesh key={k} position={[0, (p.y1 - p.y0) * (k / 8 - 0.45), 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[1.65, 0.06, 6, 32]} />
              <meshBasicMaterial color={glow(p.color, 2.2)} toneMapped={false} />
            </mesh>
          ))}
        </group>
      ))}
    </>
  );
}

function Backdrop({ tr }: { tr: BuiltTrack }) {
  const { centre, stars } = useMemo(() => {
    const box = new THREE.Box3();
    for (const f of tr.frames) box.expandByPoint(f.p);
    const centre = box.getCenter(new THREE.Vector3());
    const pts = new Float32Array(1600 * 3);
    for (let i = 0; i < 1600; i++) {
      const v = new THREE.Vector3().randomDirection();
      v.y = Math.abs(v.y) * 0.9 + 0.05;
      v.normalize().multiplyScalar(420);
      pts.set([v.x + centre.x, v.y + centre.y, v.z + centre.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    return { centre, stars: g };
  }, [tr]);

  return (
    <>
      <points geometry={stars}>
        <pointsMaterial color="#cdbfff" size={1.6} sizeAttenuation={false} fog={false} />
      </points>
      <gridHelper
        args={[900, 90, '#3b2a66', '#241a40']}
        position={[centre.x, tr.def.groundY, centre.z]}
      />
      <mesh position={[centre.x, tr.def.groundY - 0.05, centre.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[900, 900]} />
        <meshBasicMaterial color="#0b0816" />
      </mesh>
    </>
  );
}

// ── Director: replay, spinners, camera, HUD ─────────────────────────────────

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _earV = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function Director({
  tr, recording, participants, myIdx, isProjector, racing, camMode, hud, timeScale, startAt = 0, onAllFinished,
}: {
  tr: BuiltTrack;
  recording: MapRecording;
  participants: Participant[];
  myIdx: number;
  isProjector: boolean;
  racing: React.RefObject<boolean>;
  camMode: React.RefObject<CamMode>;
  hud: React.RefObject<Hud>;
  timeScale?: React.RefObject<number>;
  startAt?: number;
  onAllFinished: () => void;
}) {
  const { camera, scene, size } = useThree();
  const n = recording.numMarbles;

  // Marbles + name tags, built imperatively (no per-frame React)
  const actorsRef = useRef<{ mesh: THREE.Mesh; tag: THREE.Sprite; prev: THREE.Vector3; has: boolean }[]>([]);
  useEffect(() => {
    const actors = participants.map((p, i) => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(MARBLE_R, 28, 18),
        new THREE.MeshStandardMaterial({
          map: marbleTexture(p.color), roughness: 0.18, metalness: 0.15,
          emissive: p.color, emissiveIntensity: i === myIdx ? 0.45 : 0.18,
        }),
      );
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tagTexture(p.name, p.color, i === myIdx), depthTest: false, sizeAttenuation: false,
      }));
      tag.scale.set(i === myIdx ? 0.15 : 0.12, i === myIdx ? 0.0375 : 0.03, 1);
      tag.renderOrder = i === myIdx ? 11 : 10;
      scene.add(mesh, tag);
      return { mesh, tag, prev: new THREE.Vector3(), has: false };
    });
    actorsRef.current = actors;
    return () => {
      for (const a of actors) {
        scene.remove(a.mesh, a.tag);
        a.mesh.geometry.dispose();
        const m = a.mesh.material as THREE.MeshStandardMaterial;
        m.map?.dispose(); m.dispose();
        a.tag.material.map?.dispose(); a.tag.material.dispose();
      }
      actorsRef.current = [];
    };
  }, [participants, myIdx, scene]);

  // Spinners + gate
  const spinRefs = useRef<(THREE.Group | null)[]>([]);
  const gloveRefs = useRef<(THREE.Mesh | null)[]>([]);
  const pistonRefs = useRef<(THREE.Mesh | null)[]>([]);
  const housingRefs = useRef<(THREE.Mesh | null)[]>([]);
  const popRefs = useRef<(THREE.Group | null)[]>([]);
  const pops = useMemo(() => tr.bumpers.filter((b) => b.pop).map((b) => {
    const fr = frameAt(tr, b.s);
    return { b, pos: trackPoint(fr, b.offset, BUMPER_H), q: frameQuat(fr), flash: 0 };
  }), [tr]);
  const punchers = useMemo(() => tr.punchers.map((p) => {
    const fr = frameAt(tr, p.s);
    // Local frame: x = −side, y = floor normal, z = forward (see frameQuat)
    const housingX = -p.side * (fr.w / 2 + 1.7);
    return { p, origin: fr.p.clone(), q: frameQuat(fr), housingX };
  }), [tr]);
  const gateRef = useRef<THREE.Mesh>(null);
  const gate = useMemo(() => {
    const fr = frameAt(tr, tr.gateS);
    return { fr, pos: trackPoint(fr, 0, fr.wall / 2), q: frameQuat(fr) };
  }, [tr]);

  const st = useRef({
    clock: startAt, done: false, lastHud: -1, lastZone: -1, camIdx: -1,
    camPos: new THREE.Vector3(), look: new THREE.Vector3(), camInit: false,
    myFinishedAt: -1, order: [] as number[], shownRank: 0,
    speed: 0, lastV: 0, shake: 0, fov: 60,
    pos: [] as THREE.Vector3[], prog: new Float32Array(0),
    // sound bookkeeping
    punchU: [] as number[], pairD: new Float32Array(0), wasInGap: false, finishSounded: false,
    roll: null as Rumble | null,
  });
  useEffect(() => { const s = st.current; return () => { s.roll?.stop(0.1); s.roll = null; }; }, []);

  /** Stereo position of a world point on screen, or null when too far from the camera to hear. */
  const earshot = (p: THREE.Vector3, range: number): number | null => {
    if (p.distanceTo(camera.position) > range) return null;
    const ndc = _earV.copy(p).project(camera);
    return ndc.z > 1 ? null : Math.max(-0.8, Math.min(0.8, ndc.x));
  };


  useFrame((_, rawDt) => {
    const s = st.current;
    // The race clock uses real elapsed time (a phone that was backgrounded
    // must catch up with everyone else); only smoothing uses the clamped dt.
    const dt = Math.min(rawDt, 0.1);
    if (racing.current && !s.done) s.clock += rawDt * (timeScale?.current ?? 1);

    const last = recording.numFrames - 1;
    const tf = racing.current ? Math.min(last, s.clock * REC_HZ) : 0;
    const f0 = Math.floor(tf), f1 = Math.min(last, f0 + 1), u = tf - f0;
    const F = recording.frames;
    if (s.pos.length !== n) { s.pos = Array.from({ length: n }, () => new THREE.Vector3()); s.prog = new Float32Array(n); }
    const { pos, prog } = s;

    // Marbles
    for (let i = 0; i < n; i++) {
      const a = (f0 * n + i) * REC_STRIDE, b = (f1 * n + i) * REC_STRIDE;
      const jump = Math.hypot(F[b] - F[a], F[b + 1] - F[a + 1], F[b + 2] - F[a + 2]) > 3;
      if (jump) {
        const src = u < 0.5 ? a : b;
        pos[i].set(F[src], F[src + 1], F[src + 2]);
        prog[i] = F[src + 3];
      } else {
        pos[i].set(F[a] + (F[b] - F[a]) * u, F[a + 1] + (F[b + 1] - F[a + 1]) * u, F[a + 2] + (F[b + 2] - F[a + 2]) * u);
        prog[i] = F[a + 3] + (F[b + 3] - F[a + 3]) * u;
      }
      const act = actorsRef.current[i];
      if (!act) continue;
      if (act.has) {
        _v.subVectors(pos[i], act.prev);
        const d = _v.length();
        if (d > 1e-4 && d < 2) {
          _axis.crossVectors(UP, _v).normalize();
          _q.setFromAxisAngle(_axis, d / MARBLE_R);
          act.mesh.quaternion.premultiply(_q);
        }
      }
      act.prev.copy(pos[i]);
      act.has = true;
      act.mesh.position.copy(pos[i]);
      act.tag.position.set(pos[i].x, pos[i].y + 1.05, pos[i].z);
    }

    // Marble-on-marble clacks: a pair that just closed to touching distance
    if (s.pairD.length !== n * n) s.pairD = new Float32Array(n * n).fill(99);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const d = pos[i].distanceTo(pos[j]);
      const prev = s.pairD[i * n + j];
      if (racing.current && d < MARBLE_R * 2 + 0.06 && prev >= MARBLE_R * 2 + 0.06 && prev < 3) {
        const pan = earshot(pos[i], 28);
        if (pan !== null) marbleSfx.clack(Math.min(1, (prev - d) / Math.max(dt, 1e-3) / 10), pan);
      }
      s.pairD[i * n + j] = d;
    }

    // Punchers: glove slides along local x; the piston stretches back to its housing.
    // The glove glows hotter in the last beat before it fires (telegraph).
    punchers.forEach((pc, i) => {
      const glove = gloveRefs.current[i], piston = pistonRefs.current[i];
      if (!glove || !piston) return;
      const { pos: gp } = puncherPose(tr, i, s.clock);
      glove.position.copy(gp).sub(pc.origin).applyQuaternion(_q.copy(pc.q).invert());
      const gx = glove.position.x;
      piston.position.x = (gx + pc.housingX) / 2;
      piston.scale.y = Math.max(0.01, Math.abs(pc.housingX - gx));
      const u = puncherCycle(pc.p, s.clock);
      // The cycle wraps to 0 at the moment the glove fires
      if (racing.current && u < (s.punchU[i] ?? u)) {
        const pan = earshot(gp, 32);
        if (pan !== null) marbleSfx.punch(pan);
      }
      s.punchU[i] = u;
      const heat = u > 0.8 ? (u - 0.8) / 0.2 : u < 0.1 ? 1 : 0;
      (glove.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.35 + heat * 1.6;
      const housing = housingRefs.current[i];
      if (housing) (housing.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.08 + heat * 1.4;
    });

    // Pop-bumpers flash and swell when a marble touches them
    pops.forEach((pb, k) => {
      const g = popRefs.current[k];
      if (!g) return;
      let hit = false;
      for (let i = 0; i < n && !hit; i++) {
        if (pos[i].distanceToSquared(pb.pos) < (pb.b.r + MARBLE_R + 0.15) ** 2 + BUMPER_H ** 2) hit = true;
      }
      if (hit && racing.current && (g.userData.flash ?? 0) < 0.6) {
        const pan = earshot(pb.pos, 40);
        if (pan !== null) marbleSfx.pop(pan);
      }
      const flash = hit && racing.current ? 1 : Math.max(0, (g.userData.flash ?? 0) - dt * 4);
      g.userData.flash = flash;
      g.scale.set(1 + flash * 0.18, 1, 1 + flash * 0.18);
      const body = g.children[0] as THREE.Mesh;
      (body.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5 + flash * 3;
    });

    // Spinners & gate
    tr.spinners.forEach((_, i) => {
      const g = spinRefs.current[i];
      if (g) g.quaternion.copy(spinnerPose(tr, i, s.clock).q);
    });
    if (gateRef.current) {
      const k = racing.current ? Math.min(1, s.clock / 0.35) : 0;
      gateRef.current.position.copy(gate.pos).addScaledVector(gate.fr.n, -k * (gate.fr.wall + 0.6));
      gateRef.current.visible = k < 1;
    }

    // Standings: finished (by finish frame) then by progress
    const ff = recording.finishFrame;
    const done = (i: number) => ff[i] !== null && f0 >= ff[i]!;
    const order = s.order.length === n ? s.order : Array.from({ length: n }, (_, i) => i);
    order.sort((x, y) => {
      const dx = done(x), dy = done(y);
      if (dx && dy) return ff[x]! - ff[y]!;
      if (dx !== dy) return dx ? -1 : 1;
      return prog[y] - prog[x];
    });
    s.order = order;

    // Camera target
    const leader = order.find((i) => !done(i)) ?? order[0];
    if (myIdx >= 0 && done(myIdx) && s.myFinishedAt < 0) s.myFinishedAt = s.clock;
    let target = leader;
    if (!isProjector && myIdx >= 0 && camMode.current === 'me') {
      target = s.myFinishedAt >= 0 && s.clock - s.myFinishedAt > 3 ? leader : myIdx;
    }
    const fr = frameAt(tr, prog[target] + 2);
    const fwd = _v.set(fr.t.x, 0, fr.t.z);
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
    fwd.normalize();
    const portrait = size.width < size.height;
    const dist = isProjector ? 13 : portrait ? 10.5 : 7.5;
    const height = isProjector ? 6.5 : portrait ? 5 : 3.4;
    const want = pos[target].clone().addScaledVector(fwd, -dist).add(new THREE.Vector3(0, height, 0));
    const look = pos[target].clone().addScaledVector(fr.t, 4).add(new THREE.Vector3(0, 0.4, 0));
    // Map camera zones: broadcast-style set pieces
    const cz = tr.cams.find((c) => prog[target] >= c.from && prog[target] <= c.to);
    if (cz?.kind === 'orbit') {
      const rad = new THREE.Vector3(pos[target].x - cz.x, 0, pos[target].z - cz.z).normalize();
      want.set(cz.x + rad.x * cz.r, pos[target].y + 4.5, cz.z + rad.z * cz.r);
      look.copy(pos[target]);
    } else if (cz?.kind === 'fixed') {
      const at = frameAt(tr, cz.at);
      want.copy(at.p).addScaledVector(new THREE.Vector3(at.t.z, 0, -at.t.x).normalize(), cz.side).add(new THREE.Vector3(0, cz.up, 0));
      look.copy(pos[target]);
    }
    if (!s.camInit || s.camPos.distanceTo(want) > 45 || target !== s.camIdx && s.camPos.distanceTo(want) > 25) {
      s.camPos.copy(want); s.look.copy(look); s.camInit = true;
    } else {
      s.camPos.lerp(want, 1 - Math.exp(-dt * 2.6));
      s.look.lerp(look, 1 - Math.exp(-dt * 5));
    }
    s.camIdx = target;

    // Rolling rumble follows the camera's marble; whoosh as it leaves a jump
    if (racing.current && !s.done) {
      s.roll ??= marbleSfx.roll();
      s.roll.set(Math.min(0.14, 0.01 + s.speed * 0.005), 0.6 + Math.min(1.4, s.speed / 20));
    } else if (s.roll && s.done) { s.roll.stop(0.6); s.roll = null; }
    const inGap = tr.gapRanges.some(([a, b]) => prog[target] >= a - 1 && prog[target] < b);
    if (inGap && !s.wasInGap && racing.current) marbleSfx.whoosh();
    s.wasInGap = inGap;

    // Speed feel: FOV opens up with the followed marble's speed; hard velocity
    // changes (landings, wall slams) kick the camera.
    {
      const a = (f0 * n + target) * REC_STRIDE, b = (f1 * n + target) * REC_STRIDE;
      const v = f1 > f0 ? Math.hypot(F[b] - F[a], F[b + 1] - F[a + 1], F[b + 2] - F[a + 2]) * REC_HZ : 0;
      if (v < 80) {
        if (Math.abs(v - s.lastV) > 9 && racing.current) s.shake = Math.min(1, s.shake + Math.abs(v - s.lastV) / 30);
        s.lastV = v;
        s.speed += (v - s.speed) * (1 - Math.exp(-dt * 3));
      }
    }
    s.shake *= Math.exp(-dt * 5);
    const fov = 58 + Math.max(0, Math.min(1, (s.speed - 8) / 22)) * 18;
    if (Math.abs(fov - s.fov) > 0.05) {
      s.fov = fov;
      setFov(camera as THREE.PerspectiveCamera, fov);
    }
    const k = s.shake * 0.3;
    camera.position.set(
      s.camPos.x + (Math.random() - 0.5) * k,
      s.camPos.y + (Math.random() - 0.5) * k,
      s.camPos.z + (Math.random() - 0.5) * k,
    );
    camera.lookAt(s.look);

    // HUD (~8 Hz for text, every frame for dots)
    const h = hud.current;
    const span = tr.finishS - tr.gateS;
    for (let i = 0; i < n; i++) {
      const dot = h.dots[i];
      setStyle(dot, 'left', `${Math.max(0, Math.min(1, (prog[i] - tr.gateS) / span)) * 100}%`);
    }
    if (s.clock - s.lastHud > 0.12 || s.lastHud < 0) {
      s.lastHud = s.clock;
      order.forEach((i, r) => {
        setStyle(h.board[i], 'transform', `translateY(${r * ROW_H}px)`);
        setText(h.boardTime[i], done(i) ? fmtTime(ff[i]! / REC_HZ) : '');
      });
      setText(h.timer, fmtTime(Math.min(s.clock, last / REC_HZ)));
      if (myIdx >= 0 && h.rank) {
        const r = order.indexOf(myIdx) + 1;
        if (r !== s.shownRank) {
          if (s.shownRank && racing.current && typeof h.rank.animate === 'function') {
            const up = r < s.shownRank;
            h.rank.animate(
              [{ color: up ? '#7CFC9B' : '#FF6B6B', transform: 'scale(1.35)' }, { color: '#FFF3D6', transform: 'scale(1)' }],
              { duration: 600, easing: 'ease-out' },
            );
          }
          s.shownRank = r;
          setText(h.rank, ordinal(r));
        }
      }
      setText(h.watching, target === myIdx ? '' : `Watching ${participants[target].name}`);
      // Zone banner when the followed marble enters a new act
      let z = 0;
      tr.zones.forEach((zn, zi) => { if (prog[target] >= zn.s) z = zi; });
      if (z !== s.lastZone) {
        if (s.lastZone >= 0 && h.zone && typeof h.zone.animate === 'function') {
          setText(h.zone, tr.zones[z].name);
          marbleSfx.zone();
          setStyle(h.zone, 'color', tr.zones[z].color);
          h.zone.animate(
            [{ opacity: 0, transform: 'translateY(-8px) scale(0.9)' }, { opacity: 1, transform: 'none', offset: 0.15 },
              { opacity: 1, offset: 0.8 }, { opacity: 0 }],
            { duration: 2200, easing: 'ease-out' },
          );
        }
        s.lastZone = z;
      }
    }

    // Finish sting: my marble crossing (or, with no marble of mine, the winner)
    if (!s.finishSounded && racing.current) {
      if (myIdx >= 0 ? s.myFinishedAt === s.clock : done(order[0])) {
        s.finishSounded = true;
        marbleSfx.finish(myIdx < 0 || order.indexOf(myIdx) === 0);
      }
    }

    // My finish callout
    if (myIdx >= 0 && s.myFinishedAt === s.clock && h.flash && typeof h.flash.animate === 'function') {
      setText(h.flash, `Finished ${ordinal(order.indexOf(myIdx) + 1)}!`);
      h.flash.animate(
        [{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'scale(1.08)', offset: 0.2 },
          { opacity: 1, transform: 'scale(1)', offset: 0.8 }, { opacity: 0 }],
        { duration: 2600, easing: 'ease-out' },
      );
    }

    if (!s.done && racing.current && f0 >= last) {
      s.done = true;
      onAllFinished();
    }
  });

  return (
    <>
      {tr.spinners.map((sp, i) => {
        const { pos: p } = spinnerPose(tr, i, 0);
        return (
          <group key={i} position={p} ref={(el) => { spinRefs.current[i] = el; }}>
            <mesh>
              <boxGeometry args={[sp.arm * 2, SPINNER_H * 2, SPINNER_T * 2]} />
              <meshStandardMaterial color="#ff3fd0" emissive="#ff3fd0" emissiveIntensity={0.55} roughness={0.3} />
            </mesh>
            <mesh>
              <cylinderGeometry args={[0.55, 0.55, SPINNER_H * 2 + 0.2, 20]} />
              <meshStandardMaterial color="#231432" metalness={0.6} roughness={0.3} />
            </mesh>
            <mesh position={[0, -SPINNER_Y + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[sp.arm - 0.08, sp.arm, 48]} />
              <meshBasicMaterial color={glow('#ff3fd0', 1.2)} transparent opacity={0.35} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
      {pops.map((pb, k) => (
        <group key={`pop${k}`} position={pb.pos} quaternion={pb.q} ref={(el) => { popRefs.current[k] = el; }}>
          <mesh>
            <cylinderGeometry args={[pb.b.r, pb.b.r * 1.1, BUMPER_H * 2, 28]} />
            <meshStandardMaterial color="#b6ff3b" emissive="#b6ff3b" emissiveIntensity={0.5} roughness={0.3} />
          </mesh>
          <mesh position={[0, BUMPER_H + 0.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[pb.b.r * 0.75, 0.08, 8, 28]} />
            <meshBasicMaterial color={glow('#ffffff', 2)} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {punchers.map((pc, i) => (
        <group key={`p${i}`} position={pc.origin} quaternion={pc.q}>
          <mesh ref={(el) => { gloveRefs.current[i] = el; }} scale={[GLOVE.hx * 1.15, GLOVE.hy * 1.15, GLOVE.hz * 1.05]}>
            <sphereGeometry args={[1, 24, 16]} />
            <meshStandardMaterial color="#b3121f" emissive="#ff1a2e" emissiveIntensity={0.35} roughness={0.25} metalness={0.1} />
            {/* thumb, riding on top of the fist */}
            <mesh position={[pc.p.side * 0.2, 0.75, 0.45]} scale={[0.45, 0.32, 0.5]}>
              <sphereGeometry args={[1, 16, 12]} />
              <meshStandardMaterial color="#b3121f" roughness={0.25} />
            </mesh>
            {/* white cuff on the wrist side */}
            <mesh position={[-pc.p.side * 0.95, 0, 0]} rotation={[0, 0, Math.PI / 2]} scale={[0.9, 0.55, 0.9]}>
              <cylinderGeometry args={[1, 1, 1, 20]} />
              <meshStandardMaterial color="#f5eddf" roughness={0.5} />
            </mesh>
          </mesh>
          <mesh ref={(el) => { pistonRefs.current[i] = el; }} position={[0, GLOVE.y, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.16, 0.16, 1, 10]} />
            <meshStandardMaterial color="#c9c4d8" metalness={0.9} roughness={0.2} />
          </mesh>
          <mesh ref={(el) => { housingRefs.current[i] = el; }} position={[pc.housingX, GLOVE.y, 0]}>
            <boxGeometry args={[1, 1.5, 2]} />
            <meshStandardMaterial color="#231432" metalness={0.6} roughness={0.35} emissive="#ff1a2e" emissiveIntensity={0.08} />
          </mesh>
        </group>
      ))}
      <mesh ref={gateRef} position={gate.pos} quaternion={gate.q}>
        <boxGeometry args={[gate.fr.w, gate.fr.wall, 0.3]} />
        <meshBasicMaterial color={glow('#ffb424', 2)} toneMapped={false} />
      </mesh>
    </>
  );
}

const Scene3D = memo(function Scene3D(props: React.ComponentProps<typeof Director>) {
  return (
    <Canvas
      flat
      dpr={TOUCH ? [1, 2] : [1, 1.75]}
      camera={{ fov: 60, near: 0.1, far: 1200, position: [0, 110, -20] }}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <color attach="background" args={['#07050d']} />
      <fog attach="fog" args={['#07050d', 70, 320]} />
      <ambientLight intensity={0.45} />
      <hemisphereLight args={['#9b8cff', '#1a0f24', 0.6]} />
      <directionalLight position={[40, 120, -30]} intensity={1.4} />
      <Course tr={props.tr} />
      <Backdrop tr={props.tr} />
      <Director {...props} />
      <EffectComposer multisampling={TOUCH ? 0 : 4}>
        <Bloom mipmapBlur luminanceThreshold={0.9} luminanceSmoothing={0.15} intensity={0.8} radius={0.5} />
        <Vignette offset={0.3} darkness={0.6} />
        <ToneMapping mode={ToneMappingMode.AGX} />
      </EffectComposer>
    </Canvas>
  );
});

// ── Main component ──────────────────────────────────────────────────────────

export default function MapRaceScene({
  map, participants, myPlayerId, isProjector = false, recording,
  onLeave, onRaceAgain, onRaceFinished, timeScale, startAt,
}: Props) {
  const tr = useMemo(() => buildTrack(map), [map]);
  const myIdx = participants.findIndex((p) => p.id === myPlayerId);
  const [phase, setPhase] = useState<'countdown' | 'racing' | 'finished'>('countdown');
  const [countVal, setCountVal] = useState<number | null>(3);
  const racing = useRef(false);
  const camMode = useRef<CamMode>(myIdx >= 0 && !isProjector ? 'me' : 'leader');
  const camBtn = useRef<HTMLButtonElement>(null);
  const hud = useRef<Hud>({
    board: [], boardTime: [], dots: [], rank: null, timer: null, zone: null, flash: null, watching: null,
  });

  useEffect(() => {
    marbleSfx.countdown(false);
    const timers = [
      setTimeout(() => { setCountVal(2); marbleSfx.countdown(false); }, 1000),
      setTimeout(() => { setCountVal(1); marbleSfx.countdown(false); }, 2000),
      setTimeout(() => {
        setCountVal(null); racing.current = true; setPhase('racing');
        marbleSfx.countdown(true); marbleSfx.gate();
      }, 3000),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const handleAllFinished = useCallback(() => {
    // Linger a beat on the finish before the results screen
    setTimeout(() => { setPhase('finished'); onRaceFinished?.(); }, 1500);
  }, [onRaceFinished]);

  const toggleCam = () => {
    camMode.current = camMode.current === 'me' ? 'leader' : 'me';
    if (camBtn.current) camBtn.current.textContent = camMode.current === 'me' ? 'Cam: You' : 'Cam: Leader';
  };

  if (phase === 'finished') {
    return (
      <ResultsScreen
        ranking={recording.ranking.map((i) => participants[i])}
        myPlayerId={myPlayerId}
        onLeave={onLeave}
        onRaceAgain={onRaceAgain}
      />
    );
  }

  const panel: React.CSSProperties = {
    background: 'rgba(10,8,18,0.72)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#07050d', overflow: 'hidden', userSelect: 'none' }}>
      <Scene3D
        tr={tr}
        recording={recording}
        participants={participants}
        myIdx={myIdx}
        isProjector={isProjector}
        racing={racing}
        camMode={camMode}
        hud={hud}
        timeScale={timeScale}
        startAt={startAt}
        onAllFinished={handleAllFinished}
      />

      {phase === 'countdown' && <CountdownOverlay val={countVal} />}

      {/* Live leaderboard */}
      <div style={{ ...panel, position: 'absolute', top: 12, left: 12, width: 'min(168px, 40vw)', padding: '6px 0', zIndex: 10, pointerEvents: 'none' }}>
        <div style={{ position: 'relative', height: participants.length * ROW_H }}>
          {participants.map((p, i) => (
            <div
              key={p.id}
              ref={(el) => { hud.current.board[i] = el; }}
              style={{
                position: 'absolute', left: 0, right: 0, top: 0, height: ROW_H,
                display: 'flex', alignItems: 'center', gap: 7, padding: '0 10px',
                transform: `translateY(${i * ROW_H}px)`, transition: 'transform 0.35s ease',
                background: i === myIdx ? 'rgba(255,180,36,0.18)' : undefined,
                color: i === myIdx ? '#ffd27a' : '#f5eddf', fontSize: 13, fontWeight: 600,
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 5, background: p.color, boxShadow: `0 0 6px ${p.color}`, flex: 'none' }} />
              <span style={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{p.name}</span>
              <span ref={(el) => { hud.current.boardTime[i] = el; }} style={{ fontSize: 11, color: '#9b93b8', fontVariantNumeric: 'tabular-nums' }} />
            </div>
          ))}
        </div>
      </div>

      {/* Position + timer */}
      <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, textAlign: 'right', pointerEvents: 'none' }}>
        {myIdx >= 0 && !isProjector && (
          <div style={{ ...panel, padding: '4px 14px', display: 'inline-block' }}>
            <div ref={(el) => { hud.current.rank = el; }} style={{ color: '#FFF3D6', fontSize: 26, fontFamily: 'var(--font-bungee), system-ui, sans-serif' }}>
              –
            </div>
          </div>
        )}
        <div ref={(el) => { hud.current.timer = el; }} style={{ color: '#cfc6ea', fontSize: 14, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
          0:00.0
        </div>
      </div>

      {/* Zone banner + finish flash */}
      <div
        ref={(el) => { hud.current.zone = el; }}
        style={{
          position: 'absolute', top: '17%', left: 0, right: 0, textAlign: 'center', opacity: 0, zIndex: 10,
          fontFamily: 'var(--font-bungee), system-ui, sans-serif', fontSize: 30, letterSpacing: 2,
          textShadow: '0 0 18px currentColor', pointerEvents: 'none',
        }}
      />
      <div
        ref={(el) => { hud.current.flash = el; }}
        style={{
          position: 'absolute', top: '40%', left: 0, right: 0, textAlign: 'center', opacity: 0, zIndex: 11,
          fontFamily: 'var(--font-bungee), system-ui, sans-serif', fontSize: 38, color: '#ffd27a',
          textShadow: '0 0 22px #ffb424', pointerEvents: 'none',
        }}
      />

      {/* Course progress */}
      <div style={{ position: 'absolute', left: 16, right: 16, bottom: 22, zIndex: 10, pointerEvents: 'none' }}>
        <div ref={(el) => { hud.current.watching = el; }} style={{ color: '#cfc6ea', fontSize: 12, marginBottom: 8, textAlign: 'center' }} />
        <div style={{ position: 'relative', height: 6, borderRadius: 3, display: 'flex', overflow: 'hidden' }}>
          {tr.zones.map((z, i) => {
            const a = Math.max(z.s, tr.gateS), b = Math.min(tr.zones[i + 1]?.s ?? tr.finishS, tr.finishS);
            return <div key={z.name} style={{ flex: Math.max(0, b - a), background: z.color, opacity: 0.45 }} />;
          })}
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 6 }}>
          {participants.map((p, i) => (
            <div
              key={p.id}
              ref={(el) => { hud.current.dots[i] = el; }}
              style={{
                position: 'absolute', top: '50%', left: 0, transform: 'translate(-50%, -50%)',
                width: i === myIdx ? 14 : 9, height: i === myIdx ? 14 : 9, borderRadius: '50%',
                background: p.color, border: i === myIdx ? '2px solid #fff' : '1px solid rgba(0,0,0,0.5)',
                zIndex: i === myIdx ? 2 : 1,
              }}
            />
          ))}
        </div>
      </div>

      {!isProjector && myIdx >= 0 && (
        <button
          ref={camBtn}
          onClick={toggleCam}
          style={{
            ...panel, position: 'absolute', right: 12, bottom: 52, zIndex: 12, padding: '8px 14px',
            color: '#f5eddf', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Cam: You
        </button>
      )}
      <SoundToggle style={{ position: 'absolute', right: 12, bottom: !isProjector && myIdx >= 0 ? 96 : 52, zIndex: 12 }} />
    </div>
  );
}
