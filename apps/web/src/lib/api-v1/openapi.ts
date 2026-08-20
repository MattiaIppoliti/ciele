import { z } from "zod";
import type { ZodType } from "zod";
import {
  assistantPatchSchema,
  createAssistantOp,
  createFaqOp,
  createOrgFaqOp,
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
import { API_V1_DOMAINS, API_V1_VERSION, type ApiV1Domain } from "@/lib/api-v1/meta";
import type { ApiCapability } from "@/lib/api-v1/auth";

/**
 * The /api/v1 contract registry (#626): one entry per shipped endpoint.
 *
 * This is the single list three things read:
 * - `buildOpenApiDocument()` turns it into the OpenAPI 3.1 document served
 *   at `GET /api/v1/openapi.json` (request bodies rendered from the same
 *   zod schemas the operations validate with, the contract cannot say
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
  /**
   * Which domain slice this endpoint belongs to. Absent only on the three
   * discovery endpoints, which describe the deployment rather than a domain.
   * This is what groups the Developer Panel (#754) and what a navigation entry
   * claims through `apiDomains`.
   */
  domain?: ApiV1Domain;
  /**
   * The Role an API key must carry, mirroring the capability the operation this
   * route executes declares in `@ciele/ops`. Never inferred from the verb:
   * `openapi.test.ts` derives the truth from the route file and fails on a
   * mismatch, which is why this can be trusted to render a badge.
   */
  capability?: ApiCapability;
  /**
   * `ciele …` command for this endpoint, as a template over the placeholder
   * vocabulary in `lib/developer-panel/snippets.ts`. Absent means no CLI verb
   * covers it, the panel says so in words rather than showing an empty block.
   */
  cli?: string;
  /**
   * Arguments for the domain's coarse MCP tool, as a JSON template. The tool
   * *name* lives on the domain (many endpoints share one tool); the `action`
   * and its arguments are per-endpoint, hence a template here.
   */
  mcp?: string;
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
const orgFaqBody = createOrgFaqOp.input;
const linksBody = z.object({ assistantIds: z.array(z.string().min(1)).max(50) });
const directAccessBody = z.object({
  assistantId: z.string().min(1),
  directAccess: z.boolean(),
});
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
  {
    method: "get",
    path: "/assistants",
    domain: "assistants",
    capability: "member",
    summary: "List Assistants (cursor pagination)",
    cli: "ciele assistants list --limit 20",
    mcp: '{"action":"list","limit":20}',
  },
  {
    method: "post",
    path: "/assistants",
    domain: "assistants",
    capability: "edit",
    summary: "Create an Assistant",
    body: createAssistantOp.input,
    idempotent: true,
    cli: 'ciele assistants create --title "Support assistant"',
    mcp: '{"action":"create","title":"Support assistant"}',
  },
  {
    method: "get",
    path: "/assistants/{id}",
    domain: "assistants",
    capability: "member",
    summary: "One Assistant",
    cli: "ciele assistants get {assistantId}",
    mcp: '{"action":"get","id":"{assistantId}"}',
  },
  {
    method: "patch",
    path: "/assistants/{id}",
    domain: "assistants",
    capability: "edit",
    summary: "Update an Assistant",
    body: assistantPatchSchema,
    cli: 'ciele assistants update {assistantId} --nickname "Support"',
    mcp: '{"action":"update","id":"{assistantId}","patch":{"nickname":"Support"}}',
  },
  {
    method: "delete",
    path: "/assistants/{id}",
    domain: "assistants",
    capability: "publish",
    summary: "Delete an Assistant (admin+)",
    cli: "ciele assistants delete {assistantId} --yes",
    mcp: '{"action":"delete","id":"{assistantId}"}',
  },
  {
    method: "post",
    path: "/assistants/{id}/duplicate",
    domain: "assistants",
    capability: "edit",
    summary: "Duplicate: config + Flows; knowledge stays",
    idempotent: true,
    cli: "ciele assistants duplicate {assistantId}",
    mcp: '{"action":"duplicate","id":"{assistantId}"}',
  },
  {
    method: "get",
    path: "/assistants/{id}/entities",
    domain: "assistants",
    capability: "member",
    summary: "Get the Assistant's selected Entities",
    cli: "ciele assistants get-entities {assistantId}",
    mcp: '{"action":"get_entities","id":"{assistantId}"}',
  },
  {
    method: "patch",
    path: "/assistants/{id}/entities",
    domain: "assistants",
    capability: "edit",
    summary: "Replace the Assistant's selected Entities",
    body: assistantEntitiesBody,
    cli: "ciele assistants set-entities {assistantId} --ids {entityId}",
    mcp: '{"action":"set_entities","id":"{assistantId}","entityIds":["{entityId}"]}',
  },

  // Flows (#621)
  {
    method: "get",
    path: "/assistants/{id}/flows",
    domain: "flows",
    capability: "member",
    summary: "An Assistant's ordered Flow list",
    cli: "ciele flows list {assistantId}",
    mcp: '{"action":"list","assistantId":"{assistantId}"}',
  },
  {
    method: "post",
    path: "/assistants/{id}/flows",
    domain: "flows",
    capability: "edit",
    summary: "Create a Flow",
    body: flowInputSchema,
    idempotent: true,
    // The router config is deeper than flags can carry, so the CLI reads it
    // from a file; the panel shows the shape it expects in the cURL tab.
    cli: 'ciele flows create {assistantId} --name "Escalate to a human" --file flow.json',
    mcp: '{"action":"create","assistantId":"{assistantId}","flow":{"name":"Escalate to a human"}}',
  },
  {
    method: "post",
    path: "/assistants/{id}/flows/reorder",
    domain: "flows",
    capability: "edit",
    summary: "Reorder Flows (Default stays last)",
    body: reorderBody,
    cli: "ciele flows reorder {assistantId} --ids {flowId},{flowId}",
    mcp: '{"action":"reorder","assistantId":"{assistantId}","orderedIds":["{flowId}"]}',
  },
  {
    method: "get",
    path: "/flows/{id}",
    domain: "flows",
    capability: "member",
    summary: "One Flow (full router config)",
    cli: "ciele flows get {flowId}",
    mcp: '{"action":"get","id":"{flowId}"}',
  },
  {
    method: "patch",
    path: "/flows/{id}",
    domain: "flows",
    capability: "edit",
    summary: "Update a Flow (incl. enable/disable)",
    body: flowPatchSchema,
    cli: "ciele flows update {flowId} --enabled false",
    mcp: '{"action":"update","id":"{flowId}","flow":{"enabled":false}}',
  },
  {
    method: "delete",
    path: "/flows/{id}",
    domain: "flows",
    capability: "edit",
    summary: "Delete a Flow (Default behavior refuses, 409)",
    cli: "ciele flows delete {flowId} --yes",
    mcp: '{"action":"delete","id":"{flowId}"}',
  },

  // Knowledge (#622)
  {
    method: "get",
    path: "/assistants/{id}/collections",
    domain: "knowledge",
    capability: "member",
    summary: "An Assistant's Knowledge Collections",
    cli: "ciele collections list {assistantId}",
    mcp: '{"action":"list_collections","assistantId":"{assistantId}"}',
  },
  {
    method: "get",
    path: "/collections/{id}/sources",
    domain: "knowledge",
    capability: "member",
    summary: "A Collection's Sources (with status)",
    cli: "ciele sources list {collectionId}",
    mcp: '{"action":"list_sources","collectionId":"{collectionId}"}',
  },
  {
    method: "post",
    path: "/collections/{id}/sources",
    domain: "knowledge",
    capability: "edit",
    summary: "Add a Source: JSON text/url, or multipart file",
    body: sourceBody,
    multipart: ["file"],
    idempotent: true,
    cli: "ciele sources add-url {collectionId} --url https://example.com/help",
    mcp: '{"action":"add_url","collectionId":"{collectionId}","url":"https://example.com/help"}',
  },
  {
    method: "post",
    path: "/collections/{id}/faqs",
    domain: "knowledge",
    capability: "edit",
    summary: "Add one FAQ",
    body: faqBody,
    idempotent: true,
    cli: 'ciele faqs add {collectionId} --question "How do I reset my password?" --answer "Use the reset link on the sign-in page."',
    mcp: '{"action":"add_faq","collectionId":"{collectionId}","question":"How do I reset my password?","answer":"Use the reset link on the sign-in page."}',
  },
  {
    method: "post",
    path: "/collections/{id}/faqs/import",
    domain: "knowledge",
    capability: "edit",
    summary: "Bulk FAQ import (CSV)",
    multipart: ["file"],
    cli: "ciele faqs import {collectionId} --file faqs.csv",
    mcp: '{"action":"import_faqs","collectionId":"{collectionId}","csvText":"question,answer\\n…"}',
  },
  {
    method: "get",
    path: "/sources/{id}",
    domain: "knowledge",
    capability: "member",
    summary: "One Source, poll status until it settles",
    cli: "ciele sources get {sourceId}",
    mcp: '{"action":"get_source","sourceId":"{sourceId}"}',
  },
  {
    method: "delete",
    path: "/sources/{id}",
    domain: "knowledge",
    capability: "edit",
    summary: "Delete a Source (Concepts cascade)",
    cli: "ciele sources delete {sourceId} --yes",
    mcp: '{"action":"delete_source","sourceId":"{sourceId}"}',
  },
  {
    method: "post",
    path: "/sources/{id}/recrawl",
    domain: "knowledge",
    capability: "edit",
    summary: "Restart a website Source's crawl",
    cli: "ciele sources recrawl {sourceId}",
    mcp: '{"action":"recrawl","sourceId":"{sourceId}"}',
  },

  // The Library (PRD #726): org-level knowledge across all assistants
  {
    method: "get",
    path: "/knowledge/sources",
    domain: "knowledge",
    capability: "member",
    summary: "Org-wide knowledge items (?kinds=&status=&assistantId=&q=&page=&pageSize=)",
    cli: "ciele sources list-org --kinds website,file --status ready",
    mcp: '{"action":"list_org_sources","kinds":["website","file"],"status":"ready"}',
  },
  {
    method: "put",
    path: "/sources/{id}/links",
    domain: "knowledge",
    capability: "edit",
    summary: "Replace a Source's linked-assistant set",
    body: linksBody,
    cli: "ciele sources link {sourceId} --assistants {assistantId}",
    mcp: '{"action":"set_links","sourceId":"{sourceId}","assistantIds":["{assistantId}"]}',
  },
  {
    method: "put",
    path: "/sources/{id}/direct-access",
    domain: "knowledge",
    capability: "edit",
    summary: "Flip Direct access for one assistant on a file Source",
    body: directAccessBody,
    cli: "ciele sources direct-access {sourceId} on --assistant {assistantId}",
    mcp: '{"action":"set_direct_access","sourceId":"{sourceId}","assistantId":"{assistantId}","directAccess":true}',
  },
  {
    method: "post",
    path: "/knowledge/faqs",
    domain: "knowledge",
    capability: "edit",
    summary: "Add one org-level FAQ (Knowledge Library)",
    body: orgFaqBody,
    idempotent: true,
    cli: 'ciele faqs add-org --question "What are your opening hours?" --answer "09:00 to 17:00, Monday to Friday." --assistants {assistantId}',
    mcp: '{"action":"add_org_faq","question":"What are your opening hours?","answer":"09:00 to 17:00, Monday to Friday.","assistantIds":["{assistantId}"]}',
  },
  {
    method: "post",
    path: "/knowledge/faqs/import",
    domain: "knowledge",
    capability: "edit",
    summary: "Org-level bulk FAQ import (CSV)",
    multipart: ["file"],
    cli: "ciele faqs import-org --file faqs.csv",
    mcp: '{"action":"import_org_faqs","csvText":"question,answer\\n…"}',
  },
  {
    method: "get",
    path: "/knowledge/faqs/export",
    domain: "knowledge",
    capability: "member",
    summary: "Org-wide FAQ CSV export",
    cli: "ciele faqs export",
    mcp: '{"action":"export_faqs"}',
  },

  // Publish (#623)
  {
    method: "get",
    path: "/assistants/{id}/publish",
    domain: "publish",
    capability: "member",
    summary: "Publication status",
    cli: "ciele publish status {assistantId}",
    mcp: '{"action":"status","assistantId":"{assistantId}"}',
  },
  {
    method: "post",
    path: "/assistants/{id}/publish",
    domain: "publish",
    capability: "publish",
    summary: "Publish a new snapshot (admin+)",
    idempotent: true,
    cli: "ciele publish create {assistantId}",
    mcp: '{"action":"publish","assistantId":"{assistantId}"}',
  },
  {
    method: "delete",
    path: "/assistants/{id}/publish",
    domain: "publish",
    capability: "publish",
    summary: "Unpublish (admin+)",
    cli: "ciele publish remove {assistantId} --yes",
    mcp: '{"action":"unpublish","assistantId":"{assistantId}"}',
  },
  {
    method: "post",
    path: "/assistants/{id}/republish",
    domain: "publish",
    capability: "publish",
    summary: "Re-activate an earlier Publication (admin+)",
    body: republishBody,
    idempotent: true,
    cli: "ciele publish restore {assistantId} {publicationId}",
    mcp: '{"action":"republish","assistantId":"{assistantId}","publicationId":"{publicationId}"}',
  },

  // Inbox (#624)
  {
    method: "get",
    path: "/conversations",
    domain: "inbox",
    capability: "member",
    summary: "List Conversations (?assistantId= filter)",
    cli: "ciele conversations list --assistant {assistantId} --limit 20",
    mcp: '{"action":"list","assistantId":"{assistantId}","limit":20}',
  },
  {
    method: "get",
    path: "/conversations/{id}",
    domain: "inbox",
    capability: "member",
    summary: "One transcript (trace gated by Role)",
    cli: "ciele conversations get {conversationId}",
    mcp: '{"action":"get","conversationId":"{conversationId}"}',
  },
  {
    method: "patch",
    path: "/conversations/{id}",
    domain: "inbox",
    capability: "member",
    summary: "Pin or unpin a Conversation",
    body: conversationPinnedBody,
    cli: "ciele conversations pin {conversationId}",
    mcp: '{"action":"pin","conversationId":"{conversationId}"}',
  },
  {
    method: "delete",
    path: "/conversations/{id}",
    domain: "inbox",
    capability: "member",
    summary: "Delete a Conversation",
    cli: "ciele conversations delete {conversationId} --yes",
    mcp: '{"action":"delete","conversationId":"{conversationId}"}',
  },
  {
    method: "post",
    path: "/conversations/{id}/feedback",
    domain: "inbox",
    capability: "member",
    summary: "Send Conversation feedback",
    body: conversationFeedbackBody,
    cli: 'ciele conversations feedback {conversationId} --text "Answered the wrong question."',
    mcp: '{"action":"feedback","conversationId":"{conversationId}","text":"Answered the wrong question."}',
  },
  {
    method: "post",
    path: "/conversations/export",
    domain: "inbox",
    capability: "member",
    summary: "29-field export records",
    body: exportBody,
    cli: "ciele conversations export {conversationId} --out export.json",
    mcp: '{"action":"export","conversationIds":["{conversationId}"]}',
  },
  {
    method: "patch",
    path: "/messages/{id}/feedback",
    domain: "inbox",
    capability: "member",
    summary: "Set Message feedback",
    body: messageFeedbackBody,
    cli: "ciele messages feedback {messageId} --value 1",
    mcp: '{"action":"message_feedback","messageId":"{messageId}","feedback":1}',
  },

  // Improvements (#625)
  {
    method: "get",
    path: "/improvements",
    domain: "improvements",
    capability: "member",
    summary: "The Improvements kanban",
    cli: "ciele improvements list --limit 20",
    mcp: '{"action":"list","limit":20}',
  },
  {
    method: "get",
    path: "/improvements/{id}",
    domain: "improvements",
    capability: "member",
    summary: "One Improvement (associations + proposal)",
    cli: "ciele improvements get {improvementId}",
    mcp: '{"action":"get","id":"{improvementId}"}',
  },
  {
    method: "patch",
    path: "/improvements/{id}",
    domain: "improvements",
    capability: "edit",
    summary: "Update an Improvement",
    body: improvementPatchSchema,
    cli: "ciele improvements update {improvementId} --priority high",
    mcp: '{"action":"update","id":"{improvementId}","patch":{"priority":"high"}}',
  },

  // Organization data (#663, #665, #667)
  {
    method: "get",
    path: "/entities",
    domain: "entities",
    capability: "member",
    summary: "List Organization Entities",
    cli: "ciele entities list",
    mcp: '{"action":"list"}',
  },
  {
    method: "post",
    path: "/entities",
    domain: "entities",
    capability: "edit",
    summary: "Create an Entity",
    body: entityInputSchema,
    cli: "ciele entities create --file entity.json",
    mcp: '{"action":"create","entity":{"name":"Product"}}',
  },
  {
    method: "get",
    path: "/entities/{id}",
    domain: "entities",
    capability: "member",
    summary: "One Entity",
    cli: "ciele entities get {entityId}",
    mcp: '{"action":"get","id":"{entityId}"}',
  },
  {
    method: "patch",
    path: "/entities/{id}",
    domain: "entities",
    capability: "edit",
    summary: "Update an Entity",
    body: entityPatchSchema,
    cli: 'ciele entities update {entityId} --name "Products"',
    mcp: '{"action":"update","id":"{entityId}","patch":{"name":"Products"}}',
  },
  {
    method: "delete",
    path: "/entities/{id}",
    domain: "entities",
    capability: "edit",
    summary: "Delete an Entity and its Records",
    cli: "ciele entities delete {entityId} --yes",
    mcp: '{"action":"delete","id":"{entityId}"}',
  },
  {
    method: "get",
    path: "/entities/{id}/records",
    domain: "entities",
    capability: "member",
    summary: "Browse an Entity's Records",
    cli: "ciele records list {entityId} --limit 50",
    mcp: '{"action":"list_records","entityId":"{entityId}","limit":50}',
  },
  {
    method: "post",
    path: "/entities/{id}/records/query",
    domain: "entities",
    capability: "member",
    summary: "Filter or search typed Records",
    body: entityRecordQuerySchema,
    cli: "ciele records query {entityId} --file query.json",
    mcp: '{"action":"query_records","entityId":"{entityId}","query":{}}',
  },
  {
    method: "post",
    path: "/entities/{id}/records/import",
    domain: "entities",
    capability: "edit",
    summary: "Import and idempotently upsert Records from CSV",
    body: entityImportBody,
    cli: "ciele records import {entityId} --file records.csv",
    mcp: '{"action":"import_records","entityId":"{entityId}","csvText":"id,name\\n…"}',
  },

  // Long-term memory management (#664, #666)
  {
    method: "get",
    path: "/memories/settings",
    domain: "memories",
    capability: "member",
    summary: "Long-term memory status",
    cli: "ciele memories status",
    mcp: '{"action":"settings"}',
  },
  {
    method: "patch",
    path: "/memories/settings",
    domain: "memories",
    capability: "manageMembers",
    summary: "Enable or disable long-term memory",
    body: memorySettingsBody,
    cli: "ciele memories enable",
    mcp: '{"action":"enable"}',
  },
  {
    method: "get",
    path: "/memories/subjects",
    domain: "memories",
    capability: "member",
    summary: "List subjects holding Memories",
    cli: "ciele memories subjects --limit 50",
    mcp: '{"action":"subjects","limit":50}',
  },
  {
    method: "get",
    path: "/memories/subjects/{subjectId}",
    domain: "memories",
    capability: "member",
    summary: "List one subject's Memories",
    cli: "ciele memories list {subjectId}",
    mcp: '{"action":"list","subjectId":"{subjectId}"}',
  },
  {
    method: "delete",
    path: "/memories/subjects/{subjectId}",
    domain: "memories",
    capability: "edit",
    summary: "Erase all Memories for a subject",
    cli: "ciele memories wipe {subjectId} --yes",
    mcp: '{"action":"wipe","subjectId":"{subjectId}"}',
  },
  {
    method: "delete",
    path: "/memories/{id}",
    domain: "memories",
    capability: "edit",
    summary: "Delete one Memory",
    cli: "ciele memories delete {memoryId} --yes",
    mcp: '{"action":"delete","memoryId":"{memoryId}"}',
  },

  // SSO identity threading (#662)
  {
    method: "get",
    path: "/sso/identity",
    domain: "sso",
    capability: "manageMembers",
    summary: "Read the SSO identity-claim configuration",
    cli: "ciele sso status",
    mcp: '{"action":"status"}',
  },
  {
    method: "patch",
    path: "/sso/identity",
    domain: "sso",
    capability: "manageMembers",
    summary: "Set or clear the SSO identity claim",
    body: ssoIdentityBody,
    cli: "ciele sso identity email",
    mcp: '{"action":"set_identity","identityClaim":"email"}',
  },
  {
    method: "post",
    path: "/sso/identity/validate",
    domain: "sso",
    capability: "manageMembers",
    summary: "Validate the stored SSO connection",
    cli: "ciele sso validate",
    mcp: '{"action":"validate"}',
  },

  // Help desks and escalation channels
  {
    method: "get",
    path: "/help-desks",
    domain: "help-desks",
    capability: "member",
    summary: "List Help Desks",
    cli: "ciele help-desks list",
    mcp: '{"action":"list"}',
  },
  {
    method: "post",
    path: "/help-desks",
    domain: "help-desks",
    capability: "edit",
    summary: "Create a Help Desk",
    body: helpDeskInputSchema,
    cli: 'ciele help-desks create --name "IT Support" --description "Hardware, accounts and access."',
    mcp: '{"action":"create","input":{"name":"IT Support","description":"Hardware, accounts and access."}}',
  },
  {
    method: "get",
    path: "/help-desks/{id}",
    domain: "help-desks",
    capability: "member",
    summary: "One Help Desk with ordered channels",
    cli: "ciele help-desks get {helpDeskId}",
    mcp: '{"action":"get","id":"{helpDeskId}"}',
  },
  {
    method: "patch",
    path: "/help-desks/{id}",
    domain: "help-desks",
    capability: "edit",
    summary: "Update a Help Desk",
    body: helpDeskPatchSchema,
    cli: 'ciele help-desks update {helpDeskId} --name "IT Service Desk"',
    mcp: '{"action":"update","id":"{helpDeskId}","patch":{"name":"IT Service Desk"}}',
  },
  {
    method: "delete",
    path: "/help-desks/{id}",
    domain: "help-desks",
    capability: "edit",
    summary: "Delete a Help Desk",
    cli: "ciele help-desks delete {helpDeskId} --yes",
    mcp: '{"action":"delete","id":"{helpDeskId}"}',
  },
  {
    method: "post",
    path: "/help-desks/{id}/channels",
    domain: "help-desks",
    capability: "edit",
    summary: "Add an escalation channel",
    body: supportChannelInputSchema,
    cli: "ciele help-desks add-channel {helpDeskId} --file channel.json",
    mcp: '{"action":"add_channel","id":"{helpDeskId}","input":{}}',
  },
  {
    method: "patch",
    path: "/help-desks/{id}/channels/{channelId}",
    domain: "help-desks",
    capability: "edit",
    summary: "Update an escalation channel",
    body: supportChannelPatchSchema,
    cli: "ciele help-desks update-channel {helpDeskId} {channelId} --file patch.json",
    mcp: '{"action":"update_channel","id":"{helpDeskId}","channelId":"{channelId}","patch":{}}',
  },
  {
    method: "delete",
    path: "/help-desks/{id}/channels/{channelId}",
    domain: "help-desks",
    capability: "edit",
    summary: "Delete an escalation channel",
    cli: "ciele help-desks delete-channel {helpDeskId} {channelId} --yes",
    mcp: '{"action":"delete_channel","id":"{helpDeskId}","channelId":"{channelId}"}',
  },
  {
    method: "post",
    path: "/help-desks/{id}/channels/reorder",
    domain: "help-desks",
    capability: "edit",
    summary: "Reorder escalation channels",
    body: reorderBody,
    cli: "ciele help-desks reorder-channels {helpDeskId} --ids {channelId}",
    mcp: '{"action":"reorder_channels","id":"{helpDeskId}","orderedIds":["{channelId}"]}',
  },
  {
    method: "delete",
    path: "/help-desks/{id}/ticketing",
    domain: "help-desks",
    capability: "edit",
    summary: "Disconnect ticketing integration",
    cli: "ciele help-desks disconnect-ticketing {helpDeskId} --yes",
    mcp: '{"action":"disconnect_ticketing","id":"{helpDeskId}"}',
  },
  {
    method: "post",
    path: "/help-desks/{id}/ticketing/servicenow",
    domain: "help-desks",
    capability: "edit",
    summary: "Connect ServiceNow ticketing",
    body: connectServiceNowOp.input,
    cli: "ciele help-desks connect-servicenow {helpDeskId} --file credentials.json",
    mcp: '{"action":"connect_servicenow","id":"{helpDeskId}","input":{}}',
  },

  // Reusable Skills, standing Goals, and operational Alerts
  {
    method: "get",
    path: "/skills",
    domain: "skills",
    capability: "member",
    summary: "List Organization Skills",
    cli: "ciele skills list",
    mcp: '{"action":"skill_list"}',
  },
  {
    method: "post",
    path: "/skills",
    domain: "skills",
    capability: "edit",
    summary: "Create a Skill",
    body: skillInputSchema,
    cli: "ciele skills create --file skill.json",
    mcp: '{"action":"skill_create","input":{}}',
  },
  {
    method: "patch",
    path: "/skills/{id}",
    domain: "skills",
    capability: "edit",
    summary: "Update a Skill",
    body: skillPatchSchema,
    cli: "ciele skills update {skillId} --file patch.json",
    mcp: '{"action":"skill_update","id":"{skillId}","patch":{}}',
  },
  {
    method: "delete",
    path: "/skills/{id}",
    domain: "skills",
    capability: "edit",
    summary: "Delete a Skill",
    cli: "ciele skills delete {skillId} --yes",
    mcp: '{"action":"skill_delete","id":"{skillId}"}',
  },
  {
    method: "get",
    path: "/assistants/{id}/skills",
    domain: "skills",
    capability: "member",
    summary: "List an Assistant's attached Skills",
    cli: "ciele assistants get-skills {assistantId}",
    mcp: '{"action":"assistant_skills_get","assistantId":"{assistantId}"}',
  },
  {
    method: "patch",
    path: "/assistants/{id}/skills",
    domain: "skills",
    capability: "edit",
    summary: "Replace an Assistant's attached Skills",
    body: assistantSkillsBody,
    cli: "ciele assistants set-skills {assistantId} --ids {skillId}",
    mcp: '{"action":"assistant_skills_set","assistantId":"{assistantId}","skillIds":["{skillId}"]}',
  },
  {
    method: "get",
    path: "/assistants/{id}/goals",
    domain: "goals",
    capability: "member",
    summary: "List an Assistant's standing Goals",
    cli: "ciele goals list {assistantId}",
    mcp: '{"action":"goal_list","assistantId":"{assistantId}"}',
  },
  {
    method: "post",
    path: "/assistants/{id}/goals",
    domain: "goals",
    capability: "edit",
    summary: "Create a standing Goal",
    body: goalBody,
    cli: "ciele goals create {assistantId} --file goal.json",
    mcp: '{"action":"goal_create","assistantId":"{assistantId}","input":{}}',
  },
  {
    method: "patch",
    path: "/assistants/{id}/goals/{goalId}",
    domain: "goals",
    capability: "edit",
    summary: "Update a standing Goal",
    body: goalPatchBody,
    cli: "ciele goals update {assistantId} {goalId} --file patch.json",
    mcp: '{"action":"goal_update","assistantId":"{assistantId}","goalId":"{goalId}","patch":{}}',
  },
  {
    method: "delete",
    path: "/assistants/{id}/goals/{goalId}",
    domain: "goals",
    capability: "edit",
    summary: "Delete a standing Goal",
    cli: "ciele goals delete {assistantId} {goalId} --yes",
    mcp: '{"action":"goal_delete","assistantId":"{assistantId}","goalId":"{goalId}"}',
  },
  {
    method: "get",
    path: "/alerts",
    domain: "alerts",
    capability: "member",
    summary: "List operational Alerts",
    cli: "ciele alerts list",
    mcp: '{"action":"alert_list"}',
  },
  {
    method: "post",
    path: "/alerts/{id}/resolve",
    domain: "alerts",
    capability: "edit",
    summary: "Resolve an operational Alert",
    cli: "ciele alerts resolve {alertId}",
    mcp: '{"action":"alert_resolve","id":"{alertId}"}',
  },

  // Organization administration
  {
    method: "get",
    path: "/organization",
    domain: "organization",
    capability: "member",
    summary: "Read Organization settings",
    cli: "ciele organization get",
    mcp: '{"action":"get"}',
  },
  {
    method: "patch",
    path: "/organization",
    domain: "organization",
    capability: "manageMembers",
    summary: "Update Organization settings",
    body: organizationPatchSchema,
    cli: "ciele organization update --file patch.json",
    mcp: '{"action":"update","patch":{}}',
  },
  {
    method: "get",
    path: "/members",
    domain: "members",
    capability: "edit",
    summary: "List Organization Members",
    cli: "ciele members list",
    mcp: '{"action":"member_list"}',
  },
  {
    method: "patch",
    path: "/members/{userId}",
    domain: "members",
    capability: "manageMembers",
    summary: "Change a Member role",
    body: memberRoleBody,
    cli: "ciele members set-role {userId} --role admin",
    mcp: '{"action":"member_set_role","id":"{userId}","role":"admin"}',
  },
  {
    method: "delete",
    path: "/members/{userId}",
    domain: "members",
    capability: "manageMembers",
    summary: "Remove a Member",
    cli: "ciele members remove {userId} --yes",
    mcp: '{"action":"member_remove","id":"{userId}"}',
  },
  {
    method: "get",
    path: "/invites",
    domain: "members",
    capability: "manageMembers",
    summary: "List pending invitations",
    cli: "ciele invites list",
    mcp: '{"action":"invite_list"}',
  },
  {
    method: "post",
    path: "/invites",
    domain: "members",
    capability: "manageMembers",
    summary: "Create an invitation",
    body: inviteBody,
    cli: "ciele invites create --role editor --email person@example.com",
    mcp: '{"action":"invite_create","input":{"role":"editor","email":"person@example.com"}}',
  },
  {
    method: "delete",
    path: "/invites/{id}",
    domain: "members",
    capability: "manageMembers",
    summary: "Revoke an invitation",
    cli: "ciele invites revoke {inviteId} --yes",
    mcp: '{"action":"invite_revoke","id":"{inviteId}"}',
  },
  {
    method: "get",
    path: "/api-keys",
    domain: "api-keys",
    capability: "manageApiKeys",
    summary: "List Organization API keys",
    cli: "ciele api-keys list",
    mcp: '{"action":"api_key_list"}',
  },
  {
    method: "post",
    path: "/api-keys",
    domain: "api-keys",
    capability: "manageApiKeys",
    summary: "Mint an API key; secret returned once",
    body: apiKeyBody,
    cli: 'ciele api-keys create --name "CI pipeline" --role viewer',
    mcp: '{"action":"api_key_create","input":{"name":"CI pipeline","role":"viewer"}}',
  },
  {
    method: "delete",
    path: "/api-keys/{id}",
    domain: "api-keys",
    capability: "manageApiKeys",
    summary: "Revoke an API key",
    cli: "ciele api-keys revoke {apiKeyId} --yes",
    mcp: '{"action":"api_key_revoke","id":"{apiKeyId}"}',
  },

  // Assistant API catalogue, SSO connection, and model providers
  {
    method: "get",
    path: "/assistants/{id}/api-integration",
    domain: "api-integrations",
    capability: "member",
    summary: "Read an Assistant's API integration (secret-safe)",
    cli: "ciele api-integrations get {assistantId}",
    mcp: '{"action":"api_get","id":"{assistantId}"}',
  },
  {
    method: "put",
    path: "/assistants/{id}/api-integration",
    domain: "api-integrations",
    capability: "edit",
    summary: "Create or replace an Assistant API integration",
    body: apiIntegrationInputSchema,
    cli: "ciele api-integrations set {assistantId} --file integration.json",
    mcp: '{"action":"api_set","id":"{assistantId}","input":{}}',
  },
  {
    method: "delete",
    path: "/assistants/{id}/api-integration",
    domain: "api-integrations",
    capability: "edit",
    summary: "Delete an Assistant API integration",
    cli: "ciele api-integrations delete {assistantId} --yes",
    mcp: '{"action":"api_delete","id":"{assistantId}"}',
  },
  {
    method: "get",
    path: "/sso/connection",
    domain: "sso",
    capability: "manageMembers",
    summary: "Read the full non-secret SSO configuration",
    cli: "ciele sso connection",
    mcp: '{"action":"connection"}',
  },
  {
    method: "put",
    path: "/sso/connection",
    domain: "sso",
    capability: "manageMembers",
    summary: "Create or replace the SSO connection",
    body: ssoConnectionInputSchema,
    cli: "ciele sso connect --file connection.json",
    mcp: '{"action":"connect","input":{}}',
  },
  {
    method: "delete",
    path: "/sso/connection",
    domain: "sso",
    capability: "manageMembers",
    summary: "Disconnect SSO",
    cli: "ciele sso disconnect --yes",
    mcp: '{"action":"disconnect"}',
  },
  {
    method: "get",
    path: "/providers",
    domain: "providers",
    capability: "manageMembers",
    summary: "List model Provider Connections (secret-safe)",
    cli: "ciele providers list",
    mcp: '{"action":"provider_list"}',
  },
  {
    method: "post",
    path: "/providers/api-key",
    domain: "providers",
    capability: "manageMembers",
    summary: "Create and validate a BYOK Provider Connection",
    body: createProviderApiKeyOp.input,
    cli: "ciele providers create-api-key --file provider.json",
    mcp: '{"action":"provider_create_api_key","input":{}}',
  },
  {
    method: "post",
    path: "/providers/openai-compatible",
    domain: "providers",
    capability: "manageMembers",
    summary: "Create an OpenAI-compatible Provider Connection",
    body: openAiCompatibleInputSchema,
    cli: "ciele providers create-compatible --file provider.json",
    mcp: '{"action":"provider_create_compatible","input":{}}',
  },
  {
    method: "post",
    path: "/providers/federated",
    domain: "providers",
    capability: "manageMembers",
    summary: "Create a federated cloud Provider Connection",
    body: createFederatedProviderConnectionOp.input,
    cli: "ciele providers create-federated --file provider.json",
    mcp: '{"action":"provider_create_federated","input":{}}',
  },
  {
    method: "delete",
    path: "/providers/{id}",
    domain: "providers",
    capability: "manageMembers",
    summary: "Delete a Provider Connection",
    cli: "ciele providers delete {providerId} --yes",
    mcp: '{"action":"provider_delete","id":"{providerId}"}',
  },
  {
    method: "patch",
    path: "/providers/embedding",
    domain: "providers",
    capability: "manageMembers",
    summary: "Choose the embedding Provider Connection",
    body: embeddingConnectionBody,
    cli: "ciele providers set-embedding {providerId}",
    mcp: '{"action":"provider_set_embedding","connectionId":"{providerId}"}',
  },
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
        // flow settings) have no JSON-Schema form, they render as {} (any).
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
