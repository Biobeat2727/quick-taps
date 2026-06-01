// No 'use client' directive — safe to import from both server and client.

export const PIN_POSITIONS: readonly [number, number, number][] = [
  [ 0,      0.191, 17.503 ], // 0 — head pin (closest to bowler)
  [-0.1524, 0.191, 17.767 ], // 1
  [ 0.1524, 0.191, 17.767 ], // 2
  [-0.3048, 0.191, 18.031 ], // 3
  [ 0,      0.191, 18.031 ], // 4
  [ 0.3048, 0.191, 18.031 ], // 5
  [-0.4572, 0.191, 18.295 ], // 6
  [-0.1524, 0.191, 18.295 ], // 7
  [ 0.1524, 0.191, 18.295 ], // 8
  [ 0.4572, 0.191, 18.295 ], // 9
];

export const LANE_HALF_WIDTH = 0.53;
export const LANE_LENGTH = 19.0;
export const BALL_RADIUS = 0.108;
export const PIN_HALF_HEIGHT = 0.191;
export const PIN_RADIUS = 0.06;

// LatheGeometry profile for a regulation bowling pin (USBC proportions).
// Format: [radius_m, y_m] — revolved around the Y axis.
// Centred at y=0 (half-height); base at y=−0.191, crown at y=+0.191.
export const PIN_PROFILE: readonly [number, number][] = [
  [0.000, -0.191],  // bottom centre (seals the base cap)
  [0.025, -0.191],  // base edge
  [0.026, -0.180],  // flare begins
  [0.038, -0.152],  // expanding toward belly
  [0.055, -0.107],  // lower belly
  [0.061, -0.073],  // belly peak (~4.5″ from base)
  [0.057, -0.028],  // upper belly
  [0.046,  0.012],  // mid-pin
  [0.033,  0.042],  // narrowing toward neck
  [0.023,  0.063],  // neck minimum (~10″ from base)
  [0.025,  0.092],  // above neck, slight flare
  [0.028,  0.130],  // upper crown body
  [0.022,  0.168],  // narrowing to tip
  [0.019,  0.191],  // crown edge
  [0.000,  0.191],  // crown centre (seals the top cap)
] as const;
