export interface PoolShotParams {
  angle: number;        // radians, 0=toward +Z, positive=clockwise from above
  power: number;        // 0–1 → maps to 1–8 m/s
  cueBallX: number;     // X position of cue ball (for ball-in-hand shots)
  cueBallZ: number;     // Z position of cue ball (for ball-in-hand shots)
  activeBalls: boolean[]; // [16] true = ball still in play before this shot
}

export interface PoolRawRecording {
  numFrames: number;
  numBalls: number;     // always 16
  ballFramesBase64: string;  // Float32Array → base64 (numFrames × 16 × 2)
  pocketedAtFrame: number[]; // length 16, -1 = not pocketed
  cueBallPocketed: boolean;
  finalPocketed: boolean[];  // length 16
}

export interface PoolDecodedRecording {
  numFrames: number;
  ballFrames: Float32Array;   // numFrames × 16 × 2 (X, Z)
  pocketedAtFrame: number[];
  cueBallPocketed: boolean;
  finalPocketed: boolean[];
}

export type PoolGroup = 'solid' | 'stripe' | null;

export interface PoolGameState {
  activePlayerId: string;           // whose turn to shoot
  activeBalls: boolean[];           // [16] still in play
  playerGroups: Record<string, PoolGroup>; // assigned groups per player
  groupAssigned: boolean;           // false until first object ball pocketed
  shotCount: number;                // total shots fired this game
  ballInHand: boolean;              // true if current player has ball-in-hand
  cueBallPos: [number, number];     // [x, z] current cue ball position
  winner: string | null;            // playerId, null until game over
  gameOver: boolean;
}

export interface PoolShotResult {
  finalPocketed: boolean[];
  cueBallPocketed: boolean;
}
