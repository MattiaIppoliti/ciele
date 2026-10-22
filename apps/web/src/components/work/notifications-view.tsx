"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { AlarmClock, Archive, ArrowLeft, AtSign, Bell, CheckCheck, Circle, CircleDot, ExternalLink, MessageSquare, Trash2, UserPlus, type LucideIcon } from "lucide-react";
import { Button, Skeleton } from "@agent-hub/ui";
import type { MemberNotificationKind, Task } from "@agent-hub/core";
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from "@agent-hub/core";
import type { NotificationItem } from "@ciele/ops";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/ui/section-heading";
import { toast } from "@/lib/toast";
import { replaceFilterParams } from "@/lib/url-state";
import { cn } from "@/lib/utils";
import { agoText, dueLabel, formatWorkDay } from "@/lib/work/work-format";
import {
  NOTIFICATION_TABS,
  groupByAge,
  inTab,
  notificationKey,
  notificationText,
  type NotificationTab,
} from "@/lib/work/notification-groups";
import {
  archiveNotificationsAction,
  createTaskCommentAction,
  deleteNotificationsAction,
  getTaskAction,
  markNotificationsAction,
  snoozeNotificationsAction,
  updateTaskAction,
} from "@/app/work-actions";
import { SwipeActions, SwipeActionsRow, type SwipeAction } from "@/components/motion/swipe-actions";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { RollingNumber } from "@/components/motion/rolling-number";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import type { WorkResult } from "@/app/work-actions";
import type { LoadedTask } from "./task-detail";
import { CommentBody, CommentComposer } from "./task-comments";
import { AssigneePicker, DatePickerPopover, PriorityPicker, StatusPicker } from "./task-pickers";
import { PriorityIcon, ProjectGlyph, TaskStatusIcon } from "./work-icons";
import { useWorkDirectory } from "./work-directory";
import { PillButton, WorkAvatar } from "./work-ui";

/**
 * Notifications (#1048, #1067): a Member's own rows, read and acted on in one
 * place. The list on the left (tabs, an Unread switch, Mark all as read, rows
 * grouped by age); the selected row's Task on the right, with its pickers, its
 * latest comments and a reply box, so most notifications are answered without
 * leaving the page. Opening a row marks it read. Below the container's medium
 * width the preview opens over the list. The list is 420px wide, and an unread
 * row carries a dot in its left gutter.
 */

const KIND_ICON: Record<MemberNotificationKind, LucideIcon> = {
  assigned: UserPlus,
  mentioned: AtSign,
  commented: MessageSquare,
  status_changed: CircleDot,
};

export function NotificationsView({ items: initial, initialId }: { items: NotificationItem[]; initialId: string | null }) {
  const dir = useWorkDirectory();
  const [items, setItems] = useState(initial);
  const [tab, setTab] = useState<NotificationTab>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const [, startTransition] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  // The server's list wins whenever it changes (a reply, a mark from elsewhere).
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setItems(initial);
  }

  // A server action's refresh lands on the router's own URL, which never saw the
  // replaceState, so the open row is written back after every fresh list.
  useEffect(() => {
    if (selectedId) replaceFilterParams({ n: selectedId }, { n: "" });
  }, [initial, selectedId]);

  const visible = items.filter((item) => inTab(item, tab) && (!unreadOnly || !item.readAt));
  const groups = groupByAge(visible, dir.today);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const unread = (key: NotificationTab) => items.filter((item) => !item.readAt && inTab(item, key)).length;

  const setRead = (ids: string[], read: boolean) => {
    // A refusal undoes only these rows' read state: a whole-list snapshot would
    // also bring back anything archived, snoozed or deleted meanwhile.
    const previous = new Map(items.filter((item) => ids.includes(item.id)).map((item) => [item.id, item.readAt]));
    const at = new Date().toISOString();
    setItems((current) => current.map((item) => (ids.includes(item.id) ? { ...item, readAt: read ? (item.readAt ?? at) : null } : item)));
    startTransition(async () => {
      const result = await markNotificationsAction({ ids, read });
      if (!result.ok) {
        setItems((current) =>
          current.map((item) => (previous.has(item.id) ? { ...item, readAt: previous.get(item.id) ?? null } : item))
        );
        toast.error(result.error);
      }
    });
  };

  const open = (item: NotificationItem) => {
    setSelectedId(item.id);
    replaceFilterParams({ n: item.id }, { n: "" });
    if (!item.readAt) setRead([item.id], true);
  };

  const close = () => {
    setSelectedId(null);
    replaceFilterParams({ n: "" }, { n: "" });
  };

  // Archive, snooze and delete take the row out at once; the server confirms
  // behind it, and a refusal puts the row back.
  const takeOut = (item: NotificationItem) => {
    setItems((current) => current.filter((i) => i.id !== item.id));
    if (selectedId === item.id) close();
  };
  const putBack = (item: NotificationItem) =>
    setItems((current) =>
      current.some((i) => i.id === item.id)
        ? current
        : [...current, item].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    );
  const settle = (item: NotificationItem, run: () => Promise<WorkResult<number>>, done: () => void) =>
    startTransition(async () => {
      const result = await run();
      if (!result.ok) {
        putBack(item);
        toast.error(result.error ?? "Could not update the notification");
      } else if (result.value === 0) {
        // Nothing matched: it was already gone (deleted from another tab).
        toast.info("That notification is no longer there.");
      } else done();
    });

  const archive = (item: NotificationItem) => {
    takeOut(item);
    settle(item, () => archiveNotificationsAction([item.id], true), () =>
      toast.undo("Notification archived", async () => {
        putBack(item);
        return archiveNotificationsAction([item.id], false);
      })
    );
  };
  const snooze = (item: NotificationItem) => {
    const until = snoozeUntil(new Date());
    takeOut(item);
    settle(item, () => snoozeNotificationsAction([item.id], until.toISOString()), () =>
      toast.undo(`Snoozed until ${formatSnooze(until)}`, async () => {
        putBack(item);
        return snoozeNotificationsAction([item.id], null);
      })
    );
  };
  // Delete is permanent, so it asks first (DESIGN.md §4); Archive is the
  // reversible way out and the one a full swipe takes.
  const remove = (item: NotificationItem) =>
    confirmDelete({
      title: "Delete this notification?",
      description: "It is removed for good. Archive it instead to keep it.",
      onConfirm: async () => {
        takeOut(item);
        const result = await deleteNotificationsAction([item.id]);
        if (!result.ok) {
          putBack(item);
          throw new Error(result.error);
        }
        toast.success("Notification deleted");
      },
    });

  const markAll = () => {
    const ids = visible.filter((item) => !item.readAt).map((item) => item.id);
    if (!ids.length) return;
    setRead(ids, true);
    toast.success(`Marked ${ids.length} as read`);
  };

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 @3xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        {/* The list */}
        <section aria-label="Notifications" className={cn("border-alpha-medium flex min-h-0 flex-col @3xl:border-r", selected && "hidden @3xl:flex")}>
          <header className="flex shrink-0 items-center gap-2 px-6 pt-5 pb-2">
            <SectionHeading icon={Bell} title="Notifications" />
            <span className="flex-1" />
            <label className="text-muted-foreground flex items-center gap-2 text-xs">
              Unread
              <Switch checked={unreadOnly} onCheckedChange={setUnreadOnly} aria-label="Show unread only" />
            </label>
            <PillButton className="text-muted-foreground hover:text-foreground h-7 px-2 text-xs font-medium" onClick={markAll} disabled={!unread(tab)}>
              <CheckCheck className="size-3.5" /> Mark all as read
            </PillButton>
          </header>
          <nav aria-label="Notification types" className="border-alpha-medium shrink-0 border-b px-6 pb-2">
            <Tabs value={tab} onValueChange={(value) => setTab(value as NotificationTab)}>
              <TabsList aria-label="Notification types">
                {NOTIFICATION_TABS.map((t) => (
                  <TabsTrigger key={t.key} value={t.key}>
                    {t.label}
                    {unread(t.key) > 0 && (
                      <RollingNumber value={unread(t.key)} className="bg-alpha-medium rounded-full px-1.5 text-2xs tabular-nums" />
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto pb-6">
            {groups.length === 0 ? (
              <EmptyState
                className="mt-10"
                title={unreadOnly ? "You're all caught up" : "No notifications yet"}
                description="Assignments, mentions, comments on your tasks and status changes show up here."
              />
            ) : (
              groups.map((group) => (
                <section key={group.title} aria-label={group.title}>
                  <h2 className="text-muted-foreground px-6 pt-4 pb-1.5 text-xs font-semibold">{group.title}</h2>
                  <SwipeActions label={`${group.title} notifications`}>
                    {group.items.map((item) => (
                      <SwipeActionsRow
                        key={item.id}
                        label={notificationText(item)}
                        className="border-alpha-medium border-t first:border-t-0"
                        contentClassName={rowTint(!item.readAt, item.id === selectedId)}
                        leading={[
                          {
                            label: item.readAt ? "Unread" : "Read",
                            icon: item.readAt ? <Circle /> : <CheckCheck />,
                            tone: "accent",
                            keepRow: true,
                            onSelect: () => setRead([item.id], !item.readAt),
                          } satisfies SwipeAction,
                        ]}
                        // The outermost, and so the full swipe, is Archive: the one that undoes.
                        trailing={[
                          { label: "Snooze", icon: <AlarmClock />, tone: "neutral", onSelect: () => snooze(item) },
                          { label: "Delete", icon: <Trash2 />, tone: "danger", keepRow: true, onSelect: () => remove(item) },
                          { label: "Archive", icon: <Archive />, tone: "accent", onSelect: () => archive(item) },
                        ]}
                      >
                        <NotificationRow item={item} selected={item.id === selectedId} onOpen={() => open(item)} />
                      </SwipeActionsRow>
                    ))}
                  </SwipeActions>
                </section>
              ))
            )}
          </div>
        </section>
        {/* The preview */}
        <section aria-label="Preview" className={cn("min-h-0 overflow-y-auto", !selected && "hidden @3xl:block")}>
          {selected ? (
            <NotificationPreview key={selected.id} item={selected} onBack={close} />
          ) : (
            <div className="grid h-full place-items-center">
              <p className="text-muted-foreground text-sm">Select a notification to see its task.</p>
            </div>
          )}
        </section>
      </div>
      {confirmDeleteModal}
    </div>
  );
}

/**
 * A row's tint across its whole swipe surface, menu button included: unread,
 * open, or hovered, as a background image over the opaque ground.
 */
function rowTint(unread: boolean, selected: boolean): string {
  if (selected) return "bg-[image:linear-gradient(var(--alpha-light),var(--alpha-light))]";
  return cn(
    unread && "bg-[image:linear-gradient(color-mix(in_oklab,var(--tone-blue)_30%,transparent),color-mix(in_oklab,var(--tone-blue)_30%,transparent))]",
    !unread && "hover:bg-[image:linear-gradient(var(--alpha-lighter),var(--alpha-lighter))]"
  );
}

/** Tomorrow at 9:00 local time: the one snooze a swipe can offer without asking. */
function snoozeUntil(now: Date): Date {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return next;
}

function formatSnooze(until: Date): string {
  return `tomorrow, ${until.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/** A row's face; the swipe row around it owns the actions, so it carries the tints on its own surface. */
function NotificationRow({ item, selected, onOpen }: { item: NotificationItem; selected: boolean; onOpen: () => void }) {
  const dir = useWorkDirectory();
  const Icon = KIND_ICON[item.kind];
  const unread = !item.readAt;
  return (
    <div data-selected={selected || undefined} data-unread={unread || undefined} className="relative">
      {unread && (
        <>
          <span aria-hidden className="bg-primary absolute top-5.5 left-2.5 size-1.5 rounded-full" />
          <span className="sr-only">Unread.</span>
        </>
      )}
      <button type="button" onClick={onOpen} className="press flex w-full items-start gap-3 py-2.75 pr-2 pl-6 text-left">
        <WorkAvatar person={dir.person(item.actorMemberId)} size="md" className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className={cn("block text-sm", unread ? "font-semibold" : "font-medium")}>{notificationText(item)}</span>
          <span className="text-muted-foreground block truncate text-sm">{item.task.title}</span>
          {item.excerpt && <span className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">“{item.excerpt}”</span>}
          <span className="text-muted-foreground mt-1.25 flex items-center gap-1.5 text-xs">
            <Icon aria-hidden className="size-3" />
            <ProjectGlyph icon={item.project.icon} color={item.project.color} className="size-3" />
            <span className="truncate">{item.project.name}</span>
            <span aria-hidden>·</span>
            <time dateTime={item.createdAt}>{agoText(item.createdAt)}</time>
          </span>
        </span>
      </button>
    </div>
  );
}

/** The selected notification's Task: pickers, the latest comments and a reply. */
function NotificationPreview({ item, onBack }: { item: NotificationItem; onBack: () => void }) {
  const dir = useWorkDirectory();
  const [detail, setDetail] = useState<LoadedTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void getTaskAction(item.taskId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setDetail(result.value);
        setError(null);
      } else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [item.taskId, version]);

  const task: Pick<Task, "status" | "priority" | "assigneeMemberId" | "dueDate" | "title"> = detail?.task ?? item.task;
  const editable = dir.canEdit && !(detail?.project.archived ?? false);
  const save = (patch: Partial<Pick<Task, "status" | "priority" | "assigneeMemberId" | "dueDate">>) =>
    startTransition(async () => {
      const result = await updateTaskAction({ id: item.taskId, patch });
      if (!result.ok) return toast.error(result.error);
      setVersion((v) => v + 1);
    });
  const recent = useMemo(() => [...(detail?.comments ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-3), [detail]);
  const assignee = dir.person(task.assigneeMemberId);
  const due = task.dueDate ? dueLabel(task.dueDate, dir.today, task.status) : null;

  return (
    <article className="mx-auto flex w-full max-w-180 flex-col gap-5 px-7 py-6">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" className="-ml-2 h-7 @3xl:hidden" onClick={onBack}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <ProjectGlyph icon={item.project.icon} color={item.project.color} className="size-3.5" />
          {item.project.name}
          <span aria-hidden>·</span>
          <span className="font-mono">{notificationKey(item)}</span>
        </span>
        <span className="flex-1" />
        <Button size="sm" variant="secondary" className="h-7" nativeButton={false} render={<Link href={`/tasks/${item.taskId}`} />}>
          <ExternalLink className="size-3.5" /> Open task
        </Button>
      </div>
      <div>
        <p className="text-muted-foreground text-sm">{notificationText(item)}</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">{task.title}</h2>
      </div>
      {error ? (
        <p className="text-muted-foreground text-sm">{error}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1">
            <StatusPicker
              value={task.status}
              disabled={!editable}
              onChange={(status) => save({ status })}
              trigger={
                <PillButton className="border-alpha-medium border text-xs">
                  <TaskStatusIcon status={task.status} className="size-3.5" /> {TASK_STATUS_LABELS[task.status]}
                </PillButton>
              }
            />
            <AssigneePicker
              value={task.assigneeMemberId}
              disabled={!editable}
              projectMemberIds={detail?.project.visibility === "private" ? detail.memberIds : null}
              onChange={(assigneeMemberId) => save({ assigneeMemberId })}
              trigger={
                <PillButton className="border-alpha-medium border text-xs" muted={!assignee}>
                  <WorkAvatar person={assignee} size="xs" /> {assignee ? assignee.name : "Unassigned"}
                </PillButton>
              }
            />
            <PriorityPicker
              value={task.priority}
              disabled={!editable}
              onChange={(priority) => save({ priority })}
              trigger={
                <PillButton className="border-alpha-medium border text-xs" muted={task.priority === "none"}>
                  <PriorityIcon priority={task.priority} className="size-3.5" /> {TASK_PRIORITY_LABELS[task.priority]}
                </PillButton>
              }
            />
            <DatePickerPopover
              label="Due date"
              value={task.dueDate}
              disabled={!editable}
              onChange={(dueDate) => save({ dueDate })}
              trigger={
                <PillButton className={cn("border-alpha-medium border text-xs tabular-nums", due?.tone === "overdue" && "text-destructive")} muted={!due}>
                  {task.dueDate ? formatWorkDay(task.dueDate, dir.today) : "No due date"}
                </PillButton>
              }
            />
          </div>
          <section aria-label="Latest comments" className="flex flex-col gap-3">
            <h3 className="text-muted-foreground text-xs font-semibold">
              {detail ? (detail.comments.length ? `Comments (${detail.comments.length})` : "No comments yet") : "Comments"}
            </h3>
            {!detail ? (
              <div className="flex flex-col gap-2" role="status" aria-busy="true">
                <span className="sr-only">Loading comments…</span>
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : (
              <ol className="flex flex-col gap-3">
                {recent.map((comment) => {
                  const author = dir.person(comment.authorMemberId);
                  return (
                    <li key={comment.id} className="flex gap-2.5">
                      <WorkAvatar person={author} size="md" className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          <span className="font-medium">{author?.name ?? "Someone"}</span>{" "}
                          <time dateTime={comment.createdAt} className="text-muted-foreground text-xs">
                            {agoText(comment.createdAt)}
                          </time>
                        </p>
                        <CommentBody body={comment.body} />
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            {detail && (
              <CommentComposer
                project={detail.project}
                memberIds={detail.memberIds}
                submitLabel="Reply"
                onSubmit={async (body) => {
                  const result = await createTaskCommentAction(item.taskId, body);
                  if (!result.ok) {
                    toast.error(result.error);
                    return false;
                  }
                  setVersion((v) => v + 1);
                  return true;
                }}
              />
            )}
          </section>
        </>
      )}
    </article>
  );
}
