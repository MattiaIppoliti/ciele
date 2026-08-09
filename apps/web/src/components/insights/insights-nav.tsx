"use client";

import { Link } from "@/components/ui/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { label: "Insights", href: "/insights" },
  { label: "Trends", href: "/insights/trends" },
  { label: "Feedback & grading", href: "/insights/feedback" },
  { label: "Exports", href: "/insights/exports" },
];

export function InsightsNav() {
  const pathname = usePathname();

  return (
    // One list, two shapes: a scrollable horizontal strip on small screens
    // (`no-scrollbar` because a visible bar under four tabs is noise) and the
    // stacked rail from `lg` up.
    <ul className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col lg:gap-0 lg:space-y-1 lg:overflow-visible">
      {ITEMS.map((item) => {
        const active = pathname === item.href;
        return (
          <li key={item.href} className="shrink-0 lg:shrink">
            <Link
              href={item.href}
              className={`flex items-center rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                active
                  ? "bg-primary/8 text-primary ring-primary/30 ring-1"
                  : "hover:bg-muted"
              }`}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
