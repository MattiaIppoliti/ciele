"use client";

import { useCallback, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Moon, Sun } from "lucide-react";
import { Button, Hint, TooltipProvider, cn } from "@agent-hub/ui";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { SidebarFrame } from "@/components/shell/sidebar-frame";
import { DEFAULT_WIDTH, isRailWidth } from "@/components/shell/sidebar-drag";
import { SidebarToggleIcon } from "@/components/ui/sidebar-toggle-icon";
import { CatalogSidebar } from "./catalog-sidebar";

export function CatalogShell({ children }: { children: ReactNode }) {
  return <ThemeProvider><TooltipProvider><CatalogShellContent>{children}</CatalogShellContent></TooltipProvider></ThemeProvider>;
}

function CatalogShellContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const kind = pathname.startsWith("/components/blocks") ? "block" : "component";
  const title = kind === "block" ? "Blocks" : "Components";
  const [query, setQuery] = useState("");
  const [docked, setDocked] = useState(true);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const [toggleHovered, setToggleHovered] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const drawerOpen = drawerPath === pathname;
  const onRail = docked && isRailWidth(width);
  const navInBar = !docked || onRail;
  const reopenLabel = onRail ? "Expand sidebar" : "Show sidebar";
  const setDrawerOpen = useCallback((open: boolean) => setDrawerPath(open ? pathname : null), [pathname]);

  return (
    <div className="flex h-dvh bg-shell text-foreground">
      <a href="#catalog-content" className="sr-only rounded-lg bg-background p-3 focus:not-sr-only focus:absolute focus:z-50">Skip to content</a>
      <SidebarFrame
        docked={docked}
        setDocked={setDocked}
        width={width}
        setWidth={setWidth}
        drawerOpen={drawerOpen}
        setDrawerOpen={setDrawerOpen}
        renderContent={(options) => <CatalogSidebar {...options} pathname={pathname} query={query} setQuery={setQuery} onNavigate={() => setDrawerOpen(false)} />}
      />
      <div className="admin-workspace">
        <div className="admin-panel">
          <header className="relative flex h-14 shrink-0 items-center justify-between gap-2 border-b px-2 sm:gap-3 sm:px-4">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <button
                type="button"
                aria-label={`Open ${title.toLowerCase()} navigation`}
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen(true)}
                onPointerEnter={(event) => { if (event.pointerType === "mouse") setToggleHovered(true); }}
                onPointerLeave={() => setToggleHovered(false)}
                className="press-control text-muted-foreground hover:bg-muted hover:text-foreground z-10 flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors md:hidden"
              >
                <SidebarToggleIcon isOpen={toggleHovered ? !drawerOpen : drawerOpen} className="size-4" />
              </button>
              {navInBar && <Hint label={reopenLabel}>
                <button
                  type="button"
                  aria-label={reopenLabel}
                  aria-expanded={false}
                  onPointerEnter={(event) => { if (event.pointerType === "mouse") setToggleHovered(true); }}
                  onPointerLeave={() => setToggleHovered(false)}
                  onClick={() => onRail ? setWidth(DEFAULT_WIDTH) : setDocked(true)}
                  className="press-control text-muted-foreground hover:bg-muted hover:text-foreground z-10 hidden size-8 shrink-0 items-center justify-center rounded-lg transition-colors md:flex"
                >
                  <SidebarToggleIcon isOpen={toggleHovered} className="size-4" />
                </button>
              </Hint>}
              <nav aria-label="Library sections" className="flex gap-1">{(["component", "block"] as const).map((section) => <Link key={section} href={section === "block" ? "/components/blocks" : "/components"} aria-current={kind === section ? "true" : undefined} onClick={() => { setQuery(""); setDrawerOpen(false); }} className={cn("press-text rounded-lg px-1.5 py-1.5 text-sm sm:px-2", kind === section ? "bg-alpha-lighter font-medium" : "text-muted-foreground hover:text-foreground")}>{section === "block" ? "Blocks" : "Components"}</Link>)}</nav>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link href="https://docs.ciele.app" className="press-text hidden items-center gap-1 text-xs text-muted-foreground hover:text-foreground sm:flex">Docs <ArrowUpRight className="size-3" /></Link>
              <Button variant="ghost" size="icon-sm" aria-label={resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>{resolvedTheme === "dark" ? <Sun /> : <Moon />}</Button>
              <Link href="/home" className="press-text hidden rounded-lg border border-alpha-medium px-3 py-1.5 text-xs md:block">Back to Ciele <span aria-hidden="true">↗</span></Link>
            </div>
          </header>
          <main id="catalog-content" tabIndex={-1} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain focus:outline-none" key={pathname}>
            <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
