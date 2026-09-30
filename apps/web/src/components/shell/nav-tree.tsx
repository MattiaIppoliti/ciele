"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { IntentLink } from "@/components/ui/intent-link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { LucideIcon } from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { NAV_TREE_PITCH, navTreeGeometry } from "@/lib/nav-tree";
import { cn } from "@/lib/utils";

/**
 * A nested group under a sidebar row, drawn with an elbow connector.
 *
 * What it is for: a destination whose *parts* are worth reaching directly.
 * Settings is the case that asked for it (#settings-modal), because it is a
 * dialog over six tab routes, and the sidebar only ever offered the first one:
 * getting to Billing meant opening General and then finding the rail, with the
 * console dimmed behind a modal the whole time. Unfolded here, every tab is a
 * click from anywhere in the console instead.
 *
 * Two departures from the rows above it, both deliberate:
 *
 *  - **No background pill on the active row.** Every other nav row marks itself
 *    with `bg-muted`. Here the elbow already points at the active item, and a
 *    filled pill sitting on top of the line it terminates reads as two marks
 *    arguing. Weight and ink do it instead.
 *  - **No background pill on the *active* row**, only on the hovered one.
 *    The elbow already points at the active item, and a filled pill sitting
 *    on top of the line it terminates reads as two marks arguing.
 *
 * They do glide with the rest of the nav. They used to be excluded, because
 * the pill measured `offsetTop` against the row's offsetParent and this group
 * is `relative` for the connector's sake, which put the pill in the wrong
 * column. `HoverHighlight` measures against its own box now, so a nested row
 * is no longer a special case and these rows answer the pointer the way every
 * row above them does.
 */

export interface NavTreeItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export function NavTree({
  items,
  activeIndex,
  label,
}: {
  items: NavTreeItem[];
  /** -1 when the current route is outside the group. */
  activeIndex: number;
  /** Names the group for a screen reader, e.g. "Settings sections". */
  label: string;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const pitch = useRowPitch(groupRef);
  const tree = navTreeGeometry({ count: items.length, activeIndex, pitch });
  if (items.length === 0) return null;

  return (
    // Two boxes, and the outer one is the indent. `pl` rather than `ml`
    // because the nav column is `items-center`: a full-width child plus a left
    // margin is 18px wider than the column, and a centred overflow splits the
    // difference, so the trunk came out 9px left of where the arithmetic said.
    // Padding keeps the box the column's width and moves what is inside it.
    <div className="w-full pl-[18px]">
      <div
        // 18px puts the trunk under the parent row's icon: rows pad by 10 and
        // the glyph is 16 wide, so its middle is 18 from the row's edge. A
        // connector hanging off the glyph is what makes these read as owned by
        // the row above rather than merely indented under it.
        ref={groupRef}
        className="relative flex flex-col"
        role="group"
        aria-label={label}
      >
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0"
          width={tree.width}
          height={tree.height}
          viewBox={`0 0 ${tree.width} ${tree.height}`}
          fill="none"
        >
          <path
            d={tree.trunk}
            className="stroke-border"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {tree.branch && (
            <path
              d={tree.branch}
              className="stroke-foreground/70 transition-colors duration-150"
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>

        {items.map((item, index) => (
          <IntentLink
            key={item.href}
            href={item.href}
            data-highlight-row
            // Drawn at the connector's own pitch rather than at `h-8 gap-0.5`:
            // the same 34px, but one number the elbows can be placed against
            // instead of two that have to keep agreeing.
            style={{ height: NAV_TREE_PITCH }}
            className={cn(
              "press relative flex items-center gap-2 rounded-md pr-2 pl-5 text-sm transition-colors",
              index === activeIndex
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
            aria-current={index === activeIndex ? "page" : undefined}
          >
            <AnimatedIcon icon={item.icon} size={14} className="shrink-0" />
            <span className="truncate">{item.label}</span>
          </IntentLink>
        ))}
      </div>
    </div>
  );
}

/**
 * The rows' real pitch, px. The rows are drawn at `NAV_TREE_PITCH`, but the
 * mobile drawer raises every nav row to a 38px touch target from `globals.css`
 * (`[data-nav-drawer] [data-highlight-row]`), and a connector drawn at 34 then
 * slid 10px further off its row with each one: by the eighth row the elbow
 * pointed at the gap between two items. So the tree reads the pitch from the
 * first row rather than assuming it, and follows it through a resize.
 */
function useRowPitch(groupRef: React.RefObject<HTMLDivElement | null>) {
  const [pitch, setPitch] = useState(NAV_TREE_PITCH);
  useLayoutEffect(() => {
    const row = groupRef.current?.querySelector<HTMLElement>("[data-highlight-row]");
    if (!row) return;
    const measure = () => {
      const height = row.offsetHeight;
      if (height > 0) setPitch(height);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [groupRef]);
  return pitch;
}

/**
 * A sidebar row with a foldable tree of its own parts hanging off it.
 *
 * Both groups in this sidebar work the same way and neither is a special
 * case: the row still goes where it always went (Settings to its first tab,
 * Assistants to the dashboard), and the chevron beside it folds the children
 * without navigating anywhere. Folded by default: sixteen children between
 * them is more sidebar than most sessions need, and the nav is a column with a
 * scroller at the bottom of it. Unfolding is one click, and it is remembered,
 * so somebody who lives in Settings pays for it once.
 */
export function NavFoldGroup({
  name,
  row,
  label,
  items,
  activeIndex,
  collapsed,
}: {
  /** Short slug: keys the `aria-controls` id. */
  name: string;
  /** The parent row, rendered as-is. */
  row: React.ReactNode;
  /** Names the group and the fold control, e.g. "assistant sections". */
  label: string;
  items: NavTreeItem[];
  activeIndex: number;
  collapsed: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const regionId = `sidebar-group-${name}`;

  function toggle() {
    setOpen((wasOpen) => !wasOpen);
  }

  return (
    <>
      {/* The row and its fold control are siblings, not nested: a button
          inside a link is invalid, and making the whole row toggle instead
          would cost the one thing the row is for. The chevron sits over the
          link's right end. */}
      {/* `justify-center` is what keeps the rail straight. A collapsed row is
          a 36px box, and in a plain block wrapper it sits at the wrapper's
          left edge: 4px off the 60px rail's centre, which every row outside a
          fold group is on. Two of the sidebar's icons were the only ones
          drawn off-axis, and this was why. Inert when expanded, where the row
          is `w-full` anyway. */}
      {/* Expanded, the row splits in two: its icon and label open the page,
          the empty rest of it folds the group, the way the chevron does.
          Pointer clicks only: a keyboard Enter on the link is a click with
          `detail` 0 and still navigates, and the chevron stays the keyboard's
          fold control. */}
      <div
        className="relative flex w-full justify-center"
        onClickCapture={(event) => {
          if (collapsed || event.detail === 0) return;
          const target = event.target as HTMLElement;
          if (!target.closest("a") || target.closest("[data-nav-target]")) return;
          event.preventDefault();
          toggle();
        }}
      >
        {row}
        {!collapsed && (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={regionId}
            aria-label={`${open ? "Hide" : "Show"} ${label}`}
            className="press-control text-muted-foreground hover:bg-muted hover:text-foreground absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md transition-colors"
          >
            {/* The sidebar's one fold marker: a small solid triangle, down
                when open and right when shut. */}
            <svg
              aria-hidden
              viewBox="0 0 8 8"
              className={cn(
                "shrink-0 transition-transform duration-200",
                !open && "-rotate-90",
                reduceMotion && "duration-0",
                "size-2.5"
              )}
            >
              <path d="M1 2.5h6L4 6.5z" fill="currentColor" />
            </svg>
          </button>
        )}
      </div>

      {/* The rail shows the parent row alone. Its children are one click
          away on the page the row opens (an Assistant's Overview lists its
          sections, Settings its tabs), and a flat run of every section's icon
          under it made the rail twice as tall as the nav it stands in for. */}
      <AnimatePresence initial={false}>
        {!collapsed && open && (
          <motion.div
            id={regionId}
            key={regionId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : {
                    height: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
                    opacity: { duration: 0.15 },
                  }
            }
            // The connector is absolutely positioned inside, so the group has
            // to clip while its height animates or the trunk draws past the
            // fold.
            className="w-full overflow-hidden"
          >
            <NavTree label={label} items={items} activeIndex={activeIndex} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * A titled run of sidebar rows under a caption: "Workspace", "Observability",
 * "Options". The caption is plain text, a step quieter than the rows, and
 * neither navigates nor folds: it names the group, and a control there would
 * be one more thing to hover that goes nowhere. Every row is therefore always
 * out, which is also what the sidebar looks like on every load.
 *
 * On the icon rail there is no room for a caption, so it becomes a rule, and
 * the first section (`first`) draws none, since nothing sits above it to
 * separate from.
 */
export function NavSection({
  label,
  collapsed,
  first = false,
  children,
}: {
  /** The caption, e.g. "Options". */
  label: string;
  collapsed: boolean;
  /** The topmost section: no top margin, no rule on the rail. */
  first?: boolean;
  children: React.ReactNode;
}) {
  const rows = (
    <div
      role="group"
      aria-label={label}
      className="flex w-full flex-col items-center gap-0.5"
    >
      {children}
    </div>
  );

  if (collapsed) {
    return (
      <>
        {!first && <div className="bg-border my-3 h-px w-full" />}
        {rows}
      </>
    );
  }

  return (
    <div className={cn("w-full", !first && "mt-4")}>
      <p
        data-highlight-clear
        className="text-muted-foreground/70 mb-0.5 flex h-7 items-center px-3 text-xs font-medium select-none"
      >
        {label}
      </p>
      {rows}
    </div>
  );
}
