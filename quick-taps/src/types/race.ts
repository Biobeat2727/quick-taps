/**
 * A recorded marble race: flat Float32Array of all marble positions for every
 * physics frame, plus the finish order.
 *
 * Layout: frames[f * numMarbles * 3 + i * 3 + c] = component c (0=x,1=y,2=z)
 *         of marble i at frame f.
 *
 * Frame 0 is the initial (pre-impulse) position so marbles can be shown
 * at rest during the countdown.
 */
export interface RaceRecording {
  numMarbles: number;
  numFrames: number;
  /** Float32Array encoded as base64 — decoded by the client before use. */
  framesBase64: string;
  /** Player IDs in finish order (1st place first). */
  ranking: string[];
}

/** Client-side decoded form (frames is the live Float32Array). */
export interface DecodedRecording {
  numMarbles: number;
  numFrames: number;
  frames: Float32Array;
  ranking: string[];
}
