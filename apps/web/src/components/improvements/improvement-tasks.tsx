"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@agent-hub/ui";
import type { WorkDirectory } from "@ciele/ops";
import { getWorkContextAction } from "@/app/work-actions";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";
import { UserAvatar } from "@/components/ui/user-avatar";
import { NewTaskDialog } from "@/components/work/new-task-dialog";
import { WorkDirectoryProvider } from "@/components/work/work-directory";
import { TaskStatusIcon } from "@/components/work/work-icons";
import { memberDisplayName } from "@/lib/members";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  improvementTaskProgress,
  improvementTaskRow,
  mergeImprovementTaskRows,
  type ImprovementTaskRow,
} from "@/lib/work/improvement-tasks";

interface WorkContext {
  directory: WorkDirectory;
  today: string;
  viewerId: string;
  canEdit: boolean;
}

/**
 * The Tasks that resolve an Improvement (ADR-0027 rule 2), and the Create task
 * button that files one with the link already set. Creating is a Task write,
 * so `canCreate` is the caller's rank on Tasks, not on Improvements.
 *
 * The New task dialog names Projects and people from the work directory. The
 * board's drawer renders this too, and it has none, so the directory is read
 * the first time the button is pressed rather than with every Improvement.
 */
export function ImprovementTasks({
  improvementId,
  improvementSeq,
  title,
  projectId,
  tasks,
  members,
  canCreate,
}: {
  improvementId: string;
  improvementSeq: number;
  /** The Improvement's current title and Project, which a new Task starts from. */
  title: string;
  projectId: string | null;
  tasks: ImprovementTaskRow[];
  members: { userId: string; email: string }[];
  canCreate: boolean;
}) {
  /**
   * Tasks created here. The page's own read refreshes with the action that
   * created them, the drawer's does not, so they are held until a read
   * carries them.
   */
  const [created, setCreated] = useState<ImprovementTaskRow[]>([]);
  const [work, setWork] = useState<WorkContext | null>(null);
  const [opening, setOpening] = useState(false);
  const [creating, setCreating] = useState(false);
  const headingId = useId();

  const rows = mergeImprovementTaskRows(tasks, created);
  const progress = improvementTaskProgress(rows);

  async function openCreate() {
    if (!work) {
      setOpening(true);
      const result = await getWorkContextAction().catch(() => null);
      setOpening(false);
      if (!result?.ok) {
        toast.error(result?.error ?? "Could not open the new task form. Please try again.");
        return;
      }
      setWork(result.value);
    }
    setCreating(true);
  }

  return (
    <section aria-labelledby={headingId}>
      <div className="mb-2 flex min-h-8 items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id={headingId} className="font-semibold">
            Tasks
          </h2>
          {progress.total > 0 && (
            <span className="text-muted-foreground text-xs tabular-nums">
              <RollInText text={`${progress.done}/${progress.total} done`} />
            </span>
          )}
        </div>
        {canCreate && (
          <Button size="sm" variant="secondary" loading={opening} onClick={() => void openCreate()}>
            <Plus className="size-4" />
            Create task
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No tasks resolve this improvement yet. When every task linked here is done, it moves to In
          Review for someone to close.
        </p>
      ) : (
        <ul className="divide-alpha-medium border-alpha-medium divide-y overflow-hidden rounded-xl border">
          {rows.map((row, index) => {
            const assignee = row.assigneeMemberId
              ? (members.find((member) => member.userId === row.assigneeMemberId) ?? null)
              : null;
            return (
              <RollRow key={row.id} index={index}>
                <li>
                  <Link
                    href={`/tasks/${row.id}`}
                    className={cn(
                      "press hover:bg-alpha-light flex min-h-10 items-center gap-2.5 px-3 py-2 text-sm transition-colors",
                      row.archived && "text-muted-foreground"
                    )}
                  >
                    <TaskStatusIcon status={row.status} className="size-3.5" />
                    <span className="text-muted-foreground shrink-0 font-mono text-xs">
                      <RollInText text={row.key} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      <RollInText text={row.title} />
                    </span>
                    {row.archived && <span className="text-muted-foreground shrink-0 text-xs">Archived</span>}
                    {assignee && (
                      <span className="text-muted-foreground flex max-w-40 shrink-0 items-center gap-1.5 text-xs">
                        <UserAvatar userId={assignee.userId} email={assignee.email} size="size-5" />
                        <span className="truncate">
                          <RollInText text={memberDisplayName(assignee.email)} />
                        </span>
                      </span>
                    )}
                  </Link>
                </li>
              </RollRow>
            );
          })}
        </ul>
      )}

      {creating && work && (
        <WorkDirectoryProvider
          directory={work.directory}
          today={work.today}
          viewerId={work.viewerId}
          canEdit={work.canEdit}
        >
          <NewTaskDialog
            open
            onClose={() => setCreating(false)}
            defaults={{ title, projectId }}
            resolves={{ id: improvementId, seq: improvementSeq }}
            onCreated={(task) => {
              const key = work.directory.projects.find((project) => project.id === task.projectId)?.key;
              setCreated((current) => [...current, improvementTaskRow(task, key)]);
            }}
          />
        </WorkDirectoryProvider>
      )}
    </section>
  );
}
