import type { ModeOpts } from './engine/profiles';
import { BASE_PROFILES, scaleCounts, scaleRadii } from './engine/profiles';
import type { OrbState } from './types';

export type ModeKey = 'orbits' | 'globe' | 'rubik' | 'web';

const STATE_TO_MODE: Record<OrbState, ModeKey> = {
  working: 'orbits',
  searching: 'globe',
  solving: 'rubik',
  connecting: 'web'
};

interface Preset {
  speed: number;
  count: number;
  size: number;
  /** Extra mode opts merged verbatim after scaling. */
  extra?: ModeOpts;
}

// Inline thinking indicator: retain the original 20px tunings.
const PRESETS: Record<ModeKey, Preset> = {
  orbits: { speed: 3.9, count: 0.238, size: 2.4 },
  globe: { speed: 2.665, count: 0.105, size: 1.75, extra: { scanMul: 4.335, dimBase: 0.45 } },
  rubik: { speed: 1.95, count: 0.088, size: 1.9 },
  web: { speed: 6.63, count: 0.25, size: 1.52 }
};

export interface Resolved {
  mode: ModeKey;
  speed: number;
  opts: ModeOpts;
}

const cache = new Map<OrbState, Resolved>();

/** Resolve a state to its mode and fully-scaled draw options. */
export function resolvePreset(state: OrbState): Resolved {
  const hit = cache.get(state);
  if (hit) return hit;

  const mode = STATE_TO_MODE[state];
  const preset = PRESETS[mode];
  let opts: ModeOpts = { ...BASE_PROFILES[mode] };
  if (preset.count !== 1) opts = scaleCounts(opts, preset.count);
  if (preset.size !== 1) opts = scaleRadii(opts, preset.size);
  if (preset.extra) opts = { ...opts, ...preset.extra };

  const resolved: Resolved = { mode, speed: preset.speed, opts };
  cache.set(state, resolved);
  return resolved;
}
