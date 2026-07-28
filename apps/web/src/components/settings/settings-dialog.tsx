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
 * It is a *layout*, not a client-side dialog holding panels — each tab is still
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
    // entry rather than pushing one (see `RailRow`): the whole dialog — every
    // tab, both scopes — occupies exactly one history entry, so closing takes
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-8">
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
        className="bg-background animate-in fade-in zoom-in-95 relative flex h-full max-h-[46rem] w-full max-w-5xl overflow-hidden rounded-xl border shadow-2xl duration-150"
      >
        {/* The rail is chrome, not page content: re-enable the shell's animated
            icons, which `(admin)/layout.tsx` switches off for pages. */}
        <AnimateIcons>
          <aside className="bg-muted/40 flex w-56 shrink-0 flex-col border-r py-3">
            <p className="text-muted-foreground px-4 pb-2 text-xs font-semibold tracking-wide uppercase">
              {scopeTitle(scope)}
            </p>
            <HoverHighlight className="min-h-0 flex-1 overflow-y-auto px-2">
              <div className="flex flex-col gap-0.5">
                {tabs.map((tab) => (
                  <RailRow
                    key={tab.slug}
                    tab={tab}
                    active={active === tab.slug}
                  />
                ))}
              </div>
            </HoverHighlight>
            {showCross && (
              <div className="mt-auto border-t px-2 pt-2">
                <HoverHighlight>
                  <RailRow tab={cross} active={false} crossScope />
                </HoverHighlight>
              </div>
            )}
          </aside>
        </AnimateIcons>

        <div className="relative flex min-w-0 flex-1 flex-col">
          <button
            type="button"
            aria-label="Close settings"
            onClick={close}
            className="text-muted-foreground hover:bg-muted hover:text-foreground absolute top-3 right-3 z-10 flex size-8 items-center justify-center rounded-lg transition-colors"
          >
            <X className="size-4" />
          </button>
          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
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
  /** Marks the footer row that leaves for the other scope — it carries an
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
      className={`relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <AnimatedIcon icon={tab.icon} size={16} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {tab.label}
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
