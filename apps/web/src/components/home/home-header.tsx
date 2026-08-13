"use client";

import Link from "next/link";
import React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
// Icon *data* (not components) for the two marks that reshape rather than
// swap: the theme toggle and the mobile menu button.
import { Menu as MenuData, Moon as MoonData, Sun as SunData, X as XData } from "lucide";
import { MorphIcon } from "morphicons/react";
import { Button, cn } from "@agent-hub/ui";
import { GhostMark } from "@/components/auth/ghost-mark";
import { Magnetic } from "@/components/core/magnetic";
import { useTheme } from "@/components/theme-provider";
import { menuItems, type MenuItem } from "@/components/home/nav-menu";
import {
  MobileMenuList,
  PanelContent,
  loadAnimatedIcons,
} from "@/components/home/nav-panel";
import { Reveal } from "@/components/home/reveal";

/**
 * The marketing header: the morphing pill, and the state that drives it.
 *
 * What the menus *contain* lives in `nav-menu` (the tree) and `nav-panel` (how a
 * menu renders). What stays here is what genuinely needs a client: which
 * dropdown is open, where the shared panel sits, and the measurement that keeps
 * it under its trigger.
 */

/** Breathing room the panel keeps from either edge of the viewport. */
const MIN_PANEL_MARGIN = 16;

/** How long the pointer may be outside the nav cluster before it closes. */
const CLOSE_GRACE_MS = 220;

/* Motion values of the directional-hover header the panel's movement is copied
   from: the contents cross-slide by CONTENT_X, and the rows inside stagger
   against the pointer's travel (see nav-panel). */
const PANEL_EASE = [0.16, 1, 0.3, 1] as const;
const CONTENT_X = 84;
/** Panel height tween (open, close and every swap between two panels). */
const HEIGHT_DURATION = 0.28;

/**
 * One panel shared by every dropdown (resend.com-style): it slides along the
 * nav to sit under the open trigger and morphs to that panel's size, while the
 * contents cross-slide — outgoing leaves toward the previous trigger, incoming
 * enters from the new one. `direction` is +1 when moving right along the nav.
 *
 * The caller keeps the last opened item rendering while the panel closes, so
 * closing fades out rather than collapsing to nothing first.
 */
function DropdownPanel({
  item,
  x,
  direction,
  open,
  onNavigate,
  cardRef,
}: {
  item: MenuItem | undefined;
  x: number;
  direction: number;
  open: boolean;
  onNavigate: () => void;
  cardRef: React.RefObject<HTMLDivElement | null>;
}) {
  const reduceMotion = useReducedMotion();
  /* Cross-slide the way the reference header does it: moving right along the
     nav (direction +1) brings the new panel in from the right and pushes the
     old one out to the left. */
  const slide = reduceMotion ? 0 : CONTENT_X * direction;
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const [height, setHeight] = React.useState<number | "auto">("auto");

  /* The card tweens to each panel's height instead of snapping. Measured off
     the body (`popLayout` pulls the outgoing panel out of flow, so this is the
     incoming panel's height), not animated with `layout` — that measures
     through the `-translate-x-1/2` ancestor and pinned the width. */
  React.useEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setHeight(entry.contentRect.height)
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      aria-hidden={!open}
      data-nav-panel
      className="absolute left-0 top-full z-30"
      initial={false}
      animate={{ x, opacity: open ? 1 : 0, y: open ? 0 : -6 }}
      transition={{
        x: { type: "spring", stiffness: 420, damping: 40, mass: 0.7 },
        default: { duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] },
      }}
      style={{ pointerEvents: open ? "auto" : "none" }}
    >
      {/* Transparent padding around the card is the hit area that makes the
          panel reachable: pt-4 bridges the visible gap under the trigger, and
          px-8/pb-6 catch a diagonal approach that overshoots the card's edge.
          The centering translate lives here, on the padded box, so the card
          still lines up with the trigger. */}
      <div className="-translate-x-1/2 px-8 pb-6 pt-4">
        {/* Sized by its content, not by a layout animation. `layout` measures
            through its ancestors, and this card sits inside a `-translate-x-1/2`
            box, so it kept the previous panel's width: the Docs icon grid
            spilled out over the page. The panel still slides and cross-fades. */}
        <motion.div
          ref={cardRef}
          animate={{ height }}
          transition={{
            duration: reduceMotion ? 0 : HEIGHT_DURATION,
            ease: PANEL_EASE,
          }}
          className="bg-background/95 relative w-max overflow-hidden rounded-3xl border shadow-2xl shadow-black/10 backdrop-blur-xl dark:shadow-black/40"
        >
          <div ref={bodyRef}>
            {/* popLayout pulls the outgoing panel out of flow, so the card
                resizes to the incoming one instead of stretching to fit both. */}
            <AnimatePresence mode="popLayout" initial={false}>
              {item && (
                <motion.div
                  key={item.name}
                  initial={{ opacity: 0, x: slide }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -slide }}
                  transition={{
                    x: { duration: reduceMotion ? 0 : 0.26, ease: PANEL_EASE },
                    opacity: { duration: reduceMotion ? 0 : 0.16, ease: "easeOut" },
                  }}
                >
                  <PanelContent
                    item={item}
                    direction={direction}
                    onNavigate={onNavigate}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // The server cannot know the visitor's theme, and a morph target that
  // differs between the two renders is a hydration mismatch. Draw the sun
  // until mounted, then let the real state morph it. `useSyncExternalStore`
  // rather than setState in an effect, which the repo's lint rules refuse.
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const dark = mounted && resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {/* Sun and moon are one shape that reshapes, not two icons swapped by a
          `dark:hidden` pair (morphicons.com). */}
      <MorphIcon icon={dark ? MoonData : SunData} size={16} />
    </Button>
  );
}

/**
 * Both CTA sets are rendered and CSS shows one, keyed on the signed-in hint that
 * an inline script puts on <html> before first paint (see lib/auth-hint.ts).
 *
 * Not a React branch on purpose: knowing the caller server-side meant reading a
 * cookie in the marketing layout, which made all seven pages dynamic. The hidden
 * half is `display: none`, so it is out of the accessibility tree too — a screen
 * reader announces one CTA, not both. Rules live in home.css.
 */
export function HomeHeader({ scrolled }: { scrolled: boolean }) {
  const [menuState, setMenuState] = React.useState(false);
  // Which desktop dropdown is open (null = none). Hover-driven, click-toggled.
  const [openMenu, setOpenMenu] = React.useState<string | null>(null);
  // Mobile: which group is expanded inside the menu card (one at a time).
  const [mobileGroup, setMobileGroup] = React.useState<string | null>(null);
  // The last opened item stays rendered while the panel fades out, so closing
  // doesn't collapse the card to zero before it disappears.
  const [lastMenu, setLastMenu] = React.useState<string | null>(null);
  // Where the shared panel sits (px from the nav list's left edge) and which
  // way the contents should slide: +1 when the pointer moved right along it.
  const [panelX, setPanelX] = React.useState(0);
  const [direction, setDirection] = React.useState(0);
  const listRef = React.useRef<HTMLUListElement>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const triggerRefs = React.useRef(new Map<string, HTMLElement>());
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Closing on the first mouseleave made the panel almost unreachable: any
     path from the trigger to the card that isn't dead vertical leaves the
     cluster for a frame or two. Leaving arms a short timer instead, and
     coming back anywhere in the cluster disarms it. */
  const cancelClose = React.useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const closeNow = React.useCallback(() => {
    cancelClose();
    setOpenMenu(null);
  }, [cancelClose]);

  const scheduleClose = React.useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpenMenu(null), CLOSE_GRACE_MS);
  }, [cancelClose]);

  React.useEffect(() => cancelClose, [cancelClose]);

  const measure = React.useCallback((name: string) => {
    const trigger = triggerRefs.current.get(name);
    const list = listRef.current;
    if (!trigger || !list) return;
    const triggerBox = trigger.getBoundingClientRect();
    const listBox = list.getBoundingClientRect();
    const center = triggerBox.left + triggerBox.width / 2;
    // Keep the card on screen: the widest panel is ~840px, so centring it on an
    // outer trigger would hang off the edge on a small laptop.
    const half = (cardRef.current?.offsetWidth ?? 0) / 2;
    const clamped = Math.min(
      Math.max(center, MIN_PANEL_MARGIN + half),
      window.innerWidth - MIN_PANEL_MARGIN - half
    );
    setPanelX(clamped - listBox.left);
  }, []);

  const openPanel = React.useCallback(
    (name: string) => {
      setOpenMenu((current) => {
        if (current === name) return current;
        const order = menuItems.map((entry) => entry.name);
        const from = current ? order.indexOf(current) : -1;
        setDirection(from === -1 ? 0 : Math.sign(order.indexOf(name) - from));
        return name;
      });
      setLastMenu(name);
      measure(name);
      cancelClose();
    },
    [measure, cancelClose]
  );

  /* The pill itself is still tweening its width when the panel opens during a
     scroll morph, so one measurement at hover time can land under the wrong
     spot. Re-measure for the length of that tween, then on every resize. */
  React.useEffect(() => {
    if (!openMenu) return;
    let frame = 0;
    const deadline = performance.now() + 600;
    const track = () => {
      measure(openMenu);
      if (performance.now() < deadline) frame = requestAnimationFrame(track);
    };
    frame = requestAnimationFrame(track);
    const onResize = () => measure(openMenu);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, [openMenu, measure]);

  React.useEffect(() => {
    if (!openMenu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeNow();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openMenu, closeNow]);

  return (
    <header>
      <nav
        data-state={menuState ? "active" : undefined}
        // Mobile (<lg) drives the pill's max-width from home.css off these
        // attributes rather than Tailwind's max-w-* utilities, so the scroll
        // morph can animate a length→length tween that beats the layered
        // utilities and stays in sync across auth/menu states.
        data-scrolled={scrolled ? "true" : undefined}
        className="fixed z-20 w-full px-2"
      >
        <div
          className={cn(
            // The border and radius exist in both states (transparent border
            // when expanded) so the pill morphs smoothly — otherwise the
            // 1px border pops in as a hard rectangle mid-transition.
            // max-lg:rounded-[2.5rem]: on mobile the pill is a stadium when
            // closed and reads as a rounded card once the menu stretches it
            // open (see home.css). At lg the desktop pill glides narrower.
            "mx-auto mt-2 max-w-6xl rounded-2xl border border-transparent px-6 transition-all duration-500 ease-in-out max-lg:rounded-[2.5rem] lg:px-12",
            // Collapse to a definite max-width (not max-w-fit): CSS reliably
            // tweens length→length everywhere, so the pill glides narrower
            // instead of snapping. Sized per auth state to clear the widest the
            // row can get — logo + the three nav items (two of them dropdown
            // triggers, so they carry a chevron) + the CTA cluster. Too narrow
            // and the row squeezes or wraps instead of gliding — the four nav
            // items alone measure ~680px at rest.
            // The signed-out width is the wider one; home.css trims it for a
            // signed-in caller, since that is now a CSS fact, not a React one.
            scrolled &&
              "bg-background/50 border-border backdrop-blur-lg max-w-[55.5rem] lg:px-6"
          )}
        >
          <div
            className={cn(
              // justify-between in BOTH states with no lg gap: while wide the
              // links spread edge-to-edge; as the pill's max-width tweens
              // narrower on scroll, justify-between keeps distributing the
              // shrinking free space so the groups glide together — one
              // animatable property (max-width), no layout-mode swap, no jump.
              // gap-0 on mobile keeps the closed pill slim (the menu card is
              // pulled out of flow — see home.css).
              // lg:flex-nowrap: on desktop the row is one line, always. Mobile
              // still wraps — that is how the menu card drops below the pill.
              "relative flex flex-wrap items-center justify-between gap-0 py-3 transition-[padding] duration-500 ease-in-out lg:flex-nowrap lg:gap-0 lg:py-4",
              scrolled && "lg:py-2.5"
            )}
          >
            <div className="flex w-full items-center justify-between lg:w-auto">
              <Link
                href="/home"
                aria-label="home"
                data-ghost-logo
                className="flex items-center gap-2 font-medium"
              >
                <GhostMark className="size-7" eyesClassName="ghost-logo-eyes" />
                <span className="font-brand text-lg font-medium leading-none">Ciele</span>
              </Link>

              {/* Mobile top-bar controls: theme toggle sits to the left of the
                  menu/close mark in both the closed pill and the open card. */}
              <div className="-mr-2 flex items-center gap-1 lg:hidden">
                <ThemeToggle />
                <button
                  onClick={() => {
                    // Closing collapses whatever was expanded, so reopening
                    // starts from the four macro areas again.
                    if (menuState) setMobileGroup(null);
                    setMenuState(!menuState);
                  }}
                  aria-label={menuState ? "Close Menu" : "Open Menu"}
                  className="relative z-20 block cursor-pointer p-2.5"
                >
                  {/* One mark that reshapes open to close: the bars of the
                      menu glyph spring into the cross (morphicons.com), which
                      says more than the rotated plus it replaces. */}
                  <MorphIcon
                    icon={menuState ? XData : MenuData}
                    size={24}
                    className="m-auto"
                  />
                </button>
              </div>
            </div>

            {/* Hover opens; leaving the whole cluster (list *and* panel) arms
                the close timer, so sliding sideways between triggers — or
                diagonally down into the open panel — never flickers it shut. */}
            <div
              className="relative hidden size-fit lg:block"
              onMouseEnter={() => {
                cancelClose();
                // Entering the nav is the earliest signal the Docs panel might
                // open, so the animated module is usually there by the time a
                // tile is hovered.
                loadAnimatedIcons();
              }}
              onMouseLeave={scheduleClose}
            >
              <ul ref={listRef} className="flex gap-8 text-sm">
                {menuItems.map((item) =>
                  item.columns ? (
                    <li key={item.name}>
                      <button
                        type="button"
                        ref={(node) => {
                          if (node) triggerRefs.current.set(item.name, node);
                          else triggerRefs.current.delete(item.name);
                        }}
                        aria-expanded={openMenu === item.name}
                        aria-haspopup="true"
                        onMouseEnter={() => openPanel(item.name)}
                        onFocus={() => openPanel(item.name)}
                        onClick={() =>
                          openMenu === item.name ? closeNow() : openPanel(item.name)
                        }
                        className="group/trigger text-muted-foreground hover:text-foreground aria-expanded:text-foreground flex cursor-pointer items-center gap-1 duration-150"
                      >
                        <span>{item.name}</span>
                        <ChevronDown className="size-3.5 duration-200 group-aria-expanded/trigger:rotate-180" />
                      </button>
                    </li>
                  ) : (
                    <li key={item.name}>
                      <Link
                        href={item.href}
                        target={item.external ? "_blank" : undefined}
                        rel={item.external ? "noopener noreferrer" : undefined}
                        onMouseEnter={closeNow}
                        className="text-muted-foreground hover:text-foreground block duration-150"
                      >
                        <span>{item.name}</span>
                      </Link>
                    </li>
                  )
                )}
              </ul>

              {/* One panel for the whole nav — it glides between triggers and
                  morphs to each panel's size (see DropdownPanel). Sibling of
                  the list, not a child: a <ul> may only contain <li>. */}
              <DropdownPanel
                item={menuItems.find((entry) => entry.name === (openMenu ?? lastMenu))}
                x={panelX}
                direction={direction}
                open={openMenu !== null}
                onNavigate={closeNow}
                cardRef={cardRef}
              />
            </div>

            <div className="home-mobile-menu bg-background lg:in-data-[state=active]:flex mb-6 w-full flex-wrap items-center justify-end space-y-8 rounded-3xl border p-6 shadow-2xl shadow-zinc-300/20 md:flex-nowrap lg:m-0 lg:flex lg:w-fit lg:gap-6 lg:space-y-0 lg:border-transparent lg:bg-transparent lg:p-0 lg:shadow-none dark:shadow-none dark:lg:bg-transparent">
              {/* Mobile: menu links pinned to the top of the card. */}
              <MobileMenuList
                openGroup={mobileGroup}
                onToggleGroup={(name) =>
                  setMobileGroup((current) => (current === name ? null : name))
                }
                onNavigate={() => setMenuState(false)}
              />

              {/* Desktop inline nav cluster (theme toggle + CTAs); hidden on
                  mobile, where the top bar and the buttons below take over. */}
              <div
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("a")) {
                    setMenuState(false);
                  }
                }}
                className="hidden items-center gap-3 lg:flex"
              >
                <ThemeToggle />
                {/* `display: contents` while shown, so the cluster's gap-3 still
                    spaces the buttons themselves — see home.css. */}
                <div className="home-cta-authed">
                  <Magnetic range={38} intensity={0.14} maxOffset={7}>
                    <Button size="sm" nativeButton={false} render={<Link href="/" />}>
                      <span>Open app</span>
                    </Button>
                  </Magnetic>
                </div>
                <div className="home-cta-anon">
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={<Link href="/login" />}
                  >
                    <span>Log in</span>
                  </Button>
                  <Magnetic range={38} intensity={0.14} maxOffset={7}>
                    <Button
                      size="sm"
                      nativeButton={false}
                      render={<Link href="/contact/sales" />}
                    >
                      <span>Get a demo</span>
                    </Button>
                  </Magnetic>
                </div>
              </div>

              {/* Mobile: large CTA buttons absolutely pinned to the bottom
                  edge, so they ride it down smoothly as the card grows. */}
              <div
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("a")) {
                    setMenuState(false);
                  }
                }}
                className="absolute inset-x-6 bottom-8 flex flex-col gap-3 lg:hidden"
              >
                <div className="home-cta-authed">
                  <Reveal delay={0.34}>
                    <Button
                      className="h-14 w-full rounded-full text-base font-medium"
                      nativeButton={false}
                      render={<Link href="/" />}
                    >
                      <span>Open app</span>
                    </Button>
                  </Reveal>
                </div>
                <div className="home-cta-anon">
                  <Reveal delay={0.34}>
                    <Button
                      className="h-14 w-full rounded-full text-base font-medium"
                      nativeButton={false}
                      render={<Link href="/contact/sales" />}
                    >
                      <span>Get a demo</span>
                    </Button>
                  </Reveal>
                  <Reveal delay={0.42}>
                    <Button
                      variant="secondary"
                      className="h-14 w-full rounded-full text-base font-medium"
                      nativeButton={false}
                      render={<Link href="/login" />}
                    >
                      <span>Log in</span>
                    </Button>
                  </Reveal>
                </div>
              </div>
            </div>
          </div>
        </div>
      </nav>
    </header>
  );
}
