"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { PanelLeftOpen } from "lucide-react";
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
  const { sidebarDocked, setSidebarDocked, topBarActions } = useShell();
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
    <header className="bg-background/95 relative flex h-14 shrink-0 items-center gap-3 border-b px-4 backdrop-blur">
      {!sidebarDocked && (
        <>
          <Hint label="Show sidebar">
            <button
              type="button"
              aria-label="Show sidebar"
              onClick={() => setSidebarDocked(true)}
              className="text-muted-foreground hover:bg-muted hover:text-foreground z-10 flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors"
            >
              <AnimatedIcon icon={PanelLeftOpen} size={16} />
            </button>
          </Hint>
          <div className="bg-border h-5 w-px shrink-0" />
        </>
      )}
      <ScopeSwitcher />
      <span
        aria-hidden
        className="text-muted-foreground/50 shrink-0 text-lg font-light select-none"
      >
        /
      </span>
      <span className="truncate text-sm font-medium">{title}</span>
      <div className="z-10 ml-auto flex items-center gap-2">
        {mounted && topBarActions}
        {demo && (
          <Badge variant="secondary" className="text-muted-foreground">
            Demo data, Supabase not configured
          </Badge>
        )}
      </div>
    </header>
  );
}
