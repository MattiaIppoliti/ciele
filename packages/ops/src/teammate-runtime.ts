import { z } from "zod";
import type { TeammateRuntimeConfig } from "@agent-hub/core";
import { defineOperation } from "./operation";
import { requireReadableTeammate } from "./teammate-access";

export const teammateRuntimeSchema = z
  .object({
    harness: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("ciele") }).strict(),
      z
        .object({
          kind: z.literal("ag_ui"),
          connectionId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
        })
        .strict(),
    ]),
    internet: z.boolean(),
    mcpServerIds: z.array(z.string().min(1).max(200)).max(20).optional(),
    computer: z
      .object({
        browser: z.boolean(),
        files: z.boolean(),
        terminal: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .refine(
    (config) => !config.computer.browser || config.internet,
    "Browser access requires internet access",
  )
  .refine(
    (config) =>
      !config.computer.terminal || (config.computer.files && config.internet),
    "Terminal access requires files and internet access",
  ) satisfies z.ZodType<TeammateRuntimeConfig>;

export const configureTeammateRuntimeOp = defineOperation({
  name: "teammates.runtime.configure",
  capability: "teammates:grants",
  effect: "consequential",
  input: z
    .object({ id: z.string().min(1), config: teammateRuntimeSchema })
    .strict(),
  entities: ({ id }) => [{ kind: "teammate" as const, id }],
  run: async (ctx, { id, config }) => {
    await requireReadableTeammate(ctx, id);
    for (const serverId of config.mcpServerIds ?? []) {
      const server = await ctx.db.table("mcpServerConnections").get(serverId);
      if (!server || server.organizationId !== ctx.organizationId) throw new Error("MCP server does not belong to this Organization");
    }
    return ctx.db.table("teammates").update(id, { runtimeConfig: config });
  },
});
