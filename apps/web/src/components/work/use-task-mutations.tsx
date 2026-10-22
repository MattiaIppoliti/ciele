"use client";

import { useOptimistic, useTransition } from "react";
import type { Task, TaskStatus } from "@agent-hub/core";
import { rankBetween, statusPatch } from "@agent-hub/core";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { toast } from "@/lib/toast";
import {
  archiveTaskAction,
  bulkUpdateTasksAction,
  deleteTaskAction,
  undoCompleteTaskAction,
  updateTaskAction,
} from "@/app/work-actions";
import type { DropPosition } from "@/lib/work/drop-position";

/**
 * The optimistic layer every task view writes through (#1064): a change shows
 * at once, then settles from the server's answer, which also carries the
 * refreshed page (ADR-0005). A refusal is a toast and the row snaps back when
 * the transition ends.
 */

type UpdateInput = Parameters<typeof updateTaskAction>[0];
type Patch = NonNullable<UpdateInput["patch"]>;
type Change = { id: string; patch: Partial<Task> } | { remove: string[] };

export function useTaskMutations(tasks: Task[]) {
  const [, startTransition] = useTransition();
  const [optimistic, apply] = useOptimistic(tasks, (current: Task[], change: Change) =>
    "remove" in change
      ? current.filter((task) => !change.remove.includes(task.id))
      : current.map((task) => (task.id === change.id ? { ...task, ...change.patch } : task))
  );
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  const local = (patch: Patch): Partial<Task> =>
    patch.status ? { ...patch, ...statusPatch(patch.status, new Date().toISOString()) } : (patch as Partial<Task>);

  /**
   * Completing Tasks can be taken back (#1074). Undo is the real inverse: each
   * Task returns to the status it had, and a recurring one loses the copy its
   * completion scheduled and gets its recurrence back.
   */
  const offerUndoComplete = (completed: { id: string; status: Exclude<TaskStatus, "done"> }[]) => {
    if (!completed.length) return;
    toast.undo(completed.length === 1 ? "Task completed" : `${completed.length} tasks completed`, () =>
      inTurn(completed, ({ id, status }) => undoCompleteTaskAction(id, status))
    );
  };
  const completing = (tasks: Task[], patch: Patch) =>
    patch.status === "done"
      ? tasks.flatMap((task) => (task.status === "done" ? [] : [{ id: task.id, status: task.status }]))
      : [];

  /** A field change, with an optional new place in the order. */
  const update = (task: Task, patch: Patch, extra: Omit<UpdateInput, "id" | "patch"> = {}) =>
    startTransition(async () => {
      apply({ id: task.id, patch: local(patch) });
      const result = await updateTaskAction({ id: task.id, patch, ...extra });
      if (!result.ok) toast.error(result.error);
      else offerUndoComplete(completing([task], patch));
    });

  /**
   * A drag's result: the fields the target sets plus a position between two
   * neighbours. The local rank is computed the way the server will, so the
   * card does not jump back before the answer arrives.
   */
  const move = (task: Task, patch: Patch, position: DropPosition) => {
    const rankOf = (id: string | null) => (id ? (optimistic.find((t) => t.id === id)?.rank ?? null) : null);
    let rank: string | undefined;
    try {
      const lo = rankOf(position.afterId);
      const hi = rankOf(position.beforeId);
      rank = lo !== null && hi !== null && lo >= hi ? undefined : rankBetween(lo, hi);
    } catch {
      rank = undefined;
    }
    startTransition(async () => {
      apply({ id: task.id, patch: { ...local(patch), ...(rank ? { rank } : {}) } });
      const result = await updateTaskAction({ id: task.id, patch, position });
      if (!result.ok) toast.error(result.error);
      else offerUndoComplete(completing([task], patch));
    });
  };

  /**
   * A whole column re-ordered in one gesture (the Board's Sort by priority):
   * the new order lands locally at once, then the server places each card
   * after the one before it. Separate `move`s would each read the same stale
   * snapshot and land in the wrong order until every answer came back.
   */
  const reorder = (ordered: Task[]) => {
    let previousRank: string | null = null;
    const ranks = ordered.map((task) => {
      previousRank = rankBetween(previousRank, null);
      return { id: task.id, rank: previousRank };
    });
    startTransition(async () => {
      for (const { id, rank } of ranks) apply({ id, patch: { rank } });
      const result = await inTurn(ordered, (task, index) =>
        updateTaskAction({ id: task.id, patch: {}, position: { afterId: ordered[index - 1]?.id ?? null, beforeId: null } })
      );
      if (!result.ok) toast.error(result.error);
    });
  };

  /** One field change across a selection, in one server call; a completion offers Undo. */
  const bulk = (ids: string[], patch: Pick<Patch, "status" | "priority" | "assigneeMemberId" | "dueDate">) => {
    if (!ids.length) return;
    const completed = completing(
      optimistic.filter((task) => ids.includes(task.id)),
      patch
    );
    startTransition(async () => {
      for (const id of ids) apply({ id, patch: local(patch) });
      const result = await bulkUpdateTasksAction({ ids, patch });
      if (!result.ok) toast.error(result.error);
      else if (completed.length) offerUndoComplete(completed);
      else toast.success(`Updated ${ids.length} task${ids.length === 1 ? "" : "s"}`);
    });
  };

  const archive = (ids: string[], after?: () => void) =>
    startTransition(async () => {
      apply({ remove: ids });
      const archived = await inTurn(ids, (id) => archiveTaskAction(id, true));
      if (!archived.ok) return toast.error(archived.error);
      after?.();
      toast.undo(ids.length === 1 ? "Task archived" : `${ids.length} tasks archived`, () =>
        inTurn(ids, (id) => archiveTaskAction(id, false))
      );
    });

  const remove = (ids: string[], after?: () => void) =>
    confirmDelete({
      title: ids.length === 1 ? "Delete this task?" : `Delete ${ids.length} tasks?`,
      description: "Their subtasks and comments are deleted too. Archive instead to keep them restorable.",
      onConfirm: async () => {
        apply({ remove: ids });
        const deleted = await inTurn(ids, (id) => deleteTaskAction(id));
        if (!deleted.ok) throw new Error(deleted.error);
        after?.();
      },
    });

  return { tasks: optimistic, update, move, reorder, bulk, archive, remove, confirmDeleteModal };
}

/**
 * Runs a work action over each item in turn, stopping at the first refusal
 * and handing it back: the shape every multi-item write here shares, and the
 * one `toast.undo` reads (`{ ok: false, error }` becomes an error toast).
 */
async function inTurn<T>(
  items: readonly T[],
  run: (item: T, index: number) => Promise<{ ok: true } | { ok: false; error: string } | { ok: boolean; error?: string }>
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const [index, item] of items.entries()) {
    const result = await run(item, index);
    if (!result.ok) return { ok: false, error: ("error" in result && result.error) || "Could not finish" };
  }
  return { ok: true };
}
