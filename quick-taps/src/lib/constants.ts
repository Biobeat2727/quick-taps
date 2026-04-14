export const MARBLE_COLORS = [
  { name: "Red", hex: "#E24B4A" },
  { name: "Blue", hex: "#378ADD" },
  { name: "Green", hex: "#639922" },
  { name: "Amber", hex: "#EF9F27" },
  { name: "Purple", hex: "#7F77DD" },
  { name: "Coral", hex: "#D85A30" },
  { name: "Pink", hex: "#D4537E" },
  { name: "Teal", hex: "#1D9E75" },
] as const;

export const NPC_NAMES = [
  "Big Mike",
  "Hopsy",
  "The Regular",
  "Sudsy",
  "Last Call",
  "Tab",
] as const;

export const GAME_LABELS: Record<string, string> = {
  marble_race: "Marble Race",
};
