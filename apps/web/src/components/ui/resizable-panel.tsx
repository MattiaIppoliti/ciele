"use client";

// The resize behavior is shared byte-for-byte across apps; only the visual
// handle below is web-specific (the pointer-lit line + shadcn tokens).
export { useResizableWidth } from "@agent-hub/ui/use-resizable-width";

/**
 * The gutter between the workspace panel's edge and a right-rail card (`pr-2`),
 * which a rail's content column subtracts so the card clips nothing. In px for
 * that width arithmetic; the console's density scales rems, so it is within a
 * pixel of the real `0.5rem`, which the card's `overflow-hidden` absorbs.
 */
export const RAIL_CARD_INSET = 8;

/** The docked sidebar's gap to the workspace panel: the admin layout's `lg:p-2`. */
export const SHELL_GAP = "0.5rem";

/**
 * A vertical fade centred on `--glow-y`, the pointer's height over the handle
 * (the middle until it has moved there). `reach` is how far above and below
 * that point the fade takes to reach nothing.
 */
function around(reach: string) {
  const at = "var(--glow-y, 50%)";
  return `linear-gradient(to bottom, transparent calc(${at} - ${reach}), black ${at}, transparent calc(${at} + ${reach}))`;
}

/** Mask layers, intersected: a pixel shows only where every layer does. */
function mask(...layers: string[]): React.CSSProperties {
  const image = layers.join(", ");
  return {
    maskImage: image,
    WebkitMaskImage: image,
    maskComposite: "intersect",
    WebkitMaskComposite: "source-in",
  };
}

// A fixed fade into both ends, whatever the pointer does: the edge the line
// runs along turns into the panel's rounded corners there, and a line still
// lit at full strength would overshoot the curve.
const ENDS = "linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)";

/** The line and its halo: most of the edge, fading well before either end. */
const LINE_FADE = mask(around("36rem"), ENDS);
/** The lift that follows the pointer: a soft brighter stretch, spread wide. */
const GLOW_FADE = mask(around("22rem"), ENDS);

/**
 * The cornered glow, per side the card lies on. Its fade is centred on the
 * pointer like the others but with no fixed fade into the ends, since reaching
 * the ends is its whole point, and tighter, so a corner lights only while the
 * pointer is near it. Along the arc it is full on the line and gone by the
 * arc's tip, so the curve thins away into the card's edge instead of stopping
 * on a hard end. The classes are the side-specific half of each layer.
 */
const CORNER = {
  right: {
    fade: mask(around("9rem"), "linear-gradient(to right, black 15%, transparent 100%)"),
    halo: "left-[calc(50%-2px)] rounded-l-[calc(0.75rem+1px)] border-l-4",
    line: "left-[calc(50%-0.75px)] rounded-l-xl border-l-[1.5px]",
  },
  left: {
    fade: mask(around("9rem"), "linear-gradient(to left, black 15%, transparent 100%)"),
    halo: "right-[calc(50%-2px)] rounded-r-[calc(0.75rem+1px)] border-r-4",
    line: "right-[calc(50%-0.75px)] rounded-r-xl border-r-[1.5px]",
  },
};

/**
 * Neutral guide line, shown on hover/drag, with no grip on it: the lit line is
 * the affordance. The line and its halo fade out toward both ends, so the handle reads as a hint on the edge
 * rather than a rule drawn the full height of the window.
 */
export function ResizeHandle({
  resizing,
  onPointerDown,
  side = "left",
  label = "Resize panel",
  value,
  minValue,
  maxValue,
  onValueChange,
  gap,
  span = "inset-y-0",
  cornered,
}: {
  resizing: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  side?: "left" | "right";
  label?: string;
  value?: number;
  minValue?: number;
  maxValue?: number;
  onValueChange?: (value: number) => void;
  /**
   * How far past the element's edge the visible line it resizes sits. The
   * docked sidebar's edge is `RAIL_CARD_INSET` short of the workspace panel's
   * border, and the grip belongs on that border, not in the gap before it.
   * A CSS length, so it scales with the rems the gap itself is set in.
   */
  gap?: string;
  /**
   * The handle's vertical extent, as classes. The full height by default; a
   * panel whose edge is a card shorter than the column passes the card's own
   * top and bottom, so the lit line runs along that card and fades into its
   * rounded corners instead of glowing on the empty space above and below.
   */
  span?: string;
  /**
   * The edge is a side of a rounded card (corners `rounded-xl`): the glow then
   * follows the card's own outline, round its top and bottom corners, when the
   * pointer nears either end. The side of the line the card lies on. Needs
   * `span` set to the card's exact extent, or the arc lands off the corner.
   */
  cornered?: "left" | "right";
}) {
  const adjustable =
    value !== undefined &&
    minValue !== undefined &&
    maxValue !== undefined &&
    onValueChange !== undefined;
  const lit = resizing ? "opacity-100" : "opacity-0 group-hover:opacity-100";
  const corner = cornered ? CORNER[cornered === "left" ? "left" : "right"] : null;

  return (
    <div
      role={adjustable ? "separator" : "presentation"}
      aria-orientation={adjustable ? "vertical" : undefined}
      aria-label={adjustable ? label : undefined}
      aria-valuemin={adjustable ? minValue : undefined}
      aria-valuemax={adjustable ? maxValue : undefined}
      aria-valuenow={adjustable ? value : undefined}
      aria-description={
        adjustable
          ? "Use the arrow keys to resize, Shift plus an arrow for larger steps, Home for minimum, and End for maximum."
          : undefined
      }
      aria-hidden={adjustable ? undefined : true}
      tabIndex={adjustable ? 0 : undefined}
      data-slot="resize-handle"
      data-side={side}
      onKeyDown={(event) => {
        if (!adjustable) return;
        const step = event.shiftKey ? 64 : 16;
        const growsWithArrow = side === "right" ? "ArrowRight" : "ArrowLeft";
        if (event.key === "Home") {
          event.preventDefault();
          onValueChange(minValue);
        } else if (event.key === "End") {
          event.preventDefault();
          onValueChange(maxValue);
        } else if (event.key === growsWithArrow) {
          event.preventDefault();
          onValueChange(Math.min(maxValue, value + step));
        } else if (event.key === (growsWithArrow === "ArrowLeft" ? "ArrowRight" : "ArrowLeft")) {
          event.preventDefault();
          onValueChange(Math.max(minValue, value - step));
        }
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        onPointerDown(e);
      }}
      // Written straight to the element, not through state: it changes on
      // every pointer move, and only the three masks below read it.
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--glow-y", `${e.clientY - rect.top}px`);
      }}
      onPointerLeave={(e) => {
        if (!resizing) e.currentTarget.style.removeProperty("--glow-y");
      }}
      // The w-5 hit area is centred on the line: half its width, plus the
      // gap, plus half the 1px border it lands on.
      style={gap ? { [side]: `calc(-0.625rem - ${gap} - 0.5px)` } : undefined}
      className={`group absolute ${span} z-10 w-5 cursor-col-resize outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
        gap ? "" : side === "left" ? "-left-2.5" : "-right-2.5"
      }`}
    >
      <div
        style={LINE_FADE}
        className={`absolute inset-y-0 left-1/2 w-[5px] -translate-x-1/2 bg-neutral-400/10 transition-opacity ${lit}`}
      />
      <div
        style={LINE_FADE}
        className={`absolute inset-y-0 left-1/2 w-[1.5px] -translate-x-1/2 bg-neutral-400/50 transition-opacity ${lit}`}
      />
      {/* Brightest where the pointer is, and only there: the line reads as
          lit from the cursor rather than drawn the same all the way down. */}
      {/* Two layers, not a box-shadow: the mask would clip a shadow to the
          element's own 2px. */}
      <div
        style={GLOW_FADE}
        className={`absolute inset-y-0 left-1/2 w-[5px] -translate-x-1/2 rounded-full bg-neutral-500/10 transition-opacity dark:bg-white/[0.06] ${lit}`}
      />
      {corner ? (
        // The card's own outline: a 1.5px border down the line, bending round
        // a `rounded-xl` corner at each end toward the card. `w-3` is that
        // radius, so what shows past the line is the arc and nothing more.
        <>
          {/* A wide, faint halo under the line, so its edge is diluted
              rather than drawn: the same outline, 4px and a few percent. */}
          <div
            style={corner.fade}
            className={`pointer-events-none absolute -inset-y-px w-[calc(0.75rem+2px)] border-y-4 border-neutral-500/[0.07] transition-opacity dark:border-white/[0.05] ${corner.halo} ${lit}`}
          />
          <div
            style={corner.fade}
            className={`pointer-events-none absolute inset-y-0 w-3 border-y-[1.5px] border-neutral-500/30 transition-opacity dark:border-white/20 ${corner.line} ${lit}`}
          />
        </>
      ) : (
        <div
          style={GLOW_FADE}
          className={`absolute inset-y-0 left-1/2 w-[1.5px] -translate-x-1/2 bg-neutral-500/50 transition-opacity dark:bg-white/35 ${lit}`}
        />
      )}
    </div>
  );
}
