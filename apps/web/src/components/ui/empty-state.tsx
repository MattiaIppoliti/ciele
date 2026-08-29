"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The console's one empty state.
 *
 * Every list that can be empty used to invent its own: a bare lucide glyph on
 * the Teammates roster, a dashed circle around a wand on the Improvements
 * board, a dashed box around a document on Exports. Three treatments for one
 * situation read as three products, and none of them said "this is Ciele".
 *
 * So there is one mark, and it is drawn rather than borrowed from an icon set:
 * an open box with nothing in it, standing on its own reflection. It says the
 * one thing every empty list has in common and nothing about the page it sits
 * on, which is the point. The sentence under it is what differs.
 *
 * A client component only because the mark's gradient needs a document-unique
 * id (`useId`). Every page that shows an empty state is already a client
 * component, so the boundary costs nothing here.
 */

/**
 * The mark on its own, for a caller that wants the drawing without the
 * heading-and-sentence layout below it.
 *
 * Geometry notes, since they are not obvious from the numbers. The box is a
 * 2:1 isometric crate with its lid off: half-width 30, half-depth 15, walls 20
 * deep, so the rim is the diamond (30,40) (60,25) (90,40) (60,55) and the glyph
 * occupies y 25..75. The reflection is it mirrored about y = 79, and the two
 * meet at a floor line that is never drawn. The `viewBox` is cropped tight to
 * both, because a box with slack in it makes the drawing look small at whatever
 * width the caller picks.
 *
 * Only the near half of the crate's own floor is a solid edge, because that is
 * the crate's silhouette. The far half is drawn dashed *inside* the opening,
 * and it is the whole idea of the mark: you are looking through the opening at
 * the floor, and there is nothing standing on it.
 *
 * The mask sits on an outer `<g>` and the mirror on an inner one, which is not
 * decoration: a `mask` resolves in the coordinate system its own element's
 * `transform` establishes, so a mask and a mirror on the same `<g>` masked the
 * upright glyph instead of the reflection, and the reflection never appeared.
 */
export function EmptyStateMark({ className }: { className?: string }) {
  const fade = useId();
  const glyph = (
    <>
      {/* The rim: the opening, so it is the one closed shape here. */}
      <path
        d="M30 40 60 25l30 15-30 15z"
        fill="currentColor"
        fillOpacity="0.05"
      />
      {/* The floor, seen through the opening. Dashed and dimmer, because it is
          an inside surface and because bare floor is the point. */}
      <path d="M30 60 60 45l30 15" strokeDasharray="3 3.5" opacity="0.55" />
      {/* The three visible walls, and the near half of the floor as the
          crate's bottom silhouette. */}
      <path d="M30 40v20" />
      <path d="M90 40v20" />
      <path d="M60 55v20" />
      <path d="M30 60 60 75l30-15" />
    </>
  );

  return (
    <svg
      viewBox="22 20 76 96"
      className={cn("w-40", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative: the heading under it already says what is empty.
      aria-hidden
    >
      <defs>
        <linearGradient
          id={fade}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="82"
          x2="0"
          y2="112"
        >
          <stop offset="0" stopColor="white" stopOpacity="0.45" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <mask id={`${fade}-mask`} maskUnits="userSpaceOnUse">
          <rect x="22" y="80" width="76" height="36" fill={`url(#${fade})`} />
        </mask>
      </defs>
      <g opacity="0.7">{glyph}</g>
      <g mask={`url(#${fade}-mask)`}>
        {/* `matrix(1 0 0 -1 0 158)` is y' = 158 - y: a mirror about y = 79. */}
        <g transform="matrix(1 0 0 -1 0 158)">{glyph}</g>
      </g>
    </svg>
  );
}

/**
 * A list with nothing in it: the mark, one heading, one sentence, and whatever
 * action the page wants under them.
 *
 * `description` is a node rather than a string because two callers need to
 * choose their sentence by role (an Editor is told what to do next, a Viewer is
 * told what will appear here), and that decision belongs to the page.
 */
export function EmptyState({
  title,
  description,
  children,
  size = "md",
  className,
}: {
  title: string;
  description?: ReactNode;
  /** Actions, rendered under the sentence. */
  children?: ReactNode;
  /**
   * `"sm"` for an empty state inside a column rather than a page: the Inbox's
   * conversation rail is 288px wide, and the full-size mark in it would be the
   * loudest thing on a screen whose subject is the conversation beside it.
   */
  size?: "sm" | "md";
  className?: string;
}) {
  const small = size === "sm";
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        small ? "px-4 py-10" : "px-6 py-16",
        className
      )}
    >
      <EmptyStateMark
        className={cn("text-muted-foreground", small && "w-24")}
      />
      <p className={cn("mt-2 font-semibold", small ? "text-sm" : "text-lg")}>
        {title}
      </p>
      {description && (
        <p
          className={cn(
            "text-muted-foreground mt-2 leading-relaxed",
            small ? "text-xs" : "max-w-md text-sm"
          )}
        >
          {description}
        </p>
      )}
      {children && <div className="mt-5 flex items-center gap-2">{children}</div>}
    </div>
  );
}
