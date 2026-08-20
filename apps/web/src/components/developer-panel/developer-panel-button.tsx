"use client";

import { usePathname } from "next/navigation";
import { Code2 } from "lucide-react";
import { Hint } from "@agent-hub/ui";
import { useShell } from "@/components/shell/shell-provider";
import { panelDomainsForPath } from "@/components/shell/nav";
import { DOMAIN_PRESENTATION } from "@/lib/developer-panel/domains";

/**
 * The way into the Developer Panel (#754): a top-bar button labelled with the
 * page's own domain ("Flows API") plus the `D` hint.
 *
 * Renders **nothing** where the page has no programmatic surface. That absence is
 * the feature: on Insights, which has no /api/v1 domain, an inviting button
 * leading to an empty panel would be worse than no button.
 *
 * The label comes from the client-safe presentation table rather than the fetched
 * catalogue, so the button is correct on first paint and the panel's payload
 * stays lazy.
 */
export function DeveloperPanelButton() {
  const pathname = usePathname();
  const { rightRail, toggleRightRail } = useShell();
  const domains = panelDomainsForPath(pathname);
  const first = domains[0] ? DOMAIN_PRESENTATION[domains[0]] : undefined;
  if (!first) return null;

  const open = rightRail === "developer";
  // A multi-domain page is labelled from its first domain (#753), the page
  // leads with its primary subject, and "Developer" names nothing.
  const label = first.title;

  return (
    <Hint label={open ? "Hide developer panel" : "Show developer panel"}>
      <button
        type="button"
        aria-pressed={open}
        onClick={() => toggleRightRail("developer")}
        className={`z-10 flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors ${
          open
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        <Code2 className="size-4 shrink-0" />
        {/* The label is the point on a wide screen; on a phone the icon carries
            it, since the header has no room for a second piece of prose. */}
        <span className="hidden sm:inline">{label}</span>
        <kbd className="text-muted-foreground/70 hidden font-mono text-[11px] lg:inline">
          D
        </kbd>
      </button>
    </Hint>
  );
}
