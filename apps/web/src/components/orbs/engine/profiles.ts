// Density profiles + the multiplier machinery that scales them. The base
// rows are inkform's `fine` profiles; each inline preset
// applies count / radius multipliers on top, resolved once per mount.

export interface ModeOpts {
  [key: string]: number | undefined;
}

// 2-D lattices (rings × dots-per-ring) come in pairs, each side takes
// √scale so the TOTAL dot count scales by `scale`; flat lists scale
// linearly.
const COUNT_KEYS = ['orbitN', 'ghostN', 'nodeN', 'signals'] as const;

// Every key that sets a dot's rendered radius, scaling all of them keeps
// a dot's near/far falloff intact while shrinking or growing the mark.
const RADIUS_KEYS = [
  'rBase',
  'rDepth',
  'rActive',
  'ghostR',
  'partR',
  'partRDepth',
  'nodeR',
  'nodeRDepth'
] as const;

export function scaleCounts(opts: ModeOpts, scale: number): ModeOpts {
  const out: ModeOpts = { ...opts };
  if (out.latRings != null && out.lonDensity != null) {
    const rt = Math.sqrt(scale);
    out.latRings = Math.max(2, Math.round(out.latRings * rt));
    out.lonDensity = Math.max(2, Math.round(out.lonDensity * rt));
  }
  for (const k of COUNT_KEYS) {
    const v = out[k];
    if (v != null && v !== 0) out[k] = Math.max(1, Math.round(v * scale));
  }
  return out;
}

export function scaleRadii(opts: ModeOpts, scale: number): ModeOpts {
  const out: ModeOpts = { ...opts };
  for (const k of RADIUS_KEYS) {
    const v = out[k];
    if (v != null) out[k] = v * scale;
  }
  return out;
}

/** Base (fine) profiles per mode, before preset multipliers. */
export const BASE_PROFILES: Record<string, ModeOpts> = {
  globe: {
    latRings: 17,
    lonDensity: 44,
    rBase: 0.6,
    rDepth: 1.7,
    rBoost: 1.0,
    inkFar: 0.62,
    inkSpan: 0.54,
    rsPow: 0.6,
    rMin: 0.3
  },
  orbits: {
    orbitN: 12,
    ghostN: 40,
    ghostR: 0.9,
    ghostA: 0.5,
    particles: 3,
    partR: 1.2,
    partRDepth: 1.6,
    rsPow: 0.6,
    rMin: 0.3
  },
  rubik: {
    latRings: 15,
    lonDensity: 40,
    moveCount: 14,
    rBase: 0.6,
    rDepth: 1.7,
    rActive: 0.3,
    inkFar: 0.62,
    inkSpan: 0.54,
    rsPow: 0.6,
    rMin: 0.3
  },
  web: {
    nodeN: 30,
    thr: 0.72,
    signals: 5,
    nodeR: 1.4,
    nodeRDepth: 1.8,
    lineW: 0.8,
    rsPow: 0.6,
    rMin: 0.3
  },
};
