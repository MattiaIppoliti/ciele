"use client";

// Adapted from Bencho Action node (MIT), copyright (c) 2026 Lorenzo Cabra.
// https://bencho.dev/licence — see action-node.LICENSE.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { LucideIcon } from "lucide-react";
import { SPRING_SWAP } from "@/lib/ease";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable";

export interface ActionNodeControlProps {
  className: string;
  tabIndex: number;
  onOpenChange: (open: boolean) => void;
}

export type ActionNodeControl = {
  id: string;
  label: string;
  disabled?: boolean;
} & (
  | { icon: LucideIcon; run: () => void; render?: never }
  | { render: (props: ActionNodeControlProps) => ReactNode; icon?: never; run?: never }
);

/* the button and half of it. Everything else that has a size
   is measured off this one — the spacing, the hiding place,
   the air the block keeps — so the buttons grow by changing
   this number and nothing else. */
const DOT = 36;
const R = DOT / 2;

/* centre to centre along the path. A real distance rather
   than an angle, which is the point of laying these out by
   arc length: twelve pixels of air between two buttons is
   twelve pixels whatever the corner is doing. */
const SPACING = DOT + 12;

/* ── they ride the card's OWN corner, offset ───────────────
   The path is the card's outline pushed out by a constant
   distance: straight along the top edge, round the corner on
   an arc concentric with it, straight down the right edge.
   Buttons are placed by how far along that path they are.

   An offset path has neither problem because it is the card's
   own shape: every point on it is exactly `gap` from the
   nearest card surface, corner or edge, at every radius.

   `s` is arc length measured from where the corner arc meets
   the top edge, so the corner occupies 0..len and anything
   outside that has run onto a straight. */
function ride(s: number, corner: number, off: number) {
  const arc = Math.max(0.001, corner + off);
  const len = (arc * Math.PI) / 2;
  if (s <= 0) return { x: -corner + s, y: -off };
  if (s >= len) return { x: off, y: corner + (s - len) };
  const th = Math.PI / 2 - s / arc;
  return {
    x: -corner + arc * Math.cos(th),
    y: corner - arc * Math.sin(th),
  };
}

/* ── where they hide, and it has to be PROVABLY inside ─────
   A point on the card's diagonal, far enough in that a whole
   button fits behind the card with nothing showing past the
   corner. The two pixels of margin keep a tangent button
   from drawing a hairline past the boundary. */
const hideAt = (corner: number) =>
  corner >= R + 2
    ? corner * Math.SQRT2
    : Math.max(R * Math.SQRT2 + 2, corner * Math.SQRT2 + corner + 2);

/* ── THEY COME OUT OF THE CORNER, THEY DO NOT ARRIVE AT IT ─
   The controls start inside the card's top-right corner and
   travel out along its outline. The card is visibly where
   they came from and the corner is what they are attached to.

   Closing runs the other way, last out first back, so the
   fan folds into the corner rather than collapsing from the
   inside. Ciele uses its shared spring instead of a second
   requestAnimationFrame loop; the geometry stays Bencho's. */
export function ActionNode({
  children,
  controls,
  selected,
  width,
}: {
  children: ReactNode;
  controls: ActionNodeControl[];
  selected: boolean;
  width: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const reduceMotion = useReducedMotion();
  const hoverCapable = useHoverCapable();
  const on = hovered || focused || pinned || (!hoverCapable && selected);

  // React Flow owns the keyboard focusable wrapper. Listen there so Tab onto
  // a node reveals its controls before the next Tab enters the fan.
  useEffect(() => {
    const node = root.current?.closest(".react-flow__node");
    if (!node) return;
    const updateFocus = () => setFocused(node.contains(document.activeElement));
    node.addEventListener("focusin", updateFocus);
    node.addEventListener("focusout", updateFocus);
    return () => {
      node.removeEventListener("focusin", updateFocus);
      node.removeEventListener("focusout", updateFocus);
    };
  }, []);

  // The surface's radius is rem-based. Keep the path concentric even when a
  // Member changes their text size; the CSS and the path share this value.
  const [corner, setCorner] = useState(14);
  useEffect(() => {
    const card = root.current?.querySelector(".flow-surface-card");
    if (!card) return;
    const measure = () => setCorner(parseFloat(getComputedStyle(card).borderTopRightRadius));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  const off = 12 + R;
  const mid = ((corner + off) * Math.PI) / 4;
  const spots = controls.map((_, i) =>
    ride(mid + (i - (controls.length - 1) / 2) * SPACING, corner, off)
  );
  const deep = hideAt(corner) / Math.SQRT2;

  /* ── the air between the card and the fan is a HOLE ─────
     The wrapper's box is the card and the buttons hang
     outside it, so the air between them belongs to nothing.
     The fan carries a hit area, bled a little, measured off
     `spots` so the pointer cannot fall through the gap.
     Live only while the fan is open: empty space must not
     open a card the Member has not pointed at. */
  const BLEED = 6;
  const box = spots.reduce(
    (b, s) => ({
      l: Math.min(b.l, s.x - R - BLEED),
      r: Math.max(b.r, s.x + R + BLEED),
      t: Math.min(b.t, s.y - R - BLEED),
      d: Math.max(b.d, s.y + R + BLEED),
    }),
    { l: 0, r: 0, t: 0, d: 0 }
  );
  const pw = box.r - box.l;
  const ph = box.d - box.t;
  /* The bite is INSIDE the card. Cutting the whole quadrant
     would lose the air outside a rounded corner, exactly
     where the hand goes to reach the middle button. */
  const bx = Math.max(0, -box.l - corner);
  const by = Math.min(ph, -box.t + corner);

  return (
    <div
      ref={root}
      className="flow-action-node"
      data-on={on || undefined}
      style={{ width }}
      onPointerEnter={(event) => { if (event.pointerType !== "touch") setHovered(true); }}
      onPointerLeave={() => setHovered(false)}
      onPointerCancel={() => setHovered(false)}
    >
      {children}
      {/* A zero-sized anchor ON the corner. The fan paints UNDER the card,
          so a folded button is concealed by the card itself, not a fade. */}
      <div className="flow-action-node-fan nodrag nopan" onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}>
        <i className="flow-action-node-reach" aria-hidden="true" data-on={on || undefined}
          style={{ left: box.l, top: box.t, width: pw, height: ph,
            clipPath: `polygon(0 0, ${pw}px 0, ${pw}px ${ph}px, ${bx}px ${ph}px, ${bx}px ${by}px, 0 ${by}px)` }} />
        {controls.map((control, i) => {
          const spot = spots[i]!;
          const tabIndex = on ? 0 : -1;
          return (
            <motion.div key={control.id} className="flow-action-node-slot"
              aria-hidden={!on}
              initial={false}
              animate={{
                x: reduceMotion || on ? spot.x : -deep,
                y: reduceMotion || on ? spot.y : deep,
                scale: reduceMotion || on ? 1 : 0.82,
                opacity: reduceMotion ? (on ? 1 : 0) : 1,
              }}
              transition={reduceMotion ? { duration: 0.1 } : {
                ...SPRING_SWAP, delay: (on ? i : controls.length - 1 - i) * 0.035,
              }}
              style={{ width: DOT, height: DOT, marginTop: -R, marginLeft: -R,
                pointerEvents: on ? "auto" : "none" }}>
              {control.render ? control.render({ className: "flow-action-node-button", tabIndex, onOpenChange: setPinned }) : (
                <button type="button" className="flow-action-node-button" data-foley-press data-foley-release aria-label={control.label}
                  title={control.label} tabIndex={tabIndex} disabled={control.disabled} onClick={control.run}>
                  <control.icon size={16} strokeWidth={2} />
                </button>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
