import { z } from "zod";
import { CONNECTOR_PROVIDERS, HTTP_FLOW_METHODS } from "@agent-hub/core";
import type {
  ConnectorProvider,
  FlowAction,
  FlowActionSettings,
  FlowCondition,
  FlowConditionLogic,
  FlowInput,
  FlowPatch,
  FlowTrigger,
  FlowTriggerSettings,
} from "@agent-hub/core";

/**
 * The structural schema of a Flow's router configuration (spec #836, #837).
 *
 * Until the Flow Canvas this was shape-trusted (`z.custom` over "is an array" /
 * "is an object"): the Flow Builder authored every value, so the operation only
 * had to trust it. Two new authors change that. The Flows Agent's tool calls
 * are model output, and the versioned API is scripted against, so every field a
 * Flow stores is now validated by name and type, and the API document can show
 * the real shape instead of `{}`.
 *
 * Objects are **loose**: unknown keys pass through rather than being stripped.
 * A Flow saved by a newer build must not lose a key when an older CLI patches
 * one field of it, and `redactFlowSecrets` sets derived `has*` flags the editor
 * round-trips. Known keys are typed; that is the invariant, not the key set.
 */

export const flowTriggerSchema = z.enum([
  "message",
  "page_load",
  "time_on_page",
  "chat_open",
  "http_request",
]) satisfies z.ZodType<FlowTrigger>;

const flowActionSchema = z.enum([
  "search_knowledge",
  "custom_message",
  "suggest_help_desk",
  "follow_up_questions",
  "show_button",
  "iframe",
  "api_request",
  "send_email",
  "improvement",
  "handover",
  "basic_reply",
  "notification",
  "connector",
  "human_review",
  "http_webhook",
  "respond",
]) satisfies z.ZodType<FlowAction>;

const flowConditionLogicSchema = z.enum(["any", "all"]) satisfies z.ZodType<
  FlowConditionLogic
>;

const dwellPart = z.number().int().min(0).max(24 * 60 * 60).optional();
const httpMethodSchema = z.enum(HTTP_FLOW_METHODS);

const flowTriggerSettingsSchema = z.looseObject({
  timeOnPage: z.looseObject({ minutes: dwellPart, seconds: dwellPart }).optional(),
  // "On HTTP request" (#843). No credential: the endpoint is authorized by an
  // Organization API key, so nothing here is a secret.
  httpRequest: z
    .looseObject({
      methods: z.array(httpMethodSchema).max(5).optional(),
    })
    .optional(),
}) as unknown as z.ZodType<FlowTriggerSettings>;

const jsonPathSchema = z.looseObject({
  id: z.string(),
  path: z.string().max(500),
  variable: z.string().max(100),
});

const conditionExampleSchema = z.looseObject({
  message: z.string().max(2000),
  note: z.string().max(1000),
  shouldTrigger: z.boolean(),
});

const flowConditionSchema = z.discriminatedUnion("kind", [
  z.looseObject({
    id: z.string().min(1),
    kind: z.literal("conversation_context"),
    description: z.string().max(2000),
    examples: z.array(conditionExampleSchema).max(50),
  }),
  z.looseObject({
    id: z.string().min(1),
    kind: z.literal("url"),
    operator: z.enum(["matches", "contains", "regex"]),
    value: z.string().max(2000),
  }),
  z.looseObject({
    id: z.string().min(1),
    kind: z.literal("schedule"),
    startAt: z.string().max(32),
    endAt: z.string().max(32).optional(),
    timezone: z.string().min(1).max(64),
  }),
]) as unknown as z.ZodType<FlowCondition>;

const keyValueSchema = z.looseObject({
  id: z.string(),
  name: z.string().max(200),
  value: z.string().max(4000),
});

const apiRequestAuthSchema = z.discriminatedUnion("type", [
  z.looseObject({ type: z.literal("none") }),
  z.looseObject({
    type: z.literal("bearer"),
    token: z.string().max(4000).optional(),
    hasToken: z.boolean().optional(),
  }),
  z.looseObject({
    type: z.literal("api_key"),
    header: z.string().max(200).optional(),
    key: z.string().max(4000).optional(),
    hasKey: z.boolean().optional(),
  }),
  z.looseObject({
    type: z.literal("basic"),
    username: z.string().max(500).optional(),
    password: z.string().max(4000).optional(),
    hasPassword: z.boolean().optional(),
  }),
]);

/**
 * One half of the callback gate's pair of calls (#842). The same credential
 * and header slots as `api_request`, so a secret has a place that
 * `redactFlowSecrets` knows and is never typed into the URL.
 */
const webhookCallSchema = z.looseObject({
  method: httpMethodSchema.optional(),
  url: z.string().max(2000).optional(),
  bodyTemplate: z.string().max(20000).optional(),
  auth: apiRequestAuthSchema.optional(),
  headers: z.array(keyValueSchema).max(50).optional(),
  jsonPaths: z.array(jsonPathSchema).max(50).optional(),
});

const buttonTypeSchema = z.enum(["external_link", "help_desk", "send_text", "faq"]);
const buttonIconSchema = z.enum([
  "message",
  "phone",
  "headset",
  "bell",
  "mail",
  "external_link",
  "headphones",
]);

const flowActionSettingsSchema = z.looseObject({
  search_knowledge: z
    .looseObject({
      escalatePrompt: z.boolean().optional(),
      improvementItems: z.boolean().optional(),
      searchGuidelines: z.string().max(10000).optional(),
      answeringStyle: z.string().max(10000).optional(),
      overrideAnsweringStyle: z.boolean().optional(),
    })
    .optional(),
  basic_reply: z.looseObject({ message: z.string().max(10000).optional() }).optional(),
  show_button: z
    .looseObject({
      label: z.string().max(200).optional(),
      type: buttonTypeSchema.optional(),
      url: z.string().max(2000).optional(),
      helpDeskId: z.string().max(200).optional(),
      text: z.string().max(2000).optional(),
      faqId: z.string().max(200).optional(),
      faqQuestion: z.string().max(2000).optional(),
      showIcon: z.boolean().optional(),
      icon: buttonIconSchema.optional(),
    })
    .optional(),
  iframe: z
    .looseObject({
      url: z.string().max(2000).optional(),
      title: z.string().max(200).optional(),
      lightbox: z.boolean().optional(),
      height: z.number().positive().max(100000).optional(),
      heightUnit: z.enum(["vh", "px"]).optional(),
    })
    .optional(),
  api_request: z
    .looseObject({
      // Where the endpoint comes from (#837): typed in, or named in a
      // Swagger/OpenAPI document. Absent means typed in, which is what every
      // Flow written before this meant.
      endpoint: z.enum(["url", "swagger"]).optional(),
      swaggerUrl: z.string().max(2000).optional(),
      operationId: z.string().max(200).optional(),
      method: httpMethodSchema.optional(),
      url: z.string().max(2000).optional(),
      auth: apiRequestAuthSchema.optional(),
      headers: z.array(keyValueSchema).max(50).optional(),
      queryParams: z.array(keyValueSchema).max(50).optional(),
      bodyTemplate: z.string().max(20000).optional(),
      jsonPaths: z
        .array(
          z.looseObject({
            id: z.string(),
            path: z.string().max(500),
            variable: z.string().max(100),
          })
        )
        .max(50)
        .optional(),
    })
    .optional(),
  // The callback gate (#842). Two calls and a wait; no credential of its own,
  // the callback is authorized by a URL the runtime signs per subscription.
  http_webhook: z
    .looseObject({
      subscribe: webhookCallSchema.optional(),
      unsubscribe: webhookCallSchema.optional(),
      timeoutMinutes: z.number().int().min(1).max(24 * 60).optional(),
      waitingMessage: z.string().max(2000).optional(),
      haltMessage: z.string().max(2000).optional(),
      jsonPaths: z.array(jsonPathSchema).max(50).optional(),
    })
    .optional(),
  // The answer to an inbound request (#843). 1xx is not a final answer and the
  // platform refuses to construct one, so the floor is 200.
  respond: z
    .looseObject({
      status: z.number().int().min(200).max(599).optional(),
      headers: z.array(keyValueSchema).max(50).optional(),
      bodyTemplate: z.string().max(20000).optional(),
    })
    .optional(),
  send_email: z.looseObject({ to: z.string().max(500).optional() }).optional(),
  handover: z.looseObject({ assistantId: z.string().max(200).optional() }).optional(),
  // No credential field, by construction: the Connection row holds it (#839).
  connector: z
    .looseObject({
      provider: z.enum(CONNECTOR_PROVIDERS as [ConnectorProvider, ...ConnectorProvider[]]).optional(),
      connectionId: z.string().max(200).optional(),
      action: z.string().max(200).optional(),
      params: z.record(z.string().max(100), z.string().max(20000)).optional(),
      successMessage: z.string().max(2000).optional(),
      failureMessage: z.string().max(2000).optional(),
    })
    .optional(),
  // Human review (#841): no credential either, the sender is a Connection id.
  human_review: z
    .looseObject({
      title: z.string().max(200).optional(),
      message: z.string().max(5000).optional(),
      assignees: z.array(z.string().max(320)).max(20).optional(),
      channel: z.enum(["email", "slack"]).optional(),
      senderConnectionId: z.string().max(200).optional(),
      slackTarget: z.string().max(200).optional(),
      inputs: z
        .array(
          z.looseObject({
            id: z.string().max(40),
            label: z.string().max(200),
            type: z.enum(["short_text", "long_text", "dropdown", "yes_no"]),
            required: z.boolean().optional(),
            placeholder: z.string().max(200).optional(),
            options: z.array(z.string().max(200)).max(50).optional(),
          })
        )
        .max(20)
        .optional(),
      timeoutHours: z.number().min(1).max(24 * 14).optional(),
      haltMessage: z.string().max(2000).optional(),
      waitingMessage: z.string().max(2000).optional(),
    })
    .optional(),
  follow_up_questions: z
    .looseObject({
      mode: z.enum(["ai_generated", "manual"]).optional(),
      questions: z.array(z.string().max(500)).max(10).optional(),
    })
    .optional(),
  notification: z
    .looseObject({
      title: z.string().max(200).optional(),
      content: z.string().max(10000).optional(),
      deliveryRule: z.enum(["session", "visitor", "always"]).optional(),
      allowReplies: z.boolean().optional(),
      buttons: z
        .array(
          z.looseObject({
            id: z.string(),
            label: z.string().max(200).optional(),
            type: z.enum(["external_link", "send_text"]).optional(),
            url: z.string().max(2000).optional(),
            text: z.string().max(2000).optional(),
          })
        )
        .max(10)
        .optional(),
    })
    .optional(),
}) as unknown as z.ZodType<FlowActionSettings>;

/** The router configuration every Flow carries, minus name/enabled. */
export const flowConfigShape = {
  description: z.string().max(2000),
  trigger: flowTriggerSchema,
  triggerSettings: flowTriggerSettingsSchema,
  conditionLogic: flowConditionLogicSchema,
  conditions: z.array(flowConditionSchema).max(50),
  actions: z.array(flowActionSchema).max(20),
  actionSettings: flowActionSettingsSchema,
  customMessage: z.string().max(10000),
};

export const flowInputSchema = z.object({
  name: z.string().min(1).max(200),
  description: flowConfigShape.description.optional(),
  trigger: flowConfigShape.trigger.optional(),
  triggerSettings: flowConfigShape.triggerSettings.optional(),
  conditionLogic: flowConfigShape.conditionLogic.optional(),
  conditions: flowConfigShape.conditions.optional(),
  actions: flowConfigShape.actions.optional(),
  actionSettings: flowConfigShape.actionSettings.optional(),
  customMessage: flowConfigShape.customMessage.optional(),
}) as unknown as z.ZodType<FlowInput, FlowInput>;

export const flowPatchSchema = z
  .object({
    name: z.string().min(1).max(200),
    enabled: z.boolean(),
    ...flowConfigShape,
  })
  .partial() as unknown as z.ZodType<FlowPatch, FlowPatch>;
