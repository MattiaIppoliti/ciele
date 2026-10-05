"use client";

import { OverviewCard, OverviewChecklist, OverviewActivity, OverviewQuality } from "./overview-blocks";
import { OverviewFlows, OverviewKnowledge, OverviewConversations } from "./overview-resource-blocks";

import { RollInText } from "@/components/motion/roll-in-text";

import { StatusBadge as StatusPill } from "@/components/spaceui/status-badge";

// Client component: AnimatedIcon takes lucide component references as props,
// which a Server Component cannot serialize across the RSC boundary.
import Link from "next/link";
import type {
  Assistant,
  Flow,
  InboxConversation,
  KnowledgeCollection,
  Publication,
  Source,
  UsageDashboard,
  UsageDashboardFilter,
} from "@agent-hub/core";
import {
  Rocket,
} from "lucide-react";
import { AnimatedGlyph, AnimatedIcon } from "@/components/ui/animated-icon";
import { BotIcon } from "@/components/ui/icons/bot";
import { CopyIdButton } from "@/components/assistant/copy-id-button";
import { PreviewVignette } from "@/components/assistant/preview-vignette";
import { Badge, Button, Hint } from "@agent-hub/ui";
import { formatDay } from "@/lib/format";
import { countLabel } from "@/lib/pagination";

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground text-sm">{label}</p>
      <div className="mt-0.5 flex min-w-0 items-center gap-1 text-sm font-medium">
        {children}
      </div>
    </div>
  );
}

/**
 * Vercel-style project Overview for one Assistant: the status card, then what
 * someone opening it wants to know first. Is it set up, is it answering and
 * how well, what does it route and read, and what did Visitors ask it lately.
 * Every card leads to the page that owns its detail.
 */
export function AssistantOverview({
  assistant,
  flows,
  collections,
  publications,
  recentSources,
  sourceCount,
  conversations,
  activity,
  previousActivity,
  activityWindow,
  now,
}: {
  assistant: Assistant;
  flows: Flow[];
  collections: KnowledgeCollection[];
  publications: Publication[];
  recentSources: Source[];
  sourceCount: number;
  conversations: InboxConversation[];
  activity: UsageDashboard;
  /** The seven days before `activity`, for the rows' deltas; null with no earlier activity. */
  previousActivity: UsageDashboard["totals"] | null;
  activityWindow: UsageDashboardFilter;
  /** The server's clock, so relative times hydrate against the same instant. */
  now: string;
}) {
  const latest = publications.reduce<Publication | null>(
    (top, p) => (top && top.version >= p.version ? top : p),
    null
  );
  const base = `/assistants/${assistant.id}`;
  const checklist = [
    {
      label: "Add knowledge sources",
      section: "Knowledge",
      href: `${base}/knowledge`,
      done: collections.length > 0,
    },
    {
      label: "Create a flow",
      section: "Flows",
      href: `${base}/flows`,
      done: flows.some((flow) => !flow.isDefault),
    },
    {
      label: "Publish the widget",
      section: "Publish",
      href: `${base}/publish`,
      done: latest !== null,
    },
  ];
  const doneCount = checklist.filter((step) => step.done).length;
  const setupDone = doneCount === checklist.length;
  const scope = new URLSearchParams({
    from: activityWindow.from,
    to: activityWindow.to,
    surface: "assistants",
    assistantId: assistant.id,
  }).toString();

  return (
    <div className="assistant-overview mx-auto max-w-6xl px-5 py-6 @xl:px-8 @xl:py-8">
      <OverviewCard
        title="Assistant"
        heading="h1"
        icon={<AnimatedGlyph icon={BotIcon} size={16} aria-hidden />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href={`${base}/general`} />}
            >
              Edit
            </Button>
            <Button
              nativeButton={false}
              render={<Link href={`${base}/publish`} />}
            >
              Publish
            </Button>
          </div>
        }
      >
        <div className="grid gap-8 px-4 py-4 @3xl:grid-cols-[1fr_1.2fr]">
          {/* The Preview's own chat card in miniature, and the way to it:
              selecting it opens the live Preview in the right rail. */}
          <PreviewVignette assistant={assistant} base={base} />

          <div className="grid content-start gap-5 @md:grid-cols-2">
            <DetailRow label="Status">
              <StatusPill
                status={latest ? "online" : "away"}
                primaryText={latest ? `Published v${latest.version}` : "Draft"}
              />
            </DetailRow>
            <DetailRow label={latest ? "Last published" : "Created"}>
              {formatDay(latest ? latest.createdAt : assistant.createdAt)}
            </DetailRow>
            <DetailRow label="Assistant ID">
              <Hint label={assistant.id}>
                <code translate="no" className="truncate font-mono text-xs">{assistant.id}</code>
              </Hint>
              <CopyIdButton id={assistant.id} />
            </DetailRow>
            <DetailRow label="Model">
              <Badge
                variant="secondary"
                className="max-w-full font-mono text-xs"
              >
                <span translate="no" className="truncate">
                  {assistant.modelProvider} · {assistant.modelId}
                </span>
              </Badge>
            </DetailRow>
            {assistant.description && (
              <div className="@md:col-span-2">
                <p className="text-muted-foreground text-sm">Description</p>
                <p className="mt-0.5 line-clamp-3 text-sm">
                  {assistant.description}
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-3 border-t px-6 py-3 text-xs">
          <span className="flex items-center gap-2">
            <AnimatedIcon icon={Rocket} size={14} />
            To update the live widget, publish again from the Publish section.
          </span>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`${base}/publish`} />}>
            <RollInText text={countLabel(publications.length, "publication")} />
          </Button>
        </div>
      </OverviewCard>

      {/* A finished checklist has nothing left to say: it goes, and Activity
          and Quality share the row. */}
      <div className={`mt-6 grid gap-6 ${setupDone ? "@3xl:grid-cols-2" : "@3xl:grid-cols-2 @5xl:grid-cols-3"}`}>
        <OverviewChecklist steps={checklist} />

        <OverviewActivity activity={activity} previousActivity={previousActivity} href={`/insights/observability?${scope}`} />
        <OverviewQuality totals={activity.totals} previous={previousActivity} href={`/insights/observability?${scope}`} costsHref={`/insights/costs?${scope}`} />
      </div>

      <div className="mt-6 grid gap-6 @3xl:grid-cols-2">
        <OverviewFlows flows={flows} base={base} />
        <OverviewKnowledge sources={recentSources} sourceCount={sourceCount} collectionCount={collections.length} base={base} now={now} />
      </div>

      <OverviewConversations className="mt-6" conversations={conversations} assistantId={assistant.id} now={now} />
    </div>
  );
}
