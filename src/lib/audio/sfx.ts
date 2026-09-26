// Procedural sound effects — everything is synthesized with WebAudio, so there
// are no audio files to license or download, and sounds scale with the physics
// (a harder hit is louder and brighter).
//
// Phones only allow audio after a user gesture: the context is created (or
// resumed) on the first tap anywhere. Until then every call is a silent no-op.
// Mute is per phone (localStorage) and applies instantly via the master gain.

const MUTE_KEY = 'qt:muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;
const muteListeners = new Set<(m: boolean) => void>();

if (typeof window !== 'undefined') {
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* private mode */ }
  const unlock = () => {
    const a = ensure();
    if (a && a.state !== 'running') void a.resume();
  };
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true });
}

function ensure(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    // Gentle limiter so a 15-ball break can't clip
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.15;
    master.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return ctx;
}

/** A running context, or null (not unlocked yet / muted / unsupported). */
function live(): AudioContext | null {
  if (muted || !ctx || ctx.state !== 'running') return null;
  return ctx;
}

// ── Mute ─────────────────────────────────────────────────────────────────────

export function isMuted() { return muted; }
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* ignore */ }
  if (ctx && master) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.02);
  muteListeners.forEach((l) => l(m));
}
export function onMuteChange(l: (m: boolean) => void) {
  muteListeners.add(l);
  return () => { muteListeners.delete(l); };
}

// ── Building blocks ──────────────────────────────────────────────────────────

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  glideTo?: number;   // frequency at the end of dur
  delay?: number;
  pan?: number;
}

function tone(freq: number, dur: number, o: ToneOpts = {}) {
  const a = live();
  if (!a || !master) return;
  const t = a.currentTime + (o.delay ?? 0);
  const osc = a.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.glideTo), t + dur);
  const g = a.createGain();
  const peak = o.gain ?? 0.3;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + (o.attack ?? 0.004));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  route(a, g, o.pan);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

interface NoiseOpts {
  filter?: BiquadFilterType;
  freq?: number;
  q?: number;
  gain?: number;
  attack?: number;
  sweepTo?: number;   // filter frequency at the end
  delay?: number;
  pan?: number;
}

function noise(dur: number, o: NoiseOpts = {}) {
  const a = live();
  if (!a || !master || !noiseBuf) return;
  const t = a.currentTime + (o.delay ?? 0);
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = a.createBiquadFilter();
  f.type = o.filter ?? 'bandpass';
  f.frequency.setValueAtTime(o.freq ?? 1500, t);
  if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + dur);
  f.Q.value = o.q ?? 1;
  const g = a.createGain();
  const peak = o.gain ?? 0.3;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + (o.attack ?? 0.002));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g);
  route(a, g, o.pan);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

function route(a: AudioContext, node: AudioNode, pan?: number) {
  if (pan && a.createStereoPanner) {
    const p = a.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p).connect(master!);
  } else {
    node.connect(master!);
  }
}

/** Drop sounds that would stack into mush (a break fires dozens of clacks). */
function limiter(perSecond: number) {
  let tokens = perSecond, last = 0;
  return () => {
    const now = performance.now();
    tokens = Math.min(perSecond, tokens + ((now - last) / 1000) * perSecond);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** A looping, continuously adjustable rolling rumble (bowling ball, marble). */
export interface Rumble { set(level: number, pitch?: number): void; stop(fade?: number): void }

export function rumble(opts: { freq?: number; q?: number } = {}): Rumble {
  const a = live();
  if (!a || !master || !noiseBuf) return { set() {}, stop() {} };
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = opts.freq ?? 320;
  f.Q.value = opts.q ?? 4;
  const g = a.createGain();
  g.gain.value = 0.0001;
  src.connect(f).connect(g).connect(master);
  src.start();
  let stopped = false;
  return {
    set(level, pitch = 1) {
      if (stopped) return;
      g.gain.setTargetAtTime(Math.max(0.0001, level), a.currentTime, 0.05);
      f.frequency.setTargetAtTime((opts.freq ?? 320) * pitch, a.currentTime, 0.08);
    },
    stop(fade = 0.25) {
      if (stopped) return;
      stopped = true;
      g.gain.setTargetAtTime(0.0001, a.currentTime, fade / 3);
      src.stop(a.currentTime + fade + 0.1);
    },
  };
}

// ── Pool ─────────────────────────────────────────────────────────────────────

const clackOk = limiter(28);

export const poolSfx = {
  /** Cue tip meets the cue ball. power 0..1 */
  cue(power: number) {
    const p = Math.max(0.15, Math.min(1, power));
    tone(rnd(620, 700), 0.05, { gain: 0.25 * p + 0.08, glideTo: 260 });
    noise(0.025, { freq: 2600, q: 2, gain: 0.25 * p });
  },
  /** Ball–ball collision; speed in m/s. */
  clack(speed: number, pan = 0) {
    if (!clackOk()) return;
    const v = Math.min(1, speed / 4);
    const g = 0.08 + 0.45 * Math.pow(v, 0.8);
    tone(rnd(1750, 2150) * (0.9 + 0.2 * v), 0.035, { gain: g, pan });
    noise(0.014, { freq: 4200, q: 3, gain: g * 0.7, pan });
  },
  rail(speed: number, pan = 0) {
    const v = Math.min(1, speed / 3);
    tone(150, 0.1, { gain: 0.1 + 0.3 * v, glideTo: 85, pan });
    noise(0.05, { filter: 'lowpass', freq: 500, gain: 0.08 + 0.2 * v, pan });
  },
  pocket(isCue: boolean) {
    // Leather-and-wood drop, then the ball rattling down the return
    tone(isCue ? 150 : 190, 0.14, { gain: 0.35, glideTo: 95 });
    noise(0.08, { filter: 'lowpass', freq: 700, gain: 0.3 });
    for (let i = 0; i < 3; i++) noise(0.03, { freq: rnd(800, 1300), q: 6, gain: 0.12 - i * 0.03, delay: 0.12 + i * rnd(0.06, 0.09) });
  },
};

// ── Bowling ──────────────────────────────────────────────────────────────────

const pinHitOk = limiter(40);

export const bowlSfx = {
  /** The ball's roll down the lane; call set() as it travels, stop() at the pins. */
  roll(speed: number): Rumble {
    const r = rumble({ freq: 180, q: 6 });
    r.set(0.08 + Math.min(0.25, speed * 0.025), 0.9 + speed * 0.04);
    return r;
  },
  /**
   * One real collision from the sim. kind: 0 ball→pin, 1 pin→pin, 2 pin→deck,
   * 3 pin→kickback/gutter, 4 into the pit. strength 0..1, pan −1..1.
   */
  hit(kind: 0 | 1 | 2 | 3 | 4, strength: number, pan: number) {
    if (!pinHitOk()) return;
    const s = Math.max(0.05, Math.min(1, strength));
    const g = 0.12 + s * 0.7;
    switch (kind) {
      case 0: // ball into pins: heavy body + hard crack
        tone(rnd(85, 105), 0.28, { gain: g * 0.9, glideTo: 50, pan });
        tone(rnd(420, 520), 0.07, { gain: g * 0.5, type: 'triangle', pan });
        noise(0.06, { freq: 2200, q: 1.2, gain: g * 0.8, pan });
        break;
      case 1: // pin on pin: bright maple clack
        tone(rnd(650, 1150), rnd(0.04, 0.07), { gain: g * 0.55, type: 'triangle', pan });
        noise(rnd(0.015, 0.03), { freq: rnd(2600, 3800), q: 3, gain: g * 0.7, pan });
        break;
      case 2: // pin hits the deck
        tone(rnd(170, 230), 0.1, { gain: g * 0.5, glideTo: 110, pan });
        noise(0.04, { filter: 'lowpass', freq: 900, gain: g * 0.5, pan });
        break;
      case 3: // pin off the kickback / into the gutter: hollow knock
        tone(rnd(260, 340), 0.12, { gain: g * 0.55, type: 'triangle', pan });
        noise(0.05, { freq: 900, q: 2, gain: g * 0.55, pan });
        break;
      case 4: // into the pit, behind the masking: muffled
        tone(rnd(100, 140), 0.14, { gain: g * 0.25, glideTo: 70, pan: pan * 0.5 });
        noise(0.06, { filter: 'lowpass', freq: 400, gain: g * 0.2, pan: pan * 0.5 });
        break;
    }
  },
  gutter() {
    tone(160, 0.25, { gain: 0.2, glideTo: 70, type: 'triangle' });
  },
  strike() { arcade([523, 659, 784, 1047, 1319], 0.07, 0.16); },
  spare() { arcade([659, 988, 1319], 0.08, 0.14); },
  miss() { arcade([392, 294], 0.14, 0.1, 'triangle'); },
};

/** Neon-arcade jingle: quick square/saw arpeggio. */
function arcade(notes: number[], step: number, gain: number, type: OscillatorType = 'square') {
  notes.forEach((f, i) => {
    tone(f, step * 2.2, { type, gain, delay: i * step, attack: 0.005 });
    tone(f * 2, step * 1.6, { type: 'sine', gain: gain * 0.4, delay: i * step });
  });
}

// ── Marble race ──────────────────────────────────────────────────────────────

const marbleClackOk = limiter(18);
const popOk = limiter(10);

export const marbleSfx = {
  countdown(final: boolean) {
    tone(final ? 880 : 523, final ? 0.45 : 0.18, { type: 'square', gain: 0.14 });
    tone(final ? 1760 : 1046, final ? 0.3 : 0.12, { gain: 0.08 });
  },
  gate() {
    noise(0.35, { freq: 500, sweepTo: 3000, q: 1.5, gain: 0.22 });
    tone(220, 0.25, { gain: 0.15, glideTo: 110, type: 'triangle' });
  },
  clack(strength: number, pan = 0) {
    if (!marbleClackOk()) return;
    const g = 0.05 + 0.25 * Math.min(1, strength);
    tone(rnd(2400, 3200), 0.03, { gain: g, pan });
    noise(0.01, { freq: 5000, q: 2, gain: g * 0.6, pan });
  },
  pop(pan = 0) {
    if (!popOk()) return;
    tone(rnd(480, 560), 0.12, { gain: 0.28, glideTo: 240, pan });
    noise(0.03, { freq: 2000, q: 2, gain: 0.15, pan });
  },
  punch(pan = 0) {
    tone(95, 0.16, { gain: 0.4, glideTo: 55, pan });
    noise(0.07, { freq: 900, q: 1.2, gain: 0.3, pan });
  },
  whoosh() {
    noise(0.55, { freq: 400, sweepTo: 2400, q: 2, gain: 0.18, attack: 0.08 });
  },
  zone() {
    tone(784, 0.12, { type: 'triangle', gain: 0.08 });
    tone(1175, 0.18, { type: 'triangle', gain: 0.08, delay: 0.09 });
  },
  finish(winner: boolean) {
    if (winner) arcade([523, 659, 784, 1047, 784, 1047], 0.09, 0.14);
    else {
      tone(1318, 0.9, { gain: 0.18 });
      tone(1975, 0.7, { gain: 0.09, delay: 0.01 });
    }
  },
  roll(): Rumble { return rumble({ freq: 260, q: 3 }); },
};
