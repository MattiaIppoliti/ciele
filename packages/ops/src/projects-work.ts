import { z } from "zod";
import type {
  Project,
  ProjectInput,
  ProjectMilestone,
  ProjectPatch,
  WorkActivityData,
  WorkActivityVerb,
} from "@agent-hub/core";
import {
  PROJECT_ICONS,
  PROJECT_KEY_PATTERN,
  PROJECT_STATUSES,
  WORK_COLORS,
  deriveProjectKey,
  ranksAfter,
} from "@agent-hub/core";
import { readWithHistory, type MemoryDocumentView } from "./memory";
import { OperationError, defineOperation, type OperationContext } from "./operation";
import { removeFileObjects } from "./project-files";
import { insertTask } from "./tasks";
import {
  readableProjects,
  recordActivity,
  requireReadableProject,
  requireWritableProject,
} from "./work-access";
import { isoDay as day, workId as id } from "./work-schemas";

/**
 * The Project as the container of the work (#1046): its own fields and its
 * lifecycle, who sits on a private one, its Milestones, and Duplicate. Its
 * decisions document is memory and lives in `memory.ts` (#771).
 */

/** The Project's own fields (#1046): what a create sets and a patch changes. */
const projectFieldsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000),
  key: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.string().regex(PROJECT_KEY_PATTERN, "2-5 letters or digits, starting with a letter")),
  status: z.enum(PROJECT_STATUSES),
  leadId: id.nullable(),
  startDate: day.nullable(),
  dueDate: day.nullable(),
  color: z.enum(WORK_COLORS),
  icon: z.enum(PROJECT_ICONS),
  visibility: z.enum(["organization", "private"]),
});

export const projectPatchSchema = projectFieldsSchema
  .extend({ archived: z.boolean() })
  .partial() satisfies z.ZodType<ProjectPatch, ProjectPatch>;

const keyTaken = (key: string) => new OperationError("conflict", `Another Project already uses the key ${key}.`);

/** Postgres' unique violation: on `projects`, the Organization's key is the only unique value a writer chooses. */
function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: unknown }).code === "23505";
}

/**
 * Inserts a Project under a key nobody in the Organization holds. The list the
 * caller can read leaves out private Projects they are not on, so a key that
 * looks free can still be taken. The unique constraint decides: a derived key
 * moves on to the next candidate, and a key the caller chose is refused with
 * the words a visible clash gets, so neither path says a hidden Project exists.
 */
async function insertProject(
  ctx: OperationContext,
  values: Omit<ProjectInput, "key">,
  chosen?: string
): Promise<Project> {
  const taken = (await ctx.db.table("projects").list({ organizationId: ctx.organizationId })).map((p) => p.key);
  if (chosen && taken.includes(chosen)) throw keyTaken(chosen);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const key = chosen ?? deriveProjectKey(values.name, taken);
    try {
      return await ctx.db.table("projects").insert({ ...values, key });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      if (chosen) throw keyTaken(chosen);
      taken.push(key);
    }
  }
  throw new OperationError("conflict", "No free key for this Project. Choose one.");
}

async function assertLead(ctx: OperationContext, leadId: string | null | undefined): Promise<void> {
  if (!leadId) return;
  const role = await ctx.db.getMemberRole(ctx.organizationId, leadId);
  if (!role) throw new OperationError("invalid_input", "The lead is not a Member of this Organization.");
}

function assertDates(start: string | null | undefined, due: string | null | undefined): void {
  if (start && due && start > due) {
    throw new OperationError("invalid_input", "The start date is after the target date.");
  }
}

/** Seats the caller on a private Project, so making it private never locks them out. */
async function seatCaller(ctx: OperationContext, projectId: string): Promise<void> {
  if (!ctx.userId) return;
  const seats = await ctx.db.table("projectMembers").list({ projectId });
  if (seats.some((seat) => seat.userId === ctx.userId)) return;
  await ctx.db.table("projectMembers").insert({
    organizationId: ctx.organizationId,
    projectId,
    userId: ctx.userId,
    addedBy: ctx.userId,
  });
}

// Lifecycle -----------------------------------------------------------------------

export const listProjectsOp = defineOperation({
  name: "projects.list",
  capability: "member",
  effect: "read",
  input: z.object({ includeArchived: z.boolean().optional() }),
  entities: () => [],
  // Only the Projects the caller can see (#1047): a private one does not exist
  // for a Member who is not on it.
  run: (ctx, input): Promise<Project[]> =>
    readableProjects(ctx, { includeArchived: input.includeArchived ?? true }),
});

export const getProjectOp = defineOperation({
  name: "projects.get",
  capability: "member",
  effect: "read",
  input: z.object({ id: z.string().min(1) }),
  entities: () => [],
  run: async (ctx, { id: projectId }): Promise<{ project: Project } & MemoryDocumentView> => {
    const { project } = await requireReadableProject(ctx, projectId);
    const document = await ctx.db.getMemoryDocument(ctx.organizationId, {
      scope: "project",
      projectId,
    });
    return { project, ...(await readWithHistory(ctx, document)) };
  },
});

export const createProjectOp = defineOperation({
  name: "projects.create",
  capability: "edit",
  effect: "write",
  input: projectFieldsSchema.partial().extend({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000).default(""),
  }),
  entities: () => [{ kind: "projectList" as const }, { kind: "taskList" as const }],
  run: async (ctx, input): Promise<Project> => {
    await assertLead(ctx, input.leadId);
    assertDates(input.startDate, input.dueDate);
    const project = await insertProject(
      ctx,
      {
        organizationId: ctx.organizationId,
        name: input.name,
        description: input.description,
        // The column's own default (#1046): a new Project is in progress.
        status: input.status ?? "active",
        leadId: input.leadId ?? null,
        startDate: input.startDate ?? null,
        dueDate: input.dueDate ?? null,
        color: input.color ?? "gray",
        icon: input.icon ?? "folder",
        visibility: input.visibility ?? "organization",
        createdBy: ctx.userId || null,
      },
      input.key
    );
    if (project.visibility === "private") await seatCaller(ctx, project.id);
    await recordActivity(ctx, project.id, [{ verb: "project.created", data: { name: project.name } }]);
    return project;
  },
});

export const updateProjectOp = defineOperation({
  name: "projects.update",
  capability: "edit",
  effect: "write",
  input: z.object({ id: z.string().min(1), patch: projectPatchSchema }),
  entities: ({ id: projectId }) => [
    { kind: "project" as const, id: projectId },
    { kind: "projectList" as const },
    { kind: "taskList" as const },
  ],
  run: async (ctx, { id: projectId, patch }): Promise<Project> => {
    const { project: before } = await requireWritableProject(ctx, projectId, { allowArchived: true });
    if (before.archived && patch.archived !== false && Object.keys(patch).some((k) => k !== "archived")) {
      throw new OperationError("invalid_input", "This Project is archived. Restore it to change it.");
    }
    if (patch.key && patch.key !== before.key) {
      const others = await ctx.db.table("projects").list({ organizationId: ctx.organizationId });
      if (others.some((other) => other.id !== projectId && other.key === patch.key)) throw keyTaken(patch.key);
    }
    if (patch.leadId !== undefined) await assertLead(ctx, patch.leadId);
    assertDates(
      patch.startDate !== undefined ? patch.startDate : before.startDate,
      patch.dueDate !== undefined ? patch.dueDate : before.dueDate
    );
    // Seat the caller before the row turns private, or the update's own read
    // back would be refused to them.
    if (patch.visibility === "private" && before.visibility !== "private") await seatCaller(ctx, projectId);
    let project: Project;
    try {
      project = await ctx.db.table("projects").update(projectId, patch);
    } catch (error) {
      // A clash with a Project the caller cannot see: the same refusal (`insertProject`).
      if (patch.key && isUniqueViolation(error)) throw keyTaken(patch.key);
      throw error;
    }
    const entries: { verb: WorkActivityVerb; data?: WorkActivityData }[] = [];
    if (patch.archived !== undefined && patch.archived !== before.archived) {
      entries.push({ verb: patch.archived ? "project.archived" : "project.restored" });
    }
    if (patch.status !== undefined && patch.status !== before.status) {
      entries.push({ verb: "project.status", data: { from: before.status, to: patch.status } });
    }
    const other = Object.keys(patch).filter((k) => k !== "archived" && k !== "status");
    if (other.length) entries.push({ verb: "project.updated", data: { fields: other } });
    await recordActivity(ctx, projectId, entries);
    return project;
  },
});

/** What deleting a Project takes with it, for the confirmation that names the counts (#1046). */
export const projectDeletionSummaryOp = defineOperation({
  name: "projects.deletionSummary",
  capability: "member",
  effect: "read",
  input: z.object({ id }),
  entities: () => [],
  run: async (ctx, input): Promise<{ tasks: number; files: number }> => {
    await requireReadableProject(ctx, input.id);
    const [tasks, files] = await Promise.all([
      ctx.db.table("tasks").count({ projectId: input.id }),
      ctx.db.table("projectFiles").count({ projectId: input.id }),
    ]);
    return { tasks, files };
  },
});

export const deleteProjectOp = defineOperation({
  name: "projects.delete",
  capability: "edit",
  effect: "consequential",
  input: z.object({ id: z.string().min(1) }),
  entities: ({ id: projectId }) => [
    { kind: "project" as const, id: projectId },
    { kind: "projectList" as const },
    { kind: "taskList" as const },
    // Every attached Teammate loses its Project layer next turn, and every
    // Improvement filed under it detaches.
    { kind: "teammateList" as const },
    { kind: "improvementList" as const },
  ],
  run: async (ctx, { id: projectId }): Promise<{ tasks: number }> => {
    await requireWritableProject(ctx, projectId, { allowArchived: true });
    const tasks = await ctx.db.table("tasks").count({ projectId });
    const files = await ctx.db.table("projectFiles").list({ projectId });
    // The work goes with it (#1046): Tasks, files, milestones, Saved Views and
    // the decisions cascade; Teammates, Channels and Improvements detach. That
    // is why the console offers archiving first.
    await ctx.db.table("projects").delete(projectId);
    await removeFileObjects(ctx, files.map((file) => file.storagePath));
    return { tasks };
  },
});

// Members and Milestones ------------------------------------------------------------

export const listProjectMembersOp = defineOperation({
  name: "projects.members.list",
  capability: "member",
  effect: "read",
  input: z.object({ id }),
  entities: () => [],
  run: async (ctx, input): Promise<string[]> => (await requireReadableProject(ctx, input.id)).memberIds,
});

/**
 * Replaces who sits on a Project. Meaningful for a private one (#1047); an
 * org-visible Project keeps the list so turning it private later keeps it.
 * Never empty, and only Members of the Organization.
 */
export const setProjectMembersOp = defineOperation({
  name: "projects.members.set",
  capability: "edit",
  effect: "consequential",
  input: z.object({ id, userIds: z.array(z.string().min(1).max(64)).min(1).max(500) }),
  entities: ({ id: projectId }) => [
    { kind: "project" as const, id: projectId },
    { kind: "projectList" as const },
    { kind: "taskList" as const },
  ],
  run: async (ctx, input): Promise<string[]> => {
    await requireWritableProject(ctx, input.id);
    const members = await ctx.db.listMembers(ctx.organizationId);
    const known = new Set(members.map((member) => member.userId));
    const wanted = [...new Set(input.userIds)];
    if (wanted.some((userId) => !known.has(userId))) {
      throw new OperationError("invalid_input", "Everyone on a Project must be a Member of the Organization.");
    }
    const seats = await ctx.db.table("projectMembers").list({ projectId: input.id });
    for (const seat of seats) {
      if (!wanted.includes(seat.userId)) await ctx.db.table("projectMembers").delete(seat.id);
    }
    const have = new Set(seats.map((seat) => seat.userId));
    for (const userId of wanted) {
      if (have.has(userId)) continue;
      await ctx.db.table("projectMembers").insert({
        organizationId: ctx.organizationId,
        projectId: input.id,
        userId,
        addedBy: ctx.userId || null,
      });
    }
    await recordActivity(ctx, input.id, [{ verb: "project.members", data: { count: wanted.length } }]);
    return wanted;
  },
});

export const listMilestonesOp = defineOperation({
  name: "projects.milestones.list",
  capability: "member",
  effect: "read",
  input: z.object({ id }),
  entities: () => [],
  run: async (ctx, input): Promise<ProjectMilestone[]> => {
    await requireReadableProject(ctx, input.id);
    return ctx.db.table("projectMilestones").list({ projectId: input.id }, { orderBy: "date", ascending: true });
  },
});

const milestonesSchema = z
  .array(z.object({ id: id.optional(), name: z.string().trim().min(1).max(200), date: day }))
  .max(100);

/** The PUT body on /api/v1 (#1069). */
export const milestonesBodySchema = z.object({ milestones: milestonesSchema });

/** Replaces the Milestone list: rows with an id are kept and edited, the rest created. */
export const setMilestonesOp = defineOperation({
  name: "projects.milestones.set",
  capability: "edit",
  effect: "write",
  input: z.object({ id, milestones: milestonesSchema }),
  entities: ({ id: projectId }) => [{ kind: "project" as const, id: projectId }, { kind: "taskList" as const }],
  run: async (ctx, input): Promise<ProjectMilestone[]> => {
    await requireWritableProject(ctx, input.id);
    const current = await ctx.db.table("projectMilestones").list({ projectId: input.id });
    const keep = new Set(input.milestones.flatMap((m) => (m.id ? [m.id] : [])));
    for (const row of current) if (!keep.has(row.id)) await ctx.db.table("projectMilestones").delete(row.id);
    for (const milestone of input.milestones) {
      const existing = milestone.id ? current.find((row) => row.id === milestone.id) : undefined;
      if (existing) {
        if (existing.name !== milestone.name || existing.date !== milestone.date) {
          await ctx.db.table("projectMilestones").update(existing.id, { name: milestone.name, date: milestone.date });
        }
      } else {
        await ctx.db.table("projectMilestones").insert({
          organizationId: ctx.organizationId,
          projectId: input.id,
          name: milestone.name,
          date: milestone.date,
        });
      }
    }
    await recordActivity(ctx, input.id, [{ verb: "project.milestones", data: { count: input.milestones.length } }]);
    return ctx.db.table("projectMilestones").list({ projectId: input.id }, { orderBy: "date", ascending: true });
  },
});

/**
 * Duplicate (#1046): "<name> copy" with a fresh key, the same fields (its
 * status too), members
 * and Milestones, and every live Task copied as To do with no assignee and no
 * dates (subtasks, labels, estimates and dependencies kept). Comments, files,
 * activity, Saved Views and the decisions document stay with the original.
 */
export const duplicateProjectOp = defineOperation({
  name: "projects.duplicate",
  capability: "edit",
  effect: "write",
  input: z.object({ id }),
  entities: () => [{ kind: "projectList" as const }, { kind: "taskList" as const }],
  run: async (ctx, input): Promise<Project> => {
    const { project: source, memberIds } = await requireReadableProject(ctx, input.id);
    const copy = await insertProject(ctx, {
      organizationId: ctx.organizationId,
      name: `${source.name} copy`.slice(0, 120),
      description: source.description,
      status: source.status,
      leadId: source.leadId,
      startDate: source.startDate,
      dueDate: source.dueDate,
      color: source.color,
      icon: source.icon,
      visibility: source.visibility,
      createdBy: ctx.userId || null,
    });
    const seatIds = new Set(memberIds);
    if (source.visibility === "private" && ctx.userId) seatIds.add(ctx.userId);
    for (const userId of seatIds) {
      await ctx.db.table("projectMembers").insert({
        organizationId: ctx.organizationId,
        projectId: copy.id,
        userId,
        addedBy: ctx.userId || null,
      });
    }
    for (const milestone of await ctx.db.table("projectMilestones").list({ projectId: source.id })) {
      await ctx.db.table("projectMilestones").insert({
        organizationId: ctx.organizationId,
        projectId: copy.id,
        name: milestone.name,
        date: milestone.date,
      });
    }

    const tasks = (await ctx.db.table("tasks").list({ projectId: source.id }, { orderBy: "rank", ascending: true }))
      .filter((task) => !task.archivedAt);
    const ranks = ranksAfter(null, tasks.length);
    const newId = new Map<string, string>();
    // Parents before their subtasks, so a subtask's parent already exists.
    const ordered = [...tasks.filter((t) => !t.parentId), ...tasks.filter((t) => t.parentId)];
    for (const task of ordered) {
      if (task.parentId && !newId.has(task.parentId)) continue;
      const created = await insertTask(ctx, {
        projectId: copy.id,
        parentId: task.parentId ? newId.get(task.parentId)! : null,
        title: task.title,
        description: task.description,
        status: "to_do",
        priority: task.priority,
        estimateMinutes: task.estimateMinutes,
        recurrence: task.recurrence,
        rank: ranks[tasks.indexOf(task)]!,
      });
      newId.set(task.id, created.id);
    }
    for (const link of await ctx.db.table("taskLabelLinks").list({ projectId: source.id })) {
      const taskId = newId.get(link.taskId);
      if (!taskId) continue;
      await ctx.db.table("taskLabelLinks").insert({
        organizationId: ctx.organizationId,
        projectId: copy.id,
        taskId,
        labelId: link.labelId,
      });
    }
    for (const edge of await ctx.db.table("taskDependencies").list({ projectId: source.id })) {
      const taskId = newId.get(edge.taskId);
      const blockedById = newId.get(edge.blockedById);
      if (!taskId || !blockedById) continue;
      await ctx.db.table("taskDependencies").insert({
        organizationId: ctx.organizationId,
        projectId: copy.id,
        taskId,
        blockedById,
      });
    }
    await recordActivity(ctx, copy.id, [{ verb: "project.created", data: { name: copy.name, duplicateOf: source.name } }]);
    return copy;
  },
});
