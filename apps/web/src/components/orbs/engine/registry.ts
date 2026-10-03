import type { ModeKey } from '../presets';
import type { ModeDraw } from './types';
import { drawGlobe, drawRubik } from './lattice';
import { drawOrbits } from './orbits';
import { drawWeb } from './web';

export const MODE_DRAWS: Record<ModeKey, ModeDraw> = {
  orbits: drawOrbits,
  globe: drawGlobe,
  rubik: drawRubik,
  web: drawWeb
};
