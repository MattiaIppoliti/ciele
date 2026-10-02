"use client";

import { SourceStatusBadge } from "@/components/knowledge/source-status-badge";

import { EmptyState } from "@/components/ui/empty-state";
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
  SourceKind,
  UsageDashboard,
  UsageDashboardFilter,
} from "@agent-hub/core";
import {
  ArrowUpRight,
  Activity as ActivityIcon,
  Bot,
  ClipboardCheck,
  ShieldCheck,
  CircleCheck,
  Circle,
  FileText,
  Globe,
  HelpCircle,
  MessagesSquare,
  Plug,
  Rocket,
  ThumbsDown,
  ThumbsUp,
  Type,
  Workflow,
} from "lucide-react";
import { BookOpen } from "lucide-react";
import { ArcFrame } from "@/components/charts/arc/arc-frame";
import { Gauge } from "@/components/charts/arc/gauge/gauge";
import { Tooltip } from "@/components/charts/beui/motion/tooltip";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { CopyIdButton } from "@/components/assistant/copy-id-button";
import { PreviewVignette } from "@/components/assistant/preview-vignette";
import { DashboardStatCards } from "@/components/insights/dashboard/dashboard-stat-cards";
import { Badge, Button, Hint } from "@agent-hub/ui";
import { flowsInRoutingOrder, pointsDelta, qualityRows, type QualityRow } from "@/lib/assistant-overview";
import { activityStats } from "@/lib/insights/dashboard-stats";
import { formatCount, formatDay } from "@/lib/format";
import { RollingNumber } from "@/components/motion/rolling-number";
import { formatEur } from "@/lib/insights/dashboard-view";
import { knowledgeTabForKind } from "@/lib/knowledge-hub";
import { subjectName } from "@/lib/inbox/conversation-filter";
import { relativeTimeLabel } from "@/lib/source-documents";
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

function ChecklistRow({
  done,
  label,
  href,
}: {
  done: boolean;
  label: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={`press hover:bg-muted flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus-visible:ring-ring/50 outline-none focus-visible:ring-2 ${
        done ? "text-muted-foreground line-through decoration-1" : ""
      }`}
    >
      {done ? (
        <AnimatedIcon
          icon={CircleCheck}
          size={16}
          iconClassName="text-emerald-600"
          className="shrink-0"
        />
      ) : (
        <Circle className="text-muted-foreground size-4 shrink-0" />
      )}
      {label}
    </Link>
  );
}

/** Content sits in a dark inset; the caption and destination share the outer frame. */
function Panel({
  title,
  icon,
  meta,
  href,
  hrefLabel,
  children,
  actions,
  heading = "h2",
  className = "",
}: {
  title: string;
  icon: React.ReactNode;
  meta?: React.ReactNode;
  href?: string;
  hrefLabel?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  heading?: "h1" | "h2";
  className?: string;
}) {
  const Heading = heading;
  return (
    <section
      data-slot="overview-card"
      className={`overview-card flex min-w-0 flex-col ${className}`}
    >
      <div
        data-slot="overview-card-content"
        className="overview-card-content min-w-0 flex-1 p-2"
      >
        {children}
      </div>
      <footer
        data-slot="overview-card-caption"
        className="overview-card-caption flex flex-wrap items-center justify-between gap-3 px-3 py-3"
      >
        <div className="flex min-w-0 flex-1 basis-36 items-center gap-3">
          <span
            data-slot="overview-card-icon"
            className="overview-card-icon flex size-9 shrink-0 items-center justify-center rounded-full"
            aria-hidden
          >
            {icon}
          </span>
          <div className="min-w-0">
            <Heading className="text-sm font-medium">{title}</Heading>
            {meta && <div className="text-muted-foreground text-xs">{meta}</div>}
          </div>
        </div>
        {actions}
        {href && (
          <Link
            href={href}
            aria-label={`${title}: ${hrefLabel || "Open"}`}
            className="overview-card-link press-text text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex shrink-0 items-center gap-1.5 rounded-sm text-xs font-medium outline-none focus-visible:ring-2"
          >
            {hrefLabel}
            <ArrowUpRight className="overview-card-arrow size-4" aria-hidden />
          </Link>
        )}
      </footer>
    </section>
  );
}

function EmptyLine({ children, action, title = "Nothing here yet" }: { children: string; action?: React.ReactNode; title?: string }) {
  return <EmptyState size="sm" title={title} description={children} action={action} />;
}

const SOURCE_ICONS: Record<SourceKind, React.ComponentType<{ className?: string }>> = {
  file: FileText,
  url: Globe,
  website: Globe,
  text: Type,
  faq: HelpCircle,
  application: Plug,
};

/**
 * One row of the Quality card: a small ring and the share it stands for. It
 * answers a hover or a keyboard focus with what the share is made of, the
 * counts behind it and the same share the week before, so a ring is never
 * just a percentage with nothing under it.
 */
function QualityRowView({ row }: { row: QualityRow }) {
  const delta = pointsDelta(row.rate, row.previousRate);
  const rateText = row.rate === null ? row.empty : `${(row.rate * 100).toFixed(1)}%`;
  const content =
    row.rate === null ? (
      <span className="text-muted-foreground">{row.empty} in the last 7 days.</span>
    ) : (
      <span className="grid gap-1">
        <span className="font-medium">{row.label}</span>
        <span>
          {formatCount(row.good)} {row.goodLabel} · {formatCount(row.bad)} {row.badLabel}
        </span>
        <span className="text-muted-foreground">
          {row.previousRate === null
            ? "No earlier week to compare"
            : `Prior 7 days: ${(row.previousRate * 100).toFixed(1)}% (${delta})`}
        </span>
      </span>
    );
  return (
    <Tooltip content={content} delay={60} wrapperClassName="flex w-full" className="max-w-72 text-xs">
      <div
        tabIndex={0}
        aria-label={`${row.label}: ${rateText}`}
        className="group hover:bg-muted focus-visible:ring-ring/50 flex w-full cursor-default items-center gap-3 rounded-lg px-3 py-2 outline-none transition-colors focus-visible:ring-2"
      >
        {row.rate === null ? (
          <span className="border-muted-foreground/30 size-6 shrink-0 rounded-full border-2 border-dashed" aria-hidden="true" />
        ) : (
          <span className="shrink-0 transition-transform duration-200 group-hover:scale-110 group-focus-visible:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100">
            <ArcFrame>
              <Gauge compact value={row.rate * 100} label={row.label} tone="success" />
            </ArcFrame>
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm">{row.label}</span>
        <span className="text-muted-foreground group-hover:text-foreground text-sm tabular-nums transition-colors">
          {rateText}
        </span>
      </div>
    </Tooltip>
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
  // The caption leads to the first step still open, in checklist order, the
  // same place the Activity and Quality captions lead to their detail. With
  // every step done there is nowhere left to send anyone, so no link.
  const nextStep = checklist.find((step) => !step.done);
  const setupDone = doneCount === checklist.length;
  const orderedFlows = flowsInRoutingOrder(flows);
  const shownFlows = orderedFlows.slice(0, 6);
  const enabledFlows = flows.filter((flow) => flow.enabled).length;
  const scope = new URLSearchParams({
    from: activityWindow.from,
    to: activityWindow.to,
    surface: "assistants",
    assistantId: assistant.id,
  }).toString();
  const nowDate = new Date(now);
  const totals = activity.totals;

  return (
    <div className="assistant-overview mx-auto max-w-6xl px-5 py-6 @xl:px-8 @xl:py-8">
      <Panel
        title="Assistant"
        heading="h1"
        icon={<Bot className="size-4" />}
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
            {countLabel(publications.length, "publication")}
          </Button>
        </div>
      </Panel>

      {/* A finished checklist has nothing left to say: it goes, and Activity
          and Quality share the row. */}
      <div className={`mt-6 grid gap-6 ${setupDone ? "@3xl:grid-cols-2" : "@3xl:grid-cols-2 @5xl:grid-cols-3"}`}>
        {setupDone ? null : (
          <Panel
            title="Setup checklist"
            icon={<ClipboardCheck className="size-4" />}
            meta={
              <span className="tabular-nums">
                <RollingNumber value={doneCount} />/{checklist.length}
              </span>
            }
            href={nextStep?.href}
            hrefLabel={nextStep?.section}
          >
            {checklist.map((step) => (
              <ChecklistRow key={step.label} label={step.label} href={step.href} done={step.done} />
            ))}
          </Panel>
        )}

        <Panel
          title="Activity"
          icon={<ActivityIcon className="size-4" />}
          meta="7 days"
          href={`/insights/observability?${scope}`}
          hrefLabel="Observability"
        >
          {activity.totals.turns === 0 ? (
            <EmptyLine title="No recent activity">No turns in the last seven days. Try the Assistant in the Preview.</EmptyLine>
          ) : (
            // The same UI Arc cards the Insights dashboards use: hover or
            // arrow along a line to read each day, deltas against the week
            // before.
            <DashboardStatCards
              specs={activityStats(activity, previousActivity)}
              columns={1}
              bare
              deltaLabel="vs prior 7 days"
            />
          )}
        </Panel>

        <Panel icon={<ShieldCheck className="size-4" />} title="Quality" meta="7 days" href={`/insights/observability?${scope}`} hrefLabel="Details">
          {qualityRows(totals, previousActivity).map((row) => (
            <QualityRowView key={row.key} row={row} />
          ))}
          <Link
            href={`/insights/costs?${scope}`}
            className="press hover:bg-muted mt-1 flex items-center justify-between gap-3 rounded-lg border-t px-3 py-2.5 text-sm"
          >
            <span className="text-muted-foreground">Estimated spend</span>
            <span className="font-medium tabular-nums">{formatEur(totals.spendEur)}</span>
          </Link>
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 @3xl:grid-cols-2">
        <Panel
          title="Flows"
          icon={<Workflow className="size-4" />}
          meta={
            <span className="tabular-nums">
              <RollingNumber value={enabledFlows} /> of{" "}
              <RollingNumber value={flows.length} /> enabled
            </span>
          }
          href={`${base}/flows`}
          hrefLabel="View all"
        >
          {shownFlows.length === 0 ? (
            <EmptyLine
              title="No flows yet"
              action={
                <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`${base}/flows`} />}>
                  Create a flow
                </Button>
              }
            >
              No flows yet.
            </EmptyLine>
          ) : (
            <ul>
              {shownFlows.map((flow) => (
                <li key={flow.id}>
                  <Link
                    href={`${base}/flows/${flow.id}`}
                    className="press hover:bg-muted flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{flow.name}</span>
                    {flow.isDefault ? (
                      <Badge variant="outline">Always last</Badge>
                    ) : flow.builtIn ? (
                      <Badge variant="secondary">Built-in</Badge>
                    ) : null}
                    <StatusPill status={flow.enabled ? "online" : "offline"} primaryText={flow.enabled ? "Enabled" : "Off"} />
                  </Link>
                </li>
              ))}
              {orderedFlows.length > shownFlows.length && (
                <li className="text-muted-foreground px-3 pt-1 pb-2 text-xs">
                  +{orderedFlows.length - shownFlows.length} more
                </li>
              )}
            </ul>
          )}
        </Panel>

        <Panel
          title="Knowledge"
          icon={<BookOpen className="size-4" />}
          meta={
            <span className="tabular-nums">
              <RollingNumber value={sourceCount} />{" "}
              {sourceCount === 1 ? "source" : "sources"} in{" "}
              <RollingNumber value={collections.length} />{" "}
              {collections.length === 1 ? "collection" : "collections"}
            </span>
          }
          href={`${base}/knowledge`}
          hrefLabel="View all"
        >
          {recentSources.length === 0 ? (
            <EmptyLine
              title="No knowledge sources"
              action={
                <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`${base}/knowledge`} />}>
                  Add knowledge
                </Button>
              }
            >
              No sources yet. Answers come from the model alone until one is added.
            </EmptyLine>
          ) : (
            <ul>
              {recentSources.map((source) => {
                const Icon = SOURCE_ICONS[source.kind] ?? FileText;
                return (
                  <li key={source.id}>
                    <Link
                      href={`/library/${knowledgeTabForKind(source.kind)}/${source.id}`}
                      className="press hover:bg-muted flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm"
                    >
                      <Icon className="text-muted-foreground size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate font-medium">{source.name}</span>
                      <SourceStatusBadge status={source.status} error={source.error} />
                      <span className="text-muted-foreground w-24 shrink-0 text-right text-xs" title={formatDay(source.createdAt)}>
                        {relativeTimeLabel(source.createdAt, nowDate)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        className="mt-6"
        title="Recent conversations"
        icon={<MessagesSquare className="size-4" />}
        href={`/inbox?assistantId=${encodeURIComponent(assistant.id)}`}
        hrefLabel="Inbox"
      >
        {conversations.length === 0 ? (
          <EmptyLine title="No conversations yet">No Visitor conversations yet. Publish the widget, or try it in the Preview.</EmptyLine>
        ) : (
          <ul className="divide-border divide-y">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <Link
                  href={`/inbox?conversation=${encodeURIComponent(conversation.id)}`}
                  className="press hover:bg-muted flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-3 py-3 text-sm"
                >
                  <span className="min-w-0 flex-1 basis-60">
                    <span className="block truncate font-medium">{conversation.title || "Untitled conversation"}</span>
                    <span className="text-muted-foreground block truncate text-xs">{subjectName(conversation)}</span>
                  </span>
                  {conversation.flowNames[0] && (
                    <Badge variant="outline" className="max-w-40">
                      <span className="truncate">{conversation.flowNames[0]}</span>
                    </Badge>
                  )}
                  {conversation.metadata.escalated && <StatusPill status="warning" primaryText="Escalated" />}
                  {conversation.feedback === 1 && <ThumbsUp className="size-3.5 text-emerald-600" aria-label="Rated up" />}
                  {conversation.feedback === -1 && <ThumbsDown className="size-3.5 text-red-500" aria-label="Rated down" />}
                  <span className="text-muted-foreground w-20 text-xs tabular-nums">
                    {countLabel(conversation.messageCount, "message")}
                  </span>
                  <span className="text-muted-foreground w-24 text-right text-xs" title={formatDay(conversation.updatedAt)}>
                    {relativeTimeLabel(conversation.updatedAt, nowDate)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
