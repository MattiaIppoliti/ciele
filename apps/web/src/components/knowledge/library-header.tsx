"use client";

import { SourceStatusBadge } from "@/components/knowledge/source-status-badge";

import { useOptimistic, useTransition } from "react";
import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import type { OrgKnowledgeStatusCounts, SourceStatus } from "@agent-hub/core";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import {
  KNOWLEDGE_TAB_LABELS,
  KNOWLEDGE_TAB_SLUGS,
  KNOWLEDGE_TAB_TITLES,
  isKnowledgeTabSlug,
  tabHealth,
  type KnowledgeTabSlug,
} from "@/lib/knowledge-hub";
import { RollingNumber } from "@/components/motion/rolling-number";
import { SPRING_NUDGE } from "@/lib/ease";

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
      {/* The breadcrumb is the visible title; the tab rail below carries the
          counts. */}
      <h1 className="sr-only">{KNOWLEDGE_TAB_TITLES[tab]}</h1>

      {/* One pill rail rather than an underline: the tab is also the route, so
          the selected bucket has to read as a place you are, not a border. */}
      <Tabs
        transition={SPRING_NUDGE}
        value={tab}
        onValueChange={(slug) =>
          startTransition(() => {
            setTab(slug as KnowledgeTabSlug);
            router.push(`/library/${slug}`);
          })
        }
        className="px-4 pt-4 sm:px-6"
      >
        <TabsList aria-label="Library tabs">
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
              <TabsTrigger
                key={slug}
                value={slug}
                href={`/library/${slug}`}
                className="gap-2"
              >
                {KNOWLEDGE_TAB_LABELS[slug]}
                <RollingNumber
                  value={summary?.total ?? 0}
                  className="text-xs opacity-70"
                />
                {health && (
                  <SourceStatusBadge status={health} />
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

    </div>
  );
}
