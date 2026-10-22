"use client";

import { useEffect, useState } from "react";
import { Trash2, TriangleAlert } from "lucide-react";
import { Button, DialogBody, DialogFooter } from "@agent-hub/ui";
import type { Project } from "@agent-hub/core";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { isRedirectError } from "@/components/ui/confirm-delete-modal";
import { SlideToConfirm } from "@/components/ui/slide-to-confirm";
import { MorphingModal } from "@/components/motion/morphing-modal";
import { toast } from "@/lib/toast";
import { deleteWorkProjectAction, projectDeletionSummaryAction } from "@/app/work-actions";

/**
 * Deleting a Project (#1046): it takes every Task, subtask, comment, file,
 * milestone and Saved View with it, so the confirmation names how many Tasks
 * and files go, offers Archive as the reversible path, and is crossed with
 * `slide-to-confirm` (DESIGN.md §3), the same two steps the Assistant delete
 * and a Member removal take.
 */
export function DeleteProjectModal({
  project,
  open,
  onClose,
  onArchive,
  onDeleted,
}: {
  project: Project;
  open: boolean;
  onClose: () => void;
  /** The reversible path, offered beside the delete. */
  onArchive?: () => void;
  onDeleted: () => void;
}) {
  const [view, setView] = useState<"warning" | "confirm">("warning");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{ id: string; tasks: number; files: number } | { id: string; error: string } | null>(null);

  // Reset to the first step each time the modal opens (adjust-during-render).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setView("warning");
  }

  // The counts are read when the modal opens, so they are the ones the delete will take.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void projectDeletionSummaryAction(project.id).then((result) => {
      if (cancelled) return;
      setSummary(result.ok ? { id: project.id, ...result.value } : { id: project.id, error: result.error });
    });
    return () => {
      cancelled = true;
    };
  }, [open, project.id]);

  const current = summary?.id === project.id ? summary : null;
  const counts = current && "tasks" in current ? current : null;
  const what = counts ? `${count(counts.tasks, "task")} and ${count(counts.files, "file")}` : null;

  function close() {
    if (busy) return;
    onClose();
  }

  /** Rethrows, so a failed delete sends the handle back to the start. */
  async function handleDelete() {
    setBusy(true);
    try {
      const result = await deleteWorkProjectAction(project.id);
      if (!result.ok) throw new Error(result.error);
    } catch (error) {
      setBusy(false);
      if (isRedirectError(error)) throw error;
      toast.error(error instanceof Error ? error.message : "The project was not deleted. Try again.");
      throw error;
    }
    toast.success("Project deleted");
    onClose();
    onDeleted();
  }

  return (
    <MorphingModal
      viewId={open ? view : null}
      title={view === "warning" ? `Delete “${project.name}”?` : "Confirm deletion"}
      onClose={close}
      placement="bottom"
    >
      {view === "warning" ? (
        <div className="ui-modal-stack">
          <div className="ui-modal-header flex items-start gap-3">
            <div className="bg-destructive/10 text-destructive rounded-full p-2">
              <AnimatedIcon icon={TriangleAlert} size={20} />
            </div>
            <h3 className="text-base font-semibold break-words">Delete &ldquo;{project.name}&rdquo;?</h3>
          </div>
          <DialogBody>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed" aria-live="polite">
              {what
                ? `Its ${what} are deleted with it, with every subtask, comment, milestone and saved view.`
                : current && "error" in current
                  ? "Every task, subtask, comment, file, milestone and saved view in it is deleted."
                  : "Counting what goes with it…"}{" "}
              Teammates, channels and Improvements that point at it are detached. This cannot be undone.
            </p>
          </DialogBody>
          <DialogFooter className="flex justify-end gap-2">
            {onArchive && !project.archived ? (
              <Button
                variant="secondary"
                onClick={() => {
                  onClose();
                  onArchive();
                }}
              >
                Archive instead
              </Button>
            ) : (
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
            )}
            <Button variant="destructive" disabled={!current} onClick={() => setView("confirm")}>
              Continue
            </Button>
          </DialogFooter>
        </div>
      ) : (
        <div className="ui-modal-stack">
          <div className="ui-modal-header flex items-start gap-3">
            <div className="bg-destructive/10 text-destructive rounded-full p-2">
              <AnimatedIcon icon={Trash2} size={20} />
            </div>
            <h3 className="text-base font-semibold">Confirm deletion</h3>
          </div>
          <DialogBody>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed break-words">
              Slide to permanently delete &ldquo;{project.name}&rdquo;{what ? ` and its ${what}` : ""}.
            </p>
            <div className="flex justify-center">
              <SlideToConfirm onConfirm={handleDelete} label="Slide to delete" confirmedLabel="Deleted" />
            </div>
          </DialogBody>
          <DialogFooter className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setView("warning")} disabled={busy}>
              Back
            </Button>
          </DialogFooter>
        </div>
      )}
    </MorphingModal>
  );
}

const NUMBER = new Intl.NumberFormat("en-GB");

/** "1 task", "1,204 tasks". */
function count(n: number, noun: string): string {
  return `${NUMBER.format(n)} ${noun}${n === 1 ? "" : "s"}`;
}
