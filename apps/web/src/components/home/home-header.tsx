"use client";

import Link from "next/link";
import React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  BookText,
  ChevronDown,
  Cloud,
  Fingerprint,
  Gauge,
  LayoutGrid,
  LifeBuoy,
  MousePointerClick,
  Rocket,
  Server,
  Unplug,
  Users,
  Workflow,
} from "lucide-react";
// Icon *data* (not components) for the two marks that reshape rather than
// swap: the theme toggle and the mobile menu button.
import { Menu as MenuData, Moon as MoonData, Sun as SunData, X as XData } from "lucide";
import { MorphIcon } from "morphicons/react";
import { Button, cn } from "@agent-hub/ui";
import { GhostMark } from "@/components/auth/ghost-mark";
import { FolderVisual } from "@/components/home/folder-visual";
import { Magnetic } from "@/components/core/magnetic";
import { useTheme } from "@/components/theme-provider";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { FEATURES, type FeatureEntry } from "@/components/marketing/feature-catalog";

// Only destinations that resolve from every page the header renders on.
// "Features" was a bare #features anchor: it scrolled on the marketing home and
// did nothing at all on /pricing, /security or the policy pages.
type MenuLink = { name: string; href: string; external?: boolean };
/** A promo tile in a dropdown: label + title over an abstract visual. */
type PanelCard = {
  badge: string;
  title: string;
  href: string;
  external?: boolean;
  visual: "list" | "grid" | "waves" | "lock" | "folder" | "flows";
};
type MenuItem = MenuLink & {
  /* Present = the item is a dropdown trigger, not a link of its own. `href`
     stays the group's own landing page so the mobile list (which has no
     hover) and keyboard users still get somewhere to go. */
  columns?: MenuLink[][];
  /* Right-hand side of the panel: promo cards, or (Docs only) the icon grid. */
  cards?: PanelCard[];
  areaGrid?: boolean;
};

const DOCS = "https://docs.ciele.app";

/** Every docs link is external and opens in a new tab — spelled once. */
const doc = (name: string, path: string): MenuLink => ({
  name,
  href: `${DOCS}${path}`,
  external: true,
});

/** The Features group is the feature catalogue — one entry, one page. */
const featureLink = (feature: FeatureEntry): MenuLink => ({
  name: feature.label,
  href: `/features/${feature.slug}`,
});

const menuItems: MenuItem[] = [
  {
    name: "Features",
    href: `/features/${FEATURES[0].slug}`,
    /* Split down the middle of the catalogue: building an assistant on the
       left, running it on the right. */
    columns: [
      FEATURES.slice(0, 5).map(featureLink),
      FEATURES.slice(5).map(featureLink),
    ],
    cards: [
      {
        badge: "Route",
        title: "Flows",
        href: "/features/flows",
        visual: "flows",
      },
      {
        badge: "Measure",
        title: "Insights",
        href: "/features/insights",
        visual: "waves",
      },
    ],
  },
  {
    name: "Enterprise",
    href: "/enterprise",
    columns: [
      [
        { name: "Enterprise governance", href: "/enterprise" },
        { name: "Pricing", href: "/pricing" },
        { name: "Security & compliance", href: "/security" },
        { name: "Talk to sales", href: "/contact/sales" },
      ],
    ],
    cards: [
      {
        badge: "Govern",
        title: "Enterprise governance",
        href: "/enterprise",
        visual: "lock",
      },
    ],
  },
  {
    name: "Resources",
    href: "/security",
    columns: [
      [
        { name: "Security", href: "/security" },
        { name: "Privacy", href: "/policies/privacy" },
        { name: "Terms of Service", href: "/policies/terms-of-service" },
        { name: "Cookies", href: "/policies/cookies" },
        { name: "Talk to sales", href: "/contact/sales" },
      ],
    ],
    cards: [
      {
        badge: "Self-host",
        title: "Run it yourself",
        href: `${DOCS}/self-hosting`,
        external: true,
        visual: "folder",
      },
    ],
  },
  {
    name: "Docs",
    href: DOCS,
    external: true,
    areaGrid: true,
    columns: [
      [
        doc("Getting started", "/getting-started"),
        doc("Core concepts", "/getting-started/core-concepts"),
        doc("Create an assistant", "/getting-started/create-an-assistant"),
        doc("Self-hosting", "/self-hosting"),
      ],
    ],
  },
];

/* The Docs panel's right half: one tile per top-level docs area, in the order
   the docs sidebar uses (Start here → Build → Connect → Run → Cloud/self-host).
   Icons, not vendor logos: the docs are product documentation, not an SDK
   reference, so what belongs here is the shape of the manual. These are the
   `@lucide-animated` icons, rendered through `AnimatedIcon` so the animation is
   driven by the tile's own hover — the glyph is 19px inside a 44px target, and
   the icon's built-in listeners would only fire on the glyph itself. */
const docsAreas = [
  { name: "Getting started", href: "/getting-started", Icon: Rocket },
  { name: "Assistants", href: "/assistants", Icon: MousePointerClick },
  { name: "Knowledge", href: "/knowledge", Icon: BookText },
  { name: "Flows", href: "/flows", Icon: Workflow },
  { name: "Help desks", href: "/help-desks", Icon: LifeBuoy },
  { name: "Authentication", href: "/authentication", Icon: Fingerprint },
  { name: "Publishing", href: "/publishing", Icon: Unplug },
  { name: "Operations", href: "/operations", Icon: Gauge },
  { name: "Organization", href: "/organization", Icon: Users },
  { name: "Cloud", href: "/cloud", Icon: Cloud },
  { name: "Self-hosting", href: "/self-hosting", Icon: Server },
  { name: "Architecture", href: "/self-hosting/architecture", Icon: LayoutGrid },
];

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

/** The inside of one dropdown: link columns, then the grid or the promo cards. */
function PanelContent({ item, onNavigate }: { item: MenuItem; onNavigate: () => void }) {
  return (
    <div className="flex gap-2 p-2">
      {/* Each column is sized to its longest label (with a floor) rather than
          a fixed width: the one-column Enterprise panel was wrapping
          "Enterprise governance" onto two lines. */}
      {item.columns?.map((column, columnIndex) => (
        <ul key={columnIndex} className="w-max min-w-44 shrink-0 py-1">
          {column.map((child) => (
            <li key={child.name}>
              <Link
                href={child.href}
                target={child.external ? "_blank" : undefined}
                rel={child.external ? "noopener noreferrer" : undefined}
                onClick={onNavigate}
                className="text-muted-foreground hover:bg-muted hover:text-foreground block whitespace-nowrap rounded-xl px-3 py-2 duration-150"
              >
                {child.name}
              </Link>
            </li>
          ))}
        </ul>
      ))}
      {item.areaGrid && <DocsAreaGrid onNavigate={onNavigate} />}
      {item.cards?.map((card) => (
        <DropdownCard key={card.title} card={card} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

/**
 * One panel shared by every dropdown (resend.com-style): it slides along the
 * nav to sit under the open trigger and morphs to that panel's size, while the
 * contents cross-slide — outgoing leaves toward the previous trigger, incoming
 * enters from the new one. `direction` is +1 when moving right along the nav.
 *
 * `lastItem` keeps the closed panel rendering its final contents, so closing
 * fades out rather than collapsing to nothing first.
 */
/** Breathing room the panel keeps from either edge of the viewport. */
const MIN_PANEL_MARGIN = 16;

/** How long the pointer may be outside the nav cluster before it closes. */
const CLOSE_GRACE_MS = 220;

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
  const slide = reduceMotion ? 0 : 28 * direction;

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
          box, so it kept the previous panel's width: the Docs icon grid spilled
          out over the page. The panel still slides and cross-fades. */}
      <div
        ref={cardRef}
        className="bg-background/95 relative w-max rounded-3xl border shadow-2xl shadow-black/10 backdrop-blur-xl dark:shadow-black/40"
      >
        {/* popLayout pulls the outgoing panel out of flow, so the card resizes
            to the incoming one instead of stretching to fit both. */}
        <AnimatePresence mode="popLayout" initial={false}>
          {item && (
            <motion.div
              key={item.name}
              initial={{ opacity: 0, x: slide, filter: "blur(4px)" }}
              animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, x: -slide, filter: "blur(4px)" }}
              transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <PanelContent item={item} onNavigate={onNavigate} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      </div>
    </motion.div>
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

function DocsAreaGrid({ onNavigate }: { onNavigate: () => void }) {
  return (
    /* Four columns of 44px tiles: three rows land at the same height as the
       five-link column beside it, so the panel reads as one block. */
    <div className="grid shrink-0 grid-cols-4 gap-1 self-center">
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
          <AnimatedIcon icon={Icon} size={19} />
          <span className="sr-only">{name}</span>
        </Link>
      ))}
    </div>
  );
}

/**
 * Blur + rise + fade reveal for the mobile menu items
 * (beui.dev/components/motion/text-animation), driven purely by the nav's open
 * state via CSS (see home.css `.home-reveal`, gated on `nav[data-state=active]`).
 * `delay` staggers each item on open and resets quickly on close so it replays.
 */
function Reveal({
  delay,
  className,
  children,
}: {
  delay: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn("home-reveal", className)}
      style={{ "--reveal-delay": `${delay}s` } as React.CSSProperties}
    >
      {children}
    </div>
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

export function HomeHeader({
  authenticated,
  scrolled,
}: {
  authenticated: boolean;
  scrolled: boolean;
}) {
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
        data-auth={authenticated ? "true" : undefined}
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
            // items alone measure ~580px at rest.
            scrolled &&
              cn(
                "bg-background/50 border-border backdrop-blur-lg lg:px-6",
                authenticated ? "max-w-[43rem]" : "max-w-[49rem]"
              )
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
                  +/× in both the closed pill and the open card. */}
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
              onMouseEnter={cancelClose}
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
              {/* Mobile: the four groups only, pinned to the top of the card.
                  Tapping one springs it open (see MobileGroup) — listing every
                  child at once outgrew the card and buried the CTAs. */}
              <ul className="mt-8 max-h-[calc(100dvh-16rem)] space-y-4 overflow-y-auto pb-6 pr-1 lg:hidden">
                {menuItems.map((item, i) => (
                  <li key={item.name}>
                    <Reveal delay={0.05 + i * 0.08}>
                      {item.columns ? (
                        <MobileGroup
                          item={item}
                          open={mobileGroup === item.name}
                          onToggle={() =>
                            setMobileGroup((current) =>
                              current === item.name ? null : item.name
                            )
                          }
                          onNavigate={() => setMenuState(false)}
                        />
                      ) : (
                        <Link
                          href={item.href}
                          target={item.external ? "_blank" : undefined}
                          rel={item.external ? "noopener noreferrer" : undefined}
                          onClick={() => setMenuState(false)}
                          className="text-muted-foreground hover:text-foreground block text-4xl font-light tracking-tight duration-150"
                        >
                          <span>{item.name}</span>
                        </Link>
                      )}
                    </Reveal>
                  </li>
                ))}
              </ul>

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
                {authenticated ? (
                  <Magnetic range={38} intensity={0.14} maxOffset={7}>
                    <Button size="sm" nativeButton={false} render={<Link href="/" />}>
                      <span>Open app</span>
                    </Button>
                  </Magnetic>
                ) : (
                  <>
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
                  </>
                )}
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
                {authenticated ? (
                  <Reveal delay={0.34}>
                    <Button
                      className="h-14 w-full rounded-full text-base font-medium"
                      nativeButton={false}
                      render={<Link href="/" />}
                    >
                      <span>Open app</span>
                    </Button>
                  </Reveal>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </nav>
    </header>
  );
}
