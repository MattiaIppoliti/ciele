"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import type { OrgKnowledgeStatusCounts, SourceStatus } from "@agent-hub/core";
import { Badge } from "@agent-hub/ui";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import {
  KNOWLEDGE_TAB_INTROS,
  KNOWLEDGE_TAB_LABELS,
  KNOWLEDGE_TAB_SLUGS,
  KNOWLEDGE_TAB_TITLES,
  isKnowledgeTabSlug,
  tabHealth,
  type KnowledgeTabSlug,
} from "@/lib/knowledge-hub";

const HEALTH_DOT: Record<SourceStatus, string> = {
  ready: "bg-emerald-500",
  processing: "bg-amber-500",
  error: "bg-red-500",
};

export interface LibraryTabSummary {
  total: number;
  statusCounts: OrgKnowledgeStatusCounts;
}

/**
 * The Library's heading and its tab rail.
 *
 * It lives in the route *layout*, not in the page, because the pill glides
 * between tabs with a shared `layoutId` and Next keys each route segment: from
 * inside `[tab]/page.tsx` every click unmounted the indicator and remounted it
 * at the destination, which reads as a jump, not a move. The layout survives
 * the segment change, so both positions exist in one commit.
 *
 * The rail sits above the intro for the same reason the user can see: the four
 * intros are different lengths, and a paragraph that wraps to one line on FAQs
 * and two on Websites moved the tabs vertically on every navigation.
 */
export function LibraryHeader({
  tabSummaries,
  applicationHealthSummary,
}: {
  tabSummaries: Record<string, LibraryTabSummary>;
  applicationHealthSummary: {
    connected: number;
    pending: number;
    attention: number;
    syncing: number;
    ready: number;
  };
}) {
  const router = useRouter();
  const segment = useSelectedLayoutSegment();
  const current: KnowledgeTabSlug =
    segment && isKnowledgeTabSlug(segment) ? segment : "websites";
  const [, startTransition] = useTransition();
  // The pill moves on click, not when the server answers. Without this the
  // rail waits out the navigation and the glide plays late.
  const [tab, setTab] = useOptimistic(current);

  // Applications have no Source status of their own until content is imported,
  // so their dot rolls up connection health first and falls back to the rows.
  const applicationHealth: SourceStatus | null =
    applicationHealthSummary.attention > 0
      ? "error"
      : applicationHealthSummary.pending > 0 || applicationHealthSummary.syncing > 0
        ? "processing"
        : applicationHealthSummary.connected > 0 || applicationHealthSummary.ready > 0
          ? "ready"
          : null;

  return (
    <div className="shrink-0">
      <header className="flex flex-wrap items-center gap-3 px-4 pt-5 pb-3 sm:px-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          {KNOWLEDGE_TAB_TITLES[tab]}
          <Badge variant="secondary">{tabSummaries[tab]?.total ?? 0}</Badge>
        </h1>
      </header>

      {/* One pill rail rather than an underline: the tab is also the route, so
          the selected bucket has to read as a place you are, not a border. */}
      <Tabs
        value={tab}
        onValueChange={(slug) =>
          startTransition(() => {
            setTab(slug as KnowledgeTabSlug);
            router.push(`/library/${slug}`);
          })
        }
        className="px-4 sm:px-6"
      >
        <TabsList aria-label="Library tabs" className="bg-muted">
          {KNOWLEDGE_TAB_SLUGS.map((slug) => {
            const summary = tabSummaries[slug];
            const health =
              slug === "applications"
                ? (applicationHealth ??
                  (summary ? tabHealth(summary.statusCounts) : null))
                : summary
                  ? tabHealth(summary.statusCounts)
                  : null;
            return (
              <TabsTrigger key={slug} value={slug} className="gap-2">
                {KNOWLEDGE_TAB_LABELS[slug]}
                <span className="text-xs opacity-70">{summary?.total ?? 0}</span>
                {health && (
                  <span
                    className={`size-1.5 rounded-full ${HEALTH_DOT[health]}`}
                    aria-label={`status: ${health}`}
                  />
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {/* Two lines reserved: the shortest intro is one line and the longest is
          two, and without the floor the table under them jumps between tabs. */}
      <p className="text-muted-foreground mt-3 min-h-10 max-w-3xl px-4 text-sm sm:px-6">
        {KNOWLEDGE_TAB_INTROS[tab]}
      </p>
    </div>
  );
}
