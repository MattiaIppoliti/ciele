"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { panelDomainsForPath } from "@/components/shell/nav";
import { useShell } from "@/components/shell/shell-provider";

const DeveloperPanel = dynamic(
  () => import("./developer-panel").then((module) => module.DeveloperPanel),
  { ssr: false }
);

/**
 * Mounts the Developer Panel when it holds the right rail (#754).
 *
 * Code-split and mounted only while open, like the live Preview it shares the
 * rail with, except this one has no state worth preserving across a close, so
 * it unmounts rather than collapsing. There is no collapsed rail either: the way
 * back in is the top-bar button and `D`, and a second sliver of chrome beside the
 * Preview's would only be ambiguous.
 */
export function DeveloperPanelLauncher() {
  const pathname = usePathname();
  const { rightRail } = useShell();
  const domains = panelDomainsForPath(pathname);
  if (rightRail !== "developer" || domains.length === 0) return null;
  return <DeveloperPanel domains={domains} />;
}
