"use client";

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
  ChevronRight,
  CircleCheck,
  Circle,
  FileText,
  Globe,
  HelpCircle,
  MessageCircle,
  MessagesSquare,
  Plug,
  Rocket,
  ThumbsDown,
  ThumbsUp,
  Type,
  Workflow,
} from "lucide-react";
import { BookOpen } from "lucide-react";
import { RadialGauge } from "@agent-hub/charts";
import { Tooltip } from "@/components/charts/beui/motion/tooltip";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { CopyIdButton } from "@/components/assistant/copy-id-button";
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

/** A card with a title row and, when it leads somewhere, a chevron link to it. */
function Panel({
  title,
  meta,
  href,
  hrefLabel,
  children,
  className = "",
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  href?: string;
  hrefLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-card flex min-w-0 flex-col rounded-xl border shadow-xs ${className}`}>
      <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-medium">
          {title}
          {meta && <span className="text-muted-foreground text-xs font-normal">{meta}</span>}
        </h2>
        {href && (
          <Link
            href={href}
            aria-label={hrefLabel}
            className="press-text text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex shrink-0 items-center gap-0.5 rounded-sm text-xs font-medium outline-none focus-visible:ring-2"
          >
            {hrefLabel}
            <ChevronRight className="size-3.5" />
          </Link>
        )}
      </header>
      <div className="min-w-0 flex-1 px-2 pb-2">{children}</div>
    </section>
  );
}

function EmptyLine({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="text-muted-foreground flex flex-col items-start gap-3 px-3 py-6 text-sm">
      {children}
      {action}
    </div>
  );
}

const SOURCE_ICONS: Record<SourceKind, React.ComponentType<{ className?: string }>> = {
  file: FileText,
  url: Globe,
  website: Globe,
  text: Type,
  faq: HelpCircle,
  application: Plug,
};

const STATUS_DOT: Record<Source["status"], string> = {
  ready: "bg-emerald-500",
  processing: "bg-amber-500",
  error: "bg-red-500",
};

const STATUS_LABEL: Record<Source["status"], string> = {
  ready: "Ready",
  processing: "Processing",
  error: "Failed",
};

/**
 * One row of the Quality card: a small ring and the share it stands for. It
 * answers a hover or a keyboard focus with what the share is made of, the
 * counts behind it and the same share the week before, so a ring is never
 * just a percentage with nothing under it.
 */
function QualityRowView({ row }: { row: QualityRow }) {
  const delta = pointsDelta(row.rate, row.previousRate);
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
        aria-label={`${row.label}: ${row.rate === null ? row.empty : `${(row.rate * 100).toFixed(1)}%`}`}
        className="group hover:bg-muted focus-visible:ring-ring/50 flex w-full cursor-default items-center gap-3 rounded-lg px-3 py-2 outline-none transition-colors focus-visible:ring-2"
      >
        {row.rate === null ? (
          <span className="border-muted-foreground/30 size-6 shrink-0 rounded-full border-2 border-dashed" aria-hidden="true" />
        ) : (
          <span className="shrink-0 transition-transform duration-200 group-hover:scale-110 group-focus-visible:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100">
            <RadialGauge
              size={24}
              strokeWidth={3}
              gap={0}
              rings={[
                {
                  fraction: row.rate,
                  toneClass: "stroke-[#2a78d6] dark:stroke-[#3987e5]",
                  label: `${row.label}: ${Math.round(row.rate * 100)}%`,
                },
              ]}
            />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm">{row.label}</span>
        <span className="text-muted-foreground group-hover:text-foreground text-sm tabular-nums transition-colors">
          {row.rate === null ? row.empty : `${(row.rate * 100).toFixed(1)}%`}
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
  const brandColor = assistant.style.brandColor ?? "#0a0a0a";
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
  // The header leads to the first step still open, in checklist order, the
  // same place the Activity and Quality headers lead to their detail. With
  // every step done there is nowhere left to send anyone, so no link.
  const nextStep = checklist.find((step) => !step.done);
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
    <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8 sm:py-8">
      <div className="bg-card rounded-xl border shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
          <h1 className="text-sm font-medium">Assistant</h1>
          <div className="flex items-center gap-2">
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
        </div>
        <div className="grid gap-8 px-6 py-6 lg:grid-cols-[1fr_1.2fr]">
          {/* Widget vignette in place of Vercel's deployment screenshot. */}
          <div
            aria-hidden
            className="bg-muted/50 relative flex min-h-44 items-end justify-end rounded-lg border p-4"
          >
            <div className="bg-card absolute top-4 left-4 max-w-[70%] rounded-lg border px-3 py-2 shadow-xs">
              <p className="truncate text-xs font-medium">
                {assistant.nickname || assistant.title}
              </p>
              <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                {assistant.welcomeMessage || "Hi! How can I help?"}
              </p>
            </div>
            <span
              className="flex size-11 items-center justify-center rounded-full text-white shadow-md"
              style={{ backgroundColor: brandColor }}
            >
              <AnimatedIcon icon={MessageCircle} size={20} />
            </span>
          </div>

          <div className="grid content-start gap-5 sm:grid-cols-2">
            <DetailRow label="Status">
              <span
                className={`size-2 rounded-full ${latest ? "bg-emerald-500" : "bg-amber-500"}`}
              />
              <span className="ml-1">
                {latest ? `Published v${latest.version}` : "Draft"}
              </span>
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
              <div className="sm:col-span-2">
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
            {publications.length} {publications.length === 1 ? "publication" : "publications"}
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel
          title="Setup checklist"
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

        <Panel
          title="Activity"
          meta="7 days"
          href={`/insights/observability?${scope}`}
          hrefLabel="Observability"
        >
          {activity.totals.turns === 0 ? (
            <EmptyLine>No turns in the last seven days. Try the Assistant in the Preview.</EmptyLine>
          ) : (
            // The same Spectrum cards the Insights dashboards use: hover or
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

        <Panel title="Quality" meta="7 days" href={`/insights/observability?${scope}`} hrefLabel="Details">
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

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel
          title={
            <>
              <AnimatedIcon icon={Workflow} size={16} iconClassName="text-muted-foreground" /> Flows
            </>
          }
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
                    <span
                      className={`size-2 shrink-0 rounded-full ${flow.enabled ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                      aria-label={flow.enabled ? "Enabled" : "Disabled"}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{flow.name}</span>
                    {flow.isDefault ? (
                      <Badge variant="outline">Always last</Badge>
                    ) : flow.builtIn ? (
                      <Badge variant="secondary">Built-in</Badge>
                    ) : null}
                    {!flow.enabled && <span className="text-muted-foreground text-xs">Off</span>}
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
          title={
            <>
              <BookOpen className="text-muted-foreground size-4" /> Knowledge
            </>
          }
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
                      <span
                        className={`size-2 shrink-0 rounded-full ${STATUS_DOT[source.status]}`}
                        aria-label={STATUS_LABEL[source.status]}
                      />
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
        title={
          <>
            <MessagesSquare className="text-muted-foreground size-4" /> Recent conversations
          </>
        }
        href={`/inbox?assistantId=${encodeURIComponent(assistant.id)}`}
        hrefLabel="Inbox"
      >
        {conversations.length === 0 ? (
          <EmptyLine>No Visitor conversations yet. Publish the widget, or try it in the Preview.</EmptyLine>
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
                  {conversation.metadata.escalated && <Badge variant="destructive">Escalated</Badge>}
                  {conversation.feedback === 1 && <ThumbsUp className="size-3.5 text-emerald-600" aria-label="Rated up" />}
                  {conversation.feedback === -1 && <ThumbsDown className="size-3.5 text-red-500" aria-label="Rated down" />}
                  <span className="text-muted-foreground w-20 text-xs tabular-nums">
                    {conversation.messageCount} {conversation.messageCount === 1 ? "message" : "messages"}
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
