import { z } from "zod";
import type { QuickText } from "@agent-hub/core";
import { OperationError, defineOperation, type OperationContext } from "./operation";

/**
 * Quick Texts (#1085): Organization-level saved replies for the Inbox reply
 * box. Every Member reads them; an Editor or above writes them. No per-Member
 * visibility in this slice.
 */

const idSchema = z.string().trim().min(1).max(200);

export const quickTextInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().min(1).max(4_000),
  folder: z.string().trim().min(1).max(80).nullable().optional(),
});

export const quickTextPatchSchema = quickTextInputSchema.partial();

async function requireQuickText(ctx: OperationContext, id: string): Promise<QuickText> {
  const quickText = await ctx.db.table("quickTexts").get(id);
  if (!quickText || quickText.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Quick Text not found");
  }
  return quickText;
}

export const listQuickTextsOp = defineOperation({
  name: "quickTexts.list",
  capability: "quickTexts:view",
  effect: "read",
  input: z.object({}),
  entities: () => [],
  run: async (ctx): Promise<QuickText[]> =>
    (await ctx.db.table("quickTexts").list({ organizationId: ctx.organizationId })).sort(
      (a, b) => (a.folder ?? "").localeCompare(b.folder ?? "") || a.title.localeCompare(b.title)
    ),
});

export const createQuickTextOp = defineOperation({
  name: "quickTexts.create",
  capability: "quickTexts:edit",
  effect: "write",
  input: quickTextInputSchema,
  entities: () => [{ kind: "quickTexts" as const }],
  run: (ctx, input): Promise<QuickText> =>
    ctx.db.table("quickTexts").insert({
      organizationId: ctx.organizationId,
      title: input.title,
      body: input.body,
      folder: input.folder ?? null,
      createdBy: ctx.userId || null,
    }),
});

export const updateQuickTextOp = defineOperation({
  name: "quickTexts.update",
  capability: "quickTexts:edit",
  effect: "write",
  input: z.object({ id: idSchema, patch: quickTextPatchSchema }),
  entities: () => [{ kind: "quickTexts" as const }],
  run: async (ctx, { id, patch }): Promise<QuickText> => {
    await requireQuickText(ctx, id);
    return ctx.db.table("quickTexts").update(id, patch);
  },
});

export const deleteQuickTextOp = defineOperation({
  name: "quickTexts.delete",
  capability: "quickTexts:edit",
  effect: "consequential",
  input: z.object({ id: idSchema }),
  entities: () => [{ kind: "quickTexts" as const }],
  run: async (ctx, { id }) => {
    await requireQuickText(ctx, id);
    await ctx.db.table("quickTexts").delete(id);
  },
});
