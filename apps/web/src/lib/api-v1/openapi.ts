import { z } from "zod";
import type { ZodType } from "zod";
import {
  assistantPatchSchema,
  createAssistantOp,
  createFaqOp,
  flowInputSchema,
  flowPatchSchema,
  improvementPatchSchema,
  entityInputSchema,
  entityPatchSchema,
  entityRecordQuerySchema,
  connectServiceNowOp,
  helpDeskInputSchema,
  helpDeskPatchSchema,
  supportChannelInputSchema,
  supportChannelPatchSchema,
  goalExpectationsSchema,
  skillInputSchema,
  skillPatchSchema,
  organizationPatchSchema,
  apiIntegrationInputSchema,
  createFederatedProviderConnectionOp,
  createProviderApiKeyOp,
  openAiCompatibleInputSchema,
  ssoConnectionInputSchema,
} from "@ciele/ops";
import { API_V1_DOMAINS, API_V1_VERSION } from "@/lib/api-v1/meta";

/**
 * The /api/v1 contract registry (#626): one entry per shipped endpoint.
 *
 * This is the single list three things read:
 * - `buildOpenApiDocument()` turns it into the OpenAPI 3.1 document served
 *   at `GET /api/v1/openapi.json` (request bodies rendered from the same
 *   zod schemas the operations validate with — the contract cannot say
 *   something the server doesn't enforce);
 * - the drift test (`openapi.test.ts`) diffs it against the route files on
 *   disk, so shipping a route without registering it (or vice versa) fails
 *   CI;
 * - `@ciele/client` mirrors it method-for-method.
 */

export interface EndpointSpec {
  method: "get" | "post" | "put" | "patch" | "delete";
  /** OpenAPI-style path relative to /api/v1, e.g. "/assistants/{id}". */
  path: string;
  summary: string;
  /** Zod schema of the JSON request body, when the endpoint takes one. */
  body?: ZodType;
  /** Multipart endpoints document their form fields instead of a body. */
  multipart?: string[];
  /** False only for the discovery endpoints. */
  auth?: boolean;
  /** Honors the Idempotency-Key header. */
  idempotent?: boolean;
}

const reorderBody = z.object({ orderedIds: z.array(z.string()) });
const republishBody = z.object({ publicationId: z.string() });
const exportBody = z.object({ conversationIds: z.array(z.string()) });
const faqBody = createFaqOp.input;
const sourceBody = z.union([
  z.object({
    kind: z.literal("text"),
    name: z.string().optional(),
    text: z.string(),
  }),
  z.object({ kind: z.literal("url"), url: z.string() }),
]);
const memorySettingsBody = z.object({ enabled: z.boolean() });
const entityImportBody = z.object({ csv: z.string() });
const assistantEntitiesBody = z.object({ entityIds: z.array(z.string()) });
const ssoIdentityBody = z.object({ identityClaim: z.string().nullable() });
const assistantSkillsBody = z.object({ skillIds: z.array(z.string()) });
const goalBody = z.object({
  question: z.string(),
  expectations: goalExpectationsSchema,
});
const goalPatchBody = z.object({
  question: z.string().optional(),
  expectations: goalExpectationsSchema.optional(),
  status: z.enum(["active", "quarantined"]).optional(),
});
const roleSchema = z.enum(["owner", "admin", "editor", "viewer"]);
const memberRoleBody = z.object({ role: roleSchema });
const inviteBody = z.object({ role: roleSchema, email: z.string().email().optional() });
const apiKeyBody = z.object({ name: z.string(), role: roleSchema });
const embeddingConnectionBody = z.object({ connectionId: z.string().nullable() });
const conversationPinnedBody = z.object({ pinned: z.boolean() });
const conversationFeedbackBody = z.object({ text: z.string().trim().min(1).max(2_000) });
const messageFeedbackBody = z.object({ feedback: z.union([z.literal(-1), z.literal(0), z.literal(1)]) });

export const API_V1_ENDPOINTS: EndpointSpec[] = [
  { method: "get", path: "/meta", summary: "Discovery: API version, server version, shipped domains", auth: false },
  { method: "get", path: "/openapi.json", summary: "This document", auth: false },
  { method: "get", path: "/whoami", summary: "The key's Organization, Role and id" },

  // Assistants (#620)
  { method: "get", path: "/assistants", summary: "List Assistants (cursor pagination)" },
  { method: "post", path: "/assistants", summary: "Create an Assistant", body: createAssistantOp.input, idempotent: true },
  { method: "get", path: "/assistants/{id}", summary: "One Assistant" },
  { method: "patch", path: "/assistants/{id}", summary: "Update an Assistant", body: assistantPatchSchema },
  { method: "delete", path: "/assistants/{id}", summary: "Delete an Assistant (admin+)" },
  { method: "post", path: "/assistants/{id}/duplicate", summary: "Duplicate: config + Flows; knowledge stays", idempotent: true },
  { method: "get", path: "/assistants/{id}/entities", summary: "Get the Assistant's selected Entities" },
  { method: "patch", path: "/assistants/{id}/entities", summary: "Replace the Assistant's selected Entities", body: assistantEntitiesBody },

  // Flows (#621)
  { method: "get", path: "/assistants/{id}/flows", summary: "An Assistant's ordered Flow list" },
  { method: "post", path: "/assistants/{id}/flows", summary: "Create a Flow", body: flowInputSchema, idempotent: true },
  { method: "post", path: "/assistants/{id}/flows/reorder", summary: "Reorder Flows (Default stays last)", body: reorderBody },
  { method: "get", path: "/flows/{id}", summary: "One Flow (full router config)" },
  { method: "patch", path: "/flows/{id}", summary: "Update a Flow (incl. enable/disable)", body: flowPatchSchema },
  { method: "delete", path: "/flows/{id}", summary: "Delete a Flow (Default behavior refuses, 409)" },

  // Knowledge (#622)
  { method: "get", path: "/assistants/{id}/collections", summary: "An Assistant's Knowledge Collections" },
  { method: "get", path: "/collections/{id}/sources", summary: "A Collection's Sources (with status)" },
  { method: "post", path: "/collections/{id}/sources", summary: "Add a Source: JSON text/url, or multipart file", body: sourceBody, multipart: ["file"], idempotent: true },
  { method: "post", path: "/collections/{id}/faqs", summary: "Add one FAQ", body: faqBody, idempotent: true },
  { method: "post", path: "/collections/{id}/faqs/import", summary: "Bulk FAQ import (CSV)", multipart: ["file"] },
  { method: "get", path: "/sources/{id}", summary: "One Source — poll status until it settles" },
  { method: "delete", path: "/sources/{id}", summary: "Delete a Source (Concepts cascade)" },
  { method: "post", path: "/sources/{id}/recrawl", summary: "Restart a website Source's crawl" },

  // Publish (#623)
  { method: "get", path: "/assistants/{id}/publish", summary: "Publication status" },
  { method: "post", path: "/assistants/{id}/publish", summary: "Publish a new snapshot (admin+)", idempotent: true },
  { method: "delete", path: "/assistants/{id}/publish", summary: "Unpublish (admin+)" },
  { method: "post", path: "/assistants/{id}/republish", summary: "Re-activate an earlier Publication (admin+)", body: republishBody, idempotent: true },

  // Inbox (#624)
  { method: "get", path: "/conversations", summary: "List Conversations (?assistantId= filter)" },
  { method: "get", path: "/conversations/{id}", summary: "One transcript (trace gated by Role)" },
  { method: "patch", path: "/conversations/{id}", summary: "Pin or unpin a Conversation", body: conversationPinnedBody },
  { method: "delete", path: "/conversations/{id}", summary: "Delete a Conversation" },
  { method: "post", path: "/conversations/{id}/feedback", summary: "Send Conversation feedback", body: conversationFeedbackBody },
  { method: "post", path: "/conversations/export", summary: "29-field export records", body: exportBody },
  { method: "patch", path: "/messages/{id}/feedback", summary: "Set Message feedback", body: messageFeedbackBody },

  // Improvements (#625)
  { method: "get", path: "/improvements", summary: "The Improvements kanban" },
  { method: "get", path: "/improvements/{id}", summary: "One Improvement (associations + proposal)" },
  { method: "patch", path: "/improvements/{id}", summary: "Update an Improvement", body: improvementPatchSchema },

  // Organization data (#663, #665, #667)
  { method: "get", path: "/entities", summary: "List Organization Entities" },
  { method: "post", path: "/entities", summary: "Create an Entity", body: entityInputSchema },
  { method: "get", path: "/entities/{id}", summary: "One Entity" },
  { method: "patch", path: "/entities/{id}", summary: "Update an Entity", body: entityPatchSchema },
  { method: "delete", path: "/entities/{id}", summary: "Delete an Entity and its Records" },
  { method: "get", path: "/entities/{id}/records", summary: "Browse an Entity's Records" },
  { method: "post", path: "/entities/{id}/records/query", summary: "Filter or search typed Records", body: entityRecordQuerySchema },
  { method: "post", path: "/entities/{id}/records/import", summary: "Import and idempotently upsert Records from CSV", body: entityImportBody },

  // Long-term memory management (#664, #666)
  { method: "get", path: "/memories/settings", summary: "Long-term memory status" },
  { method: "patch", path: "/memories/settings", summary: "Enable or disable long-term memory", body: memorySettingsBody },
  { method: "get", path: "/memories/subjects", summary: "List subjects holding Memories" },
  { method: "get", path: "/memories/subjects/{subjectId}", summary: "List one subject's Memories" },
  { method: "delete", path: "/memories/subjects/{subjectId}", summary: "Erase all Memories for a subject" },
  { method: "delete", path: "/memories/{id}", summary: "Delete one Memory" },

  // SSO identity threading (#662)
  { method: "get", path: "/sso/identity", summary: "Read the SSO identity-claim configuration" },
  { method: "patch", path: "/sso/identity", summary: "Set or clear the SSO identity claim", body: ssoIdentityBody },
  { method: "post", path: "/sso/identity/validate", summary: "Validate the stored SSO connection" },

  // Help desks and escalation channels
  { method: "get", path: "/help-desks", summary: "List Help Desks" },
  { method: "post", path: "/help-desks", summary: "Create a Help Desk", body: helpDeskInputSchema },
  { method: "get", path: "/help-desks/{id}", summary: "One Help Desk with ordered channels" },
  { method: "patch", path: "/help-desks/{id}", summary: "Update a Help Desk", body: helpDeskPatchSchema },
  { method: "delete", path: "/help-desks/{id}", summary: "Delete a Help Desk" },
  { method: "post", path: "/help-desks/{id}/channels", summary: "Add an escalation channel", body: supportChannelInputSchema },
  { method: "patch", path: "/help-desks/{id}/channels/{channelId}", summary: "Update an escalation channel", body: supportChannelPatchSchema },
  { method: "delete", path: "/help-desks/{id}/channels/{channelId}", summary: "Delete an escalation channel" },
  { method: "post", path: "/help-desks/{id}/channels/reorder", summary: "Reorder escalation channels", body: reorderBody },
  { method: "delete", path: "/help-desks/{id}/ticketing", summary: "Disconnect ticketing integration" },
  { method: "post", path: "/help-desks/{id}/ticketing/servicenow", summary: "Connect ServiceNow ticketing", body: connectServiceNowOp.input },

  // Reusable Skills, standing Goals, and operational Alerts
  { method: "get", path: "/skills", summary: "List Organization Skills" },
  { method: "post", path: "/skills", summary: "Create a Skill", body: skillInputSchema },
  { method: "patch", path: "/skills/{id}", summary: "Update a Skill", body: skillPatchSchema },
  { method: "delete", path: "/skills/{id}", summary: "Delete a Skill" },
  { method: "get", path: "/assistants/{id}/skills", summary: "List an Assistant's attached Skills" },
  { method: "patch", path: "/assistants/{id}/skills", summary: "Replace an Assistant's attached Skills", body: assistantSkillsBody },
  { method: "get", path: "/assistants/{id}/goals", summary: "List an Assistant's standing Goals" },
  { method: "post", path: "/assistants/{id}/goals", summary: "Create a standing Goal", body: goalBody },
  { method: "patch", path: "/assistants/{id}/goals/{goalId}", summary: "Update a standing Goal", body: goalPatchBody },
  { method: "delete", path: "/assistants/{id}/goals/{goalId}", summary: "Delete a standing Goal" },
  { method: "get", path: "/alerts", summary: "List operational Alerts" },
  { method: "post", path: "/alerts/{id}/resolve", summary: "Resolve an operational Alert" },

  // Organization administration
  { method: "get", path: "/organization", summary: "Read Organization settings" },
  { method: "patch", path: "/organization", summary: "Update Organization settings", body: organizationPatchSchema },
  { method: "get", path: "/members", summary: "List Organization Members" },
  { method: "patch", path: "/members/{userId}", summary: "Change a Member role", body: memberRoleBody },
  { method: "delete", path: "/members/{userId}", summary: "Remove a Member" },
  { method: "get", path: "/invites", summary: "List pending invitations" },
  { method: "post", path: "/invites", summary: "Create an invitation", body: inviteBody },
  { method: "delete", path: "/invites/{id}", summary: "Revoke an invitation" },
  { method: "get", path: "/api-keys", summary: "List Organization API keys" },
  { method: "post", path: "/api-keys", summary: "Mint an API key; secret returned once", body: apiKeyBody },
  { method: "delete", path: "/api-keys/{id}", summary: "Revoke an API key" },

  // Assistant API catalogue, SSO connection, and model providers
  { method: "get", path: "/assistants/{id}/api-integration", summary: "Read an Assistant's API integration (secret-safe)" },
  { method: "put", path: "/assistants/{id}/api-integration", summary: "Create or replace an Assistant API integration", body: apiIntegrationInputSchema },
  { method: "delete", path: "/assistants/{id}/api-integration", summary: "Delete an Assistant API integration" },
  { method: "get", path: "/sso/connection", summary: "Read the full non-secret SSO configuration" },
  { method: "put", path: "/sso/connection", summary: "Create or replace the SSO connection", body: ssoConnectionInputSchema },
  { method: "delete", path: "/sso/connection", summary: "Disconnect SSO" },
  { method: "get", path: "/providers", summary: "List model Provider Connections (secret-safe)" },
  { method: "post", path: "/providers/api-key", summary: "Create and validate a BYOK Provider Connection", body: createProviderApiKeyOp.input },
  { method: "post", path: "/providers/openai-compatible", summary: "Create an OpenAI-compatible Provider Connection", body: openAiCompatibleInputSchema },
  { method: "post", path: "/providers/federated", summary: "Create a federated cloud Provider Connection", body: createFederatedProviderConnectionOp.input },
  { method: "delete", path: "/providers/{id}", summary: "Delete a Provider Connection" },
  { method: "patch", path: "/providers/embedding", summary: "Choose the embedding Provider Connection", body: embeddingConnectionBody },
];

const ERROR_SCHEMA = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: { code: { type: "string" }, message: { type: "string" } },
      required: ["code", "message"],
    },
  },
  required: ["error"],
} as const;

function pathParams(path: string) {
  return [...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
    name,
    in: "path" as const,
    required: true,
    schema: { type: "string" as const },
  }));
}

/** The served document. Kept dependency-free: zod v4 renders JSON Schema. */
export function buildOpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const endpoint of API_V1_ENDPOINTS) {
    const entry: Record<string, unknown> = {
      summary: endpoint.summary,
      parameters: pathParams(endpoint.path),
      security: endpoint.auth === false ? [] : [{ apiKey: [] }],
      responses: {
        "2XX": { description: "Success" },
        "4XX": {
          description: "Error envelope",
          content: { "application/json": { schema: ERROR_SCHEMA } },
        },
      },
    };
    const content: Record<string, unknown> = {};
    if (endpoint.body) {
      content["application/json"] = {
        // Structured config fields validated with z.custom (quick replies,
        // flow settings) have no JSON-Schema form — they render as {} (any).
        schema: z.toJSONSchema(endpoint.body, {
          io: "input",
          target: "draft-7",
          unrepresentable: "any",
        }),
      };
    }
    if (endpoint.multipart) {
      content["multipart/form-data"] = {
        schema: {
          type: "object",
          properties: Object.fromEntries(
            endpoint.multipart.map((f) => [f, { type: "string", format: "binary" }])
          ),
        },
      };
    }
    if (Object.keys(content).length > 0) {
      entry.requestBody = { required: true, content };
    }
    (paths[`/api/v1${endpoint.path}`] ??= {})[endpoint.method] = entry;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "ciele API",
      version: `${API_V1_VERSION}.0.0`,
      description: `Org-scoped admin API. Authenticate with an API key (Bearer ciele_sk_…). Domains: ${API_V1_DOMAINS.join(", ")}.`,
    },
    components: {
      securitySchemes: {
        apiKey: { type: "http", scheme: "bearer", bearerFormat: "ciele_sk_…" },
      },
    },
    paths,
  };
}
