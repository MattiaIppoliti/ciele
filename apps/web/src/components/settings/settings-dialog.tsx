"use client";

import { useCallback, useMemo, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, Check, ChevronDown, X } from "lucide-react";
import Link from "next/link";
import { Dialog, DialogContent, DialogTitle } from "@agent-hub/ui";
import { AnimateIcons, AnimatedIcon } from "@/components/ui/animated-icon";
import { HoverHighlight } from "@/components/ui/hover-highlight";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useExitTransition } from "@/components/motion/use-exit-transition";
import {
  crossScopeLink,
  scopeTitle,
  settingsScopeFromPath,
  settingsTabFromPath,
  tabsForScope,
  type SettingsTab,
} from "@/components/settings/settings-nav";
import {
  SettingsDirtyContext,
  type SettingsDirtyRegistry,
} from "@/components/settings/settings-dirty";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { discardChangesRequest } from "@/components/ui/use-unsaved-changes";
import { isPlainClick } from "@/lib/plain-click";

/**
 * The Settings modal: a tab rail on the left, the active settings route on the
 * right, over a dimmed console.
 *
 * It is a *layout*, not a client-side dialog holding panels, each tab is still
 * its own server route, so the data it shows is fetched and RLS-scoped on the
 * server exactly as before, and every tab stays deep-linkable. Closing pops back
 * to whatever the console was showing (or the dashboard, for someone who arrived
 * by URL).
 *
 * The same dialog serves both scopes (see `settings-nav.ts`): the rail lists the
 * current scope's tabs and ends with the way into the other one, so Organization
 * and Personal settings read as one surface without ever mixing the tenant's
 * configuration into a person's own.
 */
export function SettingsDialog({
  canManageOrg,
  children,
}: {
  /** Owners and admins may open the Organization scope; everyone else only sees
   * the personal scope, and the org routes redirect them back to it. */
  canManageOrg: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const active = settingsTabFromPath(pathname);
  const scope = settingsScopeFromPath(pathname);
  const tabs = tabsForScope(scope);
  const cross = crossScopeLink(scope);
  const activeTab = tabs.find((tab) => tab.slug === active);
  const dialogTitle = activeTab?.label ?? scopeTitle(scope);
  // Leaving the personal scope for the Organization one is only offered where
  // there is something to manage; the reverse is always available.
  const showCross = scope === "personal" ? canManageOrg : true;

  const navigateAway = useCallback(() => {
    // One back step leaves the dialog because switching tabs *replaces* the
    // entry rather than pushing one (see `RailRow`): the whole dialog, every
    // tab, both scopes, occupies exactly one history entry, so closing takes
    // one click no matter how much of it was browsed. A deep link has nothing
    // behind it in this app's history, so fall through to the dashboard.
    if (window.history.length > 1) router.back();
    else router.push("/");
  }, [router]);

  // The dialog is mounted by the route, so it cannot animate its own unmount:
  // it used to fade and zoom in over 150ms and then disappear in one frame.
  // `close` now plays the reverse of the entrance first.
  const { exiting, beginExit } = useExitTransition(navigateAway, 150);

  // Every way out of a tab (Escape, backdrop, X, a rail link) unmounts it, and
  // with it whatever was typed there. Dirty forms register here, so leaving
  // asks first.
  const dirtyKeys = useRef(new Set<string>());
  const registry = useMemo<SettingsDirtyRegistry>(
    () => ({
      set(key, dirty) {
        if (dirty) dirtyKeys.current.add(key);
        else dirtyKeys.current.delete(key);
      },
    }),
    [],
  );
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  const guard = useCallback(
    (leave: () => void) => {
      if (dirtyKeys.current.size === 0) {
        leave();
        return;
      }
      confirmDelete(
        discardChangesRequest("What you changed on this tab is not saved yet.", () => {
          dirtyKeys.current.clear();
          leave();
        }),
      );
    },
    [confirmDelete],
  );

  const close = useCallback(() => guard(beginExit), [guard, beginExit]);

  const onRailClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      // A modified click opens a new tab and leaves this one's edits alone.
      if (!isPlainClick(event) || dirtyKeys.current.size === 0) return;
      event.preventDefault();
      guard(() => router.replace(href));
    },
    [guard, router],
  );

  return (
    <SettingsDirtyContext.Provider value={registry}>
      <Dialog
        open={!exiting}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent
          showCloseButton={false}
          overlayClassName="bg-black/50 backdrop-blur-[1px]"
          className={`flex h-dvh w-screen max-w-none -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border bg-background p-0 shadow-2xl outline-none duration-150 sm:h-[calc(100dvh-4rem)] sm:w-[calc(100vw-4rem)] sm:max-h-[46rem] sm:max-w-5xl sm:flex-row sm:rounded-xl ${
            exiting
              ? "animate-out fade-out zoom-out-95"
              : "animate-in fade-in zoom-in-95"
          }`}
        >
          <DialogTitle className="sr-only">{dialogTitle}</DialogTitle>
          {/* The rail is chrome, not page content: re-enable the shell's animated
            icons, which `(admin)/layout.tsx` switches off for pages. */}
          <AnimateIcons>
            {/* A column of tabs on a desktop. A phone has no room for the
              column, and a horizontal strip of tabs made Members scroll a bar
              sideways to find a tab, past its end into empty space, so there
              the rail folds into one menu named after the tab you are on. The
              scope title is the dialog's heading in both. */}
            <aside className="bg-muted/40 flex shrink-0 flex-row items-center gap-2 border-b py-2 pr-14 pl-3 sm:w-56 sm:flex-col sm:items-stretch sm:gap-0 sm:border-r sm:border-b-0 sm:py-3 sm:pr-0 sm:pl-0">
              <p className="text-muted-foreground shrink-0 text-xs font-semibold tracking-wide uppercase sm:px-4 sm:pb-2">
                {scopeTitle(scope)}
              </p>
              <RailMenu
                onNavigate={onRailClick}
                tabs={tabs}
                active={activeTab}
                cross={showCross ? cross : null}
              />
              <HoverHighlight className="hidden min-h-0 min-w-0 flex-1 overflow-y-auto px-2 sm:block">
                <div className="flex flex-col gap-0.5">
                  {tabs.map((tab) => (
                    <RailRow
                      key={tab.slug}
                      tab={tab}
                      active={active === tab.slug}
                      onNavigate={onRailClick}
                    />
                  ))}
                </div>
              </HoverHighlight>
              {showCross && (
                <div className="mt-auto hidden border-t px-2 pt-2 sm:block">
                  <HoverHighlight>
                    <RailRow
                      tab={cross}
                      active={false}
                      crossScope
                      onNavigate={onRailClick}
                    />
                  </HoverHighlight>
                </div>
              )}
            </aside>
          </AnimateIcons>

          {/* Anchored to the dialog, not to the content pane: the pane is flush
            with the dialog's right edge on a desktop, but on a phone the rail
            rail's header owns that corner and the button has to sit in it
            (which is what the rail's `pr-14` reserves room for). */}
          <button
            type="button"
            aria-label="Close settings"
            onClick={close}
            className="text-muted-foreground hover:bg-muted hover:text-foreground absolute top-2.5 right-3 z-10 flex size-11 items-center justify-center rounded-lg transition-colors sm:top-3 lg:size-8"
          >
            <X className="size-4" />
          </button>
          <div className="relative flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8 sm:py-7">
              {children}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {confirmDeleteModal}
    </SettingsDirtyContext.Provider>
  );
}

/**
 * The rail on a phone: one trigger naming the current tab, opening every tab of
 * the scope and, after a separator, the way into the other scope. The same
 * links as the column, with the same `replace`, so the dialog still takes one
 * history entry however it was browsed.
 */
type RailNavigate = (
  event: React.MouseEvent<HTMLAnchorElement>,
  href: string,
) => void;

function RailMenu({
  tabs,
  active,
  cross,
  onNavigate,
}: {
  onNavigate: RailNavigate;
  tabs: SettingsTab[];
  active: SettingsTab | undefined;
  /** The other scope, or null where it is not offered. */
  cross: SettingsTab | null;
}) {
  const current = active ?? tabs[0]!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="press-control bg-muted text-foreground flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2.5 text-sm font-medium sm:hidden"
          />
        }
      >
        <AnimatedIcon icon={current.icon} size={16} className="shrink-0" />
        <span className="truncate">{current.label}</span>
        <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {tabs.map((tab) => (
          <DropdownMenuItem
            key={tab.slug}
            render={
              <Link
                href={tab.href}
                replace
                onClick={(event) => onNavigate(event, tab.href)}
              />
            }
            aria-current={tab.slug === current.slug ? "page" : undefined}
          >
            <tab.icon className="size-4" />
            <span className="min-w-0 flex-1 truncate">{tab.label}</span>
            {tab.slug === current.slug && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
        {cross && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              render={
                <Link
                  href={cross.href}
                  replace
                  onClick={(event) => onNavigate(event, cross.href)}
                />
              }
            >
              <cross.icon className="size-4" />
              <span className="min-w-0 flex-1 truncate">{cross.label}</span>
              <ArrowUpRight className="size-3.5" />
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RailRow({
  tab,
  active,
  crossScope = false,
  onNavigate,
}: {
  onNavigate: RailNavigate;
  tab: SettingsTab;
  active: boolean;
  /** Marks the footer row that leaves for the other scope, it carries an
   * outbound arrow so it does not read as one more tab. */
  crossScope?: boolean;
}) {
  return (
    <Link
      href={tab.href}
      // Tabs replace rather than push: a modal is one place, so browsing it must
      // not stack history entries that the close button then has to unwind one
      // by one (it used to take a click per tab visited).
      replace
      onClick={(event) => onNavigate(event, tab.href)}
      aria-current={active ? "page" : undefined}
      data-highlight-row
      className={`relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <AnimatedIcon icon={tab.icon} size={16} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {tab.label}
        {/* The hint is a second line under the label. */}
        {tab.hint && (
          <span className="text-muted-foreground block truncate text-xs font-normal">
            {tab.hint}
          </span>
        )}
      </span>
      {crossScope && <ArrowUpRight className="size-3.5 shrink-0" />}
    </Link>
  );
}
