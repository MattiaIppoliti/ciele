"use client";

import { usePathname } from "next/navigation";
import { Code2, PanelTop } from "lucide-react";
import { Hint } from "@agent-hub/ui";
import { useShell } from "@/components/shell/shell-provider";
import { assistantIdFromPath, panelDomainsForPath } from "@/components/shell/nav";
import { useTouchNavigation } from "@/components/shell/mobile-navigation";
import { DOMAIN_PRESENTATION } from "@/lib/developer-panel/domains";

/**
 * The way into the Developer Panel (#754): a top-bar button labelled with the
 * page's own domain ("Flows API").
 *
 * The `D` shortcut still opens the panel, but the button does not print the key
 * beside the label. A bare letter next to a noun reads as part of the noun
 * ("Teammates API D"), and the top bar is the one place in the console where
 * every pixel is already spoken for. The tooltip is where a shortcut belongs.
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
  const touch = useTouchNavigation();
  const assistantId = assistantIdFromPath(pathname);
  if (touch && assistantId && pathname.endsWith("/preview")) return null;
  if (touch && assistantId) return <button type="button" aria-label="Open chatbot preview" aria-pressed={rightRail === "preview"} onClick={() => toggleRightRail("preview")} className="flex size-[44px] shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><PanelTop className="size-5" /></button>;
  const domains = panelDomainsForPath(pathname);
  const first = domains[0] ? DOMAIN_PRESENTATION[domains[0]] : undefined;
  if (!first) return null;

  const open = rightRail === "developer";
  // A multi-domain page is labelled from its first domain (#753), the page
  // leads with its primary subject, and "Developer" names nothing.
  const label = first.title;

  return (
    <Hint
      label={`${open ? "Hide" : "Show"} ${label} (D)`}
    >
      <button
        type="button"
        aria-pressed={open}
        aria-label={`${label} developer panel`}
        onClick={() => toggleRightRail("developer")}
        className={`press-control z-10 flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
          open
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        <Code2 className="size-4 shrink-0" />
      </button>
    </Hint>
  );
}
