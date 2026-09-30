"use client";

import { prefetchFind } from "@/lib/find-client";
import { useSyncExternalStore } from "react";
import { PanelLeftOpen } from "lucide-react";
import { Search } from "lucide-react";
import { Badge } from "@agent-hub/ui";
import { Hint } from "@agent-hub/ui";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/motion/breadcrumb";
import { ScopeSwitcher } from "@/components/shell/scope-switcher";
import { DeveloperPanelButton } from "@/components/developer-panel/developer-panel-button";
import { useShell } from "@/components/shell/shell-provider";
import { PortalSlot, TOP_BAR_SLOT } from "@/components/shell/slot-portal";
import { DEFAULT_WIDTH, isRailWidth } from "@/components/shell/sidebar-drag";
import { breadcrumbTrail } from "@/components/shell/breadcrumb-trail";
import { useUnderlyingPathname } from "@/components/shell/use-underlying-pathname";
import { useTopBarContent } from "@/components/shell/top-bar-slots";

const subscribeNoop = () => () => {};

/** True on the machine's own loopback host. The server snapshot says "local"
 * too, so the demo badge never flashes in before hydration decides. */
function useIsLocalhost(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname),
    () => true
  );
}

/** Global top bar: scope switcher on the left, page title centered. */
export function TopBar({ demo }: { demo: boolean }) {
  const {
    sidebarDocked,
    setSidebarDocked,
    sidebarWidth,
    setSidebarWidth,
    navDrawerOpen,
    setNavDrawerOpen,
    openFind,
  } = useShell();
  // The page under an open Settings dialog: the bar belongs to it, not to the
  // dialog, the same way the sidebar keeps it lit.
  const underlying = useUnderlyingPathname();
  const { title, actions, form, crumbLabel } = useTopBarContent();
  const trail = breadcrumbTrail(underlying, crumbLabel);
  const isLocalhost = useIsLocalhost();
  // The icon rail keeps only the Organization's avatar, so from `md` up the
  // bar carries Find and the sidebar control whenever the sidebar is not at
  // full width: hidden (the control shows it) or the rail (it widens it).
  const onRail = sidebarDocked && isRailWidth(sidebarWidth);
  const navInBar = !sidebarDocked || onRail;

  return (
    <header className="relative flex h-14 shrink-0 items-center gap-2 border-b pr-[max(0.5rem,env(safe-area-inset-right))] pl-[max(0.5rem,env(safe-area-inset-left))] sm:gap-3 sm:pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(1rem,env(safe-area-inset-left))]">
      {/* Below `md` the sidebar is a drawer, so this button is the only way
          into navigation and is always present. It wears the desktop's
          sidebar toggle, not a hamburger, so a phone and a desktop show the
          same control for the same thing. From `md` up (a tablet included)
          the reopen button takes over, only while the sidebar is not full. */}
      {/* The nav controls sit as one tight group, so the toggle and Find read as
          a pair. Below `md` the pair is the drawer toggle + Find and Find is
          always there; from `md` it is the reopen button + Find, only while
          the sidebar is hidden or on its icon rail. */}
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          aria-label="Open navigation"
          aria-expanded={navDrawerOpen}
          onClick={() => setNavDrawerOpen(true)}
          className="text-muted-foreground hover:bg-muted hover:text-foreground z-10 flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors md:hidden"
        >
          <AnimatedIcon icon={PanelLeftOpen} size={16} />
        </button>
        {navInBar && (
          <Hint label={onRail ? "Expand sidebar" : "Show sidebar"}>
            <button
              type="button"
              aria-label={onRail ? "Expand sidebar" : "Show sidebar"}
              onClick={() =>
                onRail ? setSidebarWidth(DEFAULT_WIDTH) : setSidebarDocked(true)
              }
              className="text-muted-foreground hover:bg-muted hover:text-foreground z-10 hidden size-8 shrink-0 items-center justify-center rounded-lg transition-colors md:flex"
            >
              <AnimatedIcon icon={PanelLeftOpen} size={16} />
            </button>
          </Hint>
        )}
        <Hint label="Find… (F)">
          <button
            type="button"
            aria-label="Find"
            aria-keyshortcuts="F Meta+K"
            onClick={openFind}
            onPointerEnter={prefetchFind}
            onFocus={prefetchFind}
            className={`text-muted-foreground hover:bg-muted hover:text-foreground z-10 size-9 shrink-0 items-center justify-center rounded-lg transition-colors md:size-8 ${
              navInBar ? "flex" : "flex md:hidden"
            }`}
          >
            <AnimatedIcon icon={Search} size={16} />
          </button>
        </Hint>
      </div>
      {navInBar && (
        <div className="bg-border hidden h-5 w-px shrink-0 md:block" />
      )}
      {/* One shrinkable group: on a phone the switcher and the page title share
          whatever the hamburger and the actions leave, each truncating in
          place rather than pushing the row wider than the screen. */}
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <ScopeSwitcher />
        {/* A page may supply its own trail (Teammate Configure, whose links
            ask about unsaved edits first); every other page gets the one the
            route derives. */}
        {title ? (
          <>
            <span
              aria-hidden
              className="text-muted-foreground/50 shrink-0 text-lg font-light select-none"
            >
              /
            </span>
            <div className="min-w-0 truncate text-sm font-medium">{title}</div>
          </>
        ) : (
          // The trail starts at the second level: the scope switcher is the
          // first, and the page is the rest of it. The bar outlives navigation,
          // so keying each item on its place animates a page in or out as you
          // open or leave a detail.
          <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap">
              {trail.map((crumb, index) => (
                <BreadcrumbItem key={crumb.key}>
                  {index === 0 ? (
                    <span
                      aria-hidden
                      className="text-muted-foreground/50 shrink-0 text-lg font-light select-none"
                    >
                      /
                    </span>
                  ) : (
                    <BreadcrumbSeparator />
                  )}
                  {crumb.href ? (
                    <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        )}
      </div>
      {/* Pages mount their search, filters and export here through
          `SlotPortal`, so the breadcrumb is the title and the controls share
          its row instead of sitting under it. */}
      <PortalSlot
        id={TOP_BAR_SLOT}
        className="z-10 flex min-w-0 shrink-0 items-center gap-2"
      />
      <div className="z-10 flex shrink-0 items-center gap-1 sm:gap-2">
        {actions}
        {form}
        <DeveloperPanelButton />
        {demo && !isLocalhost && (
          <Badge variant="secondary" className="text-muted-foreground">
            {/* The full sentence needs room the phone header doesn't have. */}
            <span className="hidden lg:inline">
              Demo data, Supabase not configured
            </span>
            <span className="lg:hidden">Demo</span>
          </Badge>
        )}
      </div>
    </header>
  );
}
