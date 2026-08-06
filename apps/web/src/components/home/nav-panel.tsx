"use client";

import Link from "next/link";
import React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { cn } from "@agent-hub/ui";
import { FolderVisual } from "@/components/home/folder-visual";
import type { AnimatedIcon } from "@/components/ui/animated-icon";
import { Reveal } from "@/components/home/reveal";
import {
  DOCS,
  docsAreas,
  menuItems,
  type MenuItem,
  type PanelCard,
} from "@/components/home/nav-menu";

/**
 * What the marketing nav's menus look like inside — the desktop dropdown's
 * contents and the mobile menu's list.
 *
 * Separate from `home-header.tsx` because the header owns the chrome: which
 * panel is open, where it sits, and the measurement that puts it there. What
 * lives here is markup over `nav-menu`'s data plus the motion *inside* a panel
 * (the row stagger, the mobile accordion), and the two facts it cannot know —
 * close the menu once a link is taken, and which mobile group is expanded —
 * arrive as props.
 */

/* Motion values of the directional-hover header the panel's movement is copied
   from: every row inside a panel enters from ITEM_X and the rows fire
   STAGGER_STEP apart — front-to-back when the pointer moved left along the nav,
   back-to-front when it moved right. The panel's own cross-slide (CONTENT_X)
   belongs to the header, which owns the panel. */
const ITEM_X = 18;
const STAGGER_STEP = 0.038;

/* The docs tiles are the only animated icons the marketing header draws, and
   importing `animated-icon` eagerly is what put its whole barrel — ~75 animated
   variants plus the ~80 lucide glyphs its lookup map keys on — into every public
   page, for 12 tiles behind a hover. Measured at ~16-18 KB gzip per route on
   /home, /pricing, /features/*, /security and /policies/*.

   Same treatment the hero mock already gets in preview-panes.tsx: render the
   plain lucide glyph, fetch the animated module on the first pointer into the
   nav, then swap. The module survives DocsAreaGrid's remounts (the panel is
   keyed per dropdown, so the grid unmounts whenever another one opens) by
   living at module scope behind a store — `useSyncExternalStore` rather than
   setState in an effect, which this repo's lint rules refuse. */
type AnimatedIconRenderer = typeof AnimatedIcon;

let animatedIcon: AnimatedIconRenderer | null = null;
let animatedIconPending = false;
const animatedIconListeners = new Set<() => void>();

export function loadAnimatedIcons() {
  // Both entry points fire on pointer events, so this is called repeatedly
  // while the first import is still in flight.
  if (animatedIcon || animatedIconPending) return;
  animatedIconPending = true;
  void import("@/components/ui/animated-icon").then((module) => {
    animatedIcon = module.AnimatedIcon;
    for (const notify of animatedIconListeners) notify();
  });
}

function useAnimatedIcon() {
  return React.useSyncExternalStore(
    (onChange) => {
      animatedIconListeners.add(onChange);
      return () => {
        animatedIconListeners.delete(onChange);
      };
    },
    () => animatedIcon,
    // The server has no animated module either, so both renders agree.
    () => null
  );
}

/**
 * The abstract artwork under a promo card's title. Decorative only (hence
 * `aria-hidden`), drawn in `currentColor` so it inherits the card's muted tone
 * and works in both themes without a second palette.
 */
function CardVisual({ visual }: { visual: PanelCard["visual"] }) {
  if (visual === "folder") return <FolderVisual />;

  if (visual === "list") {
    return (
      <span className="bg-background/70 mt-3 block rounded-xl border p-2.5 shadow-sm">
        <span className="text-muted-foreground block text-[0.625rem]">Controls</span>
        <span className="mt-2 block space-y-2" aria-hidden>
          {[0.9, 0.65, 0.8, 0.5].map((w, i) => (
            <span key={i} className="flex items-center gap-2">
              <span className="bg-muted-foreground/30 size-3 shrink-0 rounded-full" />
              <span
                className="bg-muted-foreground/20 h-1.5 rounded-full"
                style={{ width: `${w * 100}%` }}
              />
            </span>
          ))}
        </span>
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className="text-muted-foreground/40 group-hover/card:text-muted-foreground/70 mt-3 block h-20 overflow-hidden duration-300"
    >
      {visual === "flows" ? (
        <svg viewBox="0 0 200 92" className="size-full" fill="none" stroke="currentColor">
          {/* Two triggers on the left fanning into the flows they match —
              the router, drawn as what it does. */}
          {[16, 54].map((y) => (
            <rect
              key={y}
              x="2"
              y={y}
              width="62"
              height="22"
              rx="7"
              strokeWidth="1"
              className="fill-muted/60"
            />
          ))}
          {[
            "M64 27C88 27 88 14 112 14",
            "M64 27C90 27 90 46 112 46",
            "M64 65C90 65 90 78 112 78",
            "M64 65C88 65 88 46 112 46",
          ].map((d) => (
            <path key={d} d={d} strokeWidth="1" className="opacity-50" />
          ))}
          {[3, 35, 67].map((y) => (
            <g key={y}>
              <rect
                x="112"
                y={y}
                width="86"
                height="22"
                rx="7"
                strokeWidth="1"
                className="fill-muted/60"
              />
              <circle cx="124" cy={y + 11} r="3.5" strokeWidth="1.2" />
              <path
                d={`M134 ${y + 11}h52`}
                strokeWidth="2.5"
                strokeLinecap="round"
                className="opacity-40"
              />
            </g>
          ))}
        </svg>
      ) : visual === "lock" ? (
        <svg viewBox="0 0 160 80" className="size-full" fill="none" stroke="currentColor">
          {/* A padlock inside the same concentric rings the Enterprise page
              draws around the organization — governance closing in on one
              thing. The rings widen on hover. */}
          <g className="opacity-60 duration-500 group-hover/card:opacity-100">
            {[22, 32, 42].map((r, index) => (
              <circle
                key={r}
                cx="80"
                cy="40"
                r={r}
                strokeWidth="1"
                className="origin-center duration-500 group-hover/card:scale-[1.06]"
                style={{ transitionDelay: `${index * 60}ms` }}
              />
            ))}
          </g>
          <g strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="70" y="38" width="20" height="15" rx="3" />
            <path d="M74 38v-4a6 6 0 0 1 12 0v4" />
          </g>
        </svg>
      ) : visual === "grid" ? (
        <svg viewBox="0 0 160 80" className="size-full" fill="none" stroke="currentColor">
          {/* Faint graph paper with one routed path drawn over it. */}
          <g strokeWidth="0.5" className="opacity-40">
            {[0, 20, 40, 60, 80, 100, 120, 140, 160].map((x) => (
              <line key={x} x1={x} y1="0" x2={x} y2="80" />
            ))}
            {[0, 20, 40, 60, 80].map((y) => (
              <line key={y} x1="0" y1={y} x2="160" y2={y} />
            ))}
          </g>
          <path d="M30 20v25a5 5 0 0 0 5 5h45" strokeWidth="1.5" />
          <circle cx="30" cy="20" r="3" strokeWidth="1.5" />
          <circle cx="80" cy="50" r="3" strokeWidth="1.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 160 80" className="size-full" fill="none" stroke="currentColor">
          {/* Concentric arcs radiating from the corner — reach/broadcast. */}
          {[20, 42, 64, 86, 108].map((r) => (
            <circle key={r} cx="10" cy="78" r={r} strokeWidth="1" className="opacity-70" />
          ))}
        </svg>
      )}
    </span>
  );
}

/**
 * A dropdown's promo tile: badge + title over `CardVisual`. The whole card is
 * one link, and the visual reacts to its hover.
 */
function DropdownCard({ card, onNavigate }: { card: PanelCard; onNavigate: () => void }) {
  return (
    <Link
      href={card.href}
      target={card.external ? "_blank" : undefined}
      rel={card.external ? "noopener noreferrer" : undefined}
      onClick={onNavigate}
      className="group/card bg-muted/40 hover:bg-muted/70 relative block w-56 shrink-0 overflow-hidden rounded-2xl border p-4 duration-200"
    >
      <span className="text-muted-foreground text-xs">{card.badge}</span>
      <span className="mt-0.5 block text-sm font-medium">{card.title}</span>
      <CardVisual visual={card.visual} />
    </Link>
  );
}

function DocsAreaGrid({ onNavigate }: { onNavigate: () => void }) {
  const Animated = useAnimatedIcon();

  return (
    /* Four columns of 44px tiles: three rows land at the same height as the
       five-link column beside it, so the panel reads as one block. */
    <div
      // Backstop for a pointer that reaches the grid before the nav-cluster
      // preload has resolved (or never entered the cluster — keyboard focus
      // opens the panel too).
      onPointerEnter={loadAnimatedIcons}
      className="grid shrink-0 grid-cols-4 gap-1 self-center"
    >
      {docsAreas.map(({ name, href, Icon }) => (
        <Link
          key={href}
          href={`${DOCS}${href}`}
          target="_blank"
          rel="noopener noreferrer"
          title={name}
          onClick={onNavigate}
          className="text-muted-foreground/70 hover:bg-muted hover:text-foreground flex size-11 items-center justify-center rounded-xl duration-150"
        >
          {Animated ? <Animated icon={Icon} size={19} /> : <Icon size={19} />}
          <span className="sr-only">{name}</span>
        </Link>
      ))}
    </div>
  );
}

/**
 * The stagger schedule for one panel's rows: `total` rows, played in reverse
 * when the pointer travelled right (`direction` +1), so the wave always runs
 * against the pointer's own travel. `direction` 0 (first open) keeps the
 * natural order.
 */
function useRowMotion(total: number, direction: number) {
  const reduceMotion = useReducedMotion();
  const dx = reduceMotion ? 0 : direction > 0 ? ITEM_X : -ITEM_X;

  return (index: number) => ({
    initial: { opacity: 0, x: dx, y: reduceMotion ? 0 : 5 },
    animate: { opacity: 1, x: 0, y: 0 },
    transition: reduceMotion
      ? { duration: 0 }
      : {
          duration: 0.18,
          ease: "easeOut" as const,
          delay: (direction > 0 ? total - 1 - index : index) * STAGGER_STEP,
        },
  });
}

/** The inside of one dropdown: link columns, then the grid or the promo cards. */
export function PanelContent({
  item,
  direction,
  onNavigate,
}: {
  item: MenuItem;
  direction: number;
  onNavigate: () => void;
}) {
  /* One flat row index across the whole panel — the link columns first, then
     the docs grid (counted as one row) or the promo cards. */
  const columns = item.columns ?? [];
  const links = columns.reduce((sum, column) => sum + column.length, 0);
  const total = links + (item.areaGrid ? 1 : 0) + (item.cards?.length ?? 0);
  const row = useRowMotion(total, direction);
  let cursor = 0;

  return (
    <div className="flex gap-2 p-2">
      {/* Each column is sized to its longest label (with a floor) rather than
          a fixed width: the one-column Enterprise panel was wrapping
          "Enterprise governance" onto two lines. */}
      {columns.map((column, columnIndex) => (
        <ul key={columnIndex} className="w-max min-w-44 shrink-0 py-1">
          {column.map((child) => (
            <motion.li key={child.name} {...row(cursor++)}>
              <Link
                href={child.href}
                target={child.external ? "_blank" : undefined}
                rel={child.external ? "noopener noreferrer" : undefined}
                onClick={onNavigate}
                className="text-muted-foreground hover:bg-muted hover:text-foreground block whitespace-nowrap rounded-xl px-3 py-2 duration-150"
              >
                {child.name}
              </Link>
            </motion.li>
          ))}
        </ul>
      ))}
      {item.areaGrid && (
        <motion.div className="shrink-0 self-center" {...row(cursor++)}>
          <DocsAreaGrid onNavigate={onNavigate} />
        </motion.div>
      )}
      {item.cards?.map((card) => (
        <motion.div key={card.title} className="shrink-0" {...row(cursor++)}>
          <DropdownCard card={card} onNavigate={onNavigate} />
        </motion.div>
      ))}
    </div>
  );
}

/**
 * A nav group on touch, where there is no hover to open a panel: the macro
 * area is a row you tap, and its links spring out underneath with the same
 * overshoot the menu card itself opens with. Only one group is open at a time,
 * so the card never outgrows the screen.
 */
function MobileGroup({
  item,
  open,
  onToggle,
  onNavigate,
}: {
  item: MenuItem;
  open: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const links = item.columns?.flat() ?? [];

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="text-muted-foreground aria-expanded:text-foreground flex w-full items-center justify-between gap-3 text-3xl font-light tracking-tight duration-150"
      >
        <span>{item.name}</span>
        <ChevronDown
          className={cn("size-5 duration-300 ease-out", open && "rotate-180")}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="links"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : // Springy on the way out, quick and plain on the way back,
                  // an overshooting collapse reads as a glitch.
                  {
                    height: { type: "spring", stiffness: 320, damping: 22, mass: 0.8 },
                    opacity: { duration: 0.18 },
                  }
            }
            className="overflow-hidden"
          >
            <ul className="mt-2 space-y-1.5 pl-1">
              {links.map((child, index) => (
                <motion.li
                  key={child.name}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { delay: 0.03 + index * 0.025, duration: 0.25, ease: [0.16, 1, 0.3, 1] }
                  }
                >
                  <Link
                    href={child.href}
                    target={child.external ? "_blank" : undefined}
                    rel={child.external ? "noopener noreferrer" : undefined}
                    onClick={onNavigate}
                    className="text-muted-foreground hover:text-foreground block py-0.5 text-lg font-light duration-150"
                  >
                    {child.name}
                  </Link>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The mobile menu's link list: the four groups only, pinned to the top of the
 * card. Tapping one springs it open (see `MobileGroup`) — listing every child
 * at once outgrew the card and buried the CTAs, so the list scrolls on its own
 * and stops short of them.
 *
 * Which group is expanded is the header's state, not this list's: closing the
 * card collapses it, so reopening starts from the four macro areas again.
 */
export function MobileMenuList({
  openGroup,
  onToggleGroup,
  onNavigate,
}: {
  openGroup: string | null;
  onToggleGroup: (name: string) => void;
  onNavigate: () => void;
}) {
  return (
    <ul className="mt-8 max-h-[calc(100dvh-16rem)] space-y-4 overflow-y-auto pb-6 pr-1 lg:hidden">
      {menuItems.map((item, i) => (
        <li key={item.name}>
          <Reveal delay={0.05 + i * 0.08}>
            {item.columns ? (
              <MobileGroup
                item={item}
                open={openGroup === item.name}
                onToggle={() => onToggleGroup(item.name)}
                onNavigate={onNavigate}
              />
            ) : (
              <Link
                href={item.href}
                target={item.external ? "_blank" : undefined}
                rel={item.external ? "noopener noreferrer" : undefined}
                onClick={onNavigate}
                className="text-muted-foreground hover:text-foreground block text-4xl font-light tracking-tight duration-150"
              >
                <span>{item.name}</span>
              </Link>
            )}
          </Reveal>
        </li>
      ))}
    </ul>
  );
}
