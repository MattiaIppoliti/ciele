import { z } from "zod";
import type { ZodType } from "zod";
import {
  ROUTINE_CADENCES,
  TEAMMATE_CAPABILITY_CEILINGS,
  TEAMMATE_GRANT_DOMAINS,
} from "@agent-hub/core";
import {
  assistantPatchSchema,
  createAssistantOp,
  createFaqOp,
  createOrgFaqOp,
  draftFlowOp,
  projectPatchSchema,
  provisionTeammateOp,
  routinePatchSchema,
  flowInputSchema,
  flowPatchSchema,
  improvementPatchSchema,
  entityInputSchema,
  entityPatchSchema,
  entityRecordQuerySchema,
  connectServiceNowOp,
  helpDeskInputSchema,
  helpDeskPatchSchema,
  channelInputSchema,
  channelMembersSchema,
  channelPatchSchema,
  channelTeammatesSchema,
  teammateInputSchema,
  teammatePatchSchema,
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
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "@/lib/api-v1/http";
import responseSchemas from "./response-schemas.generated.json";

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
  /** May be rejected by the shared source-ingestion rate limit. */
  rateLimited?: boolean;
}

const reorderBody = z.object({ orderedIds: z.array(z.string()) });
const reconsentBody = z.object({
  actions: z.array(z.string()).optional(),
  scopes: z.array(z.string()).optional(),
});
const republishBody = z.object({ publicationId: z.string() });
const decideReviewBody = z.object({
  decision: z.enum(["approved", "rejected"]),
  inputs: z.record(z.string(), z.string()).optional(),
});
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
/** The org-level add carries its links in the body; the Library has no owner. */
const orgSourceBody = z.union([
  z.object({
    kind: z.literal("text"),
    name: z.string().optional(),
    text: z.string(),
    assistantIds: z.array(z.string().min(1)).min(1).max(50),
  }),
  z.object({
    kind: z.literal("url"),
    url: z.string(),
    assistantIds: z.array(z.string().min(1)).min(1).max(50),
  }),
]);
/**
 * The grant and routine bodies restate what the operations validate, minus the
 * id the path already carries. `Operation.input` is a `ZodType`, so it cannot
 * be `.omit`ed here; the enums come from `@agent-hub/core` so the two lists
 * cannot disagree even though the objects are written twice.
 */
const teammateGrantsBody = z.object({
  domains: z.array(z.enum(TEAMMATE_GRANT_DOMAINS as [string, ...string[]])),
  ceiling: z
    .enum(TEAMMATE_CAPABILITY_CEILINGS as [string, ...string[]])
    .optional(),
  approvalBypass: z.boolean().optional(),
});
/**
 * `flows.draft` takes no path parameter, so its body is the operation's whole
 * input. `flows.propose` carries the assistant in the path, so its body is
 * restated minus that one field.
 */
const flowDraftBody = draftFlowOp.input;
const flowValidateBody = z.object({
  rationale: z.string().min(1).max(1000),
  flow: flowInputSchema,
});
const projectBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
});
const memoryDocumentBody = z.object({
  body: z.string().describe("The whole document; the previous body is kept in history"),
  note: z.string().max(300).optional().describe("Why it changed, shown in history"),
});
const routineBody = z.object({
  instruction: z.string().min(1).max(2000),
  cadence: z.enum(ROUTINE_CADENCES as [string, ...string[]]),
  hour: z.number().int().min(0).max(23).optional(),
});
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

const jsonObject = { type: "object", additionalProperties: true };
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
    path: "/flows/catalog",
    domain: "flows",
    capability: "member",
    summary: "What a Flow may contain: triggers, actions, condition kinds, pairing rules",
    cli: "ciele flows catalog",
    mcp: '{"action":"catalog"}',
  },
  {
    method: "post",
    path: "/flows/draft",
    domain: "flows",
    capability: "edit",
    summary: "Check a Flow patch without storing it (shows the inserted human-review gate)",
    body: flowDraftBody,
    cli: 'ciele flows draft --file patch.json --summary "add a refund branch"',
    mcp: '{"action":"draft","summary":"add a refund branch","flow":{"actions":["search_knowledge"]}}',
  },
  {
    method: "post",
    path: "/assistants/{id}/flows/validate",
    domain: "flows",
    capability: "edit",
    summary: "Check a whole Flow without creating it (shows what would be stored)",
    body: flowValidateBody,
    cli: 'ciele flows validate {assistantId} --file flow.json --rationale "refunds deserve their own flow"',
    mcp: '{"action":"validate","assistantId":"{assistantId}","rationale":"refunds deserve their own flow","flow":{"name":"Refunds"}}',
  },
  {
    method: "get",
    path: "/flows/{id}/runs",
    domain: "flows",
    capability: "member",
    summary: "Recent inbound runs of an HTTP-triggered Flow (?limit=)",
    cli: "ciele flows runs {flowId} --limit 20",
    mcp: '{"action":"runs","id":"{flowId}","limit":20}',
  },
  {
    method: "get",
    path: "/assistants/{id}/flows-agent/thread",
    domain: "flows",
    capability: "member",
    summary: "Your own Flows Agent conversations about one Flow (?flowId=)",
    cli: "ciele flows agent-thread {assistantId} --flow {flowId}",
    mcp: '{"action":"agent_thread","assistantId":"{assistantId}","id":"{flowId}"}',
  },
  {
    method: "get",
    path: "/assistants/{id}/flows-agent/conversations/{conversationId}",
    domain: "flows",
    capability: "member",
    summary: "One Flows Agent conversation with its turns",
    cli: "ciele flows agent-conversation {assistantId} --conversation {conversationId}",
    mcp: '{"action":"agent_conversation","assistantId":"{assistantId}","conversationId":"{conversationId}"}',
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
    rateLimited: true,
    cli: "ciele sources add-url {collectionId} --url https://example.com/help --assistants {assistantId}",
    mcp: '{"action":"add_url","collectionId":"{collectionId}","url":"https://example.com/help","assistantIds":["{assistantId}"]}',
  },
  {
    method: "post",
    path: "/collections/{id}/faqs",
    domain: "knowledge",
    capability: "edit",
    summary: "Add one FAQ",
    body: faqBody,
    idempotent: true,
    cli: 'ciele faqs add {collectionId} --question "How do I reset my password?" --answer "Use the reset link on the sign-in page." --assistants {assistantId}',
    mcp: '{"action":"add_faq","collectionId":"{collectionId}","question":"How do I reset my password?","answer":"Use the reset link on the sign-in page.","assistantIds":["{assistantId}"]}',
  },
  {
    method: "post",
    path: "/collections/{id}/faqs/import",
    domain: "knowledge",
    capability: "edit",
    summary: "Bulk FAQ import (CSV)",
    multipart: ["file"],
    cli: "ciele faqs import {collectionId} --file faqs.csv --assistants {assistantId}",
    mcp: '{"action":"import_faqs","collectionId":"{collectionId}","csvText":"question,answer\\n…","assistantIds":["{assistantId}"]}',
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
    method: "post",
    path: "/knowledge/sources",
    domain: "knowledge",
    capability: "edit",
    summary: "Add a Source to the Knowledge Library (no Collection id needed)",
    body: orgSourceBody,
    multipart: ["file"],
    idempotent: true,
    rateLimited: true,
    cli: "ciele sources add-org --url https://example.com/help --assistants {assistantId}",
    mcp: '{"action":"add_org_url","url":"https://example.com/help","assistantIds":["{assistantId}"]}',
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
    cli: "ciele faqs import-org --file faqs.csv --assistants {assistantId}",
    mcp: '{"action":"import_org_faqs","csvText":"question,answer\\n…","assistantIds":["{assistantId}"]}',
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

  // Projects + the Project memory layer (#771)
  {
    method: "get",
    path: "/projects",
    domain: "projects",
    capability: "member",
    summary: "The Organization's Projects",
    cli: "ciele projects list",
    mcp: '{"action":"list"}',
  },
  {
    method: "post",
    path: "/projects",
    domain: "projects",
    capability: "edit",
    summary: "Create a Project",
    body: projectBody,
    idempotent: true,
    cli: 'ciele projects create --name "Q4 migration"',
    mcp: '{"action":"create","name":"Q4 migration"}',
  },
  {
    method: "get",
    path: "/projects/{id}",
    domain: "projects",
    capability: "member",
    summary: "One Project with its memory document and that document's history",
    cli: "ciele projects get {projectId}",
    mcp: '{"action":"get","id":"{projectId}"}',
  },
  {
    method: "patch",
    path: "/projects/{id}",
    domain: "projects",
    capability: "edit",
    summary: "Rename, re-describe or archive a Project",
    body: projectPatchSchema,
    cli: "ciele projects update {projectId} --archived true",
    mcp: '{"action":"update","id":"{projectId}","patch":{"archived":true}}',
  },
  {
    method: "delete",
    path: "/projects/{id}",
    domain: "projects",
    capability: "edit",
    summary: "Delete a Project (decisions cascade, Teammates detach; archive instead to keep the record)",
    cli: "ciele projects delete {projectId} --yes",
    mcp: '{"action":"delete","id":"{projectId}"}',
  },
  {
    method: "put",
    path: "/projects/{id}/document",
    domain: "projects",
    capability: "edit",
    summary: "Replace the Project memory document (previous body kept in history)",
    body: memoryDocumentBody,
    cli: 'ciele projects set-document {projectId} --file notes.md --note "after review"',
    mcp: '{"action":"set_document","id":"{projectId}","body":"…","note":"after review"}',
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
    mcp: '{"action":"create","entity":{"name":"Product","scope":"shared","keyAttribute":"sku","attributes":[{"key":"sku","label":"SKU","type":"text"}]}}',
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

  // AI Teammates: the org's internal agents (#768)
  {
    method: "get",
    path: "/teammates",
    domain: "teammates",
    capability: "member",
    summary: "List the AI Teammates this key may see",
    cli: "ciele teammates list",
    mcp: '{"action":"list"}',
  },
  {
    method: "post",
    path: "/teammates",
    domain: "teammates",
    capability: "edit",
    summary: "Create an AI Teammate",
    body: teammateInputSchema,
    cli: 'ciele teammates create --name "Nora" --title "Support Copywriter"',
    mcp: '{"action":"create","input":{"name":"Nora","title":"Support Copywriter"}}',
  },
  {
    method: "post",
    path: "/teammates/provision",
    domain: "teammates",
    capability: "edit",
    summary: "Stand up a working Teammate in one call: persona, grants, routines",
    body: provisionTeammateOp.input,
    idempotent: true,
    cli: 'ciele teammates provision --name "Triage" --grants improvements --routine "Triage new feedback:daily"',
    mcp: '{"action":"provision","input":{"name":"Triage","grants":["improvements"],"routines":[{"instruction":"Triage new feedback","cadence":"daily"}]}}',
  },
  {
    method: "get",
    path: "/teammates/{id}",
    domain: "teammates",
    capability: "member",
    summary: "One AI Teammate",
    cli: "ciele teammates get {teammateId}",
    mcp: '{"action":"get","id":"{teammateId}"}',
  },
  {
    method: "patch",
    path: "/teammates/{id}",
    domain: "teammates",
    capability: "edit",
    summary: "Update an AI Teammate (applies to its next message)",
    body: teammatePatchSchema,
    cli: 'ciele teammates update {teammateId} --role "You draft release notes."',
    mcp: '{"action":"update","id":"{teammateId}","patch":{"roleDescription":"You draft release notes."}}',
  },
  {
    method: "delete",
    path: "/teammates/{id}",
    domain: "teammates",
    capability: "edit",
    summary: "Retire an AI Teammate (soft delete; its Conversations stay readable)",
    cli: "ciele teammates delete {teammateId} --yes",
    mcp: '{"action":"delete","id":"{teammateId}"}',
  },
  {
    method: "get",
    path: "/teammates/{id}/conversations",
    domain: "teammates",
    capability: "member",
    summary: "The key holder's own thread with one Teammate",
    cli: "ciele teammates conversations {teammateId}",
    mcp: '{"action":"conversations","id":"{teammateId}"}',
  },
  {
    method: "get",
    path: "/teammates/{id}/conversations/{conversationId}",
    domain: "teammates",
    capability: "member",
    summary: "One Teammate conversation with its messages",
    cli: "ciele teammates conversation {teammateId} {conversationId}",
    mcp: '{"action":"conversation","id":"{teammateId}","conversationId":"{conversationId}"}',
  },
  {
    method: "get",
    path: "/teammates/{id}/grants",
    domain: "teammates",
    capability: "member",
    summary: "What a Teammate may do: granted domains, ceiling, approval bypass",
    cli: "ciele teammates grants {teammateId}",
    mcp: '{"action":"grants","id":"{teammateId}"}',
  },
  {
    method: "put",
    path: "/teammates/{id}/grants",
    domain: "teammates",
    capability: "manageMembers",
    summary: "Replace a Teammate's granted domains (and its ceiling / bypass)",
    body: teammateGrantsBody,
    cli: "ciele teammates set-grants {teammateId} --domains improvements,knowledge",
    mcp: '{"action":"set_grants","id":"{teammateId}","domains":["improvements"]}',
  },
  {
    method: "get",
    path: "/teammates/{id}/memory",
    domain: "teammates",
    capability: "member",
    summary: "The Agent memory layer: what this Teammate has learned, with history",
    cli: "ciele teammates memory {teammateId}",
    mcp: '{"action":"memory","id":"{teammateId}"}',
  },
  {
    method: "put",
    path: "/teammates/{id}/memory",
    domain: "teammates",
    capability: "edit",
    summary: "Replace the Agent memory document (previous body kept in history)",
    body: memoryDocumentBody,
    cli: 'ciele teammates set-memory {teammateId} --file memory.md --note "corrected"',
    mcp: '{"action":"set_memory","id":"{teammateId}","body":"…","note":"corrected"}',
  },
  {
    method: "get",
    path: "/teammates/{id}/routines",
    domain: "teammates",
    capability: "member",
    summary: "A Teammate's Routines (unattended recurring runs)",
    cli: "ciele teammates routines {teammateId}",
    mcp: '{"action":"routines","id":"{teammateId}"}',
  },
  {
    method: "post",
    path: "/teammates/{id}/routines",
    domain: "teammates",
    capability: "edit",
    summary: "Add a Routine (max 5 per Teammate)",
    body: routineBody,
    idempotent: true,
    cli: 'ciele teammates add-routine {teammateId} --instruction "Triage new feedback" --cadence daily --hour 8',
    mcp: '{"action":"add_routine","id":"{teammateId}","instruction":"Triage new feedback","cadence":"daily","hour":8}',
  },
  {
    method: "patch",
    path: "/routines/{id}",
    domain: "teammates",
    capability: "edit",
    summary: "Change a Routine's instruction, cadence, hour or enabled flag",
    body: routinePatchSchema,
    cli: "ciele teammates update-routine {routineId} --enabled false",
    mcp: '{"action":"update_routine","routineId":"{routineId}","patch":{"enabled":false}}',
  },
  {
    method: "delete",
    path: "/routines/{id}",
    domain: "teammates",
    capability: "edit",
    summary: "Delete a Routine",
    cli: "ciele teammates delete-routine {routineId} --yes",
    mcp: '{"action":"delete_routine","routineId":"{routineId}"}',
  },

  // Teammate channels: the group threads Members share with Teammates (#778)
  {
    method: "get",
    path: "/channels",
    domain: "channels",
    capability: "member",
    summary: "List the Teammate channels this key's Member is in",
    cli: "ciele channels list",
    mcp: '{"action":"list"}',
  },
  {
    method: "post",
    path: "/channels",
    domain: "channels",
    capability: "member",
    summary: "Open a Teammate channel",
    body: channelInputSchema,
    cli: 'ciele channels create --name "Launch week" --teammates {teammateId}',
    mcp: '{"action":"create","input":{"name":"Launch week","teammateIds":["{teammateId}"]}}',
  },
  {
    method: "get",
    path: "/channels/oversight",
    domain: "channels",
    capability: "manageMembers",
    summary: "Every channel in the Organization, membership ignored (Owner/Admin)",
    cli: "ciele channels oversight",
    mcp: '{"action":"oversight"}',
  },
  {
    method: "get",
    path: "/channels/oversight/{id}",
    domain: "channels",
    capability: "manageMembers",
    summary: "One channel's transcript without being seated in it (Owner/Admin)",
    cli: "ciele channels oversight-read {channelId}",
    mcp: '{"action":"oversight_read","id":"{channelId}"}',
  },
  {
    method: "get",
    path: "/channels/{id}",
    domain: "channels",
    capability: "member",
    summary: "One channel: its roster and its transcript",
    cli: "ciele channels get {channelId}",
    mcp: '{"action":"get","id":"{channelId}"}',
  },
  {
    method: "patch",
    path: "/channels/{id}",
    domain: "channels",
    capability: "member",
    summary: "Rename a channel, or bind it to a Project",
    body: channelPatchSchema,
    cli: 'ciele channels update {channelId} --name "Launch week"',
    mcp: '{"action":"update","id":"{channelId}","patch":{"name":"Launch week"}}',
  },
  {
    method: "delete",
    path: "/channels/{id}",
    domain: "channels",
    capability: "member",
    summary: "Close a channel (its transcript goes with it)",
    cli: "ciele channels delete {channelId} --yes",
    mcp: '{"action":"delete","id":"{channelId}"}',
  },
  {
    method: "post",
    path: "/channels/{id}/members",
    domain: "channels",
    capability: "member",
    summary: "Invite Members into a channel",
    body: channelMembersSchema,
    cli: "ciele channels add-member {channelId} {userId}",
    mcp: '{"action":"add_member","id":"{channelId}","userIds":["{userId}"]}',
  },
  {
    method: "delete",
    path: "/channels/{id}/members/{userId}",
    domain: "channels",
    capability: "member",
    summary: "Remove a Member from a channel, or leave it",
    cli: "ciele channels remove-member {channelId} {userId}",
    mcp: '{"action":"remove_member","id":"{channelId}","userId":"{userId}"}',
  },
  {
    method: "post",
    path: "/channels/{id}/teammates",
    domain: "channels",
    capability: "member",
    summary: "Seat Teammates in a channel",
    body: channelTeammatesSchema,
    cli: "ciele channels add-teammate {channelId} {teammateId}",
    mcp: '{"action":"add_teammate","id":"{channelId}","teammateIds":["{teammateId}"]}',
  },
  {
    method: "delete",
    path: "/channels/{id}/teammates/{teammateId}",
    domain: "channels",
    capability: "member",
    summary: "Remove a Teammate from a channel",
    cli: "ciele channels remove-teammate {channelId} {teammateId}",
    mcp: '{"action":"remove_teammate","id":"{channelId}","teammateId":"{teammateId}"}',
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

  // Applications (#839): the Connections a Connector action runs through.
  {
    method: "get",
    path: "/applications/connections",
    domain: "applications",
    capability: "member",
    summary: "List the Organization's Application Connections (no credentials)",
    cli: "ciele applications list",
    mcp: '{"action":"application_list"}',
  },
  {
    method: "get",
    path: "/applications/connectors",
    domain: "applications",
    capability: "member",
    summary: "The Connector action catalogue: keys, effects, fields, outputs",
    cli: "ciele applications connectors",
    mcp: '{"action":"application_connectors"}',
  },
  {
    method: "post",
    path: "/applications/connections/{id}/reconsent",
    domain: "applications",
    capability: "publish",
    summary: "Compute the scope union for named Connector actions and the OAuth start path to open",
    body: reconsentBody,
    cli: "ciele applications reconsent {connectionId} --actions slack.message.post",
    mcp: '{"action":"application_reconsent","id":"{connectionId}","input":{"actions":["slack.message.post"]}}',
  },
  // Human review (#841): the gate's requests, listed and decided.
  {
    method: "get",
    path: "/reviews",
    domain: "reviews",
    capability: "member",
    summary: "Human review requests, newest first (filter by status, conversation or assistant)",
    cli: "ciele reviews list --status pending",
    mcp: '{"action":"review_list","status":"pending"}',
  },
  {
    method: "get",
    path: "/reviews/{id}",
    domain: "reviews",
    capability: "member",
    summary: "One Human review request",
    cli: "ciele reviews get {reviewId}",
    mcp: '{"action":"review_get","reviewId":"{reviewId}"}',
  },
  {
    method: "post",
    path: "/reviews/{id}/decide",
    domain: "reviews",
    capability: "member",
    summary: "Approve or reject a Human review (an assignee, or an Owner/Admin key); first decision wins",
    body: decideReviewBody,
    cli: "ciele reviews decide {reviewId} --decision approved --inputs amount=50",
    mcp: '{"action":"review_decide","reviewId":"{reviewId}","decision":"approved","inputs":{"amount":"50"}}',
  },
  // Usage (#853), read-only. A purchase is deliberately absent: it belongs to a
  // surface where a person confirms an amount.
  {
    method: "get",
    path: "/usage/meters",
    domain: "usage",
    capability: "manageMembers",
    summary:
      "The plan's meters: cap, credits used and window per resource (an unmetered deployment says so)",
    cli: "ciele usage meters",
    mcp: '{"action":"usage_meters"}',
  },
  {
    method: "get",
    path: "/usage/spenders",
    domain: "usage",
    capability: "manageMembers",
    summary:
      "Who spent a window's credits, grouped per dimension (a turn names two, so dimensions do not add up)",
    cli: "ciele usage spenders --from 2026-09-01T00:00:00Z",
    mcp: '{"action":"usage_spenders","from":"2026-09-01T00:00:00Z"}',
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

function operationId(endpoint: EndpointSpec): string {
  const words = endpoint.path
    .split("/")
    .filter(Boolean)
    .flatMap((part) => {
      const parameter = /^\{(.+)\}$/.exec(part);
      return parameter ? [`by${parameter[1][0].toUpperCase()}${parameter[1].slice(1)}`] : [part];
    })
    .join("-")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join("");
  return `${endpoint.method}${words}`;
}

function errorResponse(description: string) {
  return {
    description,
    content: { "application/json": { schema: ERROR_SCHEMA } },
  };
}

function queryParam(name: string, type: "string" | "integer", description: string) {
  return { name, in: "query" as const, required: false, description, schema: { type } };
}

const cursorQuery = [
  queryParam("limit", "integer", `Items per page; defaults to ${DEFAULT_PAGE_LIMIT} and is clamped to 1–${MAX_PAGE_LIMIT}.`),
  queryParam("cursor", "string", "Opaque nextCursor returned by the previous page."),
];

/** Route-specific query fields, copied from the handlers alongside the endpoint registry. */
const QUERY_PARAMETERS: Record<string, ReturnType<typeof queryParam>[]> = {
  "get /assistants": cursorQuery,
  "get /conversations": [...cursorQuery, queryParam("assistantId", "string", "Limit results to one Assistant.")],
  "get /improvements": cursorQuery,
  "get /entities": cursorQuery,
  "get /memories/subjects": cursorQuery,
  "get /entities/{id}/records": [
    queryParam("limit", "integer", "Maximum records to return."),
    queryParam("offset", "integer", "Number of records to skip."),
  ],
  "get /flows/{id}/runs": [queryParam("limit", "integer", "Maximum recent runs to return.")],
  "get /assistants/{id}/flows-agent/thread": [queryParam("flowId", "string", "Omit to read the new-Flow canvas thread.")],
  "get /knowledge/sources": [
    queryParam("kinds", "string", "Comma-separated Source kinds; defaults to all kinds."),
    queryParam("status", "string", "Filter by Source status."),
    queryParam("assistantId", "string", "Filter by linked Assistant."),
    queryParam("q", "string", "Search the Knowledge Library."),
    queryParam("page", "integer", "Page number."),
    queryParam("pageSize", "integer", "Items per page."),
  ],
  "get /usage/spenders": [
    queryParam("from", "string", "Start of the usage window, as an ISO 8601 timestamp."),
    queryParam("to", "string", "End of the usage window, as an ISO 8601 timestamp."),
  ],
  "get /reviews": [
    queryParam("status", "string", "Filter by review status."),
    queryParam("conversationId", "string", "Filter by Conversation."),
    queryParam("assistantId", "string", "Filter by Assistant."),
  ],
  "get /applications/connections": [queryParam("provider", "string", "Filter by Application provider.")],
  "get /applications/connectors": [queryParam("provider", "string", "Filter by Application provider.")],
};

/** Routes that explicitly return 201 after creating a resource. */
const CREATED_RESPONSES = new Set([
  "post /api-keys",
  "post /assistants/{id}/duplicate",
  "post /assistants/{id}/flows",
  "post /assistants/{id}/goals",
  "post /assistants/{id}/publish",
  "post /assistants/{id}/republish",
  "post /assistants",
  "post /channels",
  "post /collections/{id}/faqs",
  "post /collections/{id}/sources",
  "post /entities",
  "post /help-desks/{id}/channels",
  "post /help-desks",
  "post /invites",
  "post /knowledge/faqs",
  "post /knowledge/sources",
  "post /projects",
  "post /providers/federated",
  "post /providers/api-key",
  "post /providers/openai-compatible",
  "post /skills",
  "post /teammates/{id}/routines",
  "post /teammates/provision",
  "post /teammates",
]);

/** These two routes also return 200 when a provider connection reports an error. */
const MAY_RETURN_200 = new Set([
  "post /providers/api-key",
  "post /providers/openai-compatible",
]);

/** The served document. Kept dependency-free: zod v4 renders JSON Schema. */
export function buildOpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const endpoint of API_V1_ENDPOINTS) {
    const operationKey = `${endpoint.method} ${endpoint.path}`;
    const noContent = endpoint.method === "delete"
      || operationKey === "post /channels/{id}/members"
      || operationKey === "post /channels/{id}/teammates";
    const csv = operationKey === "get /knowledge/faqs/export";
    const successStatus = CREATED_RESPONSES.has(operationKey) ? "201" : "200";
    const jsonSuccess = {
      description: successStatus === "201" ? "Created" : "Successful response",
      content: {
        "application/json": {
          schema: (responseSchemas as Record<string, Record<string, unknown>>)[operationKey] ?? jsonObject,
        },
      },
    };
    const successResponse = noContent
      ? { "204": { description: "No content" } }
      : csv
        ? { "200": { description: "FAQ export", content: { "text/csv": { schema: { type: "string" } } } } }
        : {
          [successStatus]: jsonSuccess,
          ...(MAY_RETURN_200.has(operationKey) ? { "200": { ...jsonSuccess, description: "Operation completed with a provider error" } } : {}),
        };
    const errors: Record<string, unknown> = {};
    if (endpoint.auth !== false) {
      errors["401"] = errorResponse("Missing, invalid, or revoked API key");
    }
    if (endpoint.capability && endpoint.capability !== "member") {
      errors["403"] = errorResponse("The API key does not have the required capability");
    }
    if (endpoint.body || endpoint.multipart || endpoint.capability) {
      errors["400"] = errorResponse("Invalid request or operation input");
      errors["404"] = errorResponse("The requested resource was not found");
      errors["409"] = errorResponse("The request conflicts with the current resource state");
      errors["422"] = errorResponse("Validation error");
    }
    if (endpoint.idempotent) {
      errors["409"] = {
        ...errorResponse("The idempotency key is already in use or the request is still running"),
        headers: {
          "Retry-After": {
            description: "Seconds to wait before retrying a request that is still running.",
            schema: { type: "integer" },
          },
        },
      };
      errors["500"] = errorResponse("The idempotency request could not be completed");
      errors["503"] = errorResponse("Idempotency storage is temporarily unavailable");
    }
    if (endpoint.rateLimited) {
      errors["429"] = {
        ...errorResponse("The source-ingestion rate limit was exceeded"),
        headers: {
          "Retry-After": {
            description: "Seconds until another source-ingestion request is allowed.",
            schema: { type: "integer" },
          },
        },
      };
    }
    const access = endpoint.auth === false
      ? "No API key is required."
      : endpoint.capability
        ? `Requires an Organization API key with the ${endpoint.capability} capability.`
        : "Requires an Organization API key.";
    const entry: Record<string, unknown> = {
      operationId: operationId(endpoint),
      summary: endpoint.summary,
      description: `${access}${endpoint.idempotent ? " Supply an Idempotency-Key when retrying the same request." : ""}`,
      tags: [endpoint.domain ?? "discovery"],
      parameters: [
        ...pathParams(endpoint.path),
        ...(QUERY_PARAMETERS[`${endpoint.method} ${endpoint.path}`] ?? []),
        ...(endpoint.idempotent ? [{
          name: "Idempotency-Key",
          in: "header",
          required: false,
          description: "Reuse the same value only when retrying the same logical operation.",
          schema: { type: "string" },
        }] : []),
      ],
      security: endpoint.auth === false ? [] : [{ apiKey: [] }],
      responses: {
        ...successResponse,
        ...errors,
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
      const hasAssistantLinks = [
        "post /collections/{id}/sources",
        "post /collections/{id}/faqs/import",
        "post /knowledge/sources",
        "post /knowledge/faqs/import",
      ].includes(operationKey);
      const properties: Record<string, unknown> = Object.fromEntries(
        endpoint.multipart.map((field) => [field, { type: "string", format: "binary" }])
      );
      if (hasAssistantLinks) {
        properties.assistantIds = {
          type: "string",
          description: "Optional JSON-encoded array of Assistant IDs to link to the imported items.",
        };
      }
      content["multipart/form-data"] = {
        schema: {
          type: "object",
          properties,
          required: endpoint.multipart,
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
    servers: [
      {
        url: "/",
        description: "The same Ciele deployment that serves this API document.",
      },
    ],
    info: {
      title: "ciele API",
      version: `${API_V1_VERSION}.0.0`,
      description: "The public Organization API for Ciele. Requests and responses use JSON. Create an API key in Settings → API Keys and send it as `Authorization: Bearer ciele_sk_…`. Protected operations state their required capability. Lists use the pagination parameters shown on each operation. This contract describes the public `/api/v1` surface; internal console and widget routes are not API key endpoints.",
      license: {
        name: "AGPL-3.0-only",
        url: "https://spdx.org/licenses/AGPL-3.0-only.html",
      },
    },
    tags: [
      { name: "discovery", "x-displayName": "Discovery", description: "Discover this deployment and inspect the current API contract." },
      ...API_V1_DOMAINS.map((name) => ({
        name,
        "x-displayName": name.split("-").map((part) =>
          part === "api" ? "API" : part === "sso" ? "SSO" : part.charAt(0).toUpperCase() + part.slice(1)
        ).join(" "),
        description: `Public ${name.replaceAll("-", " ")} endpoints.`,
      })),
    ],
    components: {
      securitySchemes: {
        apiKey: { type: "http", scheme: "bearer", bearerFormat: "ciele_sk_…" },
      },
    },
    paths,
  };
}
