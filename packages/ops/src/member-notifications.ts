import { z } from "zod";
import type { MemberNotification, MemberNotificationKind, NotificationPreferences, Project, Task } from "@agent-hub/core";
import { MEMBER_NOTIFICATION_KINDS, memberDisplayName, mentionTokensToText } from "@agent-hub/core";
import { OperationError, defineOperation, type OperationContext } from "./operation";
import { readableProjects } from "./work-access";
import { workId as id } from "./work-schemas";

/**
 * A Member's own notifications (#1048). Every read and write here derives the
 * recipient from the context and takes none as input: there is no shape of call
 * that reads somebody else's, which is also what the RLS policy says.
 */

function me(ctx: OperationContext): string {
  if (!ctx.userId) throw new OperationError("invalid_input", "Notifications belong to a Member.");
  return ctx.userId;
}

/** In the list: not archived, and not snoozed past now. A snooze that has passed needs no job to undo it. */
function inTriage(row: MemberNotification, now = Date.now()): boolean {
  return !row.archivedAt && !(row.snoozedUntil && Date.parse(row.snoozedUntil) > now);
}

/**
 * Every notification of the caller, newest first. Unbounded on purpose: the
 * retention sweep keeps a recipient to 90 days of rows, and a cap here once
 * made "mark all read" and the badge skip whatever fell past it.
 */
function recipientRows(ctx: OperationContext, filter: Partial<MemberNotification> = {}): Promise<MemberNotification[]> {
  return ctx.db
    .table("memberNotifications")
    .list({ organizationId: ctx.organizationId, recipientId: me(ctx), ...filter }, { orderBy: "createdAt", ascending: false });
}

/** The caller's rows among `ids`, read by id; anybody else's id simply matches nothing. */
async function mine(ctx: OperationContext, ids: readonly string[]): Promise<MemberNotification[]> {
  const recipientId = me(ctx);
  const rows = await Promise.all([...new Set(ids)].map((rowId) => ctx.db.table("memberNotifications").get(rowId)));
  return rows.filter(
    (row): row is MemberNotification =>
      !!row && row.recipientId === recipientId && row.organizationId === ctx.organizationId
  );
}

export const listMemberNotificationsOp = defineOperation({
  name: "notifications.list",
  capability: "member",
  effect: "read",
  input: z.object({
    kinds: z.array(z.enum(MEMBER_NOTIFICATION_KINDS)).optional(),
    unreadOnly: z.boolean().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  entities: () => [],
  run: async (ctx, input): Promise<MemberNotification[]> => {
    const kinds = input.kinds ? new Set<MemberNotificationKind>(input.kinds) : null;
    const now = Date.now();
    return (await recipientRows(ctx))
      .filter((row) => inTriage(row, now) && (!kinds || kinds.has(row.kind)) && (!input.unreadOnly || !row.readAt))
      .slice(0, input.limit ?? 200);
  },
});

export const countUnreadNotificationsOp = defineOperation({
  name: "notifications.unreadCount",
  capability: "member",
  effect: "read",
  input: z.object({}),
  entities: () => [],
  // Exactly the unread rows the Notifications page can show, or the badge holds
  // a number nothing on the page can clear: counted from the rows, because a
  // snooze hides until a moment (no equality filter says that) and a Project
  // the reader has since lost takes its rows off the page.
  run: async (ctx): Promise<number> => {
    if (!ctx.userId) return 0;
    const [rows, projects] = await Promise.all([
      recipientRows(ctx, { readAt: null }),
      readableProjects(ctx, { includeArchived: true }),
    ]);
    const readable = new Set(projects.map((project) => project.id));
    const now = Date.now();
    return rows.filter((row) => inTriage(row, now) && readable.has(row.projectId)).length;
  },
});

/** Marks some (or all) of the caller's notifications read or unread. */
export const markNotificationsOp = defineOperation({
  name: "notifications.mark",
  capability: "member",
  effect: "write",
  input: z.object({ ids: z.array(id).max(500).optional(), all: z.boolean().optional(), read: z.boolean() }),
  entities: () => [{ kind: "myNotifications" as const }],
  run: async (ctx, input): Promise<number> => {
    const wanted = input.all ? await recipientRows(ctx) : await mine(ctx, input.ids ?? []);
    const readAt = input.read ? new Date().toISOString() : null;
    let changed = 0;
    for (const row of wanted) {
      if (Boolean(row.readAt) === input.read) continue;
      await ctx.db.table("memberNotifications").update(row.id, { readAt });
      changed += 1;
    }
    return changed;
  },
});

/** Archives the caller's notifications, or brings them back (the undo). */
export const archiveNotificationsOp = defineOperation({
  name: "notifications.archive",
  capability: "member",
  effect: "write",
  input: z.object({ ids: z.array(id).min(1).max(500), archived: z.boolean() }),
  entities: () => [{ kind: "myNotifications" as const }],
  run: async (ctx, input): Promise<number> => {
    const archivedAt = input.archived ? new Date().toISOString() : null;
    const rows = await mine(ctx, input.ids);
    for (const row of rows) await ctx.db.table("memberNotifications").update(row.id, { archivedAt });
    return rows.length;
  },
});

/** Hides the caller's notifications until `until`, or wakes them now with null. */
export const snoozeNotificationsOp = defineOperation({
  name: "notifications.snooze",
  capability: "member",
  effect: "write",
  input: z.object({ ids: z.array(id).min(1).max(500), until: z.string().datetime().nullable() }),
  entities: () => [{ kind: "myNotifications" as const }],
  run: async (ctx, input): Promise<number> => {
    const rows = await mine(ctx, input.ids);
    for (const row of rows) await ctx.db.table("memberNotifications").update(row.id, { snoozedUntil: input.until });
    return rows.length;
  },
});

/** Deletes the caller's notifications for good; the Task and its comments are untouched. */
export const deleteNotificationsOp = defineOperation({
  name: "notifications.delete",
  capability: "member",
  effect: "consequential",
  input: z.object({ ids: z.array(id).min(1).max(500) }),
  entities: () => [{ kind: "myNotifications" as const }],
  run: async (ctx, input): Promise<number> => {
    const rows = await mine(ctx, input.ids);
    for (const row of rows) await ctx.db.table("memberNotifications").delete(row.id);
    return rows.length;
  },
});

const DEFAULT_PREFERENCES = { emailAssigned: true, emailMentioned: true } as const;

export const getNotificationPreferencesOp = defineOperation({
  name: "notifications.preferences.get",
  capability: "member",
  effect: "read",
  input: z.object({}),
  entities: () => [],
  run: async (ctx): Promise<Pick<NotificationPreferences, "emailAssigned" | "emailMentioned">> => {
    const [row] = await ctx.db
      .table("notificationPreferences")
      .list({ organizationId: ctx.organizationId, userId: me(ctx) });
    return row ? { emailAssigned: row.emailAssigned, emailMentioned: row.emailMentioned } : { ...DEFAULT_PREFERENCES };
  },
});

export const setNotificationPreferencesOp = defineOperation({
  name: "notifications.preferences.set",
  capability: "member",
  effect: "write",
  input: z.object({ emailAssigned: z.boolean(), emailMentioned: z.boolean() }).partial(),
  entities: () => [{ kind: "myNotifications" as const }],
  run: async (ctx, input): Promise<Pick<NotificationPreferences, "emailAssigned" | "emailMentioned">> => {
    const userId = me(ctx);
    const [row] = await ctx.db.table("notificationPreferences").list({ organizationId: ctx.organizationId, userId });
    const saved = row
      ? await ctx.db.table("notificationPreferences").update(row.id, input)
      : await ctx.db.table("notificationPreferences").insert({ organizationId: ctx.organizationId, userId, ...input });
    return { emailAssigned: saved.emailAssigned, emailMentioned: saved.emailMentioned };
  },
});

/** A notification with what the page draws beside it, joined at read time (#1048). */
export interface NotificationItem extends MemberNotification {
  task: Pick<Task, "id" | "projectId" | "parentId" | "seq" | "title" | "status" | "priority" | "assigneeMemberId" | "dueDate">;
  project: Pick<Project, "id" | "key" | "name" | "color" | "icon">;
  /** The comment's words as plain text, or null for a deleted comment and the kinds without one. */
  excerpt: string | null;
  /** Who did it, by the Member's current display name; null for a Teammate or a departed Member. */
  actorName: string | null;
}

/**
 * The Notifications page's read: the caller's rows with their Task, Project
 * and comment joined, so a renamed Task never shows a stale title. A row whose
 * Project the caller can no longer read is left out rather than leaked.
 */
export const notificationTriageOp = defineOperation({
  name: "notifications.triage",
  capability: "member",
  effect: "read",
  input: z.object({
    unreadOnly: z.boolean().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  entities: () => [],
  run: async (ctx, input): Promise<NotificationItem[]> => {
    if (!ctx.userId) return [];
    const [rows, projects] = await Promise.all([
      recipientRows(ctx),
      readableProjects(ctx, { includeArchived: true }),
    ]);
    const now = Date.now();
    const wanted = rows
      .filter((row) => inTriage(row, now) && (!input.unreadOnly || !row.readAt))
      .slice(0, input.limit ?? 200);
    if (!wanted.length) return [];
    const byProject = new Map(projects.map((project) => [project.id, project]));
    const [taskRows, members] = await Promise.all([
      ctx.db.table("tasks").list({ organizationId: ctx.organizationId }),
      ctx.db.listMembers(ctx.organizationId),
    ]);
    const tasks = new Map(taskRows.map((task) => [task.id, task]));
    const names = new Map(members.map((member) => [member.userId, memberDisplayName(member)]));
    const commentIds = [...new Set(wanted.flatMap((row) => (row.commentId ? [row.commentId] : [])))];
    const comments = new Map(
      (await Promise.all(commentIds.map((commentId) => ctx.db.table("taskComments").get(commentId)))).flatMap((comment) =>
        comment ? [[comment.id, comment] as const] : []
      )
    );
    return wanted.flatMap((row): NotificationItem[] => {
      const project = byProject.get(row.projectId);
      const task = tasks.get(row.taskId);
      if (!project || !task) return [];
      const comment = row.commentId ? comments.get(row.commentId) : undefined;
      return [
        {
          ...row,
          task: {
            id: task.id,
            projectId: task.projectId,
            parentId: task.parentId,
            seq: task.seq,
            title: task.title,
            status: task.status,
            priority: task.priority,
            assigneeMemberId: task.assigneeMemberId,
            dueDate: task.dueDate,
          },
          project: { id: project.id, key: project.key, name: project.name, color: project.color, icon: project.icon },
          excerpt: comment && !comment.deletedAt ? mentionTokensToText(comment.body) : null,
          actorName: row.actorMemberId ? (names.get(row.actorMemberId) ?? null) : null,
        },
      ];
    });
  },
});
