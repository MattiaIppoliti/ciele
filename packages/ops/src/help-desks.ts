import { defaultChannelAvailability, ticketingLegacyAlertKey, ticketingTargetIssue } from "@agent-hub/core";
import type {
  HelpDesk,
  SupportChannel,
  SupportChannelConfig,
  SupportChannelInput,
  SupportChannelPatch,
  TicketingPlatform,
  TicketingTarget,
} from "@agent-hub/core";
import { z } from "zod";
import { OperationError, defineOperation, type OperationContext } from "./operation";

import { requireBusinessHours } from "./business-hours";

const idSchema = z.string().min(1);

export type HelpDeskView = Omit<HelpDesk, "ticketingIntegration"> & {
  ticketingIntegration: null | {
    id: string;
    platform: TicketingPlatform;
    name: string;
    connectedAt: string;
    hasCredentials: boolean;
  };
};

export type SupportChannelView = Omit<SupportChannel, "config"> & {
  config: Omit<
    SupportChannelConfig,
    "apiKeyValue" | "bearerToken" | "basicPassword"
  > & {
    hasApiKey: boolean;
    hasBearerToken: boolean;
    hasBasicPassword: boolean;
  };
};

function publicHelpDesk(desk: HelpDesk): HelpDeskView {
  const integration = desk.ticketingIntegration;
  return {
    ...desk,
    ticketingIntegration: integration
      ? {
          id: integration.id,
          platform: integration.platform,
          name: integration.name,
          connectedAt: integration.connectedAt,
          hasCredentials: Boolean(
            integration.config.clientSecret || integration.config.password
          ),
        }
      : null,
  };
}

function publicSupportChannel(channel: SupportChannel): SupportChannelView {
  const { apiKeyValue, bearerToken, basicPassword, ...config } = channel.config;
  return {
    ...channel,
    config: {
      ...config,
      hasApiKey: Boolean(apiKeyValue),
      hasBearerToken: Boolean(bearerToken),
      hasBasicPassword: Boolean(basicPassword),
    },
  };
}

/** Shape-trusted structured channel config: any object, or absent. */
const objectOrUndefined = (value: unknown) =>
  value === undefined || (typeof value === "object" && value !== null);

const supportChannelInputSchema = z.object({
  kind: z.enum([
    "email",
    "phone",
    "live_chat",
    "ticket",
    "external_link",
    "salesforce_chat",
    "api_endpoint",
    "live_operator",
  ]),
  name: z.string().trim().min(1).max(200),
  config: z.custom<SupportChannelInput["config"]>(objectOrUndefined).optional(),
  formTitle: z.string().max(500).optional(),
  form: z.custom<SupportChannelInput["form"]>(Array.isArray).optional(),
  confirmationMessage: z.string().max(10_000).optional(),
  conversationData: z.custom<SupportChannelInput["conversationData"]>(objectOrUndefined).optional(),
  availability: z.custom<SupportChannelInput["availability"]>(objectOrUndefined).optional(),
}) satisfies z.ZodType<SupportChannelInput>;

const supportChannelPatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  config: z.custom<SupportChannelPatch["config"]>(objectOrUndefined).optional(),
  formTitle: z.string().max(500).optional(),
  form: z.custom<SupportChannelPatch["form"]>(Array.isArray).optional(),
  confirmationMessage: z.string().max(10_000).optional(),
  conversationData: z.custom<SupportChannelPatch["conversationData"]>(objectOrUndefined).optional(),
  availability: z.custom<SupportChannelPatch["availability"]>(objectOrUndefined).optional(),
}) satisfies z.ZodType<SupportChannelPatch>;

export const helpDeskInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).optional(),
});

export const helpDeskPatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2_000).optional(),
  autoGenerateImprovements: z.boolean().optional(),
});

async function requireHelpDesk(
  ctx: OperationContext,
  id: string
): Promise<HelpDesk> {
  const desk = await ctx.db.getHelpDesk(id);
  if (!desk || desk.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Help desk not found");
  }
  return desk;
}

async function requireSupportChannel(
  ctx: OperationContext,
  helpDeskId: string,
  channelId: string
): Promise<SupportChannel> {
  await requireHelpDesk(ctx, helpDeskId);
  const channel = (await ctx.db.listSupportChannels(helpDeskId)).find(
    (candidate) => candidate.id === channelId
  );
  if (!channel) throw new OperationError("not_found", "Support channel not found");
  return channel;
}

export const listHelpDesksOp = defineOperation({
  name: "helpDesks.list",
  capability: "helpDesks:view",
  effect: "read",
  input: z.object({}),
  entities: () => [],
  run: async (ctx) =>
    (await ctx.db.listHelpDesks(ctx.organizationId)).map(publicHelpDesk),
});

export const getHelpDeskOp = defineOperation({
  name: "helpDesks.get",
  capability: "helpDesks:view",
  effect: "read",
  input: z.object({ id: idSchema }),
  entities: () => [],
  run: async (ctx, { id }) => {
    const desk = await requireHelpDesk(ctx, id);
    const channels = await ctx.db.listSupportChannels(id);
    return {
      desk: publicHelpDesk(desk),
      channels: channels.map(publicSupportChannel),
    };
  },
});

export const createHelpDeskOp = defineOperation({
  name: "helpDesks.create",
  capability: "helpDesks:edit",
  effect: "write",
  input: helpDeskInputSchema,
  entities: () => [{ kind: "helpDeskList" as const }],
  run: async (ctx, input) =>
    publicHelpDesk(await ctx.db.createHelpDesk(ctx.organizationId, input)),
});

export const updateHelpDeskOp = defineOperation({
  name: "helpDesks.update",
  capability: "helpDesks:edit",
  effect: "write",
  input: z.object({ id: idSchema, patch: helpDeskPatchSchema }),
  entities: ({ id }) => [
    { kind: "helpDeskList" as const },
    { kind: "helpDesk" as const, id },
  ],
  run: async (ctx, { id, patch }) => {
    await requireHelpDesk(ctx, id);
    return publicHelpDesk(await ctx.db.updateHelpDesk(id, patch));
  },
});

export const deleteHelpDeskOp = defineOperation({
  name: "helpDesks.delete",
  capability: "helpDesks:edit",
  effect: "consequential",
  input: z.object({ id: idSchema }),
  entities: () => [{ kind: "helpDeskList" as const }],
  run: async (ctx, { id }) => {
    await requireHelpDesk(ctx, id);
    await ctx.db.deleteHelpDesk(id);
  },
});

export const createSupportChannelOp = defineOperation({
  name: "helpDesks.channels.create",
  capability: "helpDesks:edit",
  effect: "write",
  input: z.object({ helpDeskId: idSchema, input: supportChannelInputSchema }),
  entities: ({ helpDeskId }) => [{ kind: "helpDesk" as const, id: helpDeskId }],
  run: async (ctx, { helpDeskId, input }) => {
    await requireHelpDesk(ctx, helpDeskId);
    const organization = (await ctx.db.listOrganizations()).find(row => row.id === ctx.organizationId);
    const availability = input.availability ?? defaultChannelAvailability(organization?.defaultTimezone ?? "UTC");
    if (availability.mode === "business_hours") await requireBusinessHours(ctx, availability.businessHoursId ?? "");
    return publicSupportChannel(await ctx.db.createSupportChannel(helpDeskId, { ...input, availability }));
  },
});

export const updateSupportChannelOp = defineOperation({
  name: "helpDesks.channels.update",
  capability: "helpDesks:edit",
  effect: "write",
  input: z.object({
    helpDeskId: idSchema,
    channelId: idSchema,
    patch: supportChannelPatchSchema,
  }),
  entities: ({ helpDeskId }) => [{ kind: "helpDesk" as const, id: helpDeskId }],
  run: async (ctx, { helpDeskId, channelId, patch }) => {
    await requireSupportChannel(ctx, helpDeskId, channelId);
    if (patch.availability?.mode === "business_hours") await requireBusinessHours(ctx, patch.availability.businessHoursId ?? "");
    return publicSupportChannel(await ctx.db.updateSupportChannel(channelId, patch));
  },
});

export const deleteSupportChannelOp = defineOperation({
  name: "helpDesks.channels.delete",
  capability: "helpDesks:edit",
  effect: "consequential",
  input: z.object({ helpDeskId: idSchema, channelId: idSchema }),
  entities: ({ helpDeskId }) => [{ kind: "helpDesk" as const, id: helpDeskId }],
  run: async (ctx, { helpDeskId, channelId }) => {
    await requireSupportChannel(ctx, helpDeskId, channelId);
    await ctx.db.deleteSupportChannel(channelId);
  },
});

export const reorderSupportChannelsOp = defineOperation({
  name: "helpDesks.channels.reorder",
  capability: "helpDesks:edit",
  effect: "write",
  input: z.object({
    helpDeskId: idSchema,
    orderedIds: z.array(idSchema).min(1).refine(
      (ids) => new Set(ids).size === ids.length,
      "Channel ids must be unique"
    ),
  }),
  entities: ({ helpDeskId }) => [{ kind: "helpDesk" as const, id: helpDeskId }],
  run: async (ctx, { helpDeskId, orderedIds }) => {
    await requireHelpDesk(ctx, helpDeskId);
    const channels = await ctx.db.listSupportChannels(helpDeskId);
    const channelIds = new Set(channels.map((channel) => channel.id));
    if (
      orderedIds.length !== channelIds.size ||
      orderedIds.some((id) => !channelIds.has(id))
    ) {
      throw new OperationError(
        "invalid_input",
        "orderedIds must include every support channel exactly once"
      );
    }
    await ctx.db.reorderSupportChannels(helpDeskId, orderedIds);
    return (await ctx.db.listSupportChannels(helpDeskId)).map(publicSupportChannel);
  },
});

/** The `PUT /help-desks/{id}/ticketing` body: the target without the desk id the path carries. */
export const ticketingTargetBodySchema = z.object({
  /** An Organization-owned Salesforce or ServiceNow Application Connection. */
  connectionId: idSchema,
  /** ServiceNow only: the table records go into; `incident` when blank. */
  table: z.string().trim().max(80).optional(),
  /** ServiceNow only: the column that receives the requester's email. */
  requesterEmailField: z.string().trim().max(80).optional(),
});

const ticketingTargetSchema = ticketingTargetBodySchema.extend({ helpDeskId: idSchema });

/**
 * Names the Application Connection a desk's "Create a ticket" channel files
 * through (#1088, #1089). The provider comes from the Connection, and the
 * Connection is looked up in the caller's Organization, so a foreign or
 * Member-owned Connection is refused here rather than at a Visitor's
 * escalation. No credential is taken: the Connection already holds one.
 */
export const setTicketingTargetOp = defineOperation({
  name: "helpDesks.ticketing.setTarget",
  capability: "helpDesks:edit",
  effect: "write",
  input: ticketingTargetSchema,
  entities: ({ helpDeskId }) => [{ kind: "helpDesk" as const, id: helpDeskId }],
  run: async (ctx, input) => {
    const existingDesk = await requireHelpDesk(ctx, input.helpDeskId);
    if (existingDesk.ticketingTarget === undefined) {
      throw new OperationError("invalid_input", "Ticketing setup is temporarily unavailable. Try again later.");
    }
    const connection =
      (await ctx.db.listApplicationConnections(ctx.organizationId)).find(
        (candidate) => candidate.id === input.connectionId
      ) ?? null;
    const provider = connection?.provider;
    if (provider !== "salesforce" && provider !== "servicenow") {
      throw new OperationError(
        "invalid_input",
        connection
          ? "Choose a Salesforce or ServiceNow connection"
          : "The connection no longer exists"
      );
    }
    const target: TicketingTarget =
      provider === "salesforce"
        ? { provider, connectionId: input.connectionId }
        : {
            provider,
            connectionId: input.connectionId,
            table: input.table?.trim() || "incident",
            ...(input.requesterEmailField?.trim()
              ? { requesterEmailField: input.requesterEmailField.trim() }
              : {}),
          };
    const issue = ticketingTargetIssue(target, connection, ctx.organizationId);
    if (issue) throw new OperationError("invalid_input", issue);
    const desk = await ctx.db.setTicketingTarget(input.helpDeskId, target);
    // The desk now files somewhere: the retired-registration Alert is answered.
    await ctx.db.resolveAlertsByKey(ctx.organizationId, ticketingLegacyAlertKey(desk.id));
    return publicHelpDesk(desk);
  },
});

export const disconnectTicketingIntegrationOp = defineOperation({
  name: "helpDesks.ticketing.disconnect",
  capability: "helpDesks:edit",
  effect: "consequential",
  input: z.object({ helpDeskId: idSchema }),
  entities: ({ helpDeskId }) => [{ kind: "helpDesk" as const, id: helpDeskId }],
  run: async (ctx, { helpDeskId }) => {
    await requireHelpDesk(ctx, helpDeskId);
    const desk = await ctx.db.clearTicketingIntegration(helpDeskId);
    // The retired registration and its sealed secrets are gone with it.
    await ctx.db.resolveAlertsByKey(ctx.organizationId, ticketingLegacyAlertKey(helpDeskId));
    return publicHelpDesk(desk);
  },
});

export { supportChannelInputSchema, supportChannelPatchSchema };
