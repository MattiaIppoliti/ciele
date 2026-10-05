"use client";

import Link from "next/link";
import type { Flow, InboxConversation, Source, SourceKind } from "@agent-hub/core";
import { BookOpen, FileText, Globe, HelpCircle, MessagesSquare, Plug, ThumbsDown, ThumbsUp, Type, Workflow } from "lucide-react";
import { Badge, Button } from "@agent-hub/ui";
import { OverviewCard } from "./overview-blocks";
import { SourceStatusBadge } from "@/components/knowledge/source-status-badge";
import { RollInText } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { StatusBadge as StatusPill } from "@/components/spaceui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { flowsInRoutingOrder } from "@/lib/assistant-overview";
import { formatDay } from "@/lib/format";
import { knowledgeTabForKind } from "@/lib/knowledge-hub";
import { subjectName } from "@/lib/inbox/conversation-filter";
import { relativeTimeLabel } from "@/lib/source-documents";
import { countLabel } from "@/lib/pagination";

function EmptyLine({ children, action, title }: { children: string; action?: React.ReactNode; title: string }) {
  return <EmptyState size="sm" title={title} description={children} action={action} />;
}
const SOURCE_ICONS: Record<SourceKind, React.ComponentType<{ className?: string }>> = {
  file: FileText, url: Globe, website: Globe, text: Type, faq: HelpCircle, application: Plug,
};

export function OverviewFlows({ flows, base }: { flows: Flow[]; base: string }) {
  const orderedFlows = flowsInRoutingOrder(flows);
  const shownFlows = orderedFlows.slice(0, 6);
  const enabledFlows = flows.filter((flow) => flow.enabled).length;
  return (
<OverviewCard
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
                    <span className="min-w-0 flex-1 truncate font-medium"><RollInText text={flow.name} /></span>
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
        </OverviewCard>
  );
}

export type OverviewSource = Pick<Source, "id" | "kind" | "name" | "status" | "error" | "createdAt">;
export function OverviewKnowledge({ sources, sourceCount, collectionCount, base, now }: {
  sources: OverviewSource[]; sourceCount: number; collectionCount: number; base: string; now: string;
}) {
  const nowDate = new Date(now);
  return (
<OverviewCard
          title="Knowledge"
          icon={<BookOpen className="size-4" />}
          meta={
            <span className="tabular-nums">
              <RollingNumber value={sourceCount} />{" "}
              {sourceCount === 1 ? "source" : "sources"} in{" "}
              <RollingNumber value={collectionCount} />{" "}
              {collectionCount === 1 ? "collection" : "collections"}
            </span>
          }
          href={`${base}/knowledge`}
          hrefLabel="View all"
        >
          {sources.length === 0 ? (
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
              {sources.map((source) => {
                const Icon = SOURCE_ICONS[source.kind] ?? FileText;
                return (
                  <li key={source.id}>
                    <Link
                      href={`/library/${knowledgeTabForKind(source.kind)}/${source.id}`}
                      className="press hover:bg-muted flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm"
                    >
                      <Icon className="text-muted-foreground size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate font-medium"><RollInText text={source.name} /></span>
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
        </OverviewCard>
  );
}

export type OverviewConversation = Pick<InboxConversation, "id" | "title" | "metadata" | "subjectType" | "flowNames" | "feedback" | "messageCount" | "updatedAt">;
export function OverviewConversations({ conversations, assistantId, now, className }: {
  conversations: OverviewConversation[]; assistantId: string; now: string; className?: string;
}) {
  const nowDate = new Date(now);
  return (
<OverviewCard
        className={className}
        title="Recent conversations"
        icon={<MessagesSquare className="size-4" />}
        href={`/inbox?assistantId=${encodeURIComponent(assistantId)}`}
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
                    <RollInText text={countLabel(conversation.messageCount, "message")} />
                  </span>
                  <span className="text-muted-foreground w-24 text-right text-xs" title={formatDay(conversation.updatedAt)}>
                    {relativeTimeLabel(conversation.updatedAt, nowDate)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </OverviewCard>
  );
}
