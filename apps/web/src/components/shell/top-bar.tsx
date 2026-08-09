"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Menu, PanelLeftOpen } from "lucide-react";
import { Badge } from "@agent-hub/ui";
import { Hint } from "@agent-hub/ui";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { ScopeSwitcher } from "@/components/shell/scope-switcher";
import { useShell } from "@/components/shell/shell-provider";
import {
  GLOBAL_NAV,
  SETUP_SECTIONS,
  assistantIdFromPath,
  assistantSectionFromPath,
} from "@/components/shell/nav";

function pageTitle(pathname: string): string {
  const scopedId = assistantIdFromPath(pathname);
  if (scopedId) {
    const section = assistantSectionFromPath(pathname);
    if (!section) return "Overview";
    return (
      SETUP_SECTIONS.find((candidate) => candidate.slug === section)?.label ??
      "Overview"
    );
  }
  if (pathname.startsWith("/setup/")) {
    const slug = pathname.slice("/setup/".length);
    return SETUP_SECTIONS.find((section) => section.slug === slug)?.label ?? "Setup";
  }
  if (pathname === "/") return "Assistants";
  const nav = GLOBAL_NAV.find((item) => {
    const prefix = item.match ?? item.href;
    return item.exact ? pathname === prefix : pathname.startsWith(prefix);
  });
  return nav?.label ?? "Overview";
}

const subscribeNoop = () => () => {};

/** Global top bar: scope switcher on the left, page title centered. */
export function TopBar({ demo }: { demo: boolean }) {
  const pathname = usePathname();
  const { sidebarDocked, setSidebarDocked, setNavDrawerOpen, topBarActions } =
    useShell();
  const title = pageTitle(pathname);
  // topBarActions is registered from page components via useEffect, so with
  // selective hydration it can be set before this boundary hydrates. Server
  // HTML never contains it — render it only after hydration to keep both
  // trees identical while hydrating.
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false
  );

  return (
    <header className="bg-background/95 relative flex h-14 shrink-0 items-center gap-2 border-b px-2 backdrop-blur sm:gap-3 sm:px-4">
      {/* Below `lg` the sidebar is off-canvas, so the hamburger is the only way
          into navigation and is always present. From `lg` up it disappears and
          the reopen button takes over — but only while the sidebar is hidden. */}
      <button
        type="button"
        aria-label="Open navigation"
        onClick={() => setNavDrawerOpen(true)}
        className="text-muted-foreground hover:bg-muted hover:text-foreground z-10 flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors lg:hidden"
      >
        <Menu className="size-5" />
      </button>
      {!sidebarDocked && (
        <>
          <Hint label="Show sidebar">
            <button
              type="button"
              aria-label="Show sidebar"
              onClick={() => setSidebarDocked(true)}
              className="text-muted-foreground hover:bg-muted hover:text-foreground z-10 hidden size-8 shrink-0 items-center justify-center rounded-lg transition-colors lg:flex"
            >
              <AnimatedIcon icon={PanelLeftOpen} size={16} />
            </button>
          </Hint>
          <div className="bg-border hidden h-5 w-px shrink-0 lg:block" />
        </>
      )}
      {/* One shrinkable group: on a phone the switcher and the page title share
          whatever the hamburger and the actions leave, each truncating in
          place rather than pushing the row wider than the screen. */}
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <ScopeSwitcher />
        <span
          aria-hidden
          className="text-muted-foreground/50 shrink-0 text-lg font-light select-none"
        >
          /
        </span>
        {/* `min-w-0`, or the nowrap title's max-content min-width makes it
            refuse to shrink and the scope switcher collapses to one letter
            beside it. Both need to be able to give. */}
        <span className="min-w-0 truncate text-sm font-medium">{title}</span>
      </div>
      <div className="z-10 flex shrink-0 items-center gap-1 sm:gap-2">
        {mounted && topBarActions}
        {demo && (
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
