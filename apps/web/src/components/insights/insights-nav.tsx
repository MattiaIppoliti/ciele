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
 * The Insights section's pill rail, the same component and treatment as the
 * Library's. It lives in the layout, so the pill glides between tabs instead
 * of remounting at each destination, and it moves on click rather than when
 * the server answers.
 */
export function InsightsNav() {
  const router = useRouter();
  const pathname = usePathname();
  const current = ITEMS.find((item) => item.href === pathname)?.href ?? "/insights";
  const [, startTransition] = useTransition();
  const [tab, setTab] = useOptimistic(current);

  return (
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
  );
}
