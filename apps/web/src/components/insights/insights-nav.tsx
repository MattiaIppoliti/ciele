"use client";

import { useOptimistic, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";

const ITEMS = [
  { label: "Insights", href: "/insights" },
  { label: "Costs", href: "/insights/costs" },
  { label: "Observability", href: "/insights/observability" },
  { label: "Exports", href: "/insights/exports" },
];

/**
 * The Insights section's title and pill rail, the same shape as the Library's:
 * the heading sits above the tabs and names the tab you are on. Both live in
 * the layout and read the same optimistic tab, so the pill glides and the title
 * rolls on click rather than when the server answers, and neither remounts.
 */
export function InsightsNav() {
  const router = useRouter();
  const pathname = usePathname();
  const current = ITEMS.find((item) => item.href === pathname)?.href ?? "/insights";
  const [, startTransition] = useTransition();
  const [tab, setTab] = useOptimistic(current);

  const title = ITEMS.find((item) => item.href === tab)?.label ?? "Insights";

  return (
    <div className="flex flex-col gap-3">
      {/* The breadcrumb is the visible title. */}
      <h1 className="sr-only" data-testid="insights-heading">
        {title}
      </h1>
      <nav aria-label="Insights sections">
        <Tabs
          value={tab}
          onValueChange={(href) =>
            startTransition(() => {
              setTab(href);
              router.push(href);
            })
          }
        >
          <TabsList aria-label="Insights tabs">
            {ITEMS.map((item) => (
              <TabsTrigger key={item.href} value={item.href} href={item.href}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </nav>
    </div>
  );
}
