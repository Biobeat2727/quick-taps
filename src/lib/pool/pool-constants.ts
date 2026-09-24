export const TABLE_HALF_LENGTH = 1.37;    // Z
export const TABLE_HALF_WIDTH  = 0.686;   // X
export const BALL_RADIUS       = 0.0286;
export const BALL_DIAM         = 0.0572;
export const POCKET_RADIUS     = 0.064;
export const MAX_FRAMES        = 1800;
export const NUM_BALLS         = 16;      // 0=cue, 1–15=object

export const POCKET_POSITIONS: readonly [number, number][] = [
  [-0.686,  1.37],  // 0: far-left corner
  [ 0.686,  1.37],  // 1: far-right corner
  [-0.686,  0   ],  // 2: left-middle side
  [ 0.686,  0   ],  // 3: right-middle side
  [-0.686, -1.37],  // 4: near-left corner
  [ 0.686, -1.37],  // 5: near-right corner
];

export const CUE_BALL_START: [number, number, number] = [0, BALL_RADIUS, -0.686];

// Ball starting positions [x, y, z] — index 0=cue, 1–15=object
export const BALL_START_POSITIONS: readonly [number, number, number][] = [
  CUE_BALL_START, // 0: cue ball
  // Row 0 (apex)
  [0,                        BALL_RADIUS,  0.686],
  // Row 1
  [-BALL_RADIUS,             BALL_RADIUS,  0.686 + 0.0495],
  [ BALL_RADIUS,             BALL_RADIUS,  0.686 + 0.0495],
  // Row 2
  [-BALL_DIAM,               BALL_RADIUS,  0.686 + 0.0990],
  [0,                        BALL_RADIUS,  0.686 + 0.0990],  // 8-ball
  [ BALL_DIAM,               BALL_RADIUS,  0.686 + 0.0990],
  // Row 3
  [-3 * BALL_RADIUS,         BALL_RADIUS,  0.686 + 0.1485],
  [-BALL_RADIUS,             BALL_RADIUS,  0.686 + 0.1485],
  [ BALL_RADIUS,             BALL_RADIUS,  0.686 + 0.1485],
  [ 3 * BALL_RADIUS,         BALL_RADIUS,  0.686 + 0.1485],
  // Row 4
  [-2 * BALL_DIAM,           BALL_RADIUS,  0.686 + 0.1980],
  [-BALL_DIAM,               BALL_RADIUS,  0.686 + 0.1980],
  [0,                        BALL_RADIUS,  0.686 + 0.1980],
  [ BALL_DIAM,               BALL_RADIUS,  0.686 + 0.1980],
  [ 2 * BALL_DIAM,           BALL_RADIUS,  0.686 + 0.1980],
];

// Ball colors for rendering (index matches ball number)
export const BALL_COLORS: readonly string[] = [
  '#FFFFFF',  // 0: cue ball
  '#FFD700',  // 1: solid yellow
  '#0000CC',  // 2: solid blue
  '#CC0000',  // 3: solid red
  '#800080',  // 4: solid purple
  '#FF6600',  // 5: solid orange
  '#006600',  // 6: solid green
  '#800000',  // 7: solid maroon
  '#111111',  // 8: eight-ball black
  '#FFD700',  // 9:  stripe yellow
  '#0000CC',  // 10: stripe blue
  '#CC0000',  // 11: stripe red
  '#800080',  // 12: stripe purple
  '#FF6600',  // 13: stripe orange
  '#006600',  // 14: stripe green
  '#800000',  // 15: stripe maroon
];

// Is ball a solid (1–7), stripe (9–15), or neither?
export function ballGroup(ballIndex: number): 'solid' | 'stripe' | null {
  if (ballIndex >= 1 && ballIndex <= 7) return 'solid';
  if (ballIndex >= 9 && ballIndex <= 15) return 'stripe';
  return null;
}
