// Map registry. Add new maps here; the server picks one per race and the id
// travels in the recording so every client builds the same course.

import type { MarbleMapDef } from '../track';
import { NEON_SUMMIT } from './neon-summit';

export const MARBLE_MAPS: Record<string, MarbleMapDef> = {
  [NEON_SUMMIT.id]: NEON_SUMMIT,
};

export const DEFAULT_MAP_ID = NEON_SUMMIT.id;

export function getMap(id: string | undefined): MarbleMapDef {
  return (id && MARBLE_MAPS[id]) || MARBLE_MAPS[DEFAULT_MAP_ID];
}
