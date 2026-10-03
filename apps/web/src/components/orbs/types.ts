import type { CanvasHTMLAttributes } from 'react';

export type OrbState = 'working' | 'searching' | 'solving' | 'connecting';

export interface ThinkingOrbProps extends CanvasHTMLAttributes<HTMLCanvasElement> {
  state?: OrbState;
}
