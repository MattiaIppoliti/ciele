import { z, type ZodRawShape } from "zod";
import type { CieleClient } from "@ciele/client";

/**
 * The ciele MCP tool set (#629): coarse domain tools with an `action`
 * discriminator — 10 tools, not one per endpoint, so an agent picks reliably.
 * Every v1-perimeter operation is reachable through one of these.
 *
 * Handlers return plain JSON-able data; the server layer (server.ts) wraps
 * it as MCP content, applies the read-only guard, and turns thrown
 * `ToolInputError`s / `CieleApiError`s into error results.
 */

/** A caller-attributable input problem (missing field for the action). */
export class ToolInputError extends Error {}

export interface CieleTool {
  name: string;
  description: string;
  schema: ZodRawShape;
  /** Whether this call would write — the read-only mode gate. */
  mutates(args: Record<string, unknown>): boolean;
  run(args: Record<string, unknown>): Promise<unknown>;
}

function need(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ToolInputError(`"${key}" is required for this action`);
  }
  return value;
}

function needObject(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = args[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolInputError(`"${key}" is required for this action`);
  }
  return value as Record<string, unknown>;
}

const READ_ACTIONS = new Set([
  "list",
  "get",
  "status",
  "list_collections",
  "list_sources",
  "get_source",
  "export",
  "query_records",
  "list_records",
  "subjects",
  "settings",
  "get_entities",
]);

const byAction = (args: Record<string, unknown>) =>
  !READ_ACTIONS.has(String(args.action));

export function buildTools(client: CieleClient): CieleTool[] {
  return [
    {
      name: "ciele_identity",
      description:
        "Who and where you are: the deployment's API version and shipped domains, plus the Organization and Role this API key acts with. Call this first to learn what you may do.",
      schema: {},
      mutates: () => false,
      run: async () => ({
        meta: await client.meta(),
        whoami: await client.whoami(),
      }),
    },
    {
      name: "manage_assistants",
      description:
        "List, read, create, update, duplicate or delete the Organization's Assistants, and get/set their selected Entities without replacing other tool settings. `list` supports limit/cursor; `update` takes a `patch` object; `delete` is permanent and needs an admin-tier key.",
      schema: {
        action: z.enum(["list", "get", "create", "update", "delete", "duplicate", "get_entities", "set_entities"]),
        id: z.string().optional().describe("Assistant id (get/update/delete/duplicate)"),
        title: z.string().optional().describe("Title (create)"),
        nickname: z.string().optional(),
        description: z.string().optional(),
        patch: z.record(z.string(), z.unknown()).optional().describe("Fields to change (update)"),
        limit: z.number().optional(),
        cursor: z.string().optional(),
        entityIds: z.array(z.string()).optional().describe("Selected Entity ids (set_entities)"),
      },
      mutates: byAction,
      run: async (args) => {
        switch (args.action) {
          case "list":
            return client.assistants.list({
              limit: args.limit as number | undefined,
              cursor: args.cursor as string | undefined,
            });
          case "get":
            return client.assistants.get(need(args, "id"));
          case "create":
            return client.assistants.create({
              title: need(args, "title"),
              nickname: args.nickname as string | undefined,
              description: args.description as string | undefined,
            });
          case "update":
            if (!args.patch) throw new ToolInputError('"patch" is required for update');
            return client.assistants.update(need(args, "id"), args.patch);
          case "delete":
            await client.assistants.delete(need(args, "id"));
            return { deleted: args.id };
          case "duplicate":
            return client.assistants.duplicate(need(args, "id"));
          case "get_entities":
            return client.assistants.entities(need(args, "id"));
          case "set_entities":
            if (!Array.isArray(args.entityIds)) {
              throw new ToolInputError('"entityIds" is required for set_entities');
            }
            return client.assistants.setEntities(need(args, "id"), args.entityIds as string[]);
          default:
            throw new ToolInputError(`Unknown action "${args.action}"`);
        }
      },
    },
    {
      name: "manage_flows",
      description:
        "The Assistant's routing: list an Assistant's Flows, read one (full trigger/conditions/actions config), create, update (incl. enabled true/false), reorder, or delete. The Default behavior flow is locked and cannot be deleted. `flow` carries the FlowInput/FlowPatch body for create/update.",
      schema: {
        action: z.enum(["list", "get", "create", "update", "delete", "reorder"]),
        assistantId: z.string().optional().describe("Required for list/create/reorder"),
        id: z.string().optional().describe("Flow id (get/update/delete)"),
        flow: z.record(z.string(), z.unknown()).optional().describe("FlowInput (create) / FlowPatch (update)"),
        orderedIds: z.array(z.string()).optional().describe("Full order for reorder; Default stays last"),
      },
      mutates: byAction,
      run: async (args) => {
        switch (args.action) {
          case "list":
            return client.flows.list(need(args, "assistantId"));
          case "get":
            return client.flows.get(need(args, "id"));
          case "create":
            if (!args.flow) throw new ToolInputError('"flow" is required for create');
            return client.flows.create(
              need(args, "assistantId"),
              args.flow as never
            );
          case "update":
            if (!args.flow) throw new ToolInputError('"flow" is required for update');
            return client.flows.update(need(args, "id"), args.flow as never);
          case "delete":
            await client.flows.delete(need(args, "id"));
            return { deleted: args.id };
          case "reorder":
            if (!Array.isArray(args.orderedIds)) {
              throw new ToolInputError('"orderedIds" is required for reorder');
            }
            return client.flows.reorder(
              need(args, "assistantId"),
              args.orderedIds as string[]
            );
          default:
            throw new ToolInputError(`Unknown action "${args.action}"`);
        }
      },
    },
    {
      name: "manage_knowledge",
      description:
        "The Assistant's knowledge base: list an Assistant's Collections, list/read a Collection's Sources (poll get_source until status leaves 'processing'), add sources (text, url, or a file passed as base64), delete a source, re-crawl a website source, add one FAQ, or bulk-import FAQs from CSV text (columns: question,answer).",
      schema: {
        action: z.enum([
          "list_collections",
          "list_sources",
          "get_source",
          "add_text",
          "add_url",
          "add_file",
          "delete_source",
          "recrawl",
          "add_faq",
          "import_faqs",
        ]),
        assistantId: z.string().optional().describe("Required for list_collections"),
        collectionId: z.string().optional().describe("Required for list_sources/add_*/import_faqs"),
        sourceId: z.string().optional().describe("Required for get_source/delete_source/recrawl"),
        name: z.string().optional().describe("Source name (add_text) / file name (add_file)"),
        text: z.string().optional().describe("Raw text (add_text)"),
        url: z.string().optional().describe("Page URL (add_url)"),
        fileBase64: z.string().optional().describe("File bytes, base64 (add_file)"),
        question: z.string().optional(),
        answer: z.string().optional(),
        csvText: z.string().optional().describe("CSV content (import_faqs)"),
      },
      mutates: byAction,
      run: async (args) => {
        switch (args.action) {
          case "list_collections":
            return client.knowledge.collections(need(args, "assistantId"));
          case "list_sources":
            return client.knowledge.sources(need(args, "collectionId"));
          case "get_source":
            return client.knowledge.getSource(need(args, "sourceId"));
          case "add_text":
            return client.knowledge.addTextSource(need(args, "collectionId"), {
              name: args.name as string | undefined,
              text: need(args, "text"),
            });
          case "add_url":
            return client.knowledge.addUrlSource(
              need(args, "collectionId"),
              need(args, "url")
            );
          case "add_file": {
            const bytes = Buffer.from(need(args, "fileBase64"), "base64");
            return client.knowledge.addFileSource(
              need(args, "collectionId"),
              new File([bytes], (args.name as string) || "upload.bin")
            );
          }
          case "delete_source":
            await client.knowledge.deleteSource(need(args, "sourceId"));
            return { deleted: args.sourceId };
          case "recrawl":
            return client.knowledge.recrawlSource(need(args, "sourceId"));
          case "add_faq":
            return client.knowledge.addFaq(need(args, "collectionId"), {
              question: need(args, "question"),
              answer: need(args, "answer"),
            });
          case "import_faqs":
            return client.knowledge.importFaqs(
              need(args, "collectionId"),
              new File([need(args, "csvText")], "faqs.csv", { type: "text/csv" })
            );
          default:
            throw new ToolInputError(`Unknown action "${args.action}"`);
        }
      },
    },
    {
      name: "manage_entities",
      description:
        "Manage Organization Entities and their typed Records. Read actions: list/get/list_records/query_records. Write actions: create/update/delete/import_records. User-scoped record access here is an admin operation; Widget runtime identity filtering remains server-enforced.",
      schema: {
        action: z.enum(["list", "get", "create", "update", "delete", "list_records", "query_records", "import_records"]),
        id: z.string().optional().describe("Entity id for get/update/delete"),
        entityId: z.string().optional().describe("Entity id for Record actions"),
        entity: z.record(z.string(), z.unknown()).optional().describe("EntityInput for create"),
        patch: z.record(z.string(), z.unknown()).optional().describe("name/description for update"),
        query: z.record(z.string(), z.unknown()).optional().describe("filters/search/limit for query_records"),
        csvText: z.string().optional().describe("CSV content for import_records"),
        limit: z.number().optional(),
        cursor: z.string().optional(),
        offset: z.number().optional(),
      },
      mutates: byAction,
      run: async (args) => {
        switch (args.action) {
          case "list":
            return client.entities.list({ limit: args.limit as number | undefined, cursor: args.cursor as string | undefined });
          case "get":
            return client.entities.get(need(args, "id"));
          case "create":
            if (!args.entity) throw new ToolInputError('"entity" is required for create');
            return client.entities.create(args.entity as never);
          case "update":
            if (!args.patch) throw new ToolInputError('"patch" is required for update');
            return client.entities.update(need(args, "id"), args.patch as never);
          case "delete":
            await client.entities.delete(need(args, "id"));
            return { deleted: args.id };
          case "list_records":
            return client.entities.listRecords(need(args, "entityId"), {
              limit: args.limit as number | undefined,
              offset: args.offset as number | undefined,
            });
          case "query_records":
            if (!args.query) throw new ToolInputError('"query" is required for query_records');
            return client.entities.queryRecords(need(args, "entityId"), args.query as never);
          case "import_records":
            return client.entities.importRecords(need(args, "entityId"), need(args, "csvText"));
          default:
            throw new ToolInputError(`Unknown action "${args.action}"`);
        }
      },
    },
    {
      name: "manage_memories",
      description:
        "Inspect long-term-memory settings and subjects, or perform erasure. Read actions: settings/subjects/list. Write actions: enable/disable/delete/wipe. Subject and memory access stays Organization-scoped on the server.",
      schema: {
        action: z.enum(["settings", "enable", "disable", "subjects", "list", "delete", "wipe"]),
        subjectId: z.string().optional(),
        memoryId: z.string().optional(),
        limit: z.number().optional(),
        cursor: z.string().optional(),
      },
      mutates: (args) => !new Set(["settings", "subjects", "list"]).has(String(args.action)),
      run: async (args) => {
        switch (args.action) {
          case "settings":
            return client.memories.settings();
          case "enable":
            return client.memories.setEnabled(true);
          case "disable":
            return client.memories.setEnabled(false);
          case "subjects":
            return client.memories.subjects({ limit: args.limit as number | undefined, cursor: args.cursor as string | undefined });
          case "list":
            return client.memories.list(need(args, "subjectId"));
          case "delete":
            await client.memories.delete(need(args, "memoryId"));
            return { deleted: args.memoryId };
          case "wipe":
            await client.memories.wipe(need(args, "subjectId"));
            return { wiped: args.subjectId };
          default:
            throw new ToolInputError(`Unknown action "${args.action}"`);
        }
      },
    },
    {
      name: "manage_sso",
      description:
        "Inspect or configure the Organization's verified SSO identity claim, the prerequisite for user-scoped Entity tools. `status` is read-only; `set_identity` sets a claim name or clears it with null. Configuration requires an admin-tier key and resets SSO validation.",
      schema: {
        action: z.enum(["status", "set_identity", "validate", "connection", "connect", "disconnect"]),
        identityClaim: z.string().nullable().optional(),
        input: z.record(z.string(), z.unknown()).optional().describe("Full SSO connection input for connect"),
      },
      mutates: (args) => !new Set(["status", "connection"]).has(String(args.action)),
      run: async (args) => {
        switch (args.action) {
          case "status":
            return client.sso.identity();
          case "set_identity":
            if (!("identityClaim" in args)) {
              throw new ToolInputError('"identityClaim" is required for set_identity');
            }
            return client.sso.setIdentityClaim(args.identityClaim as string | null);
          case "validate":
            return client.sso.validate();
          case "connection":
            return client.sso.connection();
          case "connect":
            return client.sso.connect(needObject(args, "input") as never);
          case "disconnect":
            await client.sso.disconnect();
            return { disconnected: true };
          default:
            throw new ToolInputError(`Unknown action "${args.action}"`);
        }
      },
    },
    {
      name: "publish_assistant",
      description:
        "Publication lifecycle (admin-tier key for writes): `status` (is it live, which version), `publish` (freeze the current config into a new immutable snapshot and serve it), `unpublish` (take the widget offline), `republish` (roll back to an earlier publicationId).",
      schema: {
        action: z.enum(["status", "publish", "unpublish", "republish"]),
        assistantId: z.string(),
        publicationId: z.string().optional().describe("Required for republish"),
      },
      mutates: byAction,
      run: async (args) => {
        const assistantId = need(args, "assistantId");
        switch (args.action) {
          case "status":
            return client.publish.status(assistantId);
          case "publish":
            return client.publish.publish(assistantId);
          case "unpublish":
            await client.publish.unpublish(assistantId);
            return { unpublished: assistantId };
          case "republish":
            return client.publish.republish(assistantId, need(args, "publicationId"));
          default:
            throw new ToolInputError(`Unknown action "${args.action}"`);
        }
      },
    },
    {
      name: "read_inbox",
      description:
        "Review and curate end-user Conversations: list/get/export transcripts, pin/unpin, send conversation feedback, set message feedback, or permanently delete a conversation.",
      schema: {
        action: z.enum(["list", "get", "export", "pin", "unpin", "feedback", "message_feedback", "delete"]),
        conversationId: z.string().optional().describe("Required for get"),
        conversationIds: z.array(z.string()).optional().describe("Required for export"),
        messageId: z.string().optional(),
        text: z.string().optional(),
        feedback: z.union([z.literal(-1), z.literal(0), z.literal(1)]).optional(),
        assistantId: z.string().optional(),
        limit: z.number().optional(),
        cursor: z.string().optional(),
      },
      mutates: byAction,
      run: async (args) => {
        switch (args.action) {
          case "list":
            return client.conversations.list({
              assistantId: args.assistantId as string | undefined,
              limit: args.limit as number | undefined,
              cursor: args.cursor as string | undefined,
            });
          case "get":
            return client.conversations.get(need(args, "conversationId"));
          case "export":
            if (!Array.isArray(args.conversationIds)) {
              throw new ToolInputError('"conversationIds" is required for export');
            }
            return client.conversations.export(args.conversationIds as string[]);
          case "pin":
          case "unpin":
            return client.conversations.setPinned(
              need(args, "conversationId"),
              args.action === "pin"
            );
          case "feedback":
            return client.conversations.feedback(
              need(args, "conversationId"),
              need(args, "text")
            );
          case "message_feedback":
            if (![1, 0, -1].includes(args.feedback as number)) {
              throw new ToolInputError('"feedback" must be -1, 0, or 1');
            }
            return client.messages.setFeedback(
              need(args, "messageId"),
              args.feedback as -1 | 0 | 1
            );
          case "delete":
            await client.conversations.delete(need(args, "conversationId"));
            return { deleted: args.conversationId };
          default:
            throw new ToolInputError(`Unknown action "${args.action}"`);
        }
      },
    },
    {
      name: "manage_improvements",
      description:
        "The answer-quality kanban: `list` items, `get` one (with the flagged messages and any drafted fix), `update` status/priority/tags/assigneeId/dueDate/title/description via `patch` — e.g. move a card to in_progress or done.",
      schema: {
        action: z.enum(["list", "get", "update"]),
        id: z.string().optional().describe("Improvement id (get/update)"),
        patch: z.record(z.string(), z.unknown()).optional().describe("ImprovementPatch (update)"),
        limit: z.number().optional(),
        cursor: z.string().optional(),
      },
      mutates: byAction,
      run: async (args) => {
        switch (args.action) {
          case "list":
            return client.improvements.list({
              limit: args.limit as number | undefined,
              cursor: args.cursor as string | undefined,
            });
          case "get":
            return client.improvements.get(need(args, "id"));
          case "update":
            if (!args.patch) throw new ToolInputError('"patch" is required for update');
            return client.improvements.update(need(args, "id"), args.patch as never);
          default:
            throw new ToolInputError(`Unknown action "${args.action}"`);
        }
      },
    },
    {
      name: "manage_help_desks",
      description:
        "Manage Help Desks, escalation channels, channel order, and ServiceNow ticketing. Credential-bearing responses are always redacted by the server.",
      schema: {
        action: z.enum(["list", "get", "create", "update", "delete", "add_channel", "update_channel", "delete_channel", "reorder_channels", "connect_servicenow", "disconnect_ticketing"]),
        id: z.string().optional().describe("Help Desk id"),
        channelId: z.string().optional(),
        input: z.record(z.string(), z.unknown()).optional(),
        patch: z.record(z.string(), z.unknown()).optional(),
        orderedIds: z.array(z.string()).optional(),
      },
      mutates: byAction,
      run: async (args) => {
        const id = () => need(args, "id");
        switch (args.action) {
          case "list": return client.helpDesks.list();
          case "get": return client.helpDesks.get(id());
          case "create": return client.helpDesks.create(needObject(args, "input") as never);
          case "update": return client.helpDesks.update(id(), needObject(args, "patch") as never);
          case "delete": await client.helpDesks.delete(id()); return { deleted: args.id };
          case "add_channel": return client.helpDesks.addChannel(id(), needObject(args, "input") as never);
          case "update_channel": return client.helpDesks.updateChannel(id(), need(args, "channelId"), needObject(args, "patch") as never);
          case "delete_channel": await client.helpDesks.deleteChannel(id(), need(args, "channelId")); return { deleted: args.channelId };
          case "reorder_channels":
            if (!Array.isArray(args.orderedIds)) throw new ToolInputError('"orderedIds" is required for reorder_channels');
            return client.helpDesks.reorderChannels(id(), args.orderedIds as string[]);
          case "connect_servicenow": return client.helpDesks.connectServiceNow(id(), needObject(args, "input") as never);
          case "disconnect_ticketing": return client.helpDesks.disconnectTicketing(id());
          default: throw new ToolInputError(`Unknown action "${args.action}"`);
        }
      },
    },
    {
      name: "manage_configuration",
      description:
        "Manage reusable Skills, per-Assistant Skill selection and standing Goals, and operational Alerts.",
      schema: {
        action: z.enum(["skill_list", "skill_create", "skill_update", "skill_delete", "assistant_skills_get", "assistant_skills_set", "goal_list", "goal_create", "goal_update", "goal_delete", "alert_list", "alert_resolve"]),
        id: z.string().optional().describe("Skill or Alert id"),
        assistantId: z.string().optional(),
        goalId: z.string().optional(),
        input: z.record(z.string(), z.unknown()).optional(),
        patch: z.record(z.string(), z.unknown()).optional(),
        skillIds: z.array(z.string()).optional(),
      },
      mutates: (args) => !new Set(["skill_list", "assistant_skills_get", "goal_list", "alert_list"]).has(String(args.action)),
      run: async (args) => {
        switch (args.action) {
          case "skill_list": return client.skills.list();
          case "skill_create": return client.skills.create(needObject(args, "input") as never);
          case "skill_update": return client.skills.update(need(args, "id"), needObject(args, "patch") as never);
          case "skill_delete": await client.skills.delete(need(args, "id")); return { deleted: args.id };
          case "assistant_skills_get": return client.assistants.skills(need(args, "assistantId"));
          case "assistant_skills_set":
            if (!Array.isArray(args.skillIds)) throw new ToolInputError('"skillIds" is required for assistant_skills_set');
            return client.assistants.setSkills(need(args, "assistantId"), args.skillIds as string[]);
          case "goal_list": return client.goals.list(need(args, "assistantId"));
          case "goal_create": return client.goals.create(need(args, "assistantId"), needObject(args, "input") as never);
          case "goal_update": return client.goals.update(need(args, "assistantId"), need(args, "goalId"), needObject(args, "patch") as never);
          case "goal_delete": await client.goals.delete(need(args, "assistantId"), need(args, "goalId")); return { deleted: args.goalId };
          case "alert_list": return client.alerts.list();
          case "alert_resolve": return client.alerts.resolve(need(args, "id"));
          default: throw new ToolInputError(`Unknown action "${args.action}"`);
        }
      },
    },
    {
      name: "manage_organization",
      description:
        "Manage Organization settings, Members, invitation links, and API keys. Secret keys are returned only once on creation; Role checks match the app.",
      schema: {
        action: z.enum(["get", "update", "member_list", "member_set_role", "member_remove", "invite_list", "invite_create", "invite_revoke", "api_key_list", "api_key_create", "api_key_revoke"]),
        id: z.string().optional().describe("Member user id, Invite id, or API key id"),
        input: z.record(z.string(), z.unknown()).optional(),
        patch: z.record(z.string(), z.unknown()).optional(),
        role: z.enum(["owner", "admin", "editor", "viewer"]).optional(),
      },
      mutates: (args) => !new Set(["get", "member_list", "invite_list", "api_key_list"]).has(String(args.action)),
      run: async (args) => {
        switch (args.action) {
          case "get": return client.organization.get();
          case "update": return client.organization.update(needObject(args, "patch") as never);
          case "member_list": return client.members.list();
          case "member_set_role": return client.members.setRole(need(args, "id"), need(args, "role") as never);
          case "member_remove": await client.members.remove(need(args, "id")); return { removed: args.id };
          case "invite_list": return client.invites.list();
          case "invite_create": return client.invites.create(needObject(args, "input") as never);
          case "invite_revoke": await client.invites.revoke(need(args, "id")); return { revoked: args.id };
          case "api_key_list": return client.apiKeys.list();
          case "api_key_create": return client.apiKeys.create(needObject(args, "input") as never);
          case "api_key_revoke": await client.apiKeys.revoke(need(args, "id")); return { revoked: args.id };
          default: throw new ToolInputError(`Unknown action "${args.action}"`);
        }
      },
    },
    {
      name: "manage_integrations",
      description:
        "Manage an Assistant's API integration and Organization model Provider Connections, including the preferred embedding provider.",
      schema: {
        action: z.enum(["api_get", "api_set", "api_delete", "provider_list", "provider_create_api_key", "provider_create_compatible", "provider_create_federated", "provider_delete", "provider_set_embedding"]),
        id: z.string().optional().describe("Assistant or Provider Connection id"),
        input: z.record(z.string(), z.unknown()).optional(),
        connectionId: z.string().nullable().optional(),
      },
      mutates: (args) => !new Set(["api_get", "provider_list"]).has(String(args.action)),
      run: async (args) => {
        switch (args.action) {
          case "api_get": return client.apiIntegrations.get(need(args, "id"));
          case "api_set": return client.apiIntegrations.set(need(args, "id"), needObject(args, "input") as never);
          case "api_delete": await client.apiIntegrations.delete(need(args, "id")); return { deleted: args.id };
          case "provider_list": return client.providers.list();
          case "provider_create_api_key": return client.providers.createApiKey(needObject(args, "input") as never);
          case "provider_create_compatible": return client.providers.createCompatible(needObject(args, "input") as never);
          case "provider_create_federated": return client.providers.createFederated(needObject(args, "input"));
          case "provider_delete": await client.providers.delete(need(args, "id")); return { deleted: args.id };
          case "provider_set_embedding":
            if (!("connectionId" in args)) throw new ToolInputError('"connectionId" is required for provider_set_embedding');
            return client.providers.setEmbedding(args.connectionId as string | null);
          default: throw new ToolInputError(`Unknown action "${args.action}"`);
        }
      },
    },
  ];
}
