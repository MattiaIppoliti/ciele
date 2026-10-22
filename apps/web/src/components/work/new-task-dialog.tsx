"use client";

import { useState, useTransition } from "react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogSection,
  DialogTitle,
  Input,
} from "@agent-hub/ui";
import { Link2 } from "lucide-react";
import type { Task, TaskPriority, TaskStatus } from "@agent-hub/core";
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from "@agent-hub/core";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";
import { dueLabel } from "@/lib/work/work-format";
import { createTaskAction } from "@/app/work-actions";
import { PriorityIcon, ProjectGlyph, TaskStatusIcon } from "./work-icons";
import { AssigneePicker, DatePickerPopover, PriorityPicker, ProjectPicker, StatusPicker } from "./task-pickers";
import { useWorkDirectory } from "./work-directory";
import { PillButton, WorkAvatar } from "./work-ui";

/**
 * New task (#1053): the page's committing action and `N`. A title is all it
 * needs; the pills set the rest, prefilled from where it was opened. "Create
 * more" keeps it open for the next one, for entering a batch.
 */
export function NewTaskDialog({
  open,
  onClose,
  projectId,
  defaults = {},
  resolves,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** The Project it goes in; the viewer picks one when absent. */
  projectId?: string;
  defaults?: {
    title?: string;
    /** The picker's first choice, kept only when it is a Project the viewer can see and not archived. */
    projectId?: string | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    assigneeMemberId?: string | null;
    dueDate?: string | null;
  };
  /** The Improvement every Task created here resolves (ADR-0027 rule 2). */
  resolves?: { id: string; seq: number };
  onCreated?: (task: Task) => void;
}) {
  const dir = useWorkDirectory();
  const [pending, startTransition] = useTransition();
  const firstOpen = dir.projects.find((p) => p.status !== "completed" && !p.archived);
  // `dir.projects` holds only readable, unarchived Projects, so a default
  // outside it falls through to the first open one.
  const preferred = defaults.projectId ? dir.project(defaults.projectId) : null;
  const [project, setProject] = useState(
    projectId ?? (preferred && !preferred.archived ? preferred.id : undefined) ?? firstOpen?.id ?? ""
  );
  const [title, setTitle] = useState(defaults.title ?? "");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>(defaults.status ?? "to_do");
  const [priority, setPriority] = useState<TaskPriority>(defaults.priority ?? "none");
  const [assignee, setAssignee] = useState<string | null>(defaults.assigneeMemberId ?? null);
  const [dueDate, setDueDate] = useState<string | null>(defaults.dueDate ?? null);
  const [more, setMore] = useState(false);
  const chosen = dir.project(project);
  const person = dir.person(assignee);

  const submit = () => {
    if (!title.trim() || !project) return;
    startTransition(async () => {
      const result = await createTaskAction({
        projectId: project,
        title: title.trim(),
        description,
        status,
        priority,
        assigneeMemberId: assignee,
        dueDate,
        ...(resolves ? { improvementId: resolves.id } : {}),
      });
      if (!result.ok) return toast.error(result.error);
      toast.success(`${dir.keyOf(result.value)} created`);
      onCreated?.(result.value);
      setTitle("");
      setDescription("");
      if (!more) onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
        >
          <DialogBody>
            <DialogSection>
              <Input autoFocus value={title} maxLength={500} onChange={(e) => setTitle(e.target.value)} placeholder="Task name" aria-label="Task name" required />
              <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional, markdown)" aria-label="Description" />
              <div className="flex flex-wrap gap-1.5">
                {!projectId && (
                  <ProjectPicker
                    value={project}
                    onChange={setProject}
                    trigger={
                      <PillButton muted={!chosen}>
                        {chosen ? (
                          <>
                            <ProjectGlyph icon={chosen.icon} color={chosen.color} className="size-3.5" />
                            <span className="truncate">{chosen.name}</span>
                          </>
                        ) : (
                          "Pick a project"
                        )}
                      </PillButton>
                    }
                  />
                )}
                <StatusPicker
                  value={status}
                  onChange={setStatus}
                  trigger={
                    <PillButton>
                      <TaskStatusIcon status={status} className="size-3.5" />
                      {TASK_STATUS_LABELS[status]}
                    </PillButton>
                  }
                />
                <PriorityPicker
                  value={priority}
                  onChange={setPriority}
                  trigger={
                    <PillButton muted={priority === "none"}>
                      <PriorityIcon priority={priority} className="size-3.5" />
                      {TASK_PRIORITY_LABELS[priority]}
                    </PillButton>
                  }
                />
                <AssigneePicker
                  value={assignee}
                  onChange={setAssignee}
                  trigger={
                    <PillButton muted={!person}>
                      <WorkAvatar person={person} size="sm" />
                      <span className="truncate">{person ? person.name : "Assignee"}</span>
                    </PillButton>
                  }
                />
                <DatePickerPopover
                  label="Due date"
                  value={dueDate}
                  onChange={setDueDate}
                  trigger={<PillButton muted={!dueDate}>{dueDate ? dueLabel(dueDate, dir.today).text : "Due date"}</PillButton>}
                />
                {resolves && (
                  // Not a picker: the dialog was opened from this Improvement,
                  // and the link is why. Stated so the person knows it is set.
                  <span className="text-muted-foreground inline-flex h-7 items-center gap-1.5 px-1.5 text-sm">
                    <Link2 aria-hidden className="size-3.5" />
                    Resolves <span className="font-mono text-xs">IMP-{resolves.seq}</span>
                  </span>
                )}
              </div>
            </DialogSection>
          </DialogBody>
          <DialogFooter>
            <label className="mr-auto flex items-center gap-2 text-sm">
              <Switch checked={more} onCheckedChange={setMore} aria-label="Create more" />
              Create more
            </label>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={!title.trim() || !project}>
              Create task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
