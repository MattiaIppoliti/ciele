"use client";

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A grid whose dividers carry a slow travelling glow, the mono treatment of
 * cult-ui's GridBeam (cult-ui.com/docs/components/grid-beam).
 *
 * This is a local implementation, not the upstream component: its registry
 * (cult-ui.com/r/grid-beam.json) sits behind a bot checkpoint that answers 429
 * to both fetch and the shadcn CLI, so the source could not be installed. The
 * upstream draws its beams on a canvas with a palette prop; this draws them in
 * CSS and only in mono, which is what the pricing comparison needs. Swap it for
 * the real component if the registry ever becomes reachable.
 *
 * Structure: one grid, three layers over identical tracks.
 *   1. the content cells (children), which define the row heights;
 *   2. a hairline lattice;
 *   3. the same lattice in `--foreground`, revealed through a moving mask.
 * Layers 2 and 3 follow layer 1 with `subgrid`, the only way to track auto-
 * sized rows exactly. Without subgrid support the glow is dropped rather than
 * rendered misaligned (see globals.css).
 */
export interface GridBeamProps {
  cols: number;
  rows: number;
  /** grid-template-columns. Defaults to equal fractions. */
  columnsTemplate?: string;
  className?: string;
  children: ReactNode;
}

/**
 * One lattice: `cols × rows` empty cells drawing a right/bottom hairline,
 * skipped on the last column and row so the border never doubles up with the
 * container's own edge.
 */
/**
 * One layer covering the container's whole explicit grid and re-exposing its
 * tracks through `subgrid`.
 *
 * Every layer: content included, has to go through this. Grid auto-placement
 * refuses to reuse a cell already claimed by a definitely-positioned item, so
 * an overlay spanning `1 / -1` would push auto-placed siblings into implicit
 * rows past the end of the grid. Once each layer is itself a positioned
 * subgrid, they all resolve to the same area and stack.
 */
function Layer({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("col-start-1 col-end-[-1] row-start-1 row-end-[-1] grid", className)}
      style={{
        gridTemplateColumns: "subgrid",
        gridTemplateRows: "subgrid",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * `cols × rows` empty cells drawing a right/bottom hairline, skipped on the
 * last column and row so the border never doubles up with the container edge.
 */
function Lattice({
  cols,
  rows,
  className,
}: {
  cols: number;
  rows: number;
  className?: string;
}) {
  return (
    <Layer className={cn("pointer-events-none", className)}>
      {Array.from({ length: cols * rows }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={cn(
            "border-current",
            i % cols !== cols - 1 && "border-r",
            Math.floor(i / cols) !== rows - 1 && "border-b"
          )}
        />
      ))}
    </Layer>
  );
}

export function GridBeam({
  cols,
  rows,
  columnsTemplate,
  className,
  children,
}: GridBeamProps) {
  const template = columnsTemplate ?? `repeat(${cols}, minmax(0, 1fr))`;

  return (
    <div
      className={cn("relative grid", className)}
      style={{
        gridTemplateColumns: template,
        gridTemplateRows: `repeat(${rows}, auto)`,
      }}
    >
      {/* Content sizes the tracks; the lattices follow them through subgrid. */}
      <Layer>{children}</Layer>

      {/* Static hairlines. */}
      <Lattice className="text-border/70" cols={cols} rows={rows} />

      {/* Two masked passes at different sizes and rates. `@supports` keeps them
          out of browsers where subgrid would leave them off the lines. */}
      <Layer
        className="pointer-events-none not-supports-[grid-template-columns:subgrid]:hidden"
        style={{ gridTemplateColumns: "subgrid", gridTemplateRows: "subgrid" }}
      >
        <Lattice
          className="grid-beam-glow text-foreground/70"
          cols={cols}
          rows={rows}
        />
        <Lattice
          className="grid-beam-glow grid-beam-glow-alt text-foreground/50"
          cols={cols}
          rows={rows}
        />
      </Layer>
    </div>
  );
}
