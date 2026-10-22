import { z } from "zod";
import type { SavedView, WorkFavorite } from "@agent-hub/core";
import { WORK_LAYOUTS, coerceWorkQuery, memberRoleRank } from "@agent-hub/core";
import { OperationError, defineOperation, type OperationContext } from "./operation";
import { requireReadableProject, requireReadableTask, requireWritableProject } from "./work-access";
import { workId as id } from "./work-schemas";

/**
 * Saved Views and Favorites (#1050). A Saved View is a Project's, shared with
 * everyone who can see the Project, created by an Editor and renamed or
 * deleted by its creator or an Admin. A Favorite is a Member's own star.
 */

const name = z.string().trim().min(1).max(80);
const layout = z.enum(WORK_LAYOUTS as unknown as ["list", "board", "table"]);

async function requireManageableView(ctx: OperationContext, viewId: string): Promise<SavedView> {
  const view = await ctx.db.table("savedViews").get(viewId);
  if (!view || view.organizationId !== ctx.organizationId) throw new OperationError("not_found", "View not found");
  await requireReadableProject(ctx, view.projectId);
  if (view.createdBy !== ctx.userId && memberRoleRank(ctx.role) < 3) {
    throw new OperationError("invalid_input", "Only whoever saved this view, or an Admin, can change it.");
  }
  return view;
}

export const createSavedViewOp = defineOperation({
  name: "savedViews.create",
  capability: "edit",
  effect: "write",
  input: z.object({ projectId: id, name, layout, query: z.unknown() }),
  entities: ({ projectId }) => [{ kind: "project" as const, id: projectId }],
  run: async (ctx, input): Promise<SavedView> => {
    await requireWritableProject(ctx, input.projectId);
    return ctx.db.table("savedViews").insert({
      organizationId: ctx.organizationId,
      projectId: input.projectId,
      name: input.name,
      layout: input.layout,
      query: coerceWorkQuery(input.query),
      createdBy: ctx.userId || null,
    });
  },
});

export const updateSavedViewOp = defineOperation({
  name: "savedViews.update",
  capability: "member",
  effect: "write",
  input: z.object({ id, patch: z.object({ name, layout, query: z.unknown() }).partial() }),
  entities: (_input, result: SavedView) => [{ kind: "project" as const, id: result.projectId }],
  run: async (ctx, input): Promise<SavedView> => {
    await requireManageableView(ctx, input.id);
    const { query, ...rest } = input.patch;
    return ctx.db.table("savedViews").update(input.id, {
      ...rest,
      ...(query !== undefined ? { query: coerceWorkQuery(query) } : {}),
    });
  },
});

export const deleteSavedViewOp = defineOperation({
  name: "savedViews.delete",
  capability: "member",
  effect: "consequential",
  input: z.object({ id }),
  entities: () => [{ kind: "projectList" as const }],
  run: async (ctx, input): Promise<void> => {
    const view = await requireManageableView(ctx, input.id);
    await ctx.db.table("savedViews").delete(view.id);
  },
});

export const listFavoritesOp = defineOperation({
  name: "favorites.list",
  capability: "member",
  effect: "read",
  input: z.object({}),
  entities: () => [],
  run: async (ctx): Promise<WorkFavorite[]> =>
    ctx.userId
      ? ctx.db.table("workFavorites").list({ organizationId: ctx.organizationId, userId: ctx.userId })
      : [],
});

/** Stars or unstars a Project or a Task for the caller. */
export const setFavoriteOp = defineOperation({
  name: "favorites.set",
  capability: "member",
  effect: "write",
  input: z
    .object({ projectId: id.optional(), taskId: id.optional(), on: z.boolean() })
    .refine((v) => Boolean(v.projectId) !== Boolean(v.taskId), "Star a Project or a Task, one of the two."),
  entities: () => [{ kind: "projectList" as const }, { kind: "taskList" as const }],
  run: async (ctx, input): Promise<boolean> => {
    if (!ctx.userId) throw new OperationError("invalid_input", "A favorite needs a Member.");
    if (input.projectId) await requireReadableProject(ctx, input.projectId);
    if (input.taskId) await requireReadableTask(ctx, input.taskId);
    const filter = input.projectId ? { projectId: input.projectId } : { taskId: input.taskId! };
    const existing = await ctx.db.table("workFavorites").list({ ...filter, userId: ctx.userId });
    if (input.on && !existing.length) {
      await ctx.db.table("workFavorites").insert({
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        projectId: input.projectId ?? null,
        taskId: input.taskId ?? null,
      });
    }
    if (!input.on) for (const row of existing) await ctx.db.table("workFavorites").delete(row.id);
    return input.on;
  },
});
