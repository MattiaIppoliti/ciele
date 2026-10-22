import { z } from "zod";
import type { TaskComment, TaskCommentReaction } from "@agent-hub/core";
import { parseMentionTokens } from "@agent-hub/core";
import { OperationError, defineOperation, type OperationContext } from "./operation";
import { notifyWork, recordActivity, requireReadableTask, taskSnapshot } from "./work-access";
import { workId as id } from "./work-schemas";

/**
 * Comments on a Task (#1055): markdown with id-carrying mention tokens (#1041),
 * editable and deletable by their author, with reactions of their own.
 *
 * Anyone who can read the Project comments, Viewers included (#1047), so every
 * operation here is `capability: "member"` and the visibility check is the
 * gate. `mentions` is derived from the body at every write and never accepted
 * from a caller. Work Activity records which comment was added and never its
 * words, so an edit or a delete leaves no second copy of the text behind.
 */

const body = z.string().trim().min(1).max(10_000);

/** How long a deleted comment can be brought back with Undo. */
export const COMMENT_RESTORE_WINDOW_MS = 10 * 60 * 1000;

export interface CommentView extends TaskComment {
  reactions: TaskCommentReaction[];
}

const commentEntities = (taskId: string) => [
  { kind: "task" as const, id: taskId },
  { kind: "myNotifications" as const },
];

async function requireOwnComment(ctx: OperationContext, commentId: string): Promise<TaskComment> {
  const comment = await ctx.db.table("taskComments").get(commentId);
  if (!comment || comment.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Comment not found");
  }
  await requireReadableTask(ctx, comment.taskId);
  if (!ctx.userId || comment.authorMemberId !== ctx.userId) {
    throw new OperationError("invalid_input", "Only its author can change a comment.");
  }
  return comment;
}

export const listTaskCommentsOp = defineOperation({
  name: "tasks.comments.list",
  capability: "member",
  effect: "read",
  input: z.object({ taskId: id }),
  entities: () => [],
  run: async (ctx, input): Promise<CommentView[]> => {
    await requireReadableTask(ctx, input.taskId);
    const comments = (await ctx.db.table("taskComments").list({ taskId: input.taskId })).filter(
      (comment) => !comment.deletedAt
    );
    if (!comments.length) return [];
    const reactions = await ctx.db.table("taskCommentReactions").list({ projectId: comments[0]!.projectId });
    return comments.map((comment) => ({
      ...comment,
      reactions: reactions.filter((reaction) => reaction.commentId === comment.id),
    }));
  },
});

export const createTaskCommentOp = defineOperation({
  name: "tasks.comments.create",
  capability: "member",
  effect: "write",
  input: z.object({ taskId: id, body }),
  entities: ({ taskId }) => commentEntities(taskId),
  run: async (ctx, input): Promise<TaskComment> => {
    const { task, project, memberIds } = await requireReadableTask(ctx, input.taskId);
    if (!ctx.userId && !ctx.teammate) {
      throw new OperationError("invalid_input", "A comment needs an author.");
    }
    const mentions = parseMentionTokens(input.body);
    const comment = await ctx.db.table("taskComments").insert({
      organizationId: ctx.organizationId,
      projectId: project.id,
      taskId: task.id,
      authorMemberId: ctx.teammate ? null : ctx.userId,
      authorTeammateId: ctx.teammate?.id ?? null,
      body: input.body,
      mentions,
    });
    await recordActivity(ctx, project.id, [
      {
        verb: "comment.added",
        taskId: task.id,
        data: { ...taskSnapshot(task, project), commentId: comment.id },
      },
    ]);
    await notifyWork(ctx, task, project, memberIds, [
      { kind: "commented", actorId: ctx.userId || null, commentId: comment.id, mentions, task },
    ]);
    return comment;
  },
});

export const updateTaskCommentOp = defineOperation({
  name: "tasks.comments.update",
  capability: "member",
  effect: "write",
  input: z.object({ id, body }),
  entities: (_input, result: TaskComment) => commentEntities(result.taskId),
  run: async (ctx, input): Promise<TaskComment> => {
    const before = await requireOwnComment(ctx, input.id);
    if (before.deletedAt) throw new OperationError("not_found", "Comment not found");
    const mentions = parseMentionTokens(input.body);
    const updated = await ctx.db.table("taskComments").update(before.id, {
      body: input.body,
      mentions,
      editedAt: new Date().toISOString(),
    });
    // A mention an edit adds notifies; one already notified does not again.
    const added = mentions.filter((member) => !before.mentions.includes(member));
    if (added.length) {
      const { task, project, memberIds } = await requireReadableTask(ctx, before.taskId);
      await notifyWork(ctx, task, project, memberIds, [
        { kind: "comment_edited", actorId: ctx.userId || null, commentId: before.id, addedMentions: added },
      ]);
    }
    return updated;
  },
});

export const deleteTaskCommentOp = defineOperation({
  name: "tasks.comments.delete",
  capability: "member",
  // Restorable for ten minutes, but a removal all the same: an agent acting
  // for a Member stops on the approval card before deleting their words.
  effect: "consequential",
  input: z.object({ id }),
  entities: (_input, result: TaskComment) => commentEntities(result.taskId),
  run: async (ctx, input): Promise<TaskComment> => {
    const comment = await requireOwnComment(ctx, input.id);
    if (comment.deletedAt) return comment;
    return ctx.db.table("taskComments").update(comment.id, { deletedAt: new Date().toISOString() });
  },
});

/** Undo for a delete, within the restore window (#1055). */
export const restoreTaskCommentOp = defineOperation({
  name: "tasks.comments.restore",
  capability: "member",
  effect: "write",
  input: z.object({ id }),
  entities: (_input, result: TaskComment) => commentEntities(result.taskId),
  run: async (ctx, input): Promise<TaskComment> => {
    const comment = await requireOwnComment(ctx, input.id);
    if (!comment.deletedAt) return comment;
    if (Date.now() - Date.parse(comment.deletedAt) > COMMENT_RESTORE_WINDOW_MS) {
      throw new OperationError("invalid_input", "That comment was deleted too long ago to bring back.");
    }
    return ctx.db.table("taskComments").update(comment.id, { deletedAt: null });
  },
});

/**
 * Toggles one of the caller's reactions; several per Member, one of each emoji.
 * Answers with the comment's reactions and the Task they show on.
 */
export const reactToTaskCommentOp = defineOperation({
  name: "tasks.comments.react",
  capability: "member",
  effect: "write",
  input: z.object({ id, emoji: z.string().min(1).max(32), on: z.boolean() }),
  entities: (_input, result: { taskId: string; reactions: TaskCommentReaction[] }) => [
    { kind: "task" as const, id: result.taskId },
  ],
  run: async (ctx, input): Promise<{ taskId: string; reactions: TaskCommentReaction[] }> => {
    const comment = await ctx.db.table("taskComments").get(input.id);
    if (!comment || comment.organizationId !== ctx.organizationId || comment.deletedAt) {
      throw new OperationError("not_found", "Comment not found");
    }
    await requireReadableTask(ctx, comment.taskId);
    if (!ctx.userId) throw new OperationError("invalid_input", "Reacting needs a Member.");
    const mine = (await ctx.db.table("taskCommentReactions").list({ commentId: comment.id })).filter(
      (reaction) => reaction.userId === ctx.userId && reaction.emoji === input.emoji
    );
    if (input.on && !mine.length) {
      await ctx.db.table("taskCommentReactions").insert({
        organizationId: ctx.organizationId,
        projectId: comment.projectId,
        commentId: comment.id,
        userId: ctx.userId,
        emoji: input.emoji,
      });
    }
    if (!input.on) for (const reaction of mine) await ctx.db.table("taskCommentReactions").delete(reaction.id);
    return { taskId: comment.taskId, reactions: await ctx.db.table("taskCommentReactions").list({ commentId: comment.id }) };
  },
});
