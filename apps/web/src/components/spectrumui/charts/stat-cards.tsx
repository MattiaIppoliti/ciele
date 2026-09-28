'use client';
// Spectrum UI stat cards, trimmed to what Ciele's callers use.

import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  DOWN,
  EASE,
  Keyframes,
  RollingNumber,
  UP,
  formatCount,
  monotonePath,
  seriesVarsClassName,
  useHoverIndexKeys,
  usePrefersReducedMotion,
  useTweenNumber,
} from './chart-engine';

export type StatCardData = {
  label: string;
  series?: number[];
  value?: number;
  /**
   * The comparison value. Ciele: `null` means there is nothing to compare
   * against (a previous period with no data), and the card shows its caption
   * instead of measuring a change from zero.
   */
  previous?: number | null;
  format?: (value: number) => string;
  /** Ciele: `neutral` for volumes (calls, tokens) where more is neither good nor bad. */
  goodWhen?: 'up' | 'down' | 'neutral';
  /** Ciele: one label per `series` point, read out while scrubbing instead of "day N of M". */
  labels?: string[];
  deltaLabel?: string;
  caption?: string;
};

function StatCard({
  card,
  index,
  reduce,
  bare = false,
}: {
  card: StatCardData;
  index: number;
  reduce: boolean;
  bare?: boolean;
}) {
  const { label, series, goodWhen = 'up', deltaLabel = 'vs start', caption, labels } = card;
  const format = card.format ?? ((v: number) => formatCount(v, 1));
  const [hover, setHover] = React.useState<number | null>(null);
  const sparkRef = React.useRef<HTMLDivElement | null>(null);
  const uid = React.useId().replace(/:/g, '');

  const n = series?.length ?? 0;
  const headline = card.value ?? series?.[n - 1] ?? 0;
  const shown = hover != null && series ? series[hover] : headline;

  const base = card.previous ?? series?.[0] ?? 0;
  const delta =
    card.previous === null
      ? null
      : card.previous != null || series
        ? base
          ? ((headline - base) / base) * 100
          : 0
        : null;
  const rising = (delta ?? 0) >= 0;
  const good = goodWhen === 'up' ? rising : !rising;
  const neutral = goodWhen === 'neutral';
  const color = neutral ? 'var(--spectrum-series-1)' : good ? UP : DOWN;

  const displayValue = useTweenNumber(shown, {
    duration: 260,
    enabled: !reduce && hover == null,
  });

  const [box, setBox] = React.useState({ w: 0, h: 0 });
  React.useEffect(() => {
    const node = sparkRef.current;
    if (!node) return;
    const ro = new ResizeObserver(([entry]) =>
      setBox({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    ro.observe(node);
    const rect = node.getBoundingClientRect();
    setBox({ w: rect.width, h: rect.height });
    return () => ro.disconnect();
  }, []);

  const spark = React.useMemo(() => {
    if (!series || n < 2 || box.w <= 0 || box.h <= 0) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of series) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const span = hi - lo || 1;
    const points = series.map((v, i) => ({
      x: 3 + (i / (n - 1)) * (box.w - 6),
      y: 7 + (1 - (v - lo) / span) * (box.h - 16),
    }));
    const line = monotonePath(points);
    const extremes: number[] = [];
    for (let i = 1; i < n - 1; i += 1) {
      if ((series[i] - series[i - 1]) * (series[i + 1] - series[i]) < 0) extremes.push(i);
    }
    return {
      line,
      area: `${line}L${points[n - 1].x},${box.h}L${points[0].x},${box.h}Z`,
      points,
      extremes: extremes.slice(0, 5),
    };
  }, [series, n, box]);

  const onMove = (clientX: number) => {
    const node = sparkRef.current;
    if (!node || n < 2) return;
    const box = node.getBoundingClientRect();
    const t = (clientX - box.left) / Math.max(1, box.width);
    setHover(Math.max(0, Math.min(n - 1, Math.round(t * (n - 1)))));
  };
  const onKeyDown = useHoverIndexKeys({ count: n, setIndex: setHover });

  const scrubDot = hover != null && spark ? spark.points[hover] : null;

  return (
    <div
      className={
        bare
          ? 'flex items-stretch justify-between gap-4 rounded-lg px-3 py-2.5'
          : 'flex items-stretch justify-between gap-5 rounded-2xl border border-black/8 bg-white/60 p-5 dark:border-white/10 dark:bg-white/[0.02]'
      }
      role="img"
      aria-label={`${label}: ${format(headline)}${
        delta != null ? `, ${rising ? 'up' : 'down'} ${Math.abs(delta).toFixed(0)} percent ${deltaLabel}` : ''
      }.`}
      style={
        reduce
          ? undefined
          : { animation: `spectrum-mc-enter 420ms ${EASE} ${index * 70}ms both` }
      }
    >
      <div className="flex min-w-0 flex-col justify-between">
        <p className="truncate text-[13px] text-neutral-500 dark:text-neutral-400">{label}</p>
        <p
          className={cn(
            'mt-1.5 font-medium leading-none tracking-tight text-neutral-950 dark:text-white',
            bare ? 'text-[20px]' : 'text-[27px]',
          )}
        >
          <RollingNumber
            value={hover != null ? shown : displayValue}
            format={format}
            animate={!reduce}
          />
        </p>
        <p className="mt-2 h-[17px] overflow-hidden whitespace-nowrap text-[12.5px] font-medium leading-none">
          {hover != null && series ? (
            <span className="text-neutral-400 dark:text-neutral-500">
              {labels?.[hover] ?? `day ${hover + 1} of ${n}`}
            </span>
          ) : delta != null ? (
            <span
              className={neutral ? 'text-neutral-500 dark:text-neutral-400' : undefined}
              style={neutral ? undefined : { color }}
            >
              {rising ? '↑' : '↓'} {Math.abs(delta).toFixed(0)}% {deltaLabel}
            </span>
          ) : (
            <span className="text-neutral-500 dark:text-neutral-400">{caption ?? ' '}</span>
          )}
        </p>
      </div>

      {series && n >= 2 ? (
        <div
          ref={sparkRef}
          // Ciele: a bare row has no card height to stretch against, so the
          // line gets a fixed height. Stretching let the SVG's measured size
          // feed back into the row it measured: on a full-width row (an iPad's
          // stacked Overview) each row grew to ~240px.
          className={cn(
            'relative shrink-0 cursor-crosshair touch-pan-y select-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/20',
            bare ? 'h-14 w-[40%] max-w-44 self-center' : 'w-[44%] max-w-52 self-stretch',
          )}
          style={bare ? undefined : { minHeight: 58 }}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setHover(null)}
          onPointerMove={(e) => onMove(e.clientX)}
          onPointerDown={(e) => onMove(e.clientX)}
          onPointerLeave={() => setHover(null)}
        >
          {spark ? (
          <svg
            width={box.w}
            height={box.h}
            viewBox={`0 0 ${box.w} ${box.h}`}
            className="block h-full w-full overflow-visible"
            aria-hidden
          >
            <defs>
              <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <path
              d={spark.area}
              fill={`url(#${uid}-fill)`}
              style={
                reduce
                  ? undefined
                  : { animation: `spectrum-mc-fade 620ms ease-out ${index * 70 + 180}ms both` }
              }
            />
            <path
              d={spark.line}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              style={
                reduce
                  ? undefined
                  : {
                      strokeDasharray: 1,
                      animation: `spectrum-mc-draw 700ms ${EASE} ${index * 70}ms both`,
                    }
              }
            />
            {spark.extremes.map((i) => (
              <circle
                key={i}
                cx={spark.points[i].x}
                cy={spark.points[i].y}
                r={2.5}
                fill={color}
                style={
                  reduce
                    ? undefined
                    : { animation: `spectrum-mc-fade 300ms ease-out ${index * 70 + 500}ms both` }
                }
              />
            ))}
            {scrubDot ? (
              <circle
                cx={scrubDot.x}
                cy={scrubDot.y}
                r={4.5}
                className="fill-white dark:fill-neutral-950"
                stroke={color}
                strokeWidth={2}
              />
            ) : null}
          </svg>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const COLUMN_CLASS = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
};

export interface StatCardsProps {
  className?: string;
  cards: StatCardData[];
  columns?: 1 | 2;
  loading?: boolean;
  /**
   * Ciele: rows without the card chrome, for a block that sits inside a panel
   * of its own (the Assistant Overview's Activity card). Same scrubbing, delta
   * and animation; only the border, fill and padding go.
   */
  bare?: boolean;
}

export function StatCards({
  className,
  cards,
  columns = 2,
  loading = false,
  bare = false,
}: StatCardsProps) {
  const reduce = usePrefersReducedMotion();
  const gridClass = cn('grid', bare ? 'gap-0' : 'gap-3', COLUMN_CLASS[columns]);
  // Ciele: the loading state keeps the grid's own shape, one placeholder per
  // card at the height a card last rendered at. The upstream block swapped in
  // a fixed 168px chart skeleton, four across, so a two-column grid of four or
  // eight cards grew by a row or three the moment a filter change landed.
  const gridRef = React.useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    if (loading) return;
    const first = gridRef.current?.firstElementChild as HTMLElement | null;
    if (first) setCardHeight(first.offsetHeight);
  }, [loading, cards.length]);

  return (
    <div className={cn('w-full', seriesVarsClassName, className)}>
      <Keyframes />
      {loading ? (
        <div aria-busy="true" aria-live="polite" className={gridClass}>
          {cards.map((card, index) => (
            <div
              key={card.label}
              aria-hidden
              className={cn(
                'rounded-md bg-black/[0.06] dark:bg-white/[0.08]',
                !bare && 'rounded-xl',
              )}
              style={{
                height: cardHeight ?? 129,
                animation: reduce
                  ? undefined
                  : `spectrum-sk-pulse 1.5s ease-in-out ${index * 120}ms infinite alternate`,
              }}
            />
          ))}
          <span className="sr-only">Loading chart data</span>
        </div>
      ) : (
        <div ref={gridRef} className={gridClass}>
          {cards.map((card, index) => (
            <StatCard key={card.label} card={card} index={index} reduce={reduce} bare={bare} />
          ))}
        </div>
      )}
    </div>
  );
}
