import { z } from "zod";
import type {
  ImprovementPriority,
  ImprovementStatus,
  Project,
  ProjectMilestone,
  SavedView,
  Task,
  TaskDependency,
  TaskLabel,
  TaskLabelLink,
  WorkActivity,
  WorkFavorite,
} from "@agent-hub/core";
import { mentionTokensToText, projectProgress, visibleTeammates } from "@agent-hub/core";
import { defineOperation, type OperationContext } from "./operation";
import { readableProjects, requireReadableProject, requireReadableTask, workPerson, type WorkPerson } from "./work-access";
import { workId as id } from "./work-schemas";

/**
 * The reads the work views render from (#1050), one per scope so a page asks
 * once. Every one filters through the visibility rule first: a Task in a
 * private Project the caller is not on never leaves this module.
 */

/** Who and what every work view needs to name things. */
export interface WorkDirectory {
  people: WorkPerson[];
  /**
   * The Teammates the caller may see, retired ones too, so Work Activity can
   * say "Teammate for Member" by name (#1051). One the caller cannot see stays
   * "A Teammate".
   */
  teammates: { id: string; name: string }[];
  labels: TaskLabel[];
  /** Readable, not archived. */
  projects: Project[];
  favorites: WorkFavorite[];
}

export const workDirectoryOp = defineOperation({
  name: "work.directory",
  capability: "member",
  effect: "read",
  input: z.object({}),
  entities: () => [],
  run: async (ctx): Promise<WorkDirectory> => {
    const [members, teammates, labels, projects, favorites] = await Promise.all([
      ctx.db.listMembers(ctx.organizationId),
      ctx.db.table("teammates").list({ organizationId: ctx.organizationId }),
      ctx.db.table("taskLabels").list({ organizationId: ctx.organizationId }, { orderBy: "name", ascending: true }),
      readableProjects(ctx),
      ctx.userId
        ? ctx.db.table("workFavorites").list({ organizationId: ctx.organizationId, userId: ctx.userId })
        : Promise.resolve([]),
    ]);
    return {
      people: members.map(workPerson).sort((a, b) => a.name.localeCompare(b.name)),
      teammates: visibleTeammates(teammates, { userId: ctx.userId, role: ctx.role }).map((teammate) => ({
        id: teammate.id,
        name: teammate.name,
      })),
      labels,
      projects,
      favorites,
    };
  },
});

/** A set of Tasks plus what their views draw beside them. */
export interface TaskSet {
  tasks: Task[];
  labelLinks: TaskLabelLink[];
  dependencies: TaskDependency[];
}

async function taskSet(ctx: OperationContext, projectIds: readonly string[], keep: (task: Task) => boolean): Promise<TaskSet> {
  if (!projectIds.length) return { tasks: [], labelLinks: [], dependencies: [] };
  const allowed = new Set(projectIds);
  const single = projectIds.length === 1 ? projectIds[0]! : null;
  const filter = single ? { projectId: single } : { organizationId: ctx.organizationId };
  const [tasks, labelLinks, dependencies] = await Promise.all([
    ctx.db.table("tasks").list(filter, { orderBy: "rank", ascending: true }),
    ctx.db.table("taskLabelLinks").list(filter),
    ctx.db.table("taskDependencies").list(filter),
  ]);
  const kept = tasks.filter((task) => allowed.has(task.projectId) && keep(task));
  const ids = new Set(kept.map((task) => task.id));
  return {
    tasks: kept,
    labelLinks: labelLinks.filter((link) => ids.has(link.taskId)),
    dependencies: dependencies.filter((edge) => ids.has(edge.taskId) && ids.has(edge.blockedById)),
  };
}

export interface ProjectWorkspace extends TaskSet {
  project: Project;
  memberIds: string[];
  milestones: ProjectMilestone[];
  savedViews: SavedView[];
  progress: { done: number; total: number; percent: number };
  activity: WorkActivity[];
}

export const projectWorkspaceOp = defineOperation({
  name: "work.project",
  capability: "member",
  effect: "read",
  input: z.object({ id, includeArchived: z.boolean().optional() }),
  entities: () => [],
  run: async (ctx, input): Promise<ProjectWorkspace> => {
    const { project, memberIds } = await requireReadableProject(ctx, input.id);
    const [set, milestones, savedViews, activity] = await Promise.all([
      taskSet(ctx, [project.id], (task) => Boolean(input.includeArchived) || !task.archivedAt),
      ctx.db.table("projectMilestones").list({ projectId: project.id }, { orderBy: "date", ascending: true }),
      ctx.db.table("savedViews").list({ projectId: project.id }),
      ctx.db.table("workActivity").list({ projectId: project.id }, { limit: 50 }),
    ]);
    return {
      project,
      memberIds,
      milestones,
      savedViews,
      ...set,
      progress: projectProgress(set.tasks),
      activity: await withCommentExcerpts(ctx, activity),
    };
  },
});

/** An Improvement as My Tasks lists it (#1044): its own row, its own key. */
export interface AssignedImprovement {
  id: string;
  seq: number;
  title: string;
  status: ImprovementStatus;
  priority: ImprovementPriority;
  dueDate: string | null;
  projectId: string | null;
}

export interface MyTasks extends TaskSet {
  improvements: AssignedImprovement[];
}

export const myTasksOp = defineOperation({
  name: "work.myTasks",
  capability: "member",
  effect: "read",
  input: z.object({}),
  entities: () => [],
  run: async (ctx): Promise<MyTasks> => {
    const projects = await readableProjects(ctx);
    const set = await taskSet(
      ctx,
      projects.map((project) => project.id),
      (task) => !task.archivedAt && task.assigneeMemberId === ctx.userId
    );
    const improvements = ctx.userId ? await ctx.db.listImprovementsAssignedTo(ctx.organizationId, ctx.userId) : [];
    return {
      ...set,
      improvements: improvements
        .map((item) => ({
          id: item.id,
          seq: item.seq,
          title: item.title,
          status: item.status,
          priority: item.priority,
          dueDate: item.dueDate,
          projectId: item.projectId ?? null,
        })),
    };
  },
});

export const allTasksOp = defineOperation({
  name: "work.allTasks",
  capability: "member",
  effect: "read",
  input: z.object({}),
  entities: () => [],
  run: async (ctx): Promise<TaskSet & { milestones: ProjectMilestone[] }> => {
    const projects = await readableProjects(ctx);
    const ids = projects.map((project) => project.id);
    const [set, milestones] = await Promise.all([
      taskSet(ctx, ids, (task) => !task.archivedAt),
      ctx.db.table("projectMilestones").list({ organizationId: ctx.organizationId }, { orderBy: "date", ascending: true }),
    ]);
    const allowed = new Set(ids);
    return { ...set, milestones: milestones.filter((m) => allowed.has(m.projectId)) };
  },
});

/**
 * A comment entry reads its excerpt from the comment itself (#1055): the log
 * keeps only which comment, so an edit shows the new words and a deleted
 * comment drops out of Activity as it does from the thread, with no second
 * copy of its text left anywhere.
 */
async function withCommentExcerpts(ctx: OperationContext, entries: WorkActivity[]): Promise<WorkActivity[]> {
  const ids = [
    ...new Set(
      entries.flatMap((entry) =>
        entry.verb === "comment.added" && typeof entry.data.commentId === "string" ? [entry.data.commentId] : []
      )
    ),
  ];
  if (!ids.length) return entries;
  const found = await Promise.all(ids.map((commentId) => ctx.db.table("taskComments").get(commentId)));
  const live = new Map(found.flatMap((comment) => (comment && !comment.deletedAt ? [[comment.id, comment] as const] : [])));
  return entries.flatMap((entry) => {
    if (entry.verb !== "comment.added") return [entry];
    const comment = live.get(String(entry.data.commentId));
    if (!comment) return [];
    return [{ ...entry, data: { ...entry.data, excerpt: mentionTokensToText(comment.body).slice(0, 140) } }];
  });
}

export const workActivityOp = defineOperation({
  name: "work.activity",
  capability: "member",
  effect: "read",
  input: z.object({ projectId: id.optional(), taskId: id.optional(), limit: z.number().int().min(1).max(500).optional() }),
  entities: () => [],
  run: async (ctx, input): Promise<WorkActivity[]> => {
    if (input.taskId) {
      const { task } = await requireReadableTask(ctx, input.taskId);
      return withCommentExcerpts(ctx, await ctx.db.table("workActivity").list({ taskId: task.id }, { limit: input.limit ?? 200 }));
    }
    if (input.projectId) {
      await requireReadableProject(ctx, input.projectId);
      return withCommentExcerpts(
        ctx,
        await ctx.db.table("workActivity").list({ projectId: input.projectId }, { limit: input.limit ?? 200 })
      );
    }
    const visible = new Set((await readableProjects(ctx)).map((project) => project.id));
    const rows = await ctx.db
      .table("workActivity")
      .list({ organizationId: ctx.organizationId }, { limit: (input.limit ?? 100) * 3 });
    return withCommentExcerpts(ctx, rows.filter((row) => visible.has(row.projectId)).slice(0, input.limit ?? 100));
  },
});

/** What the Archive shows: archived Tasks and Projects the caller can see. */
export const workArchiveOp = defineOperation({
  name: "work.archive",
  capability: "member",
  effect: "read",
  input: z.object({}),
  entities: () => [],
  run: async (ctx): Promise<{ projects: Project[]; tasks: Task[] }> => {
    const projects = await readableProjects(ctx, { includeArchived: true });
    const live = projects.filter((project) => !project.archived).map((project) => project.id);
    const set = await taskSet(ctx, live, (task) => Boolean(task.archivedAt) && !task.parentId);
    return { projects: projects.filter((project) => project.archived), tasks: set.tasks };
  },
});
