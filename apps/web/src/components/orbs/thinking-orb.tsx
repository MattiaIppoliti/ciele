"use client";
// Vendored from thinking-orbs (github.com/Jakubantalik/thinking-orbs, MIT,
// see ./LICENSE); source, not the npm package, per the beui-restyle brief.
// Adapted to the four inline states used by the thinking panel, with
// root theme and reduced-motion subscriptions in theme.ts.
//
// The ThinkingOrb component. One shared clock (performance.now) keeps
// every mounted orb in phase; each instance runs its own rAF loop but
// pauses automatically while offscreen (IntersectionObserver) or when
// the tab is hidden (visibilitychange). Reduced-motion users get a
// static representative frame that still follows the live theme.

import { useEffect, useRef } from 'react';
import { MODE_DRAWS } from './engine/registry';
import { resolvePreset } from './presets';
import { useReducedMotion, useResolvedDark } from './theme';
import type { OrbState, ThinkingOrbProps } from './types';

const SIZE = 20;

const LABELS: Record<OrbState, string> = {
  working: 'Working…',
  searching: 'Searching…',
  solving: 'Solving…',
  connecting: 'Connecting…',
};

export function ThinkingOrb({
  state = 'working',
  style,
  'aria-label': ariaLabel,
  ...rest
}: ThinkingOrbProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const dark = useResolvedDark();
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
    canvas.width = Math.round(SIZE * dpr);
    canvas.height = Math.round(SIZE * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { mode, speed, opts } = resolvePreset(state);
    const draw = MODE_DRAWS[mode];

    const frame = (tSec: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, SIZE, SIZE);
      draw(ctx, SIZE, tSec, dark, opts);
    };

    // reduced motion → one static, deterministic frame
    if (reduced) {
      frame(0.6);
      return;
    }

    let raf = 0;
    let running = false;
    const loop = () => {
      frame((performance.now() / 1000) * speed);
      if (running) raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    // draw at least one frame even when offscreen
    frame((performance.now() / 1000) * speed);

    // pause offscreen + on hidden tabs, free when not visible
    let visible = true;
    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (visible && document.visibilityState !== 'hidden') start();
            else stop();
          })
        : null;
    io?.observe(canvas);
    const onVis = () => {
      if (document.visibilityState === 'hidden') stop();
      else if (visible) start();
    };
    document.addEventListener('visibilitychange', onVis);
    if (!io) start();

    return () => {
      stop();
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [state, dark, reduced]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={ariaLabel ?? LABELS[state]}
      style={{ width: SIZE, height: SIZE, display: 'block', ...style }}
      {...rest}
    />
  );
}
