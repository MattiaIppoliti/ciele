import { sealSecret } from "@agent-hub/core";
import type {
  HelpDesk,
  SupportChannel,
  SupportChannelConfig,
  SupportChannelInput,
  SupportChannelPatch,
  TicketingPlatform,
} from "@agent-hub/core";
import { z } from "zod";
import { OperationError, defineOperation, type OperationContext } from "./operation";

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

const supportChannelInputSchema = z.object({
  kind: z.enum([
    "email",
    "phone",
    "live_chat",
    "ticket",
    "external_link",
    "salesforce_chat",
    "api_endpoint",
  ]),
  name: z.string().trim().min(1).max(200),
  config: z.custom<SupportChannelInput["config"]>(
    (value) => value === undefined || (typeof value === "object" && value !== null)
  ).optional(),
  formTitle: z.string().max(500).optional(),
  form: z.custom<SupportChannelInput["form"]>(Array.isArray).optional(),
  confirmationMessage: z.string().max(10_000).optional(),
  conversationData: z.custom<SupportChannelInput["conversationData"]>(
    (value) => value === undefined || (typeof value === "object" && value !== null)
  ).optional(),
  availability: z.custom<SupportChannelInput["availability"]>(
    (value) => value === undefined || (typeof value === "object" && value !== null)
  ).optional(),
}) satisfies z.ZodType<SupportChannelInput>;

const supportChannelPatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  config: z.custom<SupportChannelPatch["config"]>(
    (value) => value === undefined || (typeof value === "object" && value !== null)
  ).optional(),
  formTitle: z.string().max(500).optional(),
  form: z.custom<SupportChannelPatch["form"]>(Array.isArray).optional(),
  confirmationMessage: z.string().max(10_000).optional(),
  conversationData: z.custom<SupportChannelPatch["conversationData"]>(
    (value) => value === undefined || (typeof value === "object" && value !== null)
  ).optional(),
  availability: z.custom<SupportChannelPatch["availability"]>(
    (value) => value === undefined || (typeof value === "object" && value !== null)
  ).optional(),
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
  capability: "member",
  input: z.object({}),
  entities: () => [],
  run: async (ctx) =>
    (await ctx.db.listHelpDesks(ctx.organizationId)).map(publicHelpDesk),
});

export const getHelpDeskOp = defineOperation({
  name: "helpDesks.get",
  capability: "member",
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
  capability: "edit",
  input: helpDeskInputSchema,
  entities: () => [{ kind: "helpDeskList" as const }],
  run: async (ctx, input) =>
    publicHelpDesk(await ctx.db.createHelpDesk(ctx.organizationId, input)),
});

export const updateHelpDeskOp = defineOperation({
  name: "helpDesks.update",
  capability: "edit",
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
  capability: "edit",
  input: z.object({ id: idSchema }),
  entities: () => [{ kind: "helpDeskList" as const }],
  run: async (ctx, { id }) => {
    await requireHelpDesk(ctx, id);
    await ctx.db.deleteHelpDesk(id);
  },
});

export const createSupportChannelOp = defineOperation({
  name: "helpDesks.channels.create",
  capability: "edit",
  input: z.object({ helpDeskId: idSchema, input: supportChannelInputSchema }),
  entities: ({ helpDeskId }) => [{ kind: "helpDesk" as const, id: helpDeskId }],
  run: async (ctx, { helpDeskId, input }) => {
    await requireHelpDesk(ctx, helpDeskId);
    return publicSupportChannel(await ctx.db.createSupportChannel(helpDeskId, input));
  },
});

export const updateSupportChannelOp = defineOperation({
  name: "helpDesks.channels.update",
  capability: "edit",
  input: z.object({
    helpDeskId: idSchema,
    channelId: idSchema,
    patch: supportChannelPatchSchema,
  }),
  entities: ({ helpDeskId }) => [{ kind: "helpDesk" as const, id: helpDeskId }],
  run: async (ctx, { helpDeskId, channelId, patch }) => {
    await requireSupportChannel(ctx, helpDeskId, channelId);
    return publicSupportChannel(await ctx.db.updateSupportChannel(channelId, patch));
  },
});

export const deleteSupportChannelOp = defineOperation({
  name: "helpDesks.channels.delete",
  capability: "edit",
  input: z.object({ helpDeskId: idSchema, channelId: idSchema }),
  entities: ({ helpDeskId }) => [{ kind: "helpDesk" as const, id: helpDeskId }],
  run: async (ctx, { helpDeskId, channelId }) => {
    await requireSupportChannel(ctx, helpDeskId, channelId);
    await ctx.db.deleteSupportChannel(channelId);
  },
});

export const reorderSupportChannelsOp = defineOperation({
  name: "helpDesks.channels.reorder",
  capability: "edit",
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

const serviceNowSchema = z.object({
  helpDeskId: idSchema,
  name: z.string().trim().min(1).max(200),
  baseUrl: z.string().url().refine(
    (value) => new URL(value).protocol === "https:",
    "ServiceNow base URL must use HTTPS"
  ),
  clientId: z.string().trim().min(1),
  clientSecret: z.string().min(1),
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

export const connectServiceNowOp = defineOperation({
  name: "helpDesks.ticketing.connectServiceNow",
  capability: "edit",
  input: serviceNowSchema,
  entities: ({ helpDeskId }) => [{ kind: "helpDesk" as const, id: helpDeskId }],
  run: async (ctx, input) => {
    await requireHelpDesk(ctx, input.helpDeskId);
    const desk = await ctx.db.setTicketingIntegration(input.helpDeskId, {
      platform: "servicenow",
      name: input.name,
      config: {
        baseUrl: input.baseUrl,
        clientId: input.clientId,
        clientSecret: sealSecret(input.clientSecret),
        username: input.username,
        password: sealSecret(input.password),
      },
    });
    return publicHelpDesk(desk);
  },
});

export const disconnectTicketingIntegrationOp = defineOperation({
  name: "helpDesks.ticketing.disconnect",
  capability: "edit",
  input: z.object({ helpDeskId: idSchema }),
  entities: ({ helpDeskId }) => [{ kind: "helpDesk" as const, id: helpDeskId }],
  run: async (ctx, { helpDeskId }) => {
    await requireHelpDesk(ctx, helpDeskId);
    return publicHelpDesk(await ctx.db.clearTicketingIntegration(helpDeskId));
  },
});

export { supportChannelInputSchema, supportChannelPatchSchema };
