"use client";

import { use, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { GLOBAL_NAV, mayOpenPath, navVisibleTo, type NavAccess } from "@/components/shell/nav";

/**
 * The permission page a Member sees on a direct URL to a page their Role does
 * not reach (ADR-0028): a Data Viewer opening the Inbox, a Support Agent
 * (#1086) opening an Assistant's Flows. Presentational only: what a Member may
 * read or change is decided by the operations layer and RLS.
 */
export function ConsoleGate({ access, children }: { access: Promise<NavAccess>; children: ReactNode }) {
  const resolved = use(access);
  const pathname = usePathname();
  if (mayOpenPath(resolved, pathname)) return children;
  const supportAgent = resolved.role === "support_agent";
  // Somewhere they can go: the first entry their sidebar draws.
  const home = GLOBAL_NAV.find((item) => !item.adminOnly && navVisibleTo(resolved, item)) ?? null;
  return (
    <EmptyState
      className="h-full justify-center"
      icon={<ShieldAlert size={24} />}
      title="You don't have permission to open this page"
      description={
        supportAgent
          ? "Your Role is Support Agent: you work the Inbox and the Help Desks you staff. Ask an Admin if you need access."
          : "Your Role does not include this page. Ask an Admin if you need access."
      }
      action={
        home ? (
          <Link href={home.href} className="press-text text-primary text-sm font-medium underline-offset-4 hover:underline">
            Go to {home.label}
          </Link>
        ) : null
      }
    />
  );
}
