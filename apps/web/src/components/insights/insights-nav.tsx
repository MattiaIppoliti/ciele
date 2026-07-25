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
    <ul className="space-y-1">
      {ITEMS.map((item) => {
        const active = pathname === item.href;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              className={`flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
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
