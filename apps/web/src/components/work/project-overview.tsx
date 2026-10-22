"use client";

import { useState, useTransition } from "react";
import { CalendarDays, Diamond, Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@agent-hub/ui";
import type { ProjectMilestone, Task, TaskStatus } from "@agent-hub/core";
import { TASK_STATUSES, TASK_STATUS_LABELS, daysBetween, isOverdue } from "@agent-hub/core";
import type { ProjectWorkspace } from "@ciele/ops";
import { ChatMarkdown } from "@/components/chat/chat-markdown";
import { DatePicker } from "@/components/ui/date-picker";
import { UserAvatar } from "@/components/ui/user-avatar";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { DOT_CLASS, PROJECT_STATUS_LABELS, TASK_STATUS_TONE, dueLabel, formatWorkDay } from "@/lib/work/work-format";
import { setMilestonesAction } from "@/app/work-actions";
import { TaskStatusIcon } from "./work-icons";
import { useWorkDirectory } from "./work-directory";
import { WorkActivityList } from "./work-activity-list";

/**
 * A Project's Overview (#1046): about, progress, details, editable milestones,
 * what is coming up and the recent activity. Every number is derived from the
 * Tasks the page already holds.
 */
export function ProjectOverview({
  workspace,
  onOpenTask,
  onEdit,
}: {
  workspace: ProjectWorkspace;
  onOpenTask: (id: string) => void;
  onEdit: () => void;
}) {
  const dir = useWorkDirectory();
  const { project, tasks, progress } = workspace;
  const top = tasks.filter((t) => !t.parentId);
  const overdue = top.filter((t) => isOverdue(t, dir.today)).length;
  const daysLeft = project.dueDate ? daysBetween(dir.today, project.dueDate) : null;
  const counts = TASK_STATUSES.map((status) => ({ status, count: top.filter((t) => t.status === status).length }));
  const comingUp = top
    .filter((t) => t.status !== "done" && t.dueDate && t.dueDate >= dir.today)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))
    .slice(0, 6);
  const lead = dir.person(project.leadId);

  return (
    <div className="grid gap-4 px-4 py-4 @md:px-6 @4xl:grid-cols-[2fr_1fr]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card size="sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>About</CardTitle>
            {dir.canEdit && (
              <Button size="icon-sm" variant="ghost" aria-label="Edit project" onClick={onEdit}>
                <Pencil className="size-4" />
              </Button>
            )}
          </CardHeader>
          <CardContent className="text-sm">
            {project.description ? <ChatMarkdown text={project.description} /> : <p className="text-muted-foreground">No description yet.</p>}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Progress</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-3xl font-semibold">{progress.percent}%</span>
              <span className="text-muted-foreground text-sm">
                {progress.done} of {progress.total} tasks done
              </span>
              {daysLeft !== null && (
                <span className={cn("text-sm", daysLeft < 0 ? "text-destructive" : "text-muted-foreground")}>
                  {daysLeft < 0 ? `${-daysLeft} days past target` : `${daysLeft} days left`}
                </span>
              )}
              {overdue > 0 && <span className="text-destructive text-sm">{overdue} overdue</span>}
            </div>
            <div className="bg-alpha-medium flex h-2 overflow-hidden rounded-full" aria-hidden>
              {counts.map(({ status, count }) =>
                count ? (
                  <span key={status} className={cn(DOT_CLASS[TASK_STATUS_TONE[status]], status === "to_do" && "opacity-50")} style={{ width: `${(count / Math.max(1, top.length)) * 100}%` }} />
                ) : null
              )}
            </div>
            <ul className="grid grid-cols-2 gap-2 @lg:grid-cols-5">
              {counts.map(({ status, count }) => (
                <li key={status}>
                  <a href={`/projects/${project.id}/list?f=status:is:${status}`} className="press hover:bg-alpha-light flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                    <TaskStatusIcon status={status as TaskStatus} />
                    <span className="truncate">{TASK_STATUS_LABELS[status]}</span>
                    <span className="text-muted-foreground ml-auto">{count}</span>
                  </a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Coming up</CardTitle>
          </CardHeader>
          <CardContent>
            {comingUp.length ? (
              <ul className="flex flex-col">
                {comingUp.map((task) => (
                  <ComingUpRow key={task.id} task={task} onOpen={() => onOpenTask(task.id)} />
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">Nothing due ahead.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Status</dt>
              <dd>{PROJECT_STATUS_LABELS[project.status]}</dd>
              <dt className="text-muted-foreground">Lead</dt>
              <dd className="flex items-center gap-1.5">
                {lead ? (
                  <>
                    <UserAvatar userId={lead.userId} email={lead.email} avatarUrl={lead.avatarUrl} size="size-5" />
                    {lead.name}
                  </>
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </dd>
              <dt className="text-muted-foreground">Start</dt>
              <dd>{project.startDate ? formatWorkDay(project.startDate, dir.today) : "—"}</dd>
              <dt className="text-muted-foreground">Target</dt>
              <dd>{project.dueDate ? formatWorkDay(project.dueDate, dir.today) : "—"}</dd>
              <dt className="text-muted-foreground">Access</dt>
              <dd>{project.visibility === "private" ? `Private, ${workspace.memberIds.length} people` : "Everyone"}</dd>
            </dl>
          </CardContent>
        </Card>

        <Milestones projectId={project.id} milestones={workspace.milestones} />

        <Card size="sm">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            <WorkActivityList entries={workspace.activity.slice(0, 8)} withTask onOpenTask={onOpenTask} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ComingUpRow({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const dir = useWorkDirectory();
  const assignee = dir.person(task.assigneeMemberId);
  return (
    <li>
      <button type="button" onClick={onOpen} className="press hover:bg-alpha-light flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm">
        <TaskStatusIcon status={task.status} />
        <span className="min-w-0 flex-1 truncate">{task.title}</span>
        {assignee && <UserAvatar userId={assignee.userId} email={assignee.email} avatarUrl={assignee.avatarUrl} size="size-5" />}
        <span className="text-muted-foreground w-16 text-right text-xs">{dueLabel(task.dueDate!, dir.today).text}</span>
      </button>
    </li>
  );
}

function Milestones({ projectId, milestones }: { projectId: string; milestones: ProjectMilestone[] }) {
  const dir = useWorkDirectory();
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState(milestones.map((m) => ({ id: m.id as string | undefined, name: m.name, date: m.date })));
  const [pending, startTransition] = useTransition();
  const save = () =>
    startTransition(async () => {
      const valid = rows.filter((r) => r.name.trim() && r.date);
      const result = await setMilestonesAction(projectId, valid);
      if (!result.ok) return toast.error(result.error);
      setRows(result.value.map((m) => ({ id: m.id, name: m.name, date: m.date })));
      setEditing(false);
    });
  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Milestones</CardTitle>
        {dir.canEdit && !editing && (
          <Button size="icon-sm" variant="ghost" aria-label="Edit milestones" onClick={() => setEditing(true)}>
            <Pencil className="size-4" />
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="flex flex-col gap-2">
            {rows.map((row, index) => (
              <div key={row.id ?? `new-${index}`} className="flex items-center gap-1.5">
                <Input
                  value={row.name}
                  aria-label="Milestone name"
                  placeholder="Milestone"
                  className="h-8"
                  onChange={(e) => setRows(rows.map((r, i) => (i === index ? { ...r, name: e.target.value } : r)))}
                />
                <DatePicker label="Milestone date" compact value={row.date || null} onChange={(date) => setRows(rows.map((r, i) => (i === index ? { ...r, date } : r)))} />
                <Button size="icon-sm" variant="ghost" aria-label="Remove milestone" onClick={() => setRows(rows.filter((_, i) => i !== index))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setRows([...rows, { id: undefined, name: "", date: dir.today }])}>
                <Plus className="size-4" /> Add milestone
              </Button>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing(false)} disabled={pending}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} loading={pending}>
                Save
              </Button>
            </div>
          </div>
        ) : milestones.length ? (
          <ul className="flex flex-col gap-1.5">
            {milestones.map((m) => {
              const past = m.date < dir.today;
              return (
                <li key={m.id} className={cn("flex items-center gap-2 text-sm", past && "text-muted-foreground")}>
                  <Diamond aria-hidden className={cn("size-3.5", past ? "text-tone-green-ink" : "text-foreground")} />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                    <CalendarDays className="size-3" /> {formatWorkDay(m.date, dir.today)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No milestones.</p>
        )}
      </CardContent>
    </Card>
  );
}
