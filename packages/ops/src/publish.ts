import { z } from "zod";
import { effectiveMcpToolPolicy, type AssistantTools } from "@agent-hub/core";
import type { Flow } from "@agent-hub/core";
import {
  buildPublicationConfig,
  connectorAction,
  connectorConnectionIssue,
  connectorSettingsIssue,
  flowActionSteps,
} from "@agent-hub/core";
import type { OperationContext } from "./operation";
import { OperationError, defineOperation } from "./operation";
import { requireAssistant } from "./assistants";
import { assertHumanReviewFlowsPublishable } from "./reviews";

/**
 * A published Flow's Connector action must be runnable by the widget (#839):
 * a catalogued action, its required fields, and an Organization-owned
 * Connection that holds the scopes. The same judgement the runtime makes, so
 * Publish never freezes a Flow the widget would refuse; the reason names the
 * Flow so the console can show it there.
 */
export async function assertConnectorFlowsPublishable(
  ctx: OperationContext,
  flows: readonly Flow[]
): Promise<void> {
  const connectors = flows.filter((flow) => flow.enabled).flatMap((flow) =>
    flowActionSteps(flow).filter((step) => step.action === "connector")
      .map((step) => ({ flow, settings: step.settings.connector }))
  );
  for (const { flow, settings } of connectors) {
    const settingsIssue = connectorSettingsIssue(settings);
    if (settingsIssue) {
      throw new OperationError(
        "invalid_input",
        `Flow "${flow.name}": ${settingsIssue.toLowerCase()} before publishing`
      );
    }
    const action = connectorAction(settings?.action)!;
    const connection = await ctx.db.getSafeApplicationConnection(settings!.connectionId!);
    const issue = connectorConnectionIssue(
      action,
      connection && connection.organizationId === ctx.organizationId ? connection : null
    );
    if (issue) {
      throw new OperationError("invalid_input", `Flow "${flow.name}": ${issue}`);
    }
  }
}

/**
 * The Publish domain (#623). Publications are immutable snapshots
 * (`buildPublicationConfig` decides what freezes); the widget cache learns
 * about a new latest version through the `invalidatePublication` port so
 * live widgets flip without a Postgres round-trip per request.
 */

async function assertMcpToolsPublishable(ctx: OperationContext, tools: AssistantTools) {
  for (const selection of tools.remoteMcp ?? []) {
    const server = await ctx.db.table("mcpServerConnections").get(selection.serverId);
    for (const selected of selection.tools) {
      const tool = server?.organizationId === ctx.organizationId ? server.tools.find(tool => tool.name === selected.name) : undefined;
      if (!tool || tool.definitionHash !== selected.definitionHash || effectiveMcpToolPolicy(tool) !== "run_freely") {
        throw new OperationError("invalid_input", `MCP tool "${selected.name}" must have the current Run freely policy before publishing`);
      }
    }
  }
}

const assistantIdSchema = z.object({ assistantId: z.string().min(1) });

export const publishAssistantOp = defineOperation({
  name: "publish.publish",
  capability: "assistants:publish",
  effect: "consequential",
  input: assistantIdSchema,
  entities: ({ assistantId }) => [
    { kind: "assistantEditor" as const, assistantId },
  ],
  run: async (ctx, { assistantId }) => {
    const assistant = await requireAssistant(ctx, assistantId);
    const [flows, collections, skills] = await Promise.all([
      ctx.db.listFlows(assistantId),
      ctx.db.listCollections(assistantId),
      ctx.db.listAssistantSkills(assistantId),
    ]);
    await assertConnectorFlowsPublishable(ctx, flows);
    await assertHumanReviewFlowsPublishable(ctx, flows);
    await assertMcpToolsPublishable(ctx, assistant.tools);
    const publication = await ctx.db.createPublication(
      assistantId,
      buildPublicationConfig(assistant, flows, collections, skills),
      ctx.userId || null
    );
    await ctx.ports?.invalidatePublication?.(assistantId);
    return { version: publication.version, publicationId: publication.id };
  },
});

export const unpublishAssistantOp = defineOperation({
  name: "publish.unpublish",
  capability: "assistants:publish",
  effect: "consequential",
  input: assistantIdSchema,
  entities: ({ assistantId }) => [
    { kind: "assistantEditor" as const, assistantId },
  ],
  run: async (ctx, { assistantId }) => {
    await requireAssistant(ctx, assistantId);
    await ctx.db.deletePublications(assistantId);
    await ctx.ports?.invalidatePublication?.(assistantId);
  },
});

export const republishOp = defineOperation({
  name: "publish.republish",
  capability: "assistants:publish",
  effect: "consequential",
  input: z.object({
    assistantId: z.string().min(1),
    publicationId: z.string().min(1),
  }),
  entities: ({ assistantId }) => [
    { kind: "assistantEditor" as const, assistantId },
  ],
  run: async (ctx, { assistantId, publicationId }) => {
    await requireAssistant(ctx, assistantId);
    const old = await ctx.db.getPublication(publicationId);
    if (!old || old.assistantId !== assistantId) {
      throw new OperationError("not_found", "Publication not found");
    }
    await assertMcpToolsPublishable(ctx, old.config.assistant.tools);
    const publication = await ctx.db.createPublication(assistantId, old.config, ctx.userId || null);
    await ctx.ports?.invalidatePublication?.(assistantId);
    return { version: publication.version, publicationId: publication.id };
  },
});

/** Publication state a CI script needs: published?, version, when. */
export const publicationStatusOp = defineOperation({
  name: "publish.status",
  capability: "assistants:view",
  effect: "read",
  input: assistantIdSchema,
  entities: () => [],
  run: async (ctx, { assistantId }) => {
    await requireAssistant(ctx, assistantId);
    const latest = await ctx.db.getLatestPublication(assistantId);
    return latest
      ? {
          published: true as const,
          publicationId: latest.id,
          version: latest.version,
          publishedAt: latest.createdAt,
        }
      : { published: false as const };
  },
});
