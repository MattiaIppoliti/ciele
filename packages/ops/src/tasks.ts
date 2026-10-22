import { z } from "zod";
import type {
  Project,
  Task,
  TaskDependency,
  TaskInput,
  TaskPatch,
  WorkActivityData,
  WorkActivityVerb,
  WorkNotificationEvent,
} from "@agent-hub/core";
import {
  TASK_PRIORITIES,
  TASK_RECURRENCES,
  TASK_STATUSES,
  canNestUnder,
  improvementStatusAfterTasks,
  nextOccurrence,
  parseMentionTokens,
  rankBetween,
  ranksAfter,
  statusPatch,
  taskKey,
  wouldCreateCycle,
} from "@agent-hub/core";
import type { MutatedEntity } from "./entities";
import { OperationError, defineOperation, type OperationContext } from "./operation";
import {
  notifyWork,
  projectMemberIds,
  readableProjects,
  recordActivity,
  requireAssignee,
  requireReadableProject,
  requireReadableTask,
  requireWritableProject,
  requireWritableTask,
  taskSnapshot,
} from "./work-access";
import { removeFileObjects } from "./project-files";
import { isoDay as day, workId as id } from "./work-schemas";

/**
 * Tasks (#1049, #1062): a unit of work inside one Project.
 *
 * One `tasks.update` carries every field change, a move to another Project,
 * the label and dependency lists and a new place in the order, because each of
 * those is one gesture in the console and the side effects (Work Activity,
 * Member Notifications, the next copy of a recurring Task, an Improvement's
 * move to In Review) have to see the change whole to be right once.
 */

/** Where a Task goes in its Project's order: between the two it was dropped between. */
const positionSchema = z
  .object({ afterId: id.nullable().optional(), beforeId: id.nullable().optional() })
  .optional();

export const taskFieldsSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20000),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  assigneeMemberId: id.nullable(),
  /**
   * Refused rather than stripped (#1051): a Teammate is not an assignee in v1,
   * and a caller who sent one must hear so instead of getting a Task without it.
   */
  assigneeTeammateId: z.null({ message: "A Teammate cannot be assigned work yet. Assign a Member." }),
  startDate: day.nullable(),
  dueDate: day.nullable(),
  estimateMinutes: z.number().int().positive().max(100_000).nullable(),
  recurrence: z.enum(TASK_RECURRENCES).nullable(),
  improvementId: id.nullable(),
  parentId: id.nullable(),
});

const taskCreateSchema = taskFieldsSchema.partial().extend({
  projectId: id,
  title: z.string().trim().min(1).max(500),
  labelIds: z.array(id).max(50).optional(),
  position: positionSchema,
});

const taskUpdateSchema = z.object({
  id,
  patch: taskFieldsSchema.partial().optional(),
  /** Archive (true) or restore (false), the same rules as `tasks.archive`. */
  archived: z.boolean().optional(),
  /** Replaces the Task's Labels. */
  labelIds: z.array(id).max(50).optional(),
  /** Replaces the Tasks this one is blocked by. */
  blockedBy: z.array(id).max(100).optional(),
  /** A new place in the order. */
  position: positionSchema,
  /** Move to another Project: re-numbered there, dependencies dropped. */
  projectId: id.optional(),
});

export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;

/** The PATCH body on /api/v1 (#1069): the update without the id the path carries. */
export const taskUpdateBodySchema = taskUpdateSchema.omit({ id: true });

const taskEntities = (projectId: string | null, taskId?: string): MutatedEntity[] => [
  { kind: "taskList" },
  ...(projectId ? [{ kind: "project" as const, id: projectId }] : []),
  ...(taskId ? [{ kind: "task" as const, id: taskId }] : []),
];

/**
 * A write that can link, unlink or settle an Improvement (ADR-0027) changes
 * the board and the Improvement pages, which list their Tasks. Every page,
 * because the Improvement a Task stopped resolving is not in the input.
 */
const improvementEntities = (): MutatedEntity[] => [{ kind: "improvementList" }, { kind: "improvementTasks" }];

/**
 * Every Task insert: the caller's Organization, the next number in its
 * Project and the caller as its creator, so no path numbers or attributes a
 * Task on its own.
 */
export async function insertTask(
  ctx: OperationContext,
  fields: Omit<TaskInput, "organizationId" | "seq" | "createdBy">
): Promise<Task> {
  return ctx.db.table("tasks").insert({
    ...fields,
    organizationId: ctx.organizationId,
    seq: await ctx.db.nextTaskSeq(fields.projectId),
    createdBy: ctx.userId || null,
  });
}

// Ordering -----------------------------------------------------------------------

async function rankFor(
  ctx: OperationContext,
  projectId: string,
  position: { afterId?: string | null; beforeId?: string | null } | undefined,
  movingId?: string
): Promise<string> {
  const tasks = (await ctx.db.table("tasks").list({ projectId })).filter((t) => t.id !== movingId);
  const ranks = tasks.map((t) => t.rank).sort();
  const rankOf = (taskId: string | null | undefined) =>
    taskId ? (tasks.find((t) => t.id === taskId)?.rank ?? null) : null;
  let lo = rankOf(position?.afterId);
  let hi = rankOf(position?.beforeId);
  // A stale or duplicated pair falls back to "right after `afterId`".
  if (lo !== null && hi !== null && lo >= hi) hi = null;
  if (lo !== null && hi === null) hi = ranks.find((rank) => rank > lo!) ?? null;
  if (lo === null && hi !== null) lo = [...ranks].reverse().find((rank) => rank < hi!) ?? null;
  if (lo === null && hi === null) lo = ranks.at(-1) ?? null;
  return rankBetween(lo, hi);
}

// Validation helpers ---------------------------------------------------------------

async function validLabelIds(ctx: OperationContext, ids: readonly string[]): Promise<string[]> {
  const labels = await ctx.db.table("taskLabels").list({ organizationId: ctx.organizationId });
  const known = new Set(labels.map((label) => label.id));
  const unique = [...new Set(ids)];
  const unknown = unique.filter((labelId) => !known.has(labelId));
  if (unknown.length) throw new OperationError("invalid_input", "Unknown label.");
  return unique;
}

async function requireImprovementInOrg(ctx: OperationContext, improvementId: string) {
  const improvement = await ctx.db.getImprovement(improvementId);
  if (!improvement || improvement.organizationId !== ctx.organizationId) {
    throw new OperationError("invalid_input", "That Improvement does not exist.");
  }
  return improvement;
}

/** A due date moved before the start pulls the start back with it, and the other way round. */
function reconcileDates(
  before: Pick<Task, "startDate" | "dueDate">,
  patch: Pick<TaskPatch, "startDate" | "dueDate">
): Pick<TaskPatch, "startDate" | "dueDate"> {
  const start = patch.startDate !== undefined ? patch.startDate : before.startDate;
  const due = patch.dueDate !== undefined ? patch.dueDate : before.dueDate;
  if (!start || !due || start <= due) return patch;
  if (patch.dueDate !== undefined) return { ...patch, startDate: patch.dueDate };
  return { ...patch, dueDate: patch.startDate };
}

async function setLabels(ctx: OperationContext, task: Task, labelIds: readonly string[]): Promise<boolean> {
  const wanted = await validLabelIds(ctx, labelIds);
  const current = await ctx.db.table("taskLabelLinks").list({ taskId: task.id });
  const have = new Set(current.map((link) => link.labelId));
  let changed = false;
  for (const link of current) {
    if (!wanted.includes(link.labelId)) {
      await ctx.db.table("taskLabelLinks").delete(link.id);
      changed = true;
    }
  }
  for (const labelId of wanted) {
    if (have.has(labelId)) continue;
    await ctx.db.table("taskLabelLinks").insert({
      organizationId: ctx.organizationId,
      projectId: task.projectId,
      taskId: task.id,
      labelId,
    });
    changed = true;
  }
  return changed;
}

async function setBlockedBy(ctx: OperationContext, task: Task, blockedBy: readonly string[]): Promise<boolean> {
  const wanted = [...new Set(blockedBy)];
  const edges = await ctx.db.table("taskDependencies").list({ projectId: task.projectId });
  const mine = edges.filter((edge) => edge.taskId === task.id);
  const others = edges.filter((edge) => edge.taskId !== task.id);
  let changed = false;
  for (const edge of mine) {
    if (!wanted.includes(edge.blockedById)) {
      await ctx.db.table("taskDependencies").delete(edge.id);
      changed = true;
    }
  }
  const kept: Pick<TaskDependency, "taskId" | "blockedById">[] = [
    ...others,
    ...mine.filter((edge) => wanted.includes(edge.blockedById)),
  ];
  for (const blockerId of wanted) {
    if (mine.some((edge) => edge.blockedById === blockerId)) continue;
    const blocker = await ctx.db.table("tasks").get(blockerId);
    if (!blocker || blocker.projectId !== task.projectId) {
      throw new OperationError("invalid_input", "A Task can only be blocked by another Task in its Project.");
    }
    if (wouldCreateCycle(kept, task.id, blockerId)) {
      throw new OperationError("invalid_input", `That would make a loop: ${blocker.title} already waits on this Task.`);
    }
    await ctx.db.table("taskDependencies").insert({
      organizationId: ctx.organizationId,
      projectId: task.projectId,
      taskId: task.id,
      blockedById: blockerId,
    });
    kept.push({ taskId: task.id, blockedById: blockerId });
    changed = true;
  }
  return changed;
}

/**
 * ADR-0027 rule 3, run after any status change, link or delete of a Task that
 * resolves an Improvement. On the system Db through the port: the move is not
 * the caller's Improvement write (an Editor-only one) but a consequence of
 * their Task write, and "every linked Task" includes the ones in private
 * Projects they cannot read. Recorded on the Task that caused it.
 */
async function settleImprovement(
  ctx: OperationContext,
  improvementId: string | null,
  cause: { task: Task; project: Project; deleted?: boolean }
): Promise<void> {
  if (!improvementId) return;
  const port = ctx.ports?.improvementSettlement;
  const found = port ? await port.read(improvementId) : await readImprovementLinks(ctx, improvementId);
  if (!found) return;
  const next = improvementStatusAfterTasks(found.improvement.status, found.linkedTasks);
  if (!next) return;
  if (port) await port.setStatus(improvementId, next);
  else await ctx.db.updateImprovement(improvementId, { status: next });
  await recordActivity(ctx, cause.project.id, [
    {
      verb: "improvement.review",
      taskId: cause.deleted ? null : cause.task.id,
      data: {
        ...taskSnapshot(cause.task, cause.project),
        improvementKey: `IMP-${found.improvement.seq}`,
        improvementTitle: found.improvement.title,
        from: found.improvement.status,
        to: next,
      },
    },
  ]);
}

/** The port's read, through the operation's own Db, where no host provides one. */
async function readImprovementLinks(ctx: OperationContext, improvementId: string) {
  const improvement = await ctx.db.getImprovement(improvementId);
  if (!improvement || improvement.organizationId !== ctx.organizationId) return null;
  return { improvement, linkedTasks: await ctx.db.table("tasks").list({ improvementId }) };
}

// Reads ---------------------------------------------------------------------------

export interface TaskDetail {
  task: Task;
  project: Project;
  subtasks: Task[];
  parent: Task | null;
  labelIds: string[];
  /** The Tasks this one waits on. */
  blockedBy: Task[];
  /** The Tasks waiting on this one. */
  blocking: Task[];
  improvement: { id: string; seq: number; title: string; status: string } | null;
  /** A private Project's Members (empty for an Organization-wide one), for who can be mentioned. */
  memberIds: string[];
}

export const getTaskOp = defineOperation({
  name: "tasks.get",
  capability: "member",
  effect: "read",
  input: z.object({ id }),
  entities: () => [],
  run: async (ctx, input): Promise<TaskDetail> => {
    const { task, project, memberIds } = await requireReadableTask(ctx, input.id);
    const [projectTasks, links, edges, improvement] = await Promise.all([
      ctx.db.table("tasks").list({ projectId: project.id }, { orderBy: "rank", ascending: true }),
      ctx.db.table("taskLabelLinks").list({ taskId: task.id }),
      ctx.db.table("taskDependencies").list({ projectId: project.id }),
      task.improvementId ? ctx.db.getImprovement(task.improvementId) : Promise.resolve(null),
    ]);
    const byId = new Map(projectTasks.map((t) => [t.id, t]));
    return {
      task,
      project,
      subtasks: projectTasks.filter((t) => t.parentId === task.id),
      parent: task.parentId ? (byId.get(task.parentId) ?? null) : null,
      labelIds: links.map((link) => link.labelId),
      blockedBy: edges.filter((e) => e.taskId === task.id).flatMap((e) => byId.get(e.blockedById) ?? []),
      blocking: edges.filter((e) => e.blockedById === task.id).flatMap((e) => byId.get(e.taskId) ?? []),
      improvement:
        improvement && improvement.organizationId === ctx.organizationId
          ? { id: improvement.id, seq: improvement.seq, title: improvement.title, status: improvement.status }
          : null,
      memberIds: [...memberIds],
    };
  },
});

// Create ---------------------------------------------------------------------------

export const createTaskOp = defineOperation({
  name: "tasks.create",
  capability: "edit",
  effect: "write",
  input: taskCreateSchema,
  entities: (input, result: Task) => [
    ...taskEntities(input.projectId, result.id),
    ...(input.improvementId ? improvementEntities() : []),
  ],
  run: async (ctx, input): Promise<Task> => {
    const { project, memberIds } = await requireWritableProject(ctx, input.projectId);
    const parent = input.parentId ? await ctx.db.table("tasks").get(input.parentId) : null;
    if (input.parentId && (!parent || !canNestUnder(parent, { projectId: project.id }, false))) {
      throw new OperationError("invalid_input", "A subtask's parent must be a top-level Task in the same Project.");
    }
    if (input.assigneeMemberId) await requireAssignee(ctx, project, memberIds, input.assigneeMemberId);
    if (input.improvementId) await requireImprovementInOrg(ctx, input.improvementId);
    const dates = reconcileDates({ startDate: null, dueDate: null }, {
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
    });
    const status = input.status ?? "to_do";
    const now = new Date().toISOString();
    const task = await insertTask(ctx, {
      projectId: project.id,
      parentId: input.parentId ?? null,
      title: input.title,
      description: input.description ?? "",
      status,
      priority: input.priority ?? "none",
      assigneeMemberId: input.assigneeMemberId ?? null,
      startDate: dates.startDate ?? null,
      dueDate: dates.dueDate ?? null,
      estimateMinutes: input.estimateMinutes ?? null,
      recurrence: input.recurrence ?? null,
      rank: await rankFor(ctx, project.id, input.position),
      improvementId: input.improvementId ?? null,
      completedAt: statusPatch(status, now).completedAt,
    });
    if (input.labelIds?.length) await setLabels(ctx, task, input.labelIds);
    await recordActivity(ctx, project.id, [
      parent
        ? {
            // Recorded on the parent, which is where a reader looks for it.
            verb: "subtask.added",
            taskId: parent.id,
            data: { ...taskSnapshot(parent, project), subtaskId: task.id, subtaskTitle: task.title },
          }
        : { verb: "task.created", taskId: task.id, data: taskSnapshot(task, project) },
    ]);
    const events: WorkNotificationEvent[] = [];
    if (task.assigneeMemberId) {
      events.push({
        kind: "assigned",
        actorId: ctx.userId || null,
        assigneeId: task.assigneeMemberId,
        previousAssigneeId: null,
      });
    }
    const mentions = parseMentionTokens(task.description);
    if (mentions.length) events.push({ kind: "described", actorId: ctx.userId || null, addedMentions: mentions });
    await notifyWork(ctx, task, project, memberIds, events);
    // Linking an unfinished Task never moves an Improvement; linking a done one can.
    if (task.status === "done") await settleImprovement(ctx, task.improvementId, { task, project });
    return task;
  },
});

// Update ---------------------------------------------------------------------------

const ACTIVITY_FOR: Partial<Record<keyof TaskPatch, WorkActivityVerb>> = {
  title: "task.renamed",
  description: "task.description",
  priority: "task.priority",
  assigneeMemberId: "task.assigned",
  dueDate: "task.due",
  startDate: "task.start",
  estimateMinutes: "task.estimate",
  recurrence: "task.recurrence",
  improvementId: "task.improvement",
};

/** Creates the next copy of a recurring Task that was just completed (#1049). */
async function spawnNextOccurrence(ctx: OperationContext, task: Task, project: Project): Promise<Task | null> {
  const next = nextOccurrence(task);
  if (!next || task.parentId) return null;
  const copy = await insertTask(ctx, {
    projectId: task.projectId,
    title: task.title,
    description: task.description,
    status: "to_do",
    priority: task.priority,
    assigneeMemberId: task.assigneeMemberId,
    startDate: next.startDate,
    dueDate: next.dueDate,
    estimateMinutes: task.estimateMinutes,
    recurrence: task.recurrence,
    rank: rankBetween(task.rank, null),
    improvementId: null,
  });
  const [links, subtasks] = await Promise.all([
    ctx.db.table("taskLabelLinks").list({ taskId: task.id }),
    ctx.db.table("tasks").list({ parentId: task.id }, { orderBy: "rank", ascending: true }),
  ]);
  await setLabels(ctx, copy, links.map((link) => link.labelId));
  const subtaskRanks = ranksAfter(copy.rank, subtasks.length);
  for (const [index, sub] of subtasks.filter((s) => !s.archivedAt).entries()) {
    await insertTask(ctx, {
      projectId: task.projectId,
      parentId: copy.id,
      title: sub.title,
      description: sub.description,
      priority: sub.priority,
      assigneeMemberId: sub.assigneeMemberId,
      rank: subtaskRanks[index]!,
    });
  }
  // The completed one stops recurring, so reopening and completing it again
  // cannot schedule a second copy.
  await ctx.db.table("tasks").update(task.id, { recurrence: null });
  await recordActivity(ctx, project.id, [
    { verb: "task.created", taskId: copy.id, data: { ...taskSnapshot(copy, project), recurrenceOf: task.id } },
  ]);
  return copy;
}

/** Moves a Task (and its subtasks) to another Project, re-numbered there. */
async function moveTask(
  ctx: OperationContext,
  task: Task,
  from: Project,
  to: Project
): Promise<TaskPatch> {
  const edges = await ctx.db.table("taskDependencies").list({ projectId: from.id });
  const subtasks = await ctx.db.table("tasks").list({ parentId: task.id });
  const moving = new Set([task.id, ...subtasks.map((s) => s.id)]);
  for (const edge of edges) {
    if (moving.has(edge.taskId) || moving.has(edge.blockedById)) {
      await ctx.db.table("taskDependencies").delete(edge.id);
    }
  }
  const rank = await rankFor(ctx, to.id, undefined);
  // A subtask moved on its own becomes a Task in its new Project.
  const moved: TaskPatch = { projectId: to.id, seq: await ctx.db.nextTaskSeq(to.id), rank, parentId: null };
  // The parent goes first: `enforce_task_parent_same_project` checks each row
  // against its parent's Project, so a subtask written before its parent has
  // moved is refused.
  await ctx.db.table("tasks").update(task.id, moved);
  const childRanks = ranksAfter(rank, subtasks.length);
  for (const [index, sub] of subtasks.entries()) {
    await ctx.db.table("tasks").update(sub.id, {
      projectId: to.id,
      seq: await ctx.db.nextTaskSeq(to.id),
      rank: childRanks[index]!,
    });
  }
  return moved;
}

export const updateTaskOp = defineOperation({
  name: "tasks.update",
  capability: "edit",
  effect: "write",
  input: taskUpdateSchema,
  entities: (input, result: Task) => [
    ...taskEntities(result.projectId, result.id),
    ...(input.projectId ? [{ kind: "project" as const, id: input.projectId }] : []),
    ...(input.patch?.status !== undefined || input.patch?.improvementId !== undefined
      ? improvementEntities()
      : []),
  ],
  run: async (ctx, input): Promise<Task> => {
    if (input.archived !== undefined) {
      // One gesture on the API: the archive rules, then any other change.
      await archiveTaskOp.run(ctx, { id: input.id, archived: input.archived });
      const rest = { ...input, archived: undefined };
      if (!rest.patch && !rest.labelIds && !rest.blockedBy && !rest.position && !rest.projectId) {
        return (await requireReadableTask(ctx, input.id)).task;
      }
      return updateTaskOp.run(ctx, rest);
    }
    const { task: before, project, memberIds } = await requireWritableTask(ctx, input.id);
    const now = new Date().toISOString();
    let patch: TaskPatch = { ...(input.patch ?? {}) };
    const activity: { verb: WorkActivityVerb; taskId?: string | null; data?: WorkActivityData }[] = [];
    const snapshot = taskSnapshot(before, project);

    // Status: the completion timestamp follows it, both ways.
    if (patch.status !== undefined && patch.status !== before.status) {
      Object.assign(patch, statusPatch(patch.status, now));
      activity.push({
        verb: patch.status === "done" ? "task.completed" : before.status === "done" ? "task.reopened" : "task.status",
        taskId: before.id,
        data: { ...snapshot, from: before.status, to: patch.status },
      });
    } else {
      delete patch.status;
    }

    if (patch.assigneeMemberId) await requireAssignee(ctx, project, memberIds, patch.assigneeMemberId);
    if (patch.improvementId) await requireImprovementInOrg(ctx, patch.improvementId);
    if (patch.title !== undefined) patch.title = patch.title.trim();
    patch = { ...patch, ...reconcileDates(before, patch) };

    // Nesting: one level, same Project.
    if (patch.parentId !== undefined && patch.parentId !== before.parentId) {
      if (patch.parentId !== null) {
        const parent = await ctx.db.table("tasks").get(patch.parentId);
        const hasSubtasks = (await ctx.db.table("tasks").count({ parentId: before.id })) > 0;
        if (!parent || !canNestUnder(parent, before, hasSubtasks)) {
          throw new OperationError("invalid_input", "A subtask's parent must be a top-level Task in the same Project, and a Task with subtasks cannot become one.");
        }
      } else {
        activity.push({ verb: "subtask.converted", taskId: before.id, data: snapshot });
      }
    }

    // Moving to another Project.
    let target = project;
    if (input.projectId && input.projectId !== before.projectId) {
      ({ project: target } = await requireWritableProject(ctx, input.projectId));
      if (target.status === "completed") {
        throw new OperationError("invalid_input", "That Project is completed. Pick an open one.");
      }
      patch = { ...patch, ...(await moveTask(ctx, before, project, target)) };
      activity.push({
        verb: "task.moved",
        taskId: before.id,
        data: { ...snapshot, fromProject: project.name, toProject: target.name, newKey: taskKey(target.key, patch.seq!) },
      });
    } else if (input.position) {
      patch.rank = await rankFor(ctx, before.projectId, input.position, before.id);
    }

    for (const [field, verb] of Object.entries(ACTIVITY_FOR) as [keyof TaskPatch, WorkActivityVerb][]) {
      if (patch[field] === undefined || patch[field] === before[field]) continue;
      activity.push({
        verb,
        taskId: before.id,
        data: {
          ...snapshot,
          from: field === "description" ? null : ((before[field] as string | number | null) ?? null),
          to: field === "description" ? null : ((patch[field] as string | number | null) ?? null),
        },
      });
    }

    const changed = Object.keys(patch).length > 0;
    const task = changed ? await ctx.db.table("tasks").update(before.id, patch) : before;

    if (input.labelIds && (await setLabels(ctx, task, input.labelIds))) {
      activity.push({ verb: "task.labels", taskId: task.id, data: { ...snapshot, labelIds: input.labelIds } });
    }
    if (input.blockedBy && (await setBlockedBy(ctx, task, input.blockedBy))) {
      activity.push({ verb: "task.dependencies", taskId: task.id, data: { ...snapshot, blockedBy: input.blockedBy } });
    }
    await recordActivity(ctx, target.id, activity);

    // Notifications: assignment, status, newly mentioned in the description.
    const events: WorkNotificationEvent[] = [];
    const actorId = ctx.userId || null;
    if (patch.assigneeMemberId !== undefined && patch.assigneeMemberId !== before.assigneeMemberId) {
      events.push({
        kind: "assigned",
        actorId,
        assigneeId: patch.assigneeMemberId,
        previousAssigneeId: before.assigneeMemberId,
      });
    }
    if (patch.status !== undefined) {
      events.push({ kind: "status_changed", actorId, from: before.status, to: patch.status, task });
    }
    if (patch.description !== undefined) {
      const was = new Set(parseMentionTokens(before.description));
      const added = parseMentionTokens(patch.description).filter((member) => !was.has(member));
      if (added.length) events.push({ kind: "described", actorId, addedMentions: added });
    }
    const targetMembers = target.id === project.id ? memberIds : await projectMemberIds(ctx, target.id);
    await notifyWork(ctx, task, target, targetMembers, events);

    if (patch.status === "done" && before.status !== "done" && task.recurrence) {
      await spawnNextOccurrence(ctx, task, target);
    }
    if (patch.status !== undefined || patch.improvementId) {
      await settleImprovement(ctx, task.improvementId, { task, project: target });
    }
    // The Improvement this Task stopped resolving may now have only done Tasks.
    if (patch.improvementId !== undefined && before.improvementId && before.improvementId !== task.improvementId) {
      await settleImprovement(ctx, before.improvementId, { task, project: target });
    }
    return task;
  },
});

export const bulkUpdateTasksOp = defineOperation({
  name: "tasks.bulkUpdate",
  capability: "edit",
  effect: "write",
  input: z.object({
    ids: z.array(id).min(1).max(200),
    patch: taskFieldsSchema.pick({ status: true, priority: true, assigneeMemberId: true, dueDate: true }).partial(),
  }),
  entities: (input) => [
    { kind: "taskList" as const },
    { kind: "projectList" as const },
    ...(input.patch.status !== undefined ? improvementEntities() : []),
  ],
  run: async (ctx, input): Promise<Task[]> => {
    const updated: Task[] = [];
    for (const taskId of input.ids) {
      updated.push(await updateTaskOp.run(ctx, { id: taskId, patch: input.patch }));
    }
    return updated;
  },
});

/**
 * The copy a recurring Task's completion scheduled (#1049), found by the
 * activity entry that records it, so a same-titled Task someone created by
 * hand is never mistaken for it.
 */
async function scheduledCopyOf(ctx: OperationContext, task: Task): Promise<Task | null> {
  if (!task.completedAt) return null;
  const candidates = (await ctx.db.table("tasks").list({ projectId: task.projectId })).filter(
    (other) => other.id !== task.id && !other.parentId && other.createdAt >= task.completedAt!
  );
  for (const candidate of candidates) {
    const entries = await ctx.db.table("workActivity").list({ taskId: candidate.id });
    if (entries.some((entry) => entry.verb === "task.created" && entry.data.recurrenceOf === task.id)) {
      return candidate;
    }
  }
  return null;
}

/**
 * The real inverse of completing a Task (#1074): back to the status it had
 * and, for a recurring one, the copy the completion scheduled removed again
 * and the recurrence put back on the original. A copy someone already moved
 * along is work by then, not a side effect, so it stays and only the status
 * goes back.
 */
export const undoCompleteTaskOp = defineOperation({
  name: "tasks.undoComplete",
  capability: "edit",
  effect: "write",
  input: z.object({ id, status: z.enum(TASK_STATUSES).exclude(["done"]) }),
  entities: (input, result: Task) => taskEntities(result.projectId, input.id),
  run: async (ctx, input): Promise<Task> => {
    const { task, project } = await requireWritableTask(ctx, input.id);
    if (task.status !== "done") return task;
    const copy = await scheduledCopyOf(ctx, task);
    const untouched = copy && copy.status === "to_do" && !copy.archivedAt;
    if (copy && untouched) {
      await ctx.db.table("tasks").delete(copy.id);
      await recordActivity(ctx, project.id, [
        { verb: "task.deleted", taskId: null, data: { ...taskSnapshot(copy, project), recurrenceOf: task.id } },
      ]);
    }
    return updateTaskOp.run(ctx, {
      id: task.id,
      patch: { status: input.status, ...(copy && untouched ? { recurrence: copy.recurrence } : {}) },
    });
  },
});

// Archive, restore, delete ------------------------------------------------------------

export const archiveTaskOp = defineOperation({
  name: "tasks.archive",
  capability: "edit",
  effect: "write",
  input: z.object({ id, archived: z.boolean() }),
  entities: (input, result: Task) => taskEntities(result.projectId, input.id),
  run: async (ctx, input): Promise<Task> => {
    const { task, project } = await requireWritableTask(ctx, input.id);
    const subtasks = await ctx.db.table("tasks").list({ parentId: task.id });
    if (input.archived) {
      if (task.archivedAt) return task;
      // A timestamp no subtask already carries, or restore could not tell the
      // ones archived with the parent from one archived on its own.
      let stamp = Date.now();
      while (subtasks.some((sub) => sub.archivedAt === new Date(stamp).toISOString())) stamp += 1;
      const at = new Date(stamp).toISOString();
      // The subtree goes with the same timestamp, so a restore brings back
      // exactly what this archive hid and not a subtask archived on its own.
      for (const sub of subtasks) if (!sub.archivedAt) await ctx.db.table("tasks").update(sub.id, { archivedAt: at });
      const archived = await ctx.db.table("tasks").update(task.id, { archivedAt: at });
      await recordActivity(ctx, project.id, [{ verb: "task.archived", taskId: task.id, data: taskSnapshot(task, project) }]);
      return archived;
    }
    if (!task.archivedAt) return task;
    if (task.parentId) {
      const parent = await ctx.db.table("tasks").get(task.parentId);
      if (parent?.archivedAt) throw new OperationError("invalid_input", "Restore its parent Task first.");
    }
    for (const sub of subtasks) {
      if (sub.archivedAt === task.archivedAt) await ctx.db.table("tasks").update(sub.id, { archivedAt: null });
    }
    const restored = await ctx.db.table("tasks").update(task.id, { archivedAt: null });
    await recordActivity(ctx, project.id, [{ verb: "task.restored", taskId: task.id, data: taskSnapshot(task, project) }]);
    return restored;
  },
});

export const deleteTaskOp = defineOperation({
  name: "tasks.delete",
  capability: "edit",
  effect: "consequential",
  input: z.object({ id }),
  entities: (input, result: { deleted: number; improvementId: string | null }) => [
    { kind: "taskList" as const },
    { kind: "projectList" as const },
    { kind: "task" as const, id: input.id },
    ...(result.improvementId ? improvementEntities() : []),
  ],
  run: async (ctx, input): Promise<{ deleted: number; improvementId: string | null }> => {
    const { task, project } = await requireWritableTask(ctx, input.id);
    const subtasks = await ctx.db.table("tasks").list({ parentId: task.id });
    // The rows cascade; the objects behind them are collected first (#1068).
    const files = (
      await Promise.all([task, ...subtasks].map((t) => ctx.db.table("projectFiles").list({ projectId: project.id, taskId: t.id })))
    ).flat();
    await ctx.db.table("tasks").delete(task.id);
    await removeFileObjects(ctx, files.map((file) => file.storagePath));
    await recordActivity(ctx, project.id, [
      { verb: "task.deleted", taskId: null, data: { ...taskSnapshot(task, project), subtasks: subtasks.length } },
    ]);
    await settleImprovement(ctx, task.improvementId, { task, project, deleted: true });
    return { deleted: 1 + subtasks.length, improvementId: task.improvementId };
  },
});

/** A page of Tasks and where the next one starts, the `/api/v1` list shape. */
export interface TaskPage {
  items: Task[];
  nextCursor: string | null;
}

/** The order a list is paged in: by Project, then as the board orders them. */
const listKey = (task: Pick<Task, "projectId" | "rank" | "id">): string => `${task.projectId}\u0000${task.rank}\u0000${task.id}`;

const encodeCursor = (task: Task): string => btoa(encodeURIComponent(listKey(task)));

function decodeCursor(cursor: string): string {
  try {
    return decodeURIComponent(atob(cursor));
  } catch {
    throw new OperationError("invalid_input", "That cursor is not one this list issued.");
  }
}

/**
 * Tasks for a machine caller (#1069, #1051): one Project's, or every readable
 * Project's, narrowed by assignee, status, Label, due range, text and the
 * Improvement they resolve. Subtasks are included (they are work too) and
 * archived ones only on request. Paged by an opaque cursor, in the board's
 * order: by Project, then by rank.
 */
export const listTasksOp = defineOperation({
  name: "tasks.list",
  capability: "member",
  effect: "read",
  input: z.object({
    projectId: id.optional(),
    assigneeMemberId: id.optional(),
    status: z.array(z.enum(TASK_STATUSES)).max(5).optional(),
    labelId: id.optional(),
    dueFrom: day.optional(),
    dueTo: day.optional(),
    /** Matched against the title and the description, case-insensitively. */
    q: z.string().trim().min(1).max(200).optional(),
    improvementId: id.optional(),
    includeArchived: z.boolean().optional(),
    limit: z.number().int().min(1).max(1000).optional(),
    cursor: z.string().min(1).max(2000).nullable().optional(),
  }),
  entities: () => [],
  run: async (ctx, input): Promise<TaskPage> => {
    const projectIds = input.projectId
      ? [(await requireReadableProject(ctx, input.projectId)).project.id]
      : (await readableProjects(ctx)).map((project) => project.id);
    const allowed = new Set(projectIds);
    const [rows, labelled] = await Promise.all([
      ctx.db
        .table("tasks")
        .list(input.projectId ? { projectId: input.projectId } : { organizationId: ctx.organizationId }),
      input.labelId
        ? ctx.db.table("taskLabelLinks").list({ organizationId: ctx.organizationId, labelId: input.labelId })
        : Promise.resolve(null),
    ]);
    const withLabel = labelled ? new Set(labelled.map((link) => link.taskId)) : null;
    const statuses = input.status ? new Set(input.status) : null;
    const text = input.q?.toLowerCase();
    const after = input.cursor ? decodeCursor(input.cursor) : null;
    const matching = rows
      .filter(
        (task) =>
          allowed.has(task.projectId) &&
          (input.includeArchived || !task.archivedAt) &&
          (!input.assigneeMemberId || task.assigneeMemberId === input.assigneeMemberId) &&
          (!statuses || statuses.has(task.status)) &&
          (!withLabel || withLabel.has(task.id)) &&
          (!input.dueFrom || (!!task.dueDate && task.dueDate >= input.dueFrom)) &&
          (!input.dueTo || (!!task.dueDate && task.dueDate <= input.dueTo)) &&
          (!input.improvementId || task.improvementId === input.improvementId) &&
          (!text || task.title.toLowerCase().includes(text) || task.description.toLowerCase().includes(text)) &&
          (!after || listKey(task) > after)
      )
      .sort((a, b) => (listKey(a) < listKey(b) ? -1 : listKey(a) > listKey(b) ? 1 : 0));
    const limit = input.limit ?? 500;
    const items = matching.slice(0, limit);
    return { items, nextCursor: matching.length > limit ? encodeCursor(items.at(-1)!) : null };
  },
});

/** Every Task of one Project, for the views; subtasks included, archived only on request. */
export async function listProjectTasks(
  ctx: OperationContext,
  projectId: string,
  { includeArchived = false }: { includeArchived?: boolean } = {}
): Promise<Task[]> {
  const tasks = await ctx.db.table("tasks").list({ projectId }, { orderBy: "rank", ascending: true });
  return includeArchived ? tasks : tasks.filter((task) => !task.archivedAt);
}
