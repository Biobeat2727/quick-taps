// No 'use client' directive — safe to import from both server and client.

export const PIN_POSITIONS: readonly [number, number, number][] = [
  [ 0,      0.191, 18.295 ], // 0 — head pin
  [-0.1524, 0.191, 18.031 ], // 1
  [ 0.1524, 0.191, 18.031 ], // 2
  [-0.3048, 0.191, 17.767 ], // 3
  [ 0,      0.191, 17.767 ], // 4
  [ 0.3048, 0.191, 17.767 ], // 5
  [-0.4572, 0.191, 17.503 ], // 6
  [-0.1524, 0.191, 17.503 ], // 7
  [ 0.1524, 0.191, 17.503 ], // 8
  [ 0.4572, 0.191, 17.503 ], // 9
];

export const LANE_HALF_WIDTH = 0.53;
export const LANE_LENGTH = 19.0;
export const BALL_RADIUS = 0.108;
export const PIN_HALF_HEIGHT = 0.191;
export const PIN_RADIUS = 0.06;
