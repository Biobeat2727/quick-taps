export interface ThrowParams {
  startX: number;      // ball starting X position, clamped to ±0.45
  direction: number;   // radians, 0=straight, +right/-left, range ±(π/6)
  power: number;       // 0–1 → maps to speed 2–8 m/s
  spin: number;        // -1 to +1 → angular velocity on Y
  pinState: boolean[]; // [10] true=standing — for 2nd throw
}

export interface BowlingRawRecording {
  numFrames: number;
  ballFramesBase64: string; // Float32Array → base64
  pinFramesBase64: string;  // Float32Array → base64
  knockedPins: boolean[];
}

export interface BowlingDecodedRecording {
  numFrames: number;
  ballFrames: Float32Array;  // numFrames × 3
  pinFrames: Float32Array;   // numFrames × 70 (10 pins × 7 components)
  knockedPins: boolean[];
}
