/**
 * A recorded marble race as stored in Redis and served to clients.
 * Produced by lib/marble/race-sim-core on the server; every client replays it.
 *
 * frames (base64 Float32Array): frames[(f * numMarbles + i) * 4 + c] with
 * c = 0,1,2 → x,y,z and c = 3 → course progress, recorded at REC_HZ.
 * Frame 0 is the grid behind the start gate.
 */
export interface RaceRecording {
  /** Map id — see lib/marble/maps. */
  map: string;
  /** The field, in marble-index order (players + NPC fill). */
  marbles: { id: string; name: string; color: string }[];
  numMarbles: number;
  numFrames: number;
  framesBase64: string;
  /** Recorded frame each marble crossed the line (null = did not finish). */
  finishFrame: (number | null)[];
  /** Marble indices in finish order. */
  ranking: number[];
}

/** ARCHIVED: recording format of the original 3D map (Classic Funnel). */
export interface ClassicRecording {
  numMarbles: number;
  numFrames: number;
  /** frames[f * numMarbles * 3 + i * 3 + c], 60 Hz, frame 0 = rest pose. */
  frames: Float32Array;
  /** Player ids in finish order. */
  ranking: string[];
}
