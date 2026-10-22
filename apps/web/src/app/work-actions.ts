"use server";

import { ZodError } from "zod";
import {
  OperationError,
  archiveTaskOp,
  bulkUpdateTasksOp,
  createProjectOp,
  createSavedViewOp,
  createProjectFileOp,
  createTaskCommentOp,
  createTaskLabelOp,
  createTaskOp,
  deleteProjectOp,
  deleteSavedViewOp,
  deleteProjectFileOp,
  deleteTaskCommentOp,
  deleteTaskOp,
  discardProjectFileUploadOp,
  duplicateProjectOp,
  getTaskOp,
  listImprovementsPageOp,
  listProjectFilesOp,
  listTaskCommentsOp,
  markNotificationsOp,
  archiveNotificationsOp,
  snoozeNotificationsOp,
  deleteNotificationsOp,
  prepareProjectFileOp,
  projectDeletionSummaryOp,
  reactToTaskCommentOp,
  renameProjectFileOp,
  restoreTaskCommentOp,
  setFavoriteOp,
  setMilestonesOp,
  setNotificationPreferencesOp,
  setProjectMembersOp,
  undoCompleteTaskOp,
  updateProjectOp,
  updateSavedViewOp,
  updateTaskCommentOp,
  updateTaskOp,
  todayUtc,
  workActivityOp,
  workDirectoryOp,
  type CommentView,
  type Operation,
  type TaskDetail,
  type WorkDirectory,
} from "@ciele/ops";
import type {
  Project,
  ProjectFile,
  ProjectMilestone,
  SavedView,
  Task,
  TaskComment,
  TaskStatus,
  TaskCommentReaction,
  TaskLabel,
  WorkActivity,
  WorkLayout,
  WorkViewQuery,
} from "@agent-hub/core";
import { CapabilityRefusedError, requireMember } from "@/lib/authz";
import { runOperation } from "@/lib/operations";
import { canEdit } from "@/lib/rbac";
import { resolvableImprovements, type ResolvableImprovement } from "@/lib/work/improvement-tasks";
import { WORK_FILES_BUCKET, putWorkFile } from "@/lib/storage/work-files";
import { objectStorageClient } from "@/lib/supabase/service";

/**
 * The work section's server actions (#1063): thin calls into `@ciele/ops`.
 *
 * Each returns its refusal as a value rather than throwing it, because Next
 * replaces a thrown message with a generic one in production, and "A Viewer
 * cannot be assigned work" is exactly the sentence the person needs to read.
 * Anything that is not a caller-attributable refusal still throws.
 */

export type WorkResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function attempt<In, Out>(op: Operation<In, Out>, input: In): Promise<WorkResult<Out>> {
  try {
    return { ok: true, value: await runOperation(op, input) };
  } catch (error) {
    if (error instanceof OperationError) return { ok: false, error: error.message };
    if (error instanceof ZodError) {
      return { ok: false, error: error.issues[0]?.message ?? "That input is not valid." };
    }
    if (error instanceof CapabilityRefusedError) {
      return { ok: false, error: "Your role cannot change this. Ask an Editor or an Admin." };
    }
    throw error;
  }
}

// Tasks ---------------------------------------------------------------------------

export async function getTaskAction(
  id: string
): Promise<WorkResult<TaskDetail & { activity: WorkActivity[]; comments: CommentView[]; files: ProjectFile[] }>> {
  const detail = await attempt(getTaskOp, { id });
  if (!detail.ok) return detail;
  const [activity, comments, files] = await Promise.all([
    attempt(workActivityOp, { taskId: id, limit: 100 }),
    attempt(listTaskCommentsOp, { taskId: id }),
    attempt(listProjectFilesOp, { projectId: detail.value.project.id, taskId: id }),
  ]);
  return {
    ok: true,
    value: {
      ...detail.value,
      activity: activity.ok ? activity.value : [],
      comments: comments.ok ? comments.value : [],
      files: files.ok ? files.value : [],
    },
  };
}

export async function createTaskAction(input: Parameters<typeof createTaskOp.run>[1]): Promise<WorkResult<Task>> {
  return attempt(createTaskOp, input);
}

export async function updateTaskAction(input: Parameters<typeof updateTaskOp.run>[1]): Promise<WorkResult<Task>> {
  return attempt(updateTaskOp, input);
}

export async function bulkUpdateTasksAction(
  input: Parameters<typeof bulkUpdateTasksOp.run>[1]
): Promise<WorkResult<Task[]>> {
  return attempt(bulkUpdateTasksOp, input);
}

/**
 * Undo for a completion (#1074): the Task goes back to `previousStatus` and a
 * recurring one gets its recurrence back, its scheduled copy removed.
 */
export async function undoCompleteTaskAction(id: string, previousStatus: Exclude<TaskStatus, "done">): Promise<WorkResult<Task>> {
  return attempt(undoCompleteTaskOp, { id, status: previousStatus });
}

export async function archiveTaskAction(id: string, archived: boolean): Promise<WorkResult<Task>> {
  return attempt(archiveTaskOp, { id, archived });
}

export async function deleteTaskAction(id: string): Promise<WorkResult<{ deleted: number }>> {
  return attempt(deleteTaskOp, { id });
}

// Improvement links (ADR-0027 rule 2) ------------------------------------------------

/** The board's lanes an Improvement is still open in: not done, not archived. */
const OPEN_IMPROVEMENT_LANES = ["to_do", "in_progress", "in_review"] as const;
/** A picker, not an export: five pages of a hundred per lane covers any board a person scrolls. */
const OPEN_IMPROVEMENT_PAGES = 5;

/**
 * The Improvements a Task's Resolves field offers: the open ones, read lane by
 * lane through the board's own paged read. Any Member may read the board, so
 * this asks for no rank; the link itself is a Task write, which `tasks.update`
 * gates.
 */
export async function listOpenImprovementsAction(): Promise<WorkResult<ResolvableImprovement[]>> {
  const lanes = await Promise.all(
    OPEN_IMPROVEMENT_LANES.map(async (status): Promise<WorkResult<ResolvableImprovement[]>> => {
      const items: ResolvableImprovement[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < OPEN_IMPROVEMENT_PAGES; page++) {
        const result: WorkResult<{ items: ResolvableImprovement[]; nextCursor: string | null }> = await attempt(
          listImprovementsPageOp,
          { limit: 100, cursor, status }
        );
        if (!result.ok) return result;
        items.push(...result.value.items);
        cursor = result.value.nextCursor;
        if (!cursor) break;
      }
      return { ok: true, value: items };
    })
  );
  const failed = lanes.find((lane) => !lane.ok);
  if (failed && !failed.ok) return failed;
  return { ok: true, value: resolvableImprovements(lanes.flatMap((lane) => (lane.ok ? lane.value : []))) };
}

/**
 * What the work pickers name, for a New task dialog opened outside a work page
 * (the Improvement detail's Create task). Fetched when the dialog is wanted,
 * so the Improvement board does not read the directory on every load.
 */
export async function getWorkContextAction(): Promise<
  WorkResult<{ directory: WorkDirectory; today: string; viewerId: string; canEdit: boolean }>
> {
  const { session } = await requireMember();
  const directory = await attempt(workDirectoryOp, {});
  if (!directory.ok) return directory;
  return {
    ok: true,
    value: { directory: directory.value, today: todayUtc(), viewerId: session.userId, canEdit: canEdit(session.role) },
  };
}

// Projects ------------------------------------------------------------------------

export async function createWorkProjectAction(
  input: Parameters<typeof createProjectOp.run>[1]
): Promise<WorkResult<Project>> {
  return attempt(createProjectOp, input);
}

export async function updateWorkProjectAction(
  input: Parameters<typeof updateProjectOp.run>[1]
): Promise<WorkResult<Project>> {
  return attempt(updateProjectOp, input);
}

/** What deleting a Project takes with it, for the confirmation that names the counts (#1046). */
export async function projectDeletionSummaryAction(
  id: string
): Promise<WorkResult<{ tasks: number; files: number }>> {
  return attempt(projectDeletionSummaryOp, { id });
}

export async function deleteWorkProjectAction(id: string): Promise<WorkResult<{ tasks: number }>> {
  return attempt(deleteProjectOp, { id });
}

export async function duplicateProjectAction(id: string): Promise<WorkResult<Project>> {
  return attempt(duplicateProjectOp, { id });
}

export async function setProjectMembersAction(id: string, userIds: string[]): Promise<WorkResult<string[]>> {
  return attempt(setProjectMembersOp, { id, userIds });
}

export async function setMilestonesAction(
  id: string,
  milestones: { id?: string; name: string; date: string }[]
): Promise<WorkResult<ProjectMilestone[]>> {
  return attempt(setMilestonesOp, { id, milestones });
}

export async function setFavoriteAction(
  target: { projectId: string } | { taskId: string },
  on: boolean
): Promise<WorkResult<boolean>> {
  return attempt(setFavoriteOp, { ...target, on });
}

// Labels --------------------------------------------------------------------------

export async function createTaskLabelAction(
  name: string,
  color: TaskLabel["color"]
): Promise<WorkResult<TaskLabel>> {
  return attempt(createTaskLabelOp, { name, color });
}

// Saved Views (#1050) ---------------------------------------------------------------

export async function createSavedViewAction(input: {
  projectId: string;
  name: string;
  layout: WorkLayout;
  query: WorkViewQuery;
}): Promise<WorkResult<SavedView>> {
  return attempt(createSavedViewOp, input);
}

export async function updateSavedViewAction(
  id: string,
  patch: { name?: string; layout?: WorkLayout; query?: WorkViewQuery }
): Promise<WorkResult<SavedView>> {
  return attempt(updateSavedViewOp, { id, patch });
}

export async function deleteSavedViewAction(id: string): Promise<WorkResult<void>> {
  return attempt(deleteSavedViewOp, { id });
}

// Comments (#1066) ----------------------------------------------------------------

export async function createTaskCommentAction(taskId: string, body: string): Promise<WorkResult<TaskComment>> {
  return attempt(createTaskCommentOp, { taskId, body });
}

export async function updateTaskCommentAction(id: string, body: string): Promise<WorkResult<TaskComment>> {
  return attempt(updateTaskCommentOp, { id, body });
}

export async function deleteTaskCommentAction(id: string): Promise<WorkResult<TaskComment>> {
  return attempt(deleteTaskCommentOp, { id });
}

/** Undo for a delete, within ten minutes of it. */
export async function restoreTaskCommentAction(id: string): Promise<WorkResult<TaskComment>> {
  return attempt(restoreTaskCommentOp, { id });
}

export async function reactToTaskCommentAction(
  id: string,
  emoji: string,
  on: boolean
): Promise<WorkResult<TaskCommentReaction[]>> {
  const result = await attempt(reactToTaskCommentOp, { id, emoji, on });
  return result.ok ? { ok: true, value: result.value.reactions } : result;
}

// Member Notifications (#1067) ------------------------------------------------------

/** Marks some, or all, of the caller's notifications read or unread. */
export async function markNotificationsAction(input: { ids?: string[]; all?: boolean; read: boolean }): Promise<WorkResult<number>> {
  return attempt(markNotificationsOp, input);
}

export async function archiveNotificationsAction(ids: string[], archived: boolean): Promise<WorkResult<number>> {
  return attempt(archiveNotificationsOp, { ids, archived });
}

/** `until` null wakes them now. */
export async function snoozeNotificationsAction(ids: string[], until: string | null): Promise<WorkResult<number>> {
  return attempt(snoozeNotificationsOp, { ids, until });
}

export async function deleteNotificationsAction(ids: string[]): Promise<WorkResult<number>> {
  return attempt(deleteNotificationsOp, { ids });
}

export async function setNotificationPreferencesAction(input: {
  emailAssigned?: boolean;
  emailMentioned?: boolean;
}): Promise<WorkResult<{ emailAssigned: boolean; emailMentioned: boolean }>> {
  return attempt(setNotificationPreferencesOp, input);
}

// Project files (#1068) ---------------------------------------------------------------

type FileTicket = { id: string; storagePath: string; contentType: string };

/**
 * Step one of an upload. With object storage it hands back a signed upload
 * URL, so the bytes go from the browser straight to the bucket: a function's
 * request body is capped well below the 50 MB a file may be. Without it (the
 * demo), `direct` is false and the bytes come through `uploadProjectFileAction`.
 */
export async function startProjectFileUploadAction(input: {
  projectId: string;
  taskId?: string;
  name: string;
  sizeBytes: number;
}): Promise<WorkResult<{ ticket: FileTicket; uploadUrl: string | null }>> {
  const ticket = await attempt(prepareProjectFileOp, input);
  if (!ticket.ok) return ticket;
  const storage = objectStorageClient();
  if (!storage) return { ok: true, value: { ticket: ticket.value, uploadUrl: null } };
  const { data, error } = await storage.storage.from(WORK_FILES_BUCKET).createSignedUploadUrl(ticket.value.storagePath);
  if (error || !data?.signedUrl) return { ok: false, error: "Storage did not accept the upload. Try again." };
  return { ok: true, value: { ticket: ticket.value, uploadUrl: data.signedUrl } };
}

/**
 * Step two, after the bytes landed: records the file, or removes the object
 * when it may not be recorded. The removal is `files.discard`, which derives
 * the key from the ticket itself: the path in `ticket` is the caller's word,
 * and deleting whatever path a refused caller names, with the service role,
 * would let anyone remove any object in the bucket.
 */
export async function finishProjectFileUploadAction(input: {
  ticket: FileTicket;
  projectId: string;
  taskId?: string;
  name: string;
  sizeBytes: number;
}): Promise<WorkResult<ProjectFile>> {
  const created = await attempt(createProjectFileOp, {
    id: input.ticket.id,
    projectId: input.projectId,
    taskId: input.taskId,
    name: input.name,
    storagePath: input.ticket.storagePath,
    sizeBytes: input.sizeBytes,
  });
  if (!created.ok) {
    await attempt(discardProjectFileUploadOp, {
      id: input.ticket.id,
      projectId: input.projectId,
      name: input.name,
    }).catch(() => undefined);
  }
  return created;
}

/** The demo's path, with no bucket to sign for: the bytes travel with the action. */
export async function uploadProjectFileAction(formData: FormData): Promise<WorkResult<ProjectFile>> {
  const projectId = String(formData.get("projectId") ?? "");
  const rawTask = formData.get("taskId");
  const taskId = typeof rawTask === "string" && rawTask ? rawTask : undefined;
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Choose a file to upload." };
  const ticket = await attempt(prepareProjectFileOp, { projectId, taskId, name: file.name, sizeBytes: file.size });
  if (!ticket.ok) return ticket;
  try {
    await putWorkFile(objectStorageClient(), {
      path: ticket.value.storagePath,
      bytes: await file.arrayBuffer(),
      contentType: ticket.value.contentType,
    });
  } catch {
    return { ok: false, error: "The upload did not reach storage. Try again." };
  }
  return finishProjectFileUploadAction({ ticket: ticket.value, projectId, taskId, name: file.name, sizeBytes: file.size });
}

export async function renameProjectFileAction(id: string, name: string): Promise<WorkResult<ProjectFile>> {
  return attempt(renameProjectFileOp, { id, name });
}

export async function deleteProjectFileAction(id: string): Promise<WorkResult<{ deleted: true }>> {
  const result = await attempt(deleteProjectFileOp, { id });
  return result.ok ? { ok: true, value: { deleted: true } } : result;
}
