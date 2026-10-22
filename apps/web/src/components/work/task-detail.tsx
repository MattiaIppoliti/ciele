"use client";

import Link from "next/link";
import { useRef, useState, useTransition, type ReactNode } from "react";
import {
  Archive,
  ArrowUpRight,
  CalendarClock,
  CircleCheck,
  Copy,
  Ellipsis,
  ListTree,
  Maximize2,
  Plus,
  Repeat,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Button, Hint, Input } from "@agent-hub/ui";
import type { ProjectFile, Task, WorkActivity } from "@agent-hub/core";
import {
  TASK_PRIORITY_LABELS,
  TASK_RECURRENCE_LABELS,
  TASK_STATUS_LABELS,
  formatEstimate,
  isOverdue,
  taskProgress,
} from "@agent-hub/core";
import type { CommentView, TaskDetail } from "@ciele/ops";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { MARKDOWN_TOOLBAR_COMPACT, MarkdownEditor } from "@/components/ui/markdown-editor";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { ChatMarkdown } from "@/components/chat/chat-markdown";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { RollInText } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { SpringDependency, useElementWidth } from "@/components/motion/layout-spring";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { agoText, dueLabel, formatWorkDay, overdueText } from "@/lib/work/work-format";
import {
  archiveTaskAction,
  createTaskAction,
  deleteTaskAction,
  setFavoriteAction,
  undoCompleteTaskAction,
  updateTaskAction,
} from "@/app/work-actions";
import { ColorDot, PriorityIcon, ProjectGlyph, TaskStatusIcon } from "./work-icons";
import {
  AssigneePicker,
  BlockedByPicker,
  DatePickerPopover,
  EstimatePicker,
  ImprovementPicker,
  LabelsPicker,
  PriorityPicker,
  ProjectPicker,
  PropertyField,
  RecurrencePicker,
  StatusPicker,
} from "./task-pickers";
import { useWorkDirectory } from "./work-directory";
import { PillButton, WorkAvatar } from "./work-ui";
import { WorkActivityList } from "./work-activity-list";
import { TaskComments } from "./task-comments";
import { TaskAttachments } from "./project-files";

/**
 * One Task, as the drawer and its full page show it (#1054): header, the
 * completed or overdue banner, the title, the properties grid, the
 * description, subtasks, and its activity. Every edit goes through
 * `tasks.update` and then reloads the detail, so what the drawer shows is what
 * the server holds.
 */

export type LoadedTask = TaskDetail & { activity: WorkActivity[]; comments: CommentView[]; files: ProjectFile[] };

type UpdateInput = Parameters<typeof updateTaskAction>[0];
type Save = (input: Omit<UpdateInput, "id">, success?: string) => void;

export interface PanelControls {
  onOpenFullPage: () => void;
  onClose: () => void;
}

export function TaskDetailView({
  detail,
  variant,
  projectTasks,
  onChanged,
  onOpenTask,
  onClosed,
  panelControls,
}: {
  detail: LoadedTask;
  variant: "drawer" | "page";
  /** The Project's other Tasks, for Blocked by. */
  projectTasks: Task[];
  /** Reload after a write. */
  onChanged: () => void;
  onOpenTask: (id: string) => void;
  /** After a delete or archive, the drawer closes. */
  onClosed: () => void;
  /** In the drawer: full page and close, on the actions row rather than a header of their own. */
  panelControls?: PanelControls;
}) {
  const dir = useWorkDirectory();
  const { task, project, subtasks } = detail;
  const [pending, startTransition] = useTransition();
  const editable = dir.canEdit && !project.archived;
  const [timeline, setTimeline] = useState<"comments" | "activity">("comments");

  const save: Save = (input, success) =>
    startTransition(async () => {
      const result = await updateTaskAction({ id: task.id, ...input });
      if (!result.ok) return toast.error(result.error);
      if (success) toast.success(success);
      onChanged();
    });

  const progress = taskProgress(task, subtasks);
  const doneSubtasks = subtasks.filter((s) => s.status === "done").length;
  const done = task.status === "done";
  const overdue = isOverdue(task, dir.today);

  return (
    <article aria-busy={pending} className={cn("flex flex-col gap-5", variant === "drawer" ? "px-5 pt-3 pb-6" : "")}>
      <TaskHeader
        detail={detail}
        panelControls={panelControls}
        editable={editable}
        save={save}
        startTransition={startTransition}
        onChanged={onChanged}
        onOpenTask={onOpenTask}
        onClosed={onClosed}
      />

      {/* Banner */}
      {done && task.completedAt ? (
        <Banner tone="green">
          <RollInText text={`Completed ${agoText(task.completedAt)}`} />
          {editable && (
            <button type="button" className="press-text ml-auto font-medium underline-offset-2 hover:underline" onClick={() => save({ patch: { status: "to_do" } })}>
              Reopen task
            </button>
          )}
        </Banner>
      ) : overdue && task.dueDate ? (
        <Banner tone="red">
          <RollInText text={overdueText(task.dueDate, dir.today)} />
          {editable && (
            <DatePickerPopover
              label="Reschedule"
              value={task.dueDate}
              onChange={(dueDate) => save({ patch: { dueDate } }, "Rescheduled")}
              trigger={
                <button type="button" className="press-text ml-auto inline-flex items-center gap-1 font-medium">
                  <CalendarClock className="size-3.5" /> Reschedule
                </button>
              }
            />
          )}
        </Banner>
      ) : null}

      {/* Title */}
      <TitleField key={`${task.id}:${task.title}`} value={task.title} editable={editable} onCommit={(title) => save({ patch: { title } })} />

      <TaskProperties detail={detail} variant={variant} editable={editable} projectTasks={projectTasks} save={save} />

      {detail.blocking.length > 0 && (
        <p className="text-muted-foreground text-sm">
          Blocking {detail.blocking.map((t) => (
            <button key={t.id} type="button" className="press-text text-foreground mr-1 font-medium" onClick={() => onOpenTask(t.id)}>
              {dir.keyOf(t)}
            </button>
          ))}
        </p>
      )}

      {/* Description */}
      <DescriptionField key={`${task.id}:d`} value={task.description} editable={editable} onCommit={(description) => save({ patch: { description } })} />

      {/* Subtasks */}
      {!task.parentId && (
        <section aria-label="Subtasks" className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">Subtasks</h3>
            {subtasks.length > 0 && (
              <span className="text-muted-foreground text-xs tabular-nums">
                <RollInText text={`${doneSubtasks}/${subtasks.length}`} />
              </span>
            )}
            {subtasks.length > 0 && (
              <span className="bg-alpha-medium ml-2 h-1 flex-1 overflow-hidden rounded-full" aria-hidden>
                <span className="bg-tone-green-ink block h-full rounded-full transition-[width]" style={{ width: `${progress}%` }} />
              </span>
            )}
          </div>
          <div className="divide-alpha-medium border-alpha-medium divide-y overflow-hidden rounded-xl border empty:hidden">
            {subtasks.map((sub) => (
              <SubtaskRow key={sub.id} task={sub} editable={editable} onOpen={() => onOpenTask(sub.id)} onChanged={onChanged} />
            ))}
          </div>
          {editable && <AddSubtask parent={task} onAdded={onChanged} />}
        </section>
      )}

      <TaskAttachments projectId={project.id} taskId={task.id} files={detail.files} editable={editable} onChanged={onChanged} />

      {/* Comments and Activity (#1066) */}
      <section aria-label="Discussion" className="flex flex-col gap-3">
        <Tabs value={timeline} onValueChange={(value) => setTimeline(value as "comments" | "activity")}>
          <TabsList aria-label="Task timeline">
            <TabsTrigger value="comments">
              Comments (<RollingNumber value={detail.comments.length} />)
            </TabsTrigger>
            <TabsTrigger value="activity">
              Activity (<RollingNumber value={detail.activity.length} />)
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {timeline === "comments" ? (
          <TaskComments
            taskId={task.id}
            project={project}
            memberIds={detail.memberIds}
            comments={detail.comments}
            onChanged={onChanged}
          />
        ) : (
          <WorkActivityList entries={detail.activity} />
        )}
      </section>
    </article>
  );
}

/** The detail's top line: where the Task lives, its key and parent, and its actions. */
function TaskHeader({
  detail,
  panelControls,
  editable,
  save,
  startTransition,
  onChanged,
  onOpenTask,
  onClosed,
}: {
  detail: LoadedTask;
  panelControls?: PanelControls;
  editable: boolean;
  save: Save;
  startTransition: (action: () => Promise<void>) => void;
  onChanged: () => void;
  onOpenTask: (id: string) => void;
  onClosed: () => void;
}) {
  const dir = useWorkDirectory();
  const { task, project, subtasks, parent } = detail;
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const favorite = dir.isFavorite({ taskId: task.id });
  const key = dir.keyOf(task);
  const done = task.status === "done";

  const complete = () => {
    const previous = task.status;
    if (previous === "done") return save({ patch: { status: "to_do" } }, "Task reopened");
    startTransition(async () => {
      const result = await updateTaskAction({ id: task.id, patch: { status: "done" } });
      if (!result.ok) return void toast.error(result.error);
      onChanged();
      // The real inverse (#1074): the status it had, and for a recurring Task
      // the scheduled copy removed and the recurrence restored.
      toast.undo("Task completed", async () => {
        const reverted = await undoCompleteTaskAction(task.id, previous);
        onChanged();
        return reverted;
      });
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`/projects/${project.id}/list`}
        className="press-control border-alpha-medium hover:bg-alpha-light inline-flex max-w-56 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium"
      >
        <ProjectGlyph icon={project.icon} color={project.color} className="size-3.5" />
        <span className="truncate">
          <RollInText text={project.name} />
        </span>
      </Link>
      <span className="text-muted-foreground font-mono text-xs">
        <RollInText text={key} />
      </span>
      {parent && (
        <button type="button" className="press-text text-muted-foreground truncate text-xs" onClick={() => onOpenTask(parent.id)}>
          ← {dir.keyOf(parent)} {parent.title}
        </button>
      )}
      <div className="ml-auto flex items-center gap-1">
        {editable && (
          <Button size="sm" variant={done ? "secondary" : "primary"} onClick={complete}>
            <CircleCheck className="size-4" /> {done ? "Completed" : "Mark complete"}
          </Button>
        )}
        <Hint label={favorite ? "Remove from favorites" : "Add to favorites"}>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={favorite}
            onClick={() => startTransition(async () => {
              await setFavoriteAction({ taskId: task.id }, !favorite);
            })}
          >
            <Star className={cn("size-4", favorite && "fill-current")} />
          </Button>
        </Hint>
        <Hint label="Copy link">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Copy link"
            onClick={() => {
              void navigator.clipboard.writeText(`${window.location.origin}/tasks/${task.id}`);
              toast.success("Link copied");
            }}
          >
            <Copy className="size-4" />
          </Button>
        </Hint>
        {editable && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label="More task actions" />}>
              <Ellipsis className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {parent && (
                <DropdownMenuItem onClick={() => save({ patch: { parentId: null } }, "Now a task of its own")}>
                  <ListTree className="size-4" /> Convert to task
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() =>
                  startTransition(async () => {
                    const result = await archiveTaskAction(task.id, true);
                    if (!result.ok) return void toast.error(result.error);
                    toast.undo("Task archived", () => archiveTaskAction(task.id, false));
                    onClosed();
                  })
                }
              >
                <Archive className="size-4" /> Archive
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() =>
                  confirmDelete({
                    title: `Delete ${key}?`,
                    description: subtasks.length
                      ? `Its ${subtasks.length} subtask${subtasks.length === 1 ? "" : "s"} and every comment go with it.`
                      : "Its comments go with it. Archive instead to keep it restorable.",
                    onConfirm: async () => {
                      const result = await deleteTaskAction(task.id);
                      if (!result.ok) throw new Error(result.error);
                      onClosed();
                    },
                  })
                }
              >
                <Trash2 className="size-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {panelControls && <PanelControlButtons {...panelControls} />}
      </div>
      {confirmDeleteModal}
    </div>
  );
}

/** The drawer's full page and close, so the panel needs no header row above the actions. */
export function PanelControlButtons({ onOpenFullPage, onClose }: PanelControls) {
  return (
    <>
      <Hint label="Open full page">
        <Button size="icon-sm" variant="ghost" aria-label="Open full page" onClick={onOpenFullPage}>
          <Maximize2 className="size-4" />
        </Button>
      </Hint>
      <Hint label="Close">
        <Button size="icon-sm" variant="ghost" aria-label="Close task panel" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </Hint>
    </>
  );
}

/** The properties grid: a label beside each picker, which opens from a `PillButton`. */
function TaskProperties({
  detail,
  variant,
  editable,
  projectTasks,
  save,
}: {
  detail: LoadedTask;
  variant: "drawer" | "page";
  editable: boolean;
  projectTasks: Task[];
  save: Save;
}) {
  const dir = useWorkDirectory();
  const { task, project } = detail;
  const assignee = dir.person(task.assigneeMemberId);
  const overdue = isOverdue(task, dir.today);
  // The pill's padding hangs past the grid's right edge, so its text sits flush with it.
  const pill = "-mr-1.5";
  // The columns change through container queries alone, so the width is what
  // tells each field to spring to its new cell.
  const gridRef = useRef<HTMLDivElement>(null);
  const gridWidth = useElementWidth(gridRef);

  return (
    <SpringDependency.Provider value={gridWidth}>
    <div ref={gridRef} className={cn("grid gap-x-6 gap-y-0.5", variant === "page" ? "@3xl:grid-cols-4 @lg:grid-cols-2" : "@md:grid-cols-2")}>
      <PropertyField label="Status">
        <StatusPicker
          value={task.status}
          disabled={!editable}
          align="end"
          onChange={(status) => save({ patch: { status } })}
          trigger={
            <PillButton className={pill}>
              <TaskStatusIcon status={task.status} className="size-3.5" />
              <RollInText text={TASK_STATUS_LABELS[task.status]} />
            </PillButton>
          }
        />
      </PropertyField>
      <PropertyField label="Priority">
        <PriorityPicker
          value={task.priority}
          disabled={!editable}
          align="end"
          onChange={(priority) => save({ patch: { priority } })}
          trigger={
            <PillButton className={pill} muted={task.priority === "none"}>
              <PriorityIcon priority={task.priority} className="size-3.5" />
              <RollInText text={TASK_PRIORITY_LABELS[task.priority]} />
            </PillButton>
          }
        />
      </PropertyField>
      <PropertyField label="Assignee">
        <AssigneePicker
          value={task.assigneeMemberId}
          disabled={!editable}
          align="end"
          onChange={(assigneeMemberId) => save({ patch: { assigneeMemberId } })}
          trigger={
            <PillButton className={pill} muted={!assignee}>
              <WorkAvatar person={assignee} size="sm" />
              <span className="truncate">
                <RollInText text={assignee ? assignee.name : "Unassigned"} />
              </span>
            </PillButton>
          }
        />
      </PropertyField>
      <PropertyField label="Due date">
        <DatePickerPopover
          label="Due date"
          value={task.dueDate}
          disabled={!editable}
          align="end"
          onChange={(dueDate) => save({ patch: { dueDate } })}
          trigger={
            <PillButton className={cn(pill, overdue && "text-destructive")} muted={!task.dueDate}>
              <RollInText text={task.dueDate ? dueLabel(task.dueDate, dir.today, task.status).text : "No date"} />
            </PillButton>
          }
        />
      </PropertyField>
      <PropertyField label="Start date">
        <DatePickerPopover
          label="Start date"
          value={task.startDate}
          disabled={!editable}
          align="end"
          onChange={(startDate) => save({ patch: { startDate } })}
          trigger={
            <PillButton className={pill} muted={!task.startDate}>
              <RollInText text={task.startDate ? formatWorkDay(task.startDate, dir.today) : "No date"} />
            </PillButton>
          }
        />
      </PropertyField>
      <PropertyField label="Project">
        <ProjectPicker
          value={project.id}
          disabled={!editable}
          align="end"
          onChange={(projectId) => projectId !== project.id && save({ projectId }, "Moved")}
          trigger={
            <PillButton className={pill}>
              <ProjectGlyph icon={project.icon} color={project.color} className="size-3.5" />
              <span className="truncate">
                <RollInText text={project.name} />
              </span>
            </PillButton>
          }
        />
      </PropertyField>
      <PropertyField label="Labels">
        <LabelsPicker
          value={detail.labelIds}
          disabled={!editable}
          align="end"
          onChange={(labelIds) => save({ labelIds })}
          trigger={
            <PillButton className={pill} muted={!detail.labelIds.length}>
              {detail.labelIds.length
                ? detail.labelIds.slice(0, 3).map((id) => {
                    const label = dir.label(id);
                    return label ? (
                      <span key={id} className="inline-flex items-center gap-1">
                        <ColorDot color={label.color} />
                        {label.name}
                      </span>
                    ) : null;
                  })
                : "No labels"}
            </PillButton>
          }
        />
      </PropertyField>
      <PropertyField label="Repeat">
        <RecurrencePicker
          value={task.recurrence}
          disabled={!editable}
          align="end"
          onChange={(recurrence) => save({ patch: { recurrence } })}
          trigger={
            <PillButton className={pill} muted={!task.recurrence}>
              {task.recurrence && <Repeat className="size-3.5" />}
              <RollInText text={task.recurrence ? TASK_RECURRENCE_LABELS[task.recurrence] : "Does not repeat"} />
            </PillButton>
          }
        />
      </PropertyField>
      <PropertyField label="Estimate">
        <EstimatePicker
          value={task.estimateMinutes}
          disabled={!editable}
          align="end"
          onChange={(estimateMinutes) => save({ patch: { estimateMinutes } })}
          trigger={
            <PillButton className={pill} muted={!task.estimateMinutes}>
              <RollInText text={task.estimateMinutes ? formatEstimate(task.estimateMinutes) : "None"} />
            </PillButton>
          }
        />
      </PropertyField>
      <PropertyField label="Blocked by">
        <BlockedByPicker
          value={detail.blockedBy.map((t) => t.id)}
          candidates={projectTasks.filter((t) => t.id !== task.id && !t.parentId)}
          disabled={!editable || Boolean(task.parentId)}
          align="end"
          onChange={(blockedBy) => save({ blockedBy })}
          trigger={
            <PillButton className={pill} muted={!detail.blockedBy.length}>
              <span className="truncate">
                {detail.blockedBy.length ? detail.blockedBy.map((t) => dir.keyOf(t)).join(", ") : "Nothing"}
              </span>
            </PillButton>
          }
        />
      </PropertyField>
      {/* Linking is a Task write (ADR-0027 rule 2), so whoever may edit the
          Task picks the Improvement here; a reader only sees the link. */}
      {editable ? (
        <PropertyField label="Resolves">
          <div className="flex min-w-0 items-center gap-0.5">
            <ImprovementPicker
              value={detail.improvement}
              align="end"
              onChange={(improvementId) =>
                save({ patch: { improvementId } }, improvementId ? "Linked to the improvement" : "Unlinked")
              }
              trigger={
                <PillButton className={cn(!detail.improvement && pill)} muted={!detail.improvement}>
                  {detail.improvement ? (
                    <>
                      <span className="shrink-0 font-mono text-xs">
                        <RollInText text={`IMP-${detail.improvement.seq}`} />
                      </span>
                      <span className="truncate">
                        <RollInText text={detail.improvement.title} />
                      </span>
                    </>
                  ) : (
                    "None"
                  )}
                </PillButton>
              }
            />
            {detail.improvement && (
              <Hint label={`Open IMP-${detail.improvement.seq}`}>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className={pill}
                  aria-label={`Open IMP-${detail.improvement.seq}`}
                  nativeButton={false}
                  render={<Link href={`/improvements/${detail.improvement.id}`} />}
                >
                  <ArrowUpRight className="size-4" />
                </Button>
              </Hint>
            )}
          </div>
        </PropertyField>
      ) : (
        detail.improvement && (
          <PropertyField label="Resolves">
            <Link
              href={`/improvements/${detail.improvement.id}`}
              className="press-text text-brand-ink inline-flex min-w-0 items-center gap-1.5 text-sm underline-offset-2 hover:underline"
            >
              <span className="shrink-0 font-mono text-xs">IMP-{detail.improvement.seq}</span>
              <span className="truncate">
                <RollInText text={detail.improvement.title} />
              </span>
            </Link>
          </PropertyField>
        )
      )}
    </div>
    </SpringDependency.Provider>
  );
}

function Banner({ tone, children }: { tone: "green" | "red"; children: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
        tone === "green" ? "bg-tone-green text-tone-green-ink" : "bg-tone-red text-tone-red-ink"
      )}
    >
      {children}
    </div>
  );
}

function TitleField({ value, editable, onCommit }: { value: string; editable: boolean; onCommit: (title: string) => void }) {
  const [draft, setDraft] = useState(value);
  // The primitive sizes itself to its content (`field-sizing: content`), so
  // the title grows with its lines without measuring a panel mid-animation.
  return (
    <Textarea
      value={draft}
      rows={1}
      readOnly={!editable}
      aria-label="Task name"
      onChange={(event) => setDraft(event.target.value.replace(/\n/g, ""))}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      onBlur={() => {
        const next = draft.trim();
        if (!next) return setDraft(value);
        if (next !== value) onCommit(next);
      }}
      className="hover:bg-alpha-lighter focus-visible:bg-alpha-lighter -mx-2 min-h-0 resize-none rounded-md border-0 bg-transparent px-2 text-2xl font-semibold shadow-none focus-visible:ring-0 md:text-2xl"
    />
  );
}

function DescriptionField({ value, editable, onCommit }: { value: string; editable: boolean; onCommit: (description: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (editing) {
    const finish = () => {
      setEditing(false);
      if (draft !== value) onCommit(draft);
    };
    return (
      <MarkdownEditor
        autoFocus
        value={draft}
        onChange={setDraft}
        toolbar={MARKDOWN_TOOLBAR_COMPACT}
        rows={6}
        aria-label="Description"
        placeholder="Add a description. Markdown works."
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setDraft(value);
            setEditing(false);
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) finish();
        }}
        onBlur={finish}
      />
    );
  }
  return (
    <div
      role={editable ? "button" : undefined}
      tabIndex={editable ? 0 : undefined}
      onClick={() => editable && setEditing(true)}
      onKeyDown={(event) => {
        if (editable && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          setEditing(true);
        }
      }}
      className={cn("-mx-2 rounded-md px-2 py-1 text-sm", editable && "hover:bg-alpha-lighter cursor-text")}
    >
      {value ? <ChatMarkdown text={value} /> : <span className="text-muted-foreground">{editable ? "Add a description…" : "No description."}</span>}
    </div>
  );
}

function SubtaskRow({ task, editable, onOpen, onChanged }: { task: Task; editable: boolean; onOpen: () => void; onChanged: () => void }) {
  const dir = useWorkDirectory();
  const [, startTransition] = useTransition();
  const assignee = dir.person(task.assigneeMemberId);
  const done = task.status === "done";
  return (
    <div className="hover:bg-alpha-lighter flex min-h-9 items-center gap-2 px-2.5">
      <button
        type="button"
        className="press-control rounded-full"
        disabled={!editable}
        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        onClick={() =>
          startTransition(async () => {
            const previous = task.status;
            const result = await updateTaskAction({ id: task.id, patch: { status: previous === "done" ? "to_do" : "done" } });
            if (!result.ok) toast.error(result.error);
            onChanged();
            if (result.ok && previous !== "done") {
              toast.undo("Subtask completed", async () => {
                const reverted = await undoCompleteTaskAction(task.id, previous);
                onChanged();
                return reverted;
              });
            }
          })
        }
      >
        <TaskStatusIcon status={task.status} />
      </button>
      <button type="button" onClick={onOpen} className={cn("press-text min-w-0 flex-1 truncate text-left text-sm", done && "text-muted-foreground line-through")}>
        <RollInText text={task.title} />
      </button>
      {task.dueDate && <span className="text-muted-foreground text-xs">{dueLabel(task.dueDate, dir.today, task.status).text}</span>}
      {assignee && <WorkAvatar person={assignee} size="sm" />}
    </div>
  );
}

function AddSubtask({ parent, onAdded }: { parent: Task; onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const value = title.trim();
        if (!value) return;
        startTransition(async () => {
          const result = await createTaskAction({ projectId: parent.projectId, parentId: parent.id, title: value });
          if (!result.ok) return toast.error(result.error);
          setTitle("");
          onAdded();
        });
      }}
    >
      <Plus aria-hidden className="text-muted-foreground size-4" />
      <Input
        value={title}
        disabled={pending}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Add subtask"
        aria-label="New subtask"
        className="h-8"
      />
    </form>
  );
}
