"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { Hint } from "@agent-hub/ui";
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
  const tree = navTreeGeometry({ count: items.length, activeIndex });
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
          <Link
            key={item.href}
            href={item.href}
            data-highlight-row
            // Drawn at the connector's own pitch rather than at `h-8 gap-0.5`:
            // the same 34px, but one number the elbows can be placed against
            // instead of two that have to keep agreeing.
            style={{ height: NAV_TREE_PITCH }}
            className={cn(
              "press relative flex items-center gap-2 rounded-lg pr-2 pl-5 text-[13px] transition-colors",
              index === activeIndex
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
            aria-current={index === activeIndex ? "page" : undefined}
          >
            <item.icon className="size-3.5 shrink-0" />
            <span className="truncate">{item.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
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
  /** Short slug: keys the remembered fold and the `aria-controls` id. */
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
  const storageKey = `ciele:sidebar:${name}-open`;
  const regionId = `sidebar-group-${name}`;

  /**
   * A fold that springs back on the next reload is not a fold, so it is
   * remembered per browser. Read in an effect rather than in the initial
   * state, because the server renders this markup too and a value only the
   * browser has would not match it; deferred by a tick because setting state
   * in an effect body cascades renders and the compiler's lint refuses it.
   * Somebody who unfolded it therefore sees one frame of it folded, which is
   * the cheaper of the two wrong first paints: a group that opens is a group
   * appearing, where one that shuts is the nav jumping under the pointer.
   */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (window.localStorage.getItem(storageKey) === "1") setOpen(true);
      } catch {
        // Private window, blocked site data: the default stands.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  function toggle() {
    setOpen((wasOpen) => {
      try {
        window.localStorage.setItem(storageKey, wasOpen ? "0" : "1");
      } catch {
        // Not remembering it is no reason to refuse to fold it.
      }
      return !wasOpen;
    });
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
      <div className="relative flex w-full justify-center">
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
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform duration-200",
                open && "rotate-90",
                reduceMotion && "duration-0"
              )}
            />
          </button>
        )}
      </div>

      {/* On the rail the children are always out, as a flat run of icons.
          The fold control is the only way to open a group, and the rail has
          no room for one, so folding there meant nine destinations that could
          not be reached at all without widening the sidebar first. No
          connector: a 36px column has nowhere to draw one, and with the group
          always open there is no fold state for it to describe. */}
      {collapsed && (
        <div
          id={regionId}
          role="group"
          aria-label={label}
          className="flex w-full flex-col items-center gap-0.5"
        >
          {items.map((item, index) => (
            <Hint key={item.href} label={item.label} side="right">
              <Link
                href={item.href}
                aria-label={item.label}
                aria-current={index === activeIndex ? "page" : undefined}
                data-highlight-row
                className={cn(
                  "press relative flex h-8 w-9 items-center justify-center rounded-lg transition-colors",
                  index === activeIndex
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <item.icon className="size-3.5 shrink-0" />
              </Link>
            </Hint>
          ))}
        </div>
      )}

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
