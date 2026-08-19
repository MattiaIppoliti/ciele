"use client";

import { useCallback, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, X } from "lucide-react";
import { Link } from "@/components/ui/link";
import { AnimateIcons, AnimatedIcon } from "@/components/ui/animated-icon";
import { HoverHighlight } from "@/components/ui/hover-highlight";
import {
  crossScopeLink,
  scopeTitle,
  settingsScopeFromPath,
  settingsTabFromPath,
  tabsForScope,
  type SettingsTab,
} from "@/components/settings/settings-nav";

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
  // Leaving the personal scope for the Organization one is only offered where
  // there is something to manage; the reverse is always available.
  const showCross = scope === "personal" ? canManageOrg : true;

  const close = useCallback(() => {
    // One back step leaves the dialog because switching tabs *replaces* the
    // entry rather than pushing one (see `RailRow`): the whole dialog, every
    // tab, both scopes, occupies exactly one history entry, so closing takes
    // one click no matter how much of it was browsed. A deep link has nothing
    // behind it in this app's history, so fall through to the dashboard.
    if (window.history.length > 1) router.back();
    else router.push("/");
  }, [router]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    // A phone has no "over the console" to show: the dialog takes the whole
    // screen there (no inset, no rounding) and only becomes a floating card
    // once there is room around it.
    <div className="fixed inset-0 z-50 flex items-center justify-center sm:p-8">
      <button
        type="button"
        aria-label="Close settings"
        onClick={close}
        className="animate-in fade-in absolute inset-0 bg-black/50 duration-150"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={scope === "personal" ? "Personal settings" : "Settings"}
        className="bg-background animate-in fade-in zoom-in-95 relative flex h-full w-full max-w-5xl flex-col overflow-hidden border shadow-2xl duration-150 sm:max-h-[46rem] sm:flex-row sm:rounded-xl"
      >
        {/* The rail is chrome, not page content: re-enable the shell's animated
            icons, which `(admin)/layout.tsx` switches off for pages. */}
        <AnimateIcons>
          {/* The rail is a column of tabs on a desktop and a scrollable strip
              of them on a phone, same rows, laid out along the axis that has
              room. The scope title is the dialog's heading in both. */}
          <aside className="bg-muted/40 flex shrink-0 flex-row items-center gap-2 border-b py-2 pr-14 pl-3 sm:w-56 sm:flex-col sm:items-stretch sm:gap-0 sm:border-r sm:border-b-0 sm:py-3 sm:pr-0 sm:pl-0">
            <p className="text-muted-foreground shrink-0 text-xs font-semibold tracking-wide uppercase sm:px-4 sm:pb-2">
              {scopeTitle(scope)}
            </p>
            <HoverHighlight className="no-scrollbar min-h-0 min-w-0 flex-1 overflow-x-auto sm:overflow-x-visible sm:overflow-y-auto sm:px-2">
              <div className="flex flex-row gap-1 sm:flex-col sm:gap-0.5">
                {tabs.map((tab) => (
                  <RailRow
                    key={tab.slug}
                    tab={tab}
                    active={active === tab.slug}
                  />
                ))}
                {/* On the strip the cross-scope link is just the last tab; the
                    column keeps it pinned to the footer below. */}
                {showCross && (
                  <span className="contents sm:hidden">
                    <RailRow tab={cross} active={false} crossScope />
                  </span>
                )}
              </div>
            </HoverHighlight>
            {showCross && (
              <div className="mt-auto hidden border-t px-2 pt-2 sm:block">
                <HoverHighlight>
                  <RailRow tab={cross} active={false} crossScope />
                </HoverHighlight>
              </div>
            )}
          </aside>
        </AnimateIcons>

        {/* Anchored to the dialog, not to the content pane: the pane is flush
            with the dialog's right edge on a desktop, but on a phone the rail
            strip owns that corner and the button has to sit in it (which is
            what the rail's `pr-14` reserves room for). */}
        <button
          type="button"
          aria-label="Close settings"
          onClick={close}
          className="text-muted-foreground hover:bg-muted hover:text-foreground absolute top-2.5 right-3 z-10 flex size-9 items-center justify-center rounded-lg transition-colors sm:top-3 sm:size-8"
        >
          <X className="size-4" />
        </button>
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8 sm:py-7">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function RailRow({
  tab,
  active,
  crossScope = false,
}: {
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
      data-highlight-row
      className={`relative flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium whitespace-nowrap transition-colors sm:shrink sm:whitespace-normal ${
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <AnimatedIcon icon={tab.icon} size={16} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {tab.label}
        {/* The hint is a second line under the label, the horizontal strip
            has no vertical room for it. */}
        {tab.hint && (
          <span className="text-muted-foreground hidden truncate text-xs font-normal sm:block">
            {tab.hint}
          </span>
        )}
      </span>
      {crossScope && <ArrowUpRight className="size-3.5 shrink-0" />}
    </Link>
  );
}
