"use client";

import { useContext, useEffect, useRef, useState } from "react";
import {
  ChevronsUpDown,
  Ellipsis,
  PanelLeft,
  Search,
  LifeBuoy,
} from "lucide-react";
import type { AnimatedIcon } from "@/components/ui/animated-icon";
import {
  PREVIEW_GLOBAL_NAV,
  PREVIEW_SETUP_SECTIONS,
} from "@/components/home/preview-nav";
import { cn } from "@/lib/utils";
import {
  ASSISTANTS,
  nextView,
  type GlobalView,
  type View,
} from "@/components/home/preview-model";
import {
  CompactContext,
  NavRow,
  PreviewGrid,
  PreviewIcon,
  PreviewIconContext,
  PreviewPane,
} from "@/components/home/preview-panes";
import { AmbientActiveContext } from "@/components/home/use-in-viewport";

/* Live replica of the admin dashboard for the marketing hero's tilted
   plane — real DOM instead of a scaled screenshot (crisp at any angle),
   with the app's own hover-animated icons. It is a pure visual mock:
   nothing links into the app. The sidebar swaps the main pane between
   faked views (Assistants, Help Desks, Inbox, …) so visitors can poke
   around a believable product without touching real routes or data.
   SETUP sections all land on the same "choose an assistant" picker,
   mirroring the app's /setup/<section> page.

   The mock's data, idle view-cycling reducer and chart math live in
   preview-model.ts (pure, node-tested); the pane components live in
   preview-panes.tsx. This file owns only the interactive shell. */

type AnimatedIconRenderer = typeof AnimatedIcon;

export function HomeAppPreview({ compact = false }: { compact?: boolean }) {
  const [view, setView] = useState<View>({
    kind: "global",
    label: "Assistants",
  });
  // Scope switcher ("All Assistants" ⌄) — null means org-wide scope.
  const [scope, setScope] = useState<string | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  // Idle showcase: while the cursor is outside the mock it cycles through
  // the five global views every 1.5s; hovering pauses it so visitors can
  // explore on their own. Wherever they left off, cycling resumes from
  // the next global view.
  const [hovered, setHovered] = useState(false);
  // Hover-animated icons, loaded on the first pointerenter (see the
  // PreviewIcon note in preview-panes.tsx). Nobody can hover an icon
  // without entering the mock first, so nothing is lost by waiting.
  const [animatedIcon, setAnimatedIcon] = useState<AnimatedIconRenderer | null>(
    null,
  );
  const iconsRequested = useRef(false);
  const loadAnimatedIcons = () => {
    if (iconsRequested.current) return;
    iconsRequested.current = true;
    void import("@/components/ui/animated-icon").then((module) => {
      setAnimatedIcon(() => module.AnimatedIcon);
    });
  };

  // Idle cycling runs only while this instance is on screen and motion is
  // allowed. The enclosing PreviewStage / MobileAppPreview computes that from
  // a non-transformed ancestor (IntersectionObserver can't read this mock's
  // own visibility through the hero's 3D transform) and passes it down here;
  // the CSS-hidden instance the hero mounts for the other breakpoint reports
  // not-visible, so it stays paused. Null = no stage → treat as active.
  const active = useContext(AmbientActiveContext) ?? true;

  useEffect(() => {
    if (hovered || !active) return;
    const id = setInterval(() => {
      setScopeOpen(false);
      setView((current) => nextView(current));
    }, 1500);
    return () => clearInterval(id);
  }, [hovered, active]);

  const breadcrumb =
    view.kind === "global"
      ? view.label
      : (PREVIEW_SETUP_SECTIONS.find((section) => section.slug === view.slug)
          ?.label ??
        "Setup");

  return (
    <PreviewIconContext.Provider value={animatedIcon}>
      <CompactContext.Provider value={compact}>
      <div
        onPointerEnter={() => {
          setHovered(true);
          loadAnimatedIcons();
        }}
        onPointerLeave={() => setHovered(false)}
        className={cn(
          "bg-background text-foreground flex overflow-hidden rounded-xl border text-base",
          compact ? "h-[480px] w-[560px]" : "h-[900px] w-[1600px]",
        )}
      >
        {/* Sidebar */}
        <aside
          className={cn(
            "flex shrink-0 flex-col gap-1 border-r py-3",
            compact ? "w-44 px-2" : "w-60 px-3",
          )}
        >
          <div className="flex items-center gap-2 px-1.5 pb-2">
            {/* Gradient-orb logo: warm orange sphere with a sky-blue rim in
              light mode, the deeper cyan/violet/ember one in dark. */}
            <span
              aria-hidden
              className="size-6 shrink-0 rounded-full dark:hidden"
              style={{
                background:
                  "radial-gradient(circle at 50% 74%, #fdf3e8 0%, rgba(253,243,232,0.85) 28%, rgba(253,243,232,0) 58%), radial-gradient(circle at 50% 28%, #f18e55 0%, rgba(241,142,85,0.9) 42%, rgba(241,142,85,0) 75%), radial-gradient(circle, #f09f68 0%, #eb9a64 58%, #a8c9ea 86%, #92bfe7 100%)",
              }}
            />
            <span
              aria-hidden
              className="hidden size-6 shrink-0 rounded-full dark:block"
              style={{
                background:
                  "radial-gradient(circle at 50% 78%, #f0a184 0%, rgba(240,161,132,0.55) 26%, rgba(240,161,132,0) 52%), radial-gradient(circle at 50% 32%, rgba(124,126,239,0.95) 0%, rgba(124,126,239,0.7) 48%, rgba(124,126,239,0) 75%), radial-gradient(circle, #79e3f0 0%, #6cd9ea 72%, #5fd0e4 100%)",
              }}
            />
            <span className="text-sm font-semibold">Acme …</span>
            {!compact && (
              <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                Demo
              </span>
            )}
            <ChevronsUpDown className="text-muted-foreground ml-auto size-3.5" />
            {!compact && <PanelLeft className="text-muted-foreground size-4" />}
          </div>

          <div className="text-muted-foreground mb-2 flex h-8 items-center gap-2 rounded-lg border px-2.5 text-sm">
            <PreviewIcon icon={Search} size={14} />
            <span>Find…</span>
            <kbd className="bg-muted ml-auto rounded-full border px-1.5 text-[10px]">
              F
            </kbd>
          </div>

          {PREVIEW_GLOBAL_NAV.filter((item) => !item.bottom).map((item) => (
            <NavRow
              key={item.label}
              icon={item.icon}
              label={item.label}
              active={view.kind === "global" && item.label === view.label}
              onSelect={() => {
                setView({ kind: "global", label: item.label as GlobalView });
                setScopeOpen(false);
              }}
            />
          ))}

          <div className="my-2 border-t" />

          {(compact
            ? PREVIEW_SETUP_SECTIONS.slice(0, 4)
            : PREVIEW_SETUP_SECTIONS
          ).map(
            (section) => (
              <NavRow
                key={section.slug}
                icon={section.icon}
                label={section.label}
                active={view.kind === "setup" && section.slug === view.slug}
                onSelect={() => {
                  setView({ kind: "setup", slug: section.slug });
                  setScopeOpen(false);
                }}
              />
            ),
          )}

          <div className="mt-auto">
            {!compact && (
              <div className="mb-2 border-t pt-2">
                {/* Alerts and Settings are decorative here — no pane behind them. */}
                {PREVIEW_GLOBAL_NAV.filter((item) => item.bottom).map((item) => (
                  <NavRow
                    key={item.label}
                    icon={item.icon}
                    label={item.label}
                    badge={item.label === "Alerts" ? 1 : undefined}
                  />
                ))}
                <NavRow icon={LifeBuoy} label="Support" />
              </div>
            )}
            <div className="hover:bg-muted flex items-center gap-2 rounded-lg px-1.5 py-1.5">
              <span className="bg-muted text-muted-foreground flex size-7 items-center justify-center rounded-full border text-xs">
                AC
              </span>
              <span className="leading-tight">
                <span className="block text-sm font-medium">Alex Carter</span>
                <span className="text-muted-foreground block text-xs">
                  alex.carter@acme.com
                </span>
              </span>
              <Ellipsis className="text-muted-foreground ml-auto size-4" />
            </div>
          </div>
        </aside>

        {/* Main pane */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header
            className={cn(
              "relative z-20 flex h-12 shrink-0 items-center gap-3 border-b text-sm",
              compact ? "px-4" : "px-5",
            )}
          >
            <div className="relative">
              <button
                type="button"
                onClick={() => setScopeOpen((open) => !open)}
                onMouseDown={(event) => event.preventDefault()}
                className="text-muted-foreground hover:text-foreground flex items-center gap-2 transition-colors"
              >
                <PreviewIcon icon={PREVIEW_GLOBAL_NAV[0].icon} size={15} />
                All Assistants
                <ChevronsUpDown className="size-3.5" />
              </button>

              {scopeOpen && (
                <div className="bg-popover absolute left-0 top-9 w-64 rounded-xl border p-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setScope(null);
                      setScopeOpen(false);
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    className={cn(
                      "hover:bg-muted flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium",
                      scope === null && "bg-muted",
                    )}
                  >
                    <PreviewIcon icon={PREVIEW_GLOBAL_NAV[0].icon} size={14} />
                    All Assistants
                  </button>
                  <div className="my-1 border-t" />
                  {ASSISTANTS.map((assistant) => (
                    <button
                      key={assistant.id}
                      type="button"
                      onClick={() => {
                        setScope(assistant.title);
                        setScopeOpen(false);
                      }}
                      onMouseDown={(event) => event.preventDefault()}
                      className={cn(
                        "hover:bg-muted flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm",
                        scope === assistant.title && "bg-muted",
                      )}
                    >
                      <span className="bg-primary/80 size-3.5 shrink-0 rounded-full" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {assistant.title}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {assistant.nickname}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="text-muted-foreground/50">/</span>
            <span className="font-medium">{breadcrumb}</span>
          </header>

          {/* PreviewGrid listens for pointermove on this wrapper; the z-10
            layer keeps pane content painting above the grid lines. */}
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <PreviewGrid />
            {/* Keyed on the view so every swap remounts and replays the
              fade/slide-in — keeps the idle cycling from feeling choppy. */}
            <div
              key={view.kind === "global" ? view.label : view.slug}
              className="animate-in fade-in slide-in-from-bottom-2 relative z-10 flex min-h-0 flex-1 flex-col duration-500"
            >
              <PreviewPane view={view} />
            </div>
          </div>
        </div>
      </div>
      </CompactContext.Provider>
    </PreviewIconContext.Provider>
  );
}
