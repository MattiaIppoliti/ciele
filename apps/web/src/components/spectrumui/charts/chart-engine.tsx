'use client';
// Spectrum UI chart engine, trimmed to what Ciele's callers use.

import * as React from 'react';
import { cn } from '@/lib/utils';

export const UP = 'var(--spectrum-chart-up)';
export const DOWN = 'var(--spectrum-chart-down)';
export const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

export function monotonePath(points: { x: number; y: number }[]): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M${points[0].x},${points[0].y}`;

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx[i] = points[i + 1].x - points[i].x;
    slope[i] = dx[i] === 0 ? 0 : (points[i + 1].y - points[i].y) / dx[i];
  }

  const tangent = new Array<number>(n);
  tangent[0] = slope[0];
  tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    if (slope[i - 1] * slope[i] <= 0) {
      tangent[i] = 0;
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      tangent[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
    }
  }

  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < n - 1; i += 1) {
    const c1x = points[i].x + dx[i] / 3;
    const c1y = points[i].y + (tangent[i] * dx[i]) / 3;
    const c2x = points[i + 1].x - dx[i] / 3;
    const c2y = points[i + 1].y - (tangent[i + 1] * dx[i]) / 3;
    d += `C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${points[i + 1].x.toFixed(2)},${points[i + 1].y.toFixed(2)}`;
  }
  return d;
}

export function usePrefersReducedMotion() {
  const [reduce, setReduce] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduce(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return reduce;
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function useTween(target: number[], { duration = 520, enabled = true } = {}) {
  const [value, setValue] = React.useState(target);
  const currentRef = React.useRef(target);
  const fromRef = React.useRef(target);
  const toRef = React.useRef(target);
  const startRef = React.useRef(0);
  const rafRef = React.useRef(0);

  React.useEffect(() => {
    if (!enabled) return;
    const to = toRef.current;
    const changed = to.length !== target.length || target.some((v, i) => v !== to[i]);
    if (!changed) return;

    toRef.current = target;

    if (currentRef.current.length !== target.length) {
      currentRef.current = target;
      fromRef.current = target;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => setValue(target));
      return;
    }

    fromRef.current = currentRef.current;
    startRef.current = performance.now();
    cancelAnimationFrame(rafRef.current);

    const tick = (now: number) => {
      const p = Math.min(1, (now - startRef.current) / duration);
      const e = easeOutCubic(p);
      const from = fromRef.current;
      const dest = toRef.current;
      const next = dest.map((v, i) => from[i] + (v - from[i]) * e);
      currentRef.current = next;
      setValue(next);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  });

  React.useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  if (!enabled || value.length !== target.length) return target;
  return value;
}

export function useTweenNumber(target: number, options?: { duration?: number; enabled?: boolean }) {
  const vec = React.useMemo(() => [target], [target]);
  return useTween(vec, options)[0];
}

export const KEYFRAMES = `
@keyframes spectrum-mc-draw {
  from { stroke-dashoffset: 1; }
  to   { stroke-dashoffset: 0; }
}
@keyframes spectrum-mc-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes spectrum-sk-pulse {
  from { opacity: 1; }
  to   { opacity: 0.4; }
}
@keyframes spectrum-mc-enter {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
`;

export function Keyframes() {
  return <style>{KEYFRAMES}</style>;
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

function Digit({ char, animate }: { char: string; animate: boolean }) {
  const digit = char >= '0' && char <= '9' ? Number(char) : null;
  if (digit == null) {
    return (
      <span aria-hidden className="inline-block h-[1em] align-bottom leading-none">
        {char}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="relative inline-block h-[1em] w-[1ch] overflow-hidden align-bottom leading-none"
    >
      <span
        className="absolute inset-x-0 top-0 block"
        style={{
          transform: `translateY(-${digit}em)`,
          transition: animate ? 'transform 620ms cubic-bezier(0.22, 1, 0.36, 1)' : undefined,
        }}
      >
        {DIGITS.map((d) => (
          <span key={d} className="block h-[1em] text-center leading-none">
            {d}
          </span>
        ))}
      </span>
    </span>
  );
}

export function RollingNumber({
  value,
  format,
  className,
  animate = true,
}: {
  value: number;
  format: (value: number) => string;
  className?: string;
  animate?: boolean;
}) {
  const text = format(value);
  return (
    <span className={cn('inline-flex items-end leading-none tabular-nums', className)}>
      <span className="sr-only">{text}</span>
      {text.split('').map((char, index) => (
        <Digit key={`${index}-${char >= '0' && char <= '9' ? 'digit' : char}`} char={char} animate={animate} />
      ))}
    </span>
  );
}

export const seriesVarsClassName =
  '[--spectrum-series-1:#2563eb] [--spectrum-series-2:#f59e0b] [--spectrum-series-3:#0d9488] [--spectrum-series-4:#7c3aed] [--spectrum-series-5:#db2777] [--spectrum-series-6:#64748b] [--spectrum-track:#ececef] [--spectrum-chart-surface:#fff] [--spectrum-chart-up:#059669] [--spectrum-chart-down:#e11d48] dark:[--spectrum-series-1:#60a5fa] dark:[--spectrum-series-2:#fbbf24] dark:[--spectrum-series-3:#2dd4bf] dark:[--spectrum-series-4:#a78bfa] dark:[--spectrum-series-5:#f472b6] dark:[--spectrum-series-6:#94a3b8] dark:[--spectrum-track:#26262b] dark:[--spectrum-chart-surface:#0a0a0a] dark:[--spectrum-chart-up:#34d399] dark:[--spectrum-chart-down:#fb7185]';

export function formatCount(value: number, digits = 1) {
  if (Math.abs(value) < 1000) return String(Math.round(value));
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: digits,
  }).format(value);
}

export function useHoverIndexKeys({
  count,
  setIndex,
}: {
  count: number;
  setIndex: React.Dispatch<React.SetStateAction<number | null>>;
}) {
  return React.useCallback(
    (event: React.KeyboardEvent) => {
      const { key } = event;
      if (key === 'Escape') {
        event.preventDefault();
        setIndex(null);
        return;
      }
      if (key === 'Home' || key === 'End') {
        event.preventDefault();
        setIndex(key === 'Home' ? 0 : count - 1);
        return;
      }
      if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
      event.preventDefault();
      const step = key === 'ArrowRight' ? 1 : -1;
      setIndex((current) => {
        const next = (current ?? count - 1) + step;
        return Math.max(0, Math.min(count - 1, next));
      });
    },
    [count, setIndex],
  );
}
