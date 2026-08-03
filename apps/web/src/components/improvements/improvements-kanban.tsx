"use client";

import { Link } from "@/components/ui/link";
import type { ImprovementListItem } from "@agent-hub/core";
import { CalendarClock, MessageSquare } from "lucide-react";
import { Badge, Card, CardContent, cn } from "@agent-hub/ui";
import { formatDay } from "@/lib/format";
import { memberDisplayName, memberInitials } from "@/lib/members";
import {
  IMPROVEMENT_STATUSES,
  improvementKey,
  keepsLinkNavigation,
  priorityMeta,
} from "@/lib/improvements";
import { ImprovementContextMenu } from "./improvement-context-menu";
import type { ImprovementLanes } from "./use-improvement-lanes";

interface CardProps extends React.HTMLAttributes<HTMLElement> {
  item: ImprovementListItem;
  assigneeEmail: string | null;
  lanes: ImprovementLanes;
  onOpen: () => void;
}

/**
 * The card is the context menu's trigger, so it forwards the props the trigger
 * clones onto it (`onContextMenu`, the long-press handlers, `aria-*`) to the
 * anchor that actually receives the right-click.
 */
function ImprovementCard({
  item,
  assigneeEmail,
  lanes,
  onOpen,
  className,
  ...trigger
}: CardProps) {
  const pri = priorityMeta(item.priority);
  const drag = lanes.dragProps(item.id);
  return (
    <Link
      href={`/improvements/${item.id}`}
      {...drag}
      onClick={(e) => {
        if (keepsLinkNavigation(e)) return;
        e.preventDefault();
        onOpen();
      }}
      {...trigger}
      className={cn(
        "block rounded-xl transition-opacity",
        lanes.draggingId === item.id && "opacity-40",
        drag.draggable && "cursor-grab active:cursor-grabbing",
        className,
      )}
    >
      <Card size="sm" className="hover:ring-primary/40 transition-shadow">
        <CardContent className="flex flex-col gap-2.5">
          <div className="flex items-start justify-between gap-2">
            <span className="line-clamp-2 text-sm font-medium">
              {item.title}
            </span>
            {item.priority !== "none" && (
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${pri.chip}`}
              >
                <pri.icon className="size-3" />
                {pri.label}
              </span>
            )}
          </div>

          {item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.tags.slice(0, 3).map((t) => (
                <Badge key={t} variant="outline" className="text-[11px]">
                  {t}
                </Badge>
              ))}
            </div>
          )}

          <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
            <span className="bg-muted/50 rounded-md border px-1.5 py-0.5 font-mono text-[11px]">
              {improvementKey(item.seq)}
            </span>
            <div className="flex items-center gap-2">
              {item.messageCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <MessageSquare className="size-3.5" />
                  {item.messageCount}
                </span>
              )}
              {item.dueDate && (
                <span className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums">
                  <CalendarClock className="size-3.5" />
                  {formatDay(item.dueDate)}
                </span>
              )}
              {assigneeEmail ? (
                <span
                  title={memberDisplayName(assigneeEmail)}
                  className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                >
                  {memberInitials(assigneeEmail)}
                </span>
              ) : (
                <span className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold">
                  N/A
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * Kanban view of the Improvements tracker: one column per lane, cards dragged
 * between lanes with the browser's native drag-and-drop (no dnd dependency).
 *
 * A drop only changes `status` — lanes keep the server's ordering, since an
 * Improvement has no stored position to reorder within a lane.
 */
export function ImprovementsKanban({
  improvements,
  members,
  tagOptions,
  canEdit,
  lanes,
  onOpen,
  onTagRemembered,
}: {
  improvements: ImprovementListItem[];
  members: Array<{ userId: string; email: string }>;
  /** Tags already in use org-wide — the context menu's togglable set. */
  tagOptions: string[];
  canEdit: boolean;
  lanes: ImprovementLanes;
  /** Plain click on a card — the board opens it in the drawer. */
  onOpen: (improvementId: string) => void;
  onTagRemembered: (tag: string) => void;
}) {
  const emailOf = (userId: string | null) =>
    userId ? (members.find((m) => m.userId === userId)?.email ?? null) : null;

  return (
    // Five lanes stretch on a wide screen and scroll horizontally once each
    // would drop under ~11rem.
    <div className="grid grid-cols-[repeat(5,minmax(11rem,1fr))] gap-3 overflow-x-auto pb-2">
      {IMPROVEMENT_STATUSES.map((lane) => {
        const items = improvements.filter(
          (i) => lanes.statusOf(i) === lane.value,
        );
        const isTarget = lanes.dropLane === lane.value;
        return (
          <section
            key={lane.value}
            {...lanes.laneProps(lane.value)}
            className={`bg-muted/30 flex min-w-0 flex-col rounded-xl border transition-colors ${
              isTarget ? "border-primary bg-primary/5" : ""
            }`}
          >
            <header className="flex items-center gap-2 px-3 py-2.5">
              <span className="text-sm font-semibold">{lane.label}</span>
              <Badge variant="outline">{items.length}</Badge>
            </header>
            <div className="flex min-h-24 flex-1 flex-col gap-2.5 p-2">
              {items.length === 0 ? (
                <p className="text-muted-foreground px-1 py-6 text-center text-xs">
                  {canEdit ? "Drop an improvement here." : "Nothing here."}
                </p>
              ) : (
                items.map((i) => (
                  <ImprovementContextMenu
                    key={i.id}
                    item={i}
                    members={members}
                    tagOptions={tagOptions}
                    canEdit={canEdit}
                    onOpenDrawer={() => onOpen(i.id)}
                    onTagRemembered={onTagRemembered}
                  >
                    <ImprovementCard
                      item={i}
                      assigneeEmail={emailOf(i.assigneeId)}
                      lanes={lanes}
                      onOpen={() => onOpen(i.id)}
                    />
                  </ImprovementContextMenu>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
