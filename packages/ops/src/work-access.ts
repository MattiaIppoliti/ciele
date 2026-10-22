import type {
  Member,
  Project,
  ProjectViewer,
  Task,
  WorkActivityData,
  WorkActivityVerb,
  WorkNotificationEvent,
} from "@agent-hub/core";
import {
  canBeAssignee,
  canReadProject,
  canWriteProject,
  memberDisplayName,
  taskKey,
  workNotificationRecipients,
} from "@agent-hub/core";
import {
  OperationError,
  type OperationContext,
  type WorkActivityEntry,
  type WorkNotificationRow,
} from "./operation";

/**
 * The work domain's access rule and its two system writes (#1047, #1051,
 * #1048), shared by every work operation.
 *
 * Visibility is `canReadProject` from core, the same rule the database's
 * `private.can_read_project` enforces, so the mock, an API key (which acts as
 * its creator) and a Member's RLS session all answer alike. A Project the
 * caller cannot see is `not_found`, never "forbidden": its existence is part
 * of what is private.
 */

/** The Member the caller acts for, whose visibility applies. */
export function viewerOf(ctx: OperationContext): ProjectViewer {
  return { userId: ctx.userId, role: ctx.role };
}

export async function projectMemberIds(ctx: OperationContext, projectId: string): Promise<string[]> {
  const rows = await ctx.db.table("projectMembers").list({ projectId });
  return rows.map((row) => row.userId);
}

/** A Project in the caller's Organization they can see, or `not_found`. */
export async function requireReadableProject(
  ctx: OperationContext,
  id: string
): Promise<{ project: Project; memberIds: string[] }> {
  const project = await ctx.db.table("projects").get(id);
  if (!project || project.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Project not found");
  }
  const memberIds = project.visibility === "private" ? await projectMemberIds(ctx, id) : [];
  if (!canReadProject(project, memberIds, viewerOf(ctx))) {
    throw new OperationError("not_found", "Project not found");
  }
  return { project, memberIds };
}

/**
 * A Project the caller may change. The operation's `edit` capability already
 * checked the rung; this adds the private Project's membership. A Teammate's
 * write is gated by its grant, not by the invoking Member's Role (#770), so
 * for one only visibility applies.
 */
export async function requireWritableProject(
  ctx: OperationContext,
  id: string,
  { allowArchived = false }: { allowArchived?: boolean } = {}
): Promise<{ project: Project; memberIds: string[] }> {
  const found = await requireReadableProject(ctx, id);
  if (!ctx.teammate && !canWriteProject(found.project, found.memberIds, viewerOf(ctx))) {
    throw new OperationError("not_found", "Project not found");
  }
  if (found.project.archived && !allowArchived) {
    throw new OperationError("invalid_input", "This Project is archived. Restore it to change its work.");
  }
  return found;
}

/** A Task the caller can see, with its Project. */
export async function requireReadableTask(
  ctx: OperationContext,
  id: string
): Promise<{ task: Task; project: Project; memberIds: string[] }> {
  const task = await ctx.db.table("tasks").get(id);
  if (!task || task.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Task not found");
  }
  try {
    return { task, ...(await requireReadableProject(ctx, task.projectId)) };
  } catch (error) {
    // A Project the caller cannot read reads as a missing Task; a failing
    // Db is still a failure, not a 404.
    if (error instanceof OperationError && error.code === "not_found") {
      throw new OperationError("not_found", "Task not found");
    }
    throw error;
  }
}

export async function requireWritableTask(
  ctx: OperationContext,
  id: string
): Promise<{ task: Task; project: Project; memberIds: string[] }> {
  const found = await requireReadableTask(ctx, id);
  await requireWritableProject(ctx, found.project.id);
  return found;
}

/** Every Project in the Organization the caller can see. */
export async function readableProjects(
  ctx: OperationContext,
  { includeArchived = false }: { includeArchived?: boolean } = {}
): Promise<Project[]> {
  const [projects, seats] = await Promise.all([
    ctx.db.table("projects").list({ organizationId: ctx.organizationId }),
    ctx.db.table("projectMembers").list({ organizationId: ctx.organizationId }),
  ]);
  const seated = new Map<string, string[]>();
  for (const seat of seats) {
    const list = seated.get(seat.projectId) ?? [];
    list.push(seat.userId);
    seated.set(seat.projectId, list);
  }
  const viewer = viewerOf(ctx);
  return projects.filter(
    (project) =>
      (includeArchived || !project.archived) &&
      canReadProject(project, seated.get(project.id) ?? [], viewer)
  );
}

// The directory -------------------------------------------------------------------

/** A Member as the work views show one: enough for a face, a name and a picker. */
export interface WorkPerson {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: Member["role"];
  /** At least an Editor (#1047): only these appear in the assignee picker. */
  assignable: boolean;
}

export function workPerson(member: Member): WorkPerson {
  return {
    userId: member.userId,
    name: memberDisplayName(member),
    email: member.email,
    avatarUrl: member.avatarUrl,
    role: member.role,
    assignable: canBeAssignee(member.role),
  };
}

/**
 * Validates a Member assignee: in the Organization, at least an Editor, and
 * able to see the Project. A Teammate assignee is refused in v1 (#1051).
 */
export async function requireAssignee(
  ctx: OperationContext,
  project: Project,
  memberIds: readonly string[],
  assigneeId: string
): Promise<Member> {
  const members = await ctx.db.listMembers(ctx.organizationId);
  const member = members.find((m) => m.userId === assigneeId);
  if (!member) throw new OperationError("invalid_input", "The assignee is not a Member of this Organization.");
  if (!canBeAssignee(member.role)) {
    throw new OperationError("invalid_input", "A Viewer cannot be assigned work. Make them an Editor first.");
  }
  if (!canReadProject(project, memberIds, { userId: member.userId, role: member.role })) {
    throw new OperationError("invalid_input", "The assignee cannot see this private Project. Add them to it first.");
  }
  return member;
}

// System writes ------------------------------------------------------------------

/** Records Work Activity as the caller (#1051): the Member, and the Teammate if one acted. */
export async function recordActivity(
  ctx: OperationContext,
  projectId: string,
  entries: { verb: WorkActivityVerb; taskId?: string | null; data?: WorkActivityData }[]
): Promise<void> {
  if (!entries.length) return;
  const rows: WorkActivityEntry[] = entries.map((entry) => ({
    organizationId: ctx.organizationId,
    projectId,
    taskId: entry.taskId ?? null,
    actorMemberId: ctx.userId || null,
    actorTeammateId: ctx.teammate?.id ?? null,
    verb: entry.verb,
    data: entry.data ?? {},
  }));
  if (ctx.ports?.workLog) {
    await ctx.ports.workLog.recordActivity(rows);
    return;
  }
  for (const row of rows) await ctx.db.table("workActivity").insert(row);
}

/** What an activity entry keeps of a Task, so a deleted one still reads. */
export function taskSnapshot(task: Task, project: Pick<Project, "key">): WorkActivityData {
  return { taskKey: taskKey(project.key, task.seq), taskTitle: task.title };
}

/**
 * Raises the Member Notifications an event calls for (#1048). Recipients who
 * left the Organization, or who cannot see a private Project, get nothing.
 */
export async function notifyWork(
  ctx: OperationContext,
  task: Pick<Task, "id" | "projectId">,
  project: Project,
  memberIds: readonly string[],
  events: WorkNotificationEvent[]
): Promise<void> {
  if (!events.length) return;
  const members = await ctx.db.listMembers(ctx.organizationId);
  const roles = new Map(members.map((member) => [member.userId, member.role]));
  const canNotify = (userId: string) =>
    roles.has(userId) && canReadProject(project, memberIds, { userId, role: roles.get(userId) ?? null });
  const rows: WorkNotificationRow[] = [];
  for (const event of events) {
    for (const recipient of workNotificationRecipients(event, canNotify)) {
      if (rows.some((row) => row.recipientId === recipient.recipientId && row.kind === recipient.kind)) continue;
      rows.push({
        organizationId: ctx.organizationId,
        recipientId: recipient.recipientId,
        kind: recipient.kind,
        projectId: task.projectId,
        taskId: task.id,
        commentId: recipient.commentId,
        actorMemberId: ctx.userId || null,
        actorTeammateId: ctx.teammate?.id ?? null,
      });
    }
  }
  if (!rows.length) return;
  if (ctx.ports?.workLog) {
    await ctx.ports.workLog.notify(rows);
    return;
  }
  for (const row of rows) await ctx.db.table("memberNotifications").insert(row);
}

/** `YYYY-MM-DD` for today in UTC, the calendar the work dates are kept in. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
