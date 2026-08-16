"use server";

import type {
  AnswerVerdict,
  ApiEndpointSpec,
  ApiIntegrationAuthType,
  Assistant,
  AssistantPatch,
  Conversation,
  FlowActionSettings,
  FlowInput,
  FlowPatch,
  GoalExpectations,
  GoalStatus,
  Improvement,
  ImprovementAssociation,
  Memory,
  ImprovementListItem,
  ImprovementMessageLink,
  ImprovementPatch,
  ImprovementProposal,
  OrganizationPatch,
  ProfilePatch,
  Provider,
  RecrawlSchedule,
  Role,
  Skill,
  Entity,
  EntityInput,
  EntityRecord,
  EntitySyncRun,
  SkillInput,
  SkillPatch,
  SourceStatus,
  SsoProviderKind,
  StoredMessage,
  SupportChannelInput,
  SupportChannelPatch,
  WebsiteCrawlerProvider,
} from "@agent-hub/core";
import {
  okfActor,
  sealSecret,
  thrownMessage,
} from "@agent-hub/core";
import { isSupabaseConfigured, raiseImprovement, type Db } from "@agent-hub/db";

import { SSO_GATE_COOKIE, isGateValidForOrg } from "@/lib/sso";
import {
  listEscalationDesks,
  type EscalationHelpDesk,
} from "@/lib/escalation-desks";
import {
  backfillCollectionToGraph,
  beginWebsiteCrawl,
  embedConcept,
  enqueueDraftProposalJob,
  enqueueGraphSyncJob,
  enqueueEntitySyncJob,
  enqueueIngestJob,
  extractSourceText,
  feedbackScore,
  forwardGraphFeedback,
  finalizeWebsiteCrawl,
  testApiRequest,
  testOpenAiCompatibleConnection,
  updateWebsiteSourceConfiguration,
  type ApiRequestTestResult,
  type OpenAiCompatibleTestResult,
} from "@agent-hub/agent";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ACTIVE_ORG_COOKIE } from "@/lib/auth";
import { requireMember, requireSession } from "@/lib/authz";
import { orgMutation } from "@/lib/org-mutation";
import { runOperation } from "@/lib/operations";
import {
  addSourceOp,
  createAssistantOp,
  createFaqOp,
  createFlowOp,
  createEntityOp,
  createHelpDeskOp,
  createSupportChannelOp,
  connectServiceNowOp,
  createSkillOp,
  createAssistantGoalOp,
  deleteAssistantOp,
  deleteFlowOp,
  deleteEntityOp,
  deleteHelpDeskOp,
  deleteSupportChannelOp,
  deleteSkillOp,
  deleteAssistantGoalOp,
  deleteMemoryOp,
  deleteSourceOp,
  duplicateAssistantOp,
  importFaqsOp,
  importEntityRecordsOp,
  listEntityRecordsOp,
  listSubjectMemoriesOp,
  publishAssistantOp,
  recrawlSourceOp,
  setDirectAccessOp,
  setSourceLinksOp,
  reorderFlowsOp,
  reorderSupportChannelsOp,
  republishOp,
  unpublishAssistantOp,
  updateAssistantOp,
  updateEntityOp,
  updateHelpDeskOp,
  updateSupportChannelOp,
  updateSkillOp,
  updateAssistantGoalOp,
  updateFlowOp,
  updateImprovementOp,
  setMemorySettingsOp,
  wipeSubjectMemoriesOp,
  disconnectTicketingIntegrationOp,
  setAssistantSkillsOp,
  resolveAlertOp,
  createInviteOp,
  createOrgApiKeyOp,
  removeMemberOp,
  revokeInviteOp,
  revokeOrgApiKeyOp,
  updateMemberRoleOp,
  updateOrganizationOp,
  leaveOrganizationOp,
  createFederatedProviderConnectionOp,
  createOpenAiCompatibleConnectionOp,
  createProviderApiKeyOp,
  deleteApiIntegrationOp,
  deleteProviderConnectionOp,
  disconnectSsoConnectionOp,
  getApiIntegrationOp,
  setApiIntegrationOp,
  setEmbeddingConnectionOp,
  setSsoConnectionOp,
  deleteConversationOp,
  sendConversationFeedbackOp,
  setConversationPinnedOp,
  setMessageFeedbackOp,
  validateSsoIdentityOp,
} from "@ciele/ops";
import { persistFaqConcept } from "@/lib/op-ports";
import { FAQ_CSV_MAX_BYTES, parseFaqCsv, serializeFaqCsv } from "@/lib/faq-csv";
import { isPlatformOwner, setPlatformSystemPrompt } from "@/lib/platform";
import { getDb } from "@/lib/data";
import { getWidgetDb } from "@/lib/widget-db";
import { canViewReasoning } from "@/lib/rbac";
import { MAX_AGENT_ITERATIONS } from "@agent-hub/agent/client";
import {
  INBOX_EXPORT_MAX_CONVERSATIONS,
  INBOX_EXPORT_READ_BATCH,
  conversationExportRows,
  type ConversationExportRow,
} from "@/lib/inbox/conversation-export";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createSupabaseServiceClient,
  isSupabaseServiceConfigured,
} from "@/lib/supabase/service";
import {
  KNOWLEDGE_ORIGINALS_BUCKET,
  downloadKnowledgeOriginal,
  uploadKnowledgeOriginal,
  uploadPublicImageAsset,
  validateKnowledgeFile,
  validatePublicImageFile,
} from "@/lib/storage/assets";

// --- Auth & organization ----------------------------------------------------

export async function signOutAction() {
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}

export async function createOrganizationAction(name: string) {
  await requireSession();
  const db = await getDb();
  await db.createOrganization(name.trim());
  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * Org switcher: persists which Organization the caller is browsing. Only
 * takes effect for multi-org members and platform superusers — a regular
 * single-org member has nothing else to switch to. Re-checks visibility via
 * getCurrentOrg before persisting so a user can't point the cookie at an
 * org RLS wouldn't otherwise let them see.
 */
export async function switchOrganizationAction(organizationId: string) {
  await requireSession();
  const db = await getDb();
  const target = await db.getCurrentOrg(organizationId);
  if (!target) throw new Error("Organization not found");
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, organizationId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}

/** Org branding: name + circular logo. Admin+ (same gate as Members). */
export async function updateOrganizationAction(patch: OrganizationPatch) {
  return runOperation(updateOrganizationOp, patch);
}

export async function uploadOrganizationLogoAction(
  formData: FormData,
): Promise<{ logoUrl?: string; error?: string }> {
  const { db, session } = await requireMember("manageMembers");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an image file" };
  }
  const validation = validatePublicImageFile(file);
  if (!validation.ok) return { error: validation.error };
  if (!isSupabaseConfigured() || !isSupabaseServiceConfigured()) {
    return { error: "Object storage is not configured" };
  }

  const uploaded = await uploadPublicImageAsset(createSupabaseServiceClient(), {
    organizationId: session.organization.id,
    kind: "organization",
    file,
  });

  await db.updateOrganization(session.organization.id, {
    logoUrl: uploaded.publicUrl,
  });
  revalidatePath("/", "layout");
  return { logoUrl: uploaded.publicUrl };
}

/** Daily AI budget for the org. Admin+ (same gate as provider keys). */
export async function updateOrgBudgetAction(input: {
  dailyTokenLimit: number | null;
  dailyEuroLimit: number | null;
  enforcement: "notify" | "block";
}): Promise<void> {
  await orgMutation(
    { capability: "manageMembers", entities: [{ kind: "aiSettings" }] },
    async ({ db, session }) => {
      const limit = input.dailyTokenLimit;
      if (limit != null && (!Number.isFinite(limit) || limit <= 0)) {
        throw new Error("The daily token limit must be a positive number.");
      }
      const euroLimit = input.dailyEuroLimit;
      if (
        euroLimit != null &&
        (!Number.isFinite(euroLimit) || euroLimit <= 0)
      ) {
        throw new Error("The daily euro limit must be a positive number.");
      }
      await db.setOrgBudget(session.organization.id, {
        dailyTokenLimit: limit == null ? null : Math.floor(limit),
        dailyEuroLimit:
          euroLimit == null ? null : Math.round(euroLimit * 100) / 100,
        enforcement: input.enforcement === "block" ? "block" : "notify",
      });
    },
  );
}

/** Weekly self-improvement (compost) opt-out. Admin+ (same gate as the budget). */
export async function updateCompostOptOutAction(
  optOut: boolean,
): Promise<void> {
  await orgMutation(
    { capability: "manageMembers", entities: [{ kind: "aiSettings" }] },
    ({ db, session }) => db.setCompostOptOut(session.organization.id, optOut),
  );
}

/**
 * Org-level long-term memory toggle (#664), off by default. While off,
 * nothing is extracted and nothing is recalled — flipping it on is the one
 * deliberate act that enables the capability for every assistant.
 */
export async function updateMemoryEnabledAction(enabled: boolean): Promise<void> {
  await runOperation(setMemorySettingsOp, { enabled });
}

/**
 * Admin memory lookup (#666): one subject's stored memories, newest first.
 * Read-only, so any Member may look — mirroring the memories-table RLS.
 */
export async function listSubjectMemoriesAction(
  subjectId: string
): Promise<Memory[]> {
  return runOperation(listSubjectMemoriesOp, { subjectId });
}

/**
 * Erasure, one item (#666). The memory must belong to the given subject in
 * the caller's Organization — a forged id from another org deletes nothing.
 */
export async function deleteSubjectMemoryAction(
  _subjectId: string,
  memoryId: string
): Promise<void> {
  await runOperation(deleteMemoryOp, { id: memoryId });
}

/**
 * Which Entities the org-staff data assistant may query (#668) — an
 * org-level selection, separate from any customer-facing assistant's
 * per-assistant selection. Unknown/foreign entity ids are dropped.
 */
export async function updateDataAssistantEntitiesAction(
  entityIds: string[]
): Promise<void> {
  await orgMutation(
    { capability: "manageMembers", entities: [{ kind: "dataAssistant" }] },
    async ({ db, session }) => {
      const orgEntities = await db.table("entities").list({
        organizationId: session.organization.id,
      });
      const valid = entityIds.filter((id) =>
        orgEntities.some((e) => e.id === id)
      );
      await db.setDataAssistantEntityIds(session.organization.id, valid);
    }
  );
}

/** Erasure, whole subject (#666): complete and immediate — GDPR requests. */
export async function wipeSubjectMemoriesAction(subjectId: string): Promise<void> {
  await runOperation(wipeSubjectMemoriesOp, { subjectId });
}

/**
 * Which Provider Connection embeds this Organization's knowledge (#437).
 * `null` returns to the runtime's automatic provider order. Changing it does
 * not re-embed anything already stored — see the card's own warning.
 */
export async function updateEmbeddingConnectionAction(
  connectionId: string | null,
): Promise<void> {
  await runOperation(setEmbeddingConnectionOp, { connectionId });
}

/** Owner opt-in for Member-owned, Preview-only local AI subscriptions. */
export async function updatePersonalAiSubscriptionsAllowedAction(
  allowed: boolean,
): Promise<void> {
  await orgMutation(
    { capability: "changeRoles", entities: [{ kind: "aiSettings" }] },
    ({ db, session }) =>
      db.setPersonalAiSubscriptionsAllowed(session.organization.id, allowed),
  );
}

export async function joinDemoOrgAction() {
  await requireSession();
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("join_demo_org");
    if (error) throw error;
  }
  revalidatePath("/", "layout");
  redirect("/");
}

// --- Members & invites --------------------------------------------------------

/**
 * Admins and owners edit roles; only owners may grant or revoke ownership.
 * The same asymmetry is enforced by RLS (20260728120000) — this check is the
 * one that produces a readable error instead of a silent no-op update.
 */
export async function updateMemberRoleAction(userId: string, role: Role) {
  await runOperation(updateMemberRoleOp, { userId, role });
}

export async function removeMemberAction(userId: string) {
  const { session } = await requireMember();
  if (userId === session.userId) {
    await runOperation(leaveOrganizationOp, {});
  } else {
    await runOperation(removeMemberOp, { userId });
  }
}

export async function createInviteAction(role: Role, email?: string) {
  return runOperation(createInviteOp, { role, email });
}

export async function revokeInviteAction(inviteId: string) {
  await runOperation(revokeInviteOp, { id: inviteId });
}

// --- Organization API keys (#618) --------------------------------------------

/**
 * Mints an org API key. The plaintext secret is returned ONCE from here and
 * never stored — the Db seam only ever sees its hash and displayable hint.
 * The key's Role is capped at the creator's: a key acts as a delegate of the
 * human who minted it and can never out-rank them.
 */
export async function createApiKeyAction(name: string, role: Role) {
  return runOperation(createOrgApiKeyOp, {
    name: name.trim() || "Untitled key",
    role,
  });
}

export async function revokeApiKeyAction(keyId: string) {
  await runOperation(revokeOrgApiKeyOp, { id: keyId });
}

// --- Profile ----------------------------------------------------------------

/** The signed-in caller's own profile — not org-scoped, no role gate. */
export async function updateProfileAction(patch: ProfilePatch) {
  await requireSession();
  const db = await getDb();
  const profile = await db.updateProfile(patch);
  revalidatePath("/", "layout");
  return profile;
}

export async function uploadProfileAvatarAction(
  formData: FormData,
): Promise<{ avatarUrl?: string; error?: string }> {
  // Any Member may set their own photo; the object path is scoped to the
  // caller's active Organization prefix, matching the storage layout.
  const { db, session } = await requireMember();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an image file" };
  }
  const validation = validatePublicImageFile(file);
  if (!validation.ok) return { error: validation.error };
  if (!isSupabaseConfigured() || !isSupabaseServiceConfigured()) {
    return { error: "Object storage is not configured" };
  }

  const uploaded = await uploadPublicImageAsset(createSupabaseServiceClient(), {
    organizationId: session.organization.id,
    kind: "profile",
    file,
  });

  await db.updateProfile({ avatarUrl: uploaded.publicUrl });
  revalidatePath("/", "layout");
  return { avatarUrl: uploaded.publicUrl };
}

// --- Platform (Ciele) settings ------------------------------------------------

/**
 * Updates the platform-wide system prompt. This is a Ciele-owner surface, not
 * an org one: it is gated on PLATFORM_OWNER_EMAIL, not on org roles, and is
 * invisible to every other user (see lib/platform.ts).
 */
export async function updatePlatformPromptAction(prompt: string) {
  const session = await requireSession();
  if (!isPlatformOwner(session.email)) {
    throw new Error("Only the platform owner can edit the platform prompt");
  }
  await setPlatformSystemPrompt(prompt.trim(), session.email);
  revalidatePath("/settings/ai");
}

// --- Assistants ----------------------------------------------------------------

export async function createAssistantAction(input: {
  title: string;
  nickname?: string;
  description?: string;
}) {
  const assistant = await runOperation(createAssistantOp, input);
  redirect(`/assistants/${assistant.id}`);
}

export async function updateAssistantAction(id: string, patch: AssistantPatch) {
  await runOperation(updateAssistantOp, { id, patch });
}

/**
 * Runs an api_request flow-action config against its endpoint with sample
 * template values so an editor can preview the outcome. Editor-gated; secrets
 * in the config are used to make the call but never returned to the browser
 * (the result carries only status, a bounded excerpt, extracted values and a
 * generic error — see api-request.ts).
 */
export async function testApiRequestAction(
  settings: NonNullable<FlowActionSettings["api_request"]>,
): Promise<ApiRequestTestResult> {
  await requireMember("edit");
  return testApiRequest(settings);
}

export async function uploadAssistantAvatarAction(
  id: string,
  formData: FormData,
): Promise<{ avatarUrl?: string; error?: string }> {
  return orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "assistant", id }],
      revalidateIf: (result) => !result.error,
    },
    async ({ db, session }) => {
      const assistant = await db.getAssistant(id);
      if (!assistant || assistant.organizationId !== session.organization.id) {
        throw new Error("Assistant not found");
      }

      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return { error: "Choose an image file" };
      }
      const validation = validatePublicImageFile(file);
      if (!validation.ok) return { error: validation.error };
      if (!isSupabaseConfigured() || !isSupabaseServiceConfigured()) {
        return { error: "Object storage is not configured" };
      }

      const uploaded = await uploadPublicImageAsset(
        createSupabaseServiceClient(),
        {
          organizationId: session.organization.id,
          kind: "assistant",
          file,
        },
      );

      await db.updateAssistant(id, { avatarUrl: uploaded.publicUrl });
      return { avatarUrl: uploaded.publicUrl };
    },
  );
}

export async function deleteAssistantAction(id: string) {
  // Cascade + per-Collection graph purge live in the operation (#620); the
  // graph enqueue rides the `purgeCollectionGraph` port `runOperation` wires.
  await runOperation(deleteAssistantOp, { id });
}

/**
 * Deletes a Knowledge Collection (cascade-deletes its Sources and Concepts) and
 * reclaims its derived graph dataset with a single purge — the Collection-level
 * counterpart to `deleteAssistantAction`'s per-Collection purge. Inert on the
 * graph side without a worker.
 */
export async function deleteCollectionAction(
  assistantId: string,
  collectionId: string,
) {
  await orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "assistantEditor", assistantId }],
    },
    async ({ db }) => {
      await db.deleteCollection(collectionId);
      await enqueueGraphSyncJob({ op: "purge", collectionId }, { db });
    },
  );
}

/**
 * "Duplicate assistant": copies configuration (general settings, style,
 * help-desk settings) and all flows. Knowledge, publications, and
 * conversations stay with the original. Body lives in `duplicateAssistantOp`
 * (#620), shared with `POST /api/v1/assistants/{id}/duplicate`.
 */
export async function duplicateAssistantAction(id: string): Promise<Assistant> {
  return runOperation(duplicateAssistantOp, { id });
}

// --- Flows ------------------------------------------------------------------------
// Bodies (incl. the #541 trigger/action pairing rule and the Default-behavior
// lock) live in @ciele/ops (#621), shared with /api/v1.

export async function createFlowAction(assistantId: string, input: FlowInput) {
  await runOperation(createFlowOp, { assistantId, input });
}

export async function updateFlowAction(
  assistantId: string,
  flowId: string,
  patch: FlowPatch,
) {
  await runOperation(updateFlowOp, { id: flowId, patch });
}

export async function deleteFlowAction(assistantId: string, flowId: string) {
  await runOperation(deleteFlowOp, { id: flowId });
}

export async function reorderFlowsAction(
  assistantId: string,
  orderedIds: string[],
) {
  await runOperation(reorderFlowsOp, { assistantId, orderedIds });
}

// --- Help desks ---------------------------------------------------------------------

export async function createHelpDeskAction(input: {
  name: string;
  description?: string;
}) {
  return runOperation(createHelpDeskOp, input);
}

export async function updateHelpDeskAction(
  id: string,
  patch: {
    name?: string;
    description?: string;
    autoGenerateImprovements?: boolean;
  },
) {
  await runOperation(updateHelpDeskOp, { id, patch });
}

export async function deleteHelpDeskAction(id: string) {
  await runOperation(deleteHelpDeskOp, { id });
}

export async function createSupportChannelAction(
  helpDeskId: string,
  input: SupportChannelInput,
) {
  return runOperation(createSupportChannelOp, { helpDeskId, input });
}

export async function updateSupportChannelAction(
  helpDeskId: string,
  channelId: string,
  patch: SupportChannelPatch,
) {
  return runOperation(updateSupportChannelOp, { helpDeskId, channelId, patch });
}

export async function deleteSupportChannelAction(
  helpDeskId: string,
  channelId: string,
) {
  await runOperation(deleteSupportChannelOp, { helpDeskId, channelId });
}

export async function reorderSupportChannelsAction(
  helpDeskId: string,
  orderedIds: string[],
) {
  await runOperation(reorderSupportChannelsOp, { helpDeskId, orderedIds });
}

export async function connectServiceNowIntegrationAction(
  helpDeskId: string,
  input: {
    name: string;
    baseUrl: string;
    clientId: string;
    clientSecret: string;
    username: string;
    password: string;
  },
) {
  await runOperation(connectServiceNowOp, { helpDeskId, ...input });
}

export async function disconnectTicketingIntegrationAction(helpDeskId: string) {
  await runOperation(disconnectTicketingIntegrationOp, { helpDeskId });
}

// --- Widget SSO connection (org-level; Authentication section) --------------
//
// The connection is org-scoped and holds a secret, so managing it needs the
// admin-tier capability (matches provider connections + the sso_connections RLS
// rank). The `assistantId` only steers revalidation to the editor page the
// admin is on. The require-sign-in toggle is a per-assistant edit.

export async function setSsoConnectionAction(
  assistantId: string,
  input: {
    provider: SsoProviderKind;
    clientId: string;
    tenantId: string;
    clientSecret: string;
    /** Opt-in identity claim to verify at sign-in (#662); omit for subject-only. */
    identityClaim?: string;
  }
): Promise<{ error?: string }> {
  void assistantId;
  try {
    await runOperation(setSsoConnectionOp, input);
    return {};
  } catch (error) {
    return { error: thrownMessage(error, "Could not save the SSO connection") };
  }
}

export async function validateSsoConnectionAction(
  assistantId: string,
): Promise<{ ok: boolean; error?: string }> {
  void assistantId;
  try {
    return await runOperation(validateSsoIdentityOp, {});
  } catch (error) {
    return { ok: false, error: thrownMessage(error, "Could not validate SSO") };
  }
}

export async function disconnectSsoConnectionAction(assistantId: string) {
  void assistantId;
  await runOperation(disconnectSsoConnectionOp, {});
}

export async function setAssistantRequireSignInAction(
  assistantId: string,
  requireSignIn: boolean,
) {
  await runOperation(updateAssistantOp, {
    id: assistantId,
    patch: { requireSignIn },
  });
}

/**
 * Live SSO gate state for the editor Preview — reads the *current* assistant
 * (not a Publication), so the gate reflects the require-sign-in toggle
 * immediately. Read-only; the visitor's gate cookie is checked server-side.
 */
export async function getPreviewSsoGateAction(assistantId: string): Promise<{
  requireSignIn: boolean;
  authenticated: boolean;
  provider: SsoProviderKind | null;
}> {
  const { db, session } = await requireMember();
  const assistant = await db.getAssistant(assistantId);
  const requireSignIn = assistant?.requireSignIn ?? false;
  if (!requireSignIn) {
    return { requireSignIn: false, authenticated: true, provider: null };
  }
  const orgId = session.organization.id;
  const cookieStore = await cookies();
  const authenticated = isGateValidForOrg(
    cookieStore.get(SSO_GATE_COOKIE)?.value,
    orgId,
  );
  const connection = await db.getSsoConnectionPublic(orgId);
  return {
    requireSignIn: true,
    authenticated,
    provider: connection?.provider ?? null,
  };
}

/**
 * The escalation menu for the editor Preview: the assistant's selected help
 * desks with their enabled channels, read live (not from a Publication) so
 * the Preview reflects unsaved-but-applied Help Desks settings immediately.
 */
export async function listEscalationDesksAction(
  assistantId: string,
): Promise<EscalationHelpDesk[]> {
  const { db, session } = await requireMember();
  const assistant = await db.getAssistant(assistantId);
  if (!assistant || assistant.organizationId !== session.organization.id) {
    return [];
  }
  return listEscalationDesks(
    db,
    session.organization.id,
    assistant.helpDeskSettings?.selectedIds ?? [],
  );
}

// --- Skills (reusable prompt templates, attachable per assistant) ---------------------

/** Creates an org Skill; when created from an assistant's page, attaches it too. */
export async function createSkillAction(
  input: SkillInput,
  attachToAssistantId?: string,
): Promise<Skill> {
  return runOperation(createSkillOp, { ...input, attachToAssistantId });
}

export async function updateSkillAction(
  assistantId: string,
  skillId: string,
  patch: SkillPatch,
) {
  await runOperation(updateSkillOp, { id: skillId, patch });
}

export async function deleteSkillAction(assistantId: string, skillId: string) {
  await runOperation(deleteSkillOp, { id: skillId });
}

/** Replaces which org Skills this assistant runs with (ordered). */
export async function setAssistantSkillsAction(
  assistantId: string,
  skillIds: string[],
) {
  await runOperation(setAssistantSkillsOp, { assistantId, skillIds });
}

// --- API catalogue integration (spec #559) ---------------------------------

/**
 * The integration as the browser may see it: everything except the credential,
 * which is replaced by "is one set". A secret that is never sent to the client
 * cannot leak from the client, and the editor does not need it — saving without
 * a new credential keeps the stored one.
 */
export interface ApiIntegrationView {
  name: string;
  baseUrl: string;
  authType: ApiIntegrationAuthType;
  authHeaderName: string;
  authUsername: string;
  hasCredential: boolean;
  endpoints: ApiEndpointSpec[];
}

export async function getApiIntegrationAction(
  assistantId: string,
): Promise<ApiIntegrationView | null> {
  return runOperation(getApiIntegrationOp, { assistantId });
}

/**
 * Saves the assistant's one API integration. The credential is sealed here and
 * only here — the browser posts it in the clear over TLS exactly once, the same
 * way every other credential in the console is set, and never reads it back.
 * `credential: undefined` leaves the stored one alone; `""` clears it.
 */
export async function setApiIntegrationAction(
  assistantId: string,
  input: {
    name: string;
    baseUrl: string;
    authType: ApiIntegrationAuthType;
    authHeaderName?: string;
    authUsername?: string;
    credential?: string;
    endpoints: ApiEndpointSpec[];
  },
): Promise<{ error?: string }> {
  try {
    await runOperation(setApiIntegrationOp, { assistantId, input });
    return {};
  } catch (error) {
    return { error: thrownMessage(error, "Could not save the API integration") };
  }
}

export async function deleteApiIntegrationAction(assistantId: string) {
  await runOperation(deleteApiIntegrationOp, { assistantId });
}

// --- Publish (snapshot semantics, CONTEXT.md: Publication) ------------------------------

// Bodies live in @ciele/ops (#623); the widget cache learns about the new
// latest version through the invalidatePublication port.

export async function publishAssistantAction(assistantId: string) {
  const { version } = await runOperation(publishAssistantOp, { assistantId });
  return version;
}

export async function unpublishAssistantAction(assistantId: string) {
  await runOperation(unpublishAssistantOp, { assistantId });
}

export async function republishAction(
  assistantId: string,
  publicationId: string,
) {
  const { version } = await runOperation(republishOp, {
    assistantId,
    publicationId,
  });
  return version;
}

// --- Provider connections ------------------------------------------------------------

/**
 * BYOK: seals and stores an org API key (admins). Returns an error message
 * instead of throwing for expected failures, so the client can toast it.
 */
export async function createProviderConnectionAction(
  provider: Provider,
  apiKey: string,
  displayName?: string,
): Promise<{ error?: string }> {
  const result = await runOperation(createProviderApiKeyOp, {
    provider: provider as "anthropic" | "openai" | "google",
    apiKey,
    displayName,
  });
  return result.error ? { error: result.error } : {};
}

/** Legacy compatibility path: hosted subscription connections are retired. */
export async function createSubscriptionConnectionAction(
  _provider: Provider,
  _token: string,
  _displayName?: string,
): Promise<{ error?: string }> {
  void _provider;
  void _token;
  void _displayName;
  return {
    error:
      "Hosted Claude and ChatGPT subscription connections are retired. Use an API key or keyless enterprise auth.",
  };
}

export async function createGoogleVertexFederatedConnectionAction(input: {
  displayName?: string;
  projectId: string;
  location: string;
  workloadIdentityAudience: string;
  serviceAccountEmail?: string;
}): Promise<{ error?: string }> {
  await runOperation(createFederatedProviderConnectionOp, {
    kind: "google_vertex",
    ...input,
  });
  return {};
}

export async function createAnthropicWifFederatedConnectionAction(input: {
  displayName?: string;
  workloadIdentityAudience: string;
  organizationId?: string;
  workspaceId?: string;
}): Promise<{ error?: string }> {
  await runOperation(createFederatedProviderConnectionOp, {
    kind: "anthropic_wif",
    ...input,
  });
  return {};
}

export async function createAzureOpenAiFederatedConnectionAction(input: {
  displayName?: string;
  tenantId: string;
  endpoint: string;
  deployment: string;
  clientId?: string;
  audience?: string;
}): Promise<{ error?: string }> {
  await runOperation(createFederatedProviderConnectionOp, {
    kind: "azure_openai",
    ...input,
  });
  return {};
}

/**
 * OpenAI-compatible endpoint (#436): stores an `api_key` connection whose
 * config carries the base URL + model names. The key itself is optional —
 * local servers (Ollama, LM Studio) usually ignore authentication — and the
 * generic key probe doesn't apply here; the Test action below is the health
 * check.
 */
export async function createOpenAiCompatibleConnectionAction(input: {
  displayName?: string;
  baseUrl: string;
  apiKey?: string;
  chatModel: string;
  embeddingModel?: string;
  embeddingDims?: number;
}): Promise<{ error?: string }> {
  const result = await runOperation(createOpenAiCompatibleConnectionOp, input);
  return result.error ? { error: result.error } : {};
}

/**
 * "Test connection" for the OpenAI-compatible form: probes the chat leg and
 * (when configured) the embedding leg without persisting anything. Never
 * throws for endpoint failures — each leg reports its own ok/detail.
 */
export async function testOpenAiCompatibleConnectionAction(input: {
  baseUrl: string;
  apiKey?: string;
  chatModel: string;
  embeddingModel?: string;
}): Promise<OpenAiCompatibleTestResult> {
  await requireMember();
  return testOpenAiCompatibleConnection({
    baseUrl: input.baseUrl.trim(),
    apiKey: input.apiKey?.trim() || null,
    chatModel: input.chatModel.trim(),
    embeddingModel: input.embeddingModel?.trim() || null,
  });
}

export async function deleteProviderConnectionAction(id: string) {
  await runOperation(deleteProviderConnectionOp, { id });
}

// --- Knowledge (OKF collections) --------------------------------------------------------

/** Creates the Source row (`processing`) and defers the OKF pipeline to an
 *  Ingestion Job; the Knowledge UI polls the status until it settles. When an
 *  uploaded `original` binary is given and object storage is configured, it is
 *  persisted first and linked to the Source so it can be re-processed later. */
async function ingestNewSource(
  assistantId: string,
  collectionId: string,
  name: string,
  kind: "file" | "url" | "text",
  rawText: string,
  original?: File,
  /** The fetched URL for a `url` Source — retained so the OKF `sources` entry
   *  its Concepts carry names a followable artifact rather than a descriptor
   *  (the Source `name` is the page *title*, which is not addressable). */
  sourceUrl?: string,
) {
  // Original-binary storage stays at this surface (stateless, storage-bound);
  // guards + Source row + ingestion enqueue live in addSourceOp (#622).
  const { session } = await requireMember("edit");
  let originalObjectPath: string | undefined;
  if (original && isSupabaseConfigured() && isSupabaseServiceConfigured()) {
    const stored = await uploadKnowledgeOriginal(
      createSupabaseServiceClient(),
      {
        organizationId: session.organization.id,
        file: original,
      },
    );
    originalObjectPath = stored.path;
  }

  await runOperation(addSourceOp, {
    assistantId,
    collectionId,
    name,
    kind,
    rawText,
    sourceUrl,
    originalObjectPath,
  });
}

export async function addTextSourceAction(
  assistantId: string,
  collectionId: string,
  name: string,
  text: string,
) {
  const extracted = await extractSourceText({ kind: "text", name, text });
  await ingestNewSource(
    assistantId,
    collectionId,
    extracted.name,
    "text",
    extracted.text,
  );
}

export async function addUrlSourceAction(
  assistantId: string,
  collectionId: string,
  url: string,
) {
  const extracted = await extractSourceText({ kind: "url", url });
  await ingestNewSource(
    assistantId,
    collectionId,
    extracted.name,
    "url",
    extracted.text,
    undefined,
    url,
  );
}

/**
 * Errors here are caught and returned (not thrown): Next.js redacts thrown
 * Server Action errors to a generic digest message in production, which
 * would hide the actual extraction failure (bad PDF, encrypted file, no
 * extractable text, etc.) from the admin.
 */
export async function uploadFileSourceAction(
  formData: FormData,
): Promise<{ error: string } | void> {
  const assistantId = formData.get("assistantId") as string;
  const collectionId = formData.get("collectionId") as string;
  const file = formData.get("file") as File | null;
  if (!file) return { error: "No file" };

  const validation = validateKnowledgeFile({
    name: file.name,
    size: file.size,
  });
  if (!validation.ok) return { error: validation.error };

  try {
    const extracted = await extractSourceText({
      kind: "file",
      name: file.name,
      bytes: await file.arrayBuffer(),
    });
    await ingestNewSource(
      assistantId,
      collectionId,
      extracted.name,
      "file",
      extracted.text,
      file,
    );
  } catch (error) {
    return { error: thrownMessage(error, "Upload failed") };
  }
}

/**
 * Re-process a file Source from its stored original: re-runs the full
 * ingestion pipeline (extract → enrich → chunk → embed) from the retained
 * binary, replacing the Source's Concepts/chunks. Available only for file
 * Sources whose original was persisted (see `ingestNewSource`); pre-existing
 * Sources without one surface a clear reason instead.
 */
export async function reprocessSourceAction(
  assistantId: string,
  collectionId: string,
  sourceId: string,
) {
  const { db } = await requireMember("edit");
  const source = await db.getSource(sourceId);
  if (!source || source.collectionId !== collectionId)
    throw new Error("Source not found");
  if (!source.originalObjectPath) {
    throw new Error(
      "This file was uploaded before originals were stored, so it can't be re-processed. Re-upload the file to enable re-processing.",
    );
  }
  if (!isSupabaseConfigured() || !isSupabaseServiceConfigured()) {
    throw new Error("Object storage is not configured");
  }

  const bytes = await downloadKnowledgeOriginal(
    createSupabaseServiceClient(),
    source.originalObjectPath,
  );
  const extracted = await extractSourceText({
    kind: "file",
    name: source.name,
    bytes,
  });

  // The existing Concepts stay live while the job runs; the ingestion
  // pipeline replaces them atomically only once the full new set commits.
  await db.updateSource(sourceId, { status: "processing", error: "" });
  await enqueueIngestJob(
    {
      kind: "ingest_source",
      assistantId,
      collectionId,
      sourceId,
      rawText: extracted.text,
    },
    { db },
  );
  revalidatePath(`/assistants/${assistantId}`);
}

export async function retrySourceIngestAction(
  assistantId: string,
  collectionId: string,
  sourceId: string,
) {
  const { db } = await requireMember("edit");
  const source = await db.getSource(sourceId);
  if (!source || source.collectionId !== collectionId)
    throw new Error("Source not found");
  if (source.kind === "website") {
    await recrawlWebsiteSourceAction(assistantId, collectionId, sourceId);
    return;
  }

  const [job] = await db.listBackgroundJobsForSource(sourceId, "ingest_source");
  const payload = job?.payload as Partial<{
    kind: "ingest_source";
    assistantId: string;
    collectionId: string;
    sourceId: string;
    rawText: string;
  }>;
  if (
    payload?.kind !== "ingest_source" ||
    payload.assistantId !== assistantId ||
    payload.collectionId !== collectionId ||
    payload.sourceId !== sourceId ||
    typeof payload.rawText !== "string"
  ) {
    throw new Error("Retry metadata is not available for this source");
  }

  // The existing Concepts stay live while the job runs; the ingestion
  // pipeline replaces them atomically only once the full new set commits.
  await db.updateSource(sourceId, { status: "processing", error: "" });
  await enqueueIngestJob(
    {
      kind: "ingest_source",
      assistantId,
      collectionId,
      sourceId,
      rawText: payload.rawText,
    },
    { db },
  );
  revalidatePath(`/assistants/${assistantId}`);
}

// Websites mode: crawl through the selected adapter and store one Concept per
// page. The configuration is persisted on the Source for edit + re-crawl.
export interface WebsiteFormInput {
  name: string;
  url: string;
  crawlerProvider?: WebsiteCrawlerProvider;
  maxPages?: number;
  includeGlobs?: string;
  excludeGlobs?: string;
  fetchFiles?: boolean;
  throttle?: boolean;
  pageTimeoutSecs?: number;
  waitSecs?: number;
  loginProtected?: boolean;
}

function toWebsiteConfig(input: WebsiteFormInput) {
  return {
    url: input.url.trim(),
    crawlerProvider: input.crawlerProvider ?? "auto",
    maxPages: input.maxPages,
    includeGlobs: (input.includeGlobs ?? "")
      .split("\n")
      .map((g) => g.trim())
      .filter(Boolean),
    excludeGlobs: (input.excludeGlobs ?? "")
      .split("\n")
      .map((g) => g.trim())
      .filter(Boolean),
    fetchFiles: input.fetchFiles ?? false,
    throttle: input.throttle ?? false,
    pageTimeoutSecs: input.pageTimeoutSecs || undefined,
    waitSecs: input.waitSecs || undefined,
    loginProtected: input.loginProtected ?? false,
  };
}

export async function addWebsiteSourceAction(
  assistantId: string,
  collectionId: string,
  input: WebsiteFormInput,
) {
  await orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "assistantEditor", assistantId }, { kind: "alerts" }],
    },
    async ({ db }) => {
      const source = await db.createSource({
        collectionId,
        name: input.name.trim() || input.url,
        kind: "website",
        config: toWebsiteConfig(input),
      });
      // Start the crawl in the background; the client polls until it's ready.
      await beginWebsiteCrawl({ db, sourceId: source.id });
    },
  );
}

/** Saves the edit dialog; does not re-crawl (that's the refresh action). */
export async function updateWebsiteSourceAction(
  assistantId: string,
  sourceId: string,
  input: WebsiteFormInput,
) {
  await orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "assistantEditor", assistantId }],
    },
    ({ db }) =>
      updateWebsiteSourceConfiguration({
        db,
        sourceId,
        name: input.name.trim() || input.url,
        config: toWebsiteConfig(input),
      }),
  );
}

/** Sets a website source's re-crawl cadence; does not trigger a crawl. */
export async function setRecrawlScheduleAction(
  assistantId: string,
  sourceId: string,
  schedule: RecrawlSchedule,
) {
  await orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "assistantEditor", assistantId }],
    },
    ({ db }) => db.updateSource(sourceId, { recrawlSchedule: schedule }),
  );
}

/** Re-crawl: wipes the source's pages and starts a fresh background crawl. */
export async function recrawlWebsiteSourceAction(
  assistantId: string,
  collectionId: string,
  sourceId: string,
) {
  await runOperation(recrawlSourceOp, { id: sourceId });
}

/**
 * Polls an in-flight website crawl: finalizes it if the provider run has
 * finished (ingesting its pages) and returns the Source's current status. The
 * Knowledge UI calls this on an interval while a source is `processing`.
 */
export async function pollWebsiteCrawlAction(
  assistantId: string,
  collectionId: string,
  sourceId: string,
): Promise<SourceStatus> {
  return orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "assistantEditor", assistantId }],
      revalidateIf: (status: SourceStatus) => status !== "processing",
    },
    ({ db }) =>
      finalizeWebsiteCrawl({ db, assistantId, collectionId, sourceId }),
  );
}

/** Per-page exclusion: removes (or restores) the page's search chunks. */
export async function setPageExcludedAction(
  assistantId: string,
  conceptId: string,
  excluded: boolean,
) {
  await orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "assistantEditor", assistantId }],
    },
    async ({ db, session }) => {
      await db.setConceptExcluded(conceptId, excluded);
      if (excluded) {
        await db.deleteChunksByConcept(conceptId);
      } else {
        const concept = await db.getConcept(conceptId);
        if (concept) {
          const connections = await db.listProviderConnections(
            session.organization.id,
          );
          await embedConcept({
            db,
            assistantId,
            collectionId: concept.collectionId,
            conceptId,
            title: concept.frontmatter.title ?? concept.path,
            body: concept.body,
            connections,
          });
        }
      }
    },
  );
}

/** Per-page re-crawl override; null clears it back to inheriting the site. */
export async function setPageRecrawlScheduleAction(
  assistantId: string,
  conceptId: string,
  schedule: RecrawlSchedule | null,
) {
  await orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "assistantEditor", assistantId }],
    },
    ({ db }) => db.setConceptRecrawlSchedule(conceptId, schedule),
  );
}

// FAQs mode: each FAQ is an OKF concept of type "FAQ". The persist helper
// moved to lib/op-ports.ts (#622) so both surfaces share it as a port.

// --- Org-level knowledge hub (PRD #726) --------------------------------------

/**
 * Guard for hub reads: the Source must belong to the caller's Organization —
 * via the collection's org stamp, or the legacy owning assistant's org for
 * rows the backfill hasn't reached. RLS enforces this again underneath; the
 * guard keeps the mock db honest and the error uniform.
 */
async function requireOrgSource(
  db: Db,
  organizationId: string,
  sourceId: string
) {
  const source = await db.getSource(sourceId);
  const collection = source ? await db.getCollection(source.collectionId) : null;
  let orgId = collection?.organizationId ?? "";
  if (!orgId && collection?.assistantId) {
    orgId =
      (await db.getAssistant(collection.assistantId))?.organizationId ?? "";
  }
  if (!source || orgId !== organizationId) throw new Error("Source not found");
  return source;
}

/** The "View knowledge source" pages list (bounded server-side). */
export async function listSourceConceptsAction(sourceId: string): Promise<{
  items: Array<{
    id: string;
    title: string;
    path: string;
    resourceUrl: string | null;
  }>;
}> {
  const { db, organizationId } = await requireMember();
  await requireOrgSource(db, organizationId, sourceId);
  const concepts = await db.listConceptsBySource(sourceId);
  return {
    items: concepts
      .filter((c) => !c.excluded)
      .map((c) => ({
        id: c.id,
        title: c.frontmatter.title ?? c.path,
        path: c.path,
        resourceUrl: c.frontmatter.resource ?? null,
      })),
  };
}

/**
 * Admin-side download of a file Source's retained original: a short-lived
 * signed URL against the private originals bucket (distinct from the
 * visitor-facing Direct access flow). Null when no original was retained or
 * the demo store has no object storage.
 */
export async function downloadKnowledgeOriginalAction(
  sourceId: string
): Promise<{ url: string | null }> {
  const { db, organizationId } = await requireMember();
  const source = await requireOrgSource(db, organizationId, sourceId);
  if (!source.originalObjectPath || !isSupabaseConfigured())
    return { url: null };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from(KNOWLEDGE_ORIGINALS_BUCKET)
    .createSignedUrl(source.originalObjectPath, 600);
  if (error) return { url: null };
  return { url: data?.signedUrl ?? null };
}

/** Replaces a Source's full linked-assistant set ("Manage linked assistants"). */
export async function setSourceLinksAction(
  sourceId: string,
  assistantIds: string[],
) {
  await runOperation(setSourceLinksOp, { sourceId, assistantIds });
}

/** Flips Direct access for one assistant on a file Source. */
export async function setSourceDirectAccessAction(
  sourceId: string,
  assistantId: string,
  directAccess: boolean,
) {
  await runOperation(setDirectAccessOp, { sourceId, assistantId, directAccess });
}

/** Hub delete: removes the item for every linked Assistant at once. */
export async function deleteOrgSourceAction(sourceId: string) {
  await runOperation(deleteSourceOp, { id: sourceId });
}

/** Hub single-Q&A create: lands in the org Knowledge Library, linked as chosen. */
export async function createOrgFaqAction(
  question: string,
  answer: string,
  assistantIds: string[],
) {
  const { db, organizationId } = await requireMember("edit");
  const library = await db.getOrCreateOrgLibraryCollection(organizationId);
  await runOperation(createFaqOp, {
    collectionId: library.id,
    question,
    answer,
    assistantIds,
  });
}

/** Hub CSV import — same contract as the per-assistant one, org-wide. */
export async function importOrgFaqsAction(formData: FormData): Promise<{
  imported: number;
  skipped: string[];
}> {
  const file = formData.get("file") as File | null;
  const assistantIds = JSON.parse(
    (formData.get("assistantIds") as string | null) ?? "[]",
  ) as string[];
  if (!file) return { imported: 0, skipped: ["No file provided"] };
  if (file.size > FAQ_CSV_MAX_BYTES)
    return { imported: 0, skipped: ["File exceeds the 10MB limit"] };
  const { rows, skipped } = parseFaqCsv(await file.text());
  if (rows.length === 0) return { imported: 0, skipped };
  const { db, organizationId } = await requireMember("edit");
  const library = await db.getOrCreateOrgLibraryCollection(organizationId);
  const result = await runOperation(importFaqsOp, {
    collectionId: library.id,
    fileName: file.name,
    rows,
    assistantIds,
  });
  return { imported: result.imported, skipped };
}

/** One FAQ with its full answer — the hub's edit dialog. */
export async function getOrgFaqAction(
  sourceId: string,
): Promise<{ question: string; answer: string }> {
  const { db, organizationId } = await requireMember();
  const source = await requireOrgSource(db, organizationId, sourceId);
  const [concept] = await db.listConceptsBySource(sourceId, 1);
  return { question: source.name, answer: concept?.body ?? "" };
}

/** Hub FAQ edit, keyed by the FAQ's Source (question = Source name). */
export async function updateOrgFaqAction(
  sourceId: string,
  question: string,
  answer: string,
) {
  const { db, organizationId, session } = await requireMember("edit");
  const source = await requireOrgSource(db, organizationId, sourceId);
  if (source.kind !== "faq") throw new Error("Not a FAQ");
  const [existing] = await db.listConceptsBySource(sourceId, 1);
  if (!existing) throw new Error("FAQ content missing");
  const trimmed = question.trim();
  const concept = await db.updateConcept(existing.id, {
    frontmatter: {
      ...existing.frontmatter,
      type: "FAQ",
      title: trimmed,
      description: answer.slice(0, 140),
      generated: {
        by: okfActor.human(session.userId),
        at: new Date().toISOString(),
      },
    },
    body: answer,
  });
  await db.updateSource(sourceId, { name: trimmed.slice(0, 500) });
  await db.deleteChunksByConcept(concept.id);
  // Chunks are stamped with a linked Assistant; an unlinked FAQ is
  // unreachable in retrieval anyway, so skipping the re-embed loses nothing.
  const links = await db.listSourceAssistantLinks(sourceId);
  if (links[0]) {
    const connections = await db.listProviderConnections(organizationId);
    await embedConcept({
      db,
      assistantId: links[0].assistantId,
      collectionId: concept.collectionId,
      conceptId: concept.id,
      title: trimmed,
      body: answer,
      connections,
    });
  }
  revalidatePath("/knowledge/faqs");
}

/**
 * Hub website add. Crawler finalization derives its assistant stamp from the
 * owning Collection, so hub websites land in the FIRST linked assistant's
 * collection rather than the org library — retrieval reach for the rest
 * comes from the link table either way.
 */
export async function addOrgWebsiteSourceAction(
  input: WebsiteFormInput,
  assistantIds: string[],
) {
  const unique = [...new Set(assistantIds)];
  if (unique.length === 0) throw new Error("Pick at least one assistant");
  await orgMutation(
    {
      capability: "edit",
      entities: [
        { kind: "knowledgeHub" },
        { kind: "alerts" },
        { kind: "assistantEditor", assistantId: unique[0] },
      ],
    },
    async ({ db }) => {
      const collections = await db.listCollections(unique[0]);
      const collectionId =
        collections[0]?.id ??
        (
          await db.createCollection(unique[0], {
            name: "General knowledge",
            description: "Default collection for this assistant",
          })
        ).id;
      const source = await db.createSource({
        collectionId,
        name: input.name.trim() || input.url,
        kind: "website",
        config: toWebsiteConfig(input),
      });
      await db.setSourceAssistantLinks(source.id, unique);
      await beginWebsiteCrawl({ db, sourceId: source.id });
    },
  );
}

/** Hub file upload: extraction at the surface, ingest via addSourceOp. */
export async function uploadOrgFileSourceAction(
  formData: FormData,
): Promise<{ error: string } | void> {
  const file = formData.get("file") as File | null;
  const assistantIds = JSON.parse(
    (formData.get("assistantIds") as string | null) ?? "[]",
  ) as string[];
  if (!file) return { error: "No file" };
  const validation = validateKnowledgeFile({
    name: file.name,
    size: file.size,
  });
  if (!validation.ok) return { error: validation.error };
  try {
    const { db, organizationId, session } = await requireMember("edit");
    const library = await db.getOrCreateOrgLibraryCollection(organizationId);
    const extracted = await extractSourceText({
      kind: "file",
      name: file.name,
      bytes: await file.arrayBuffer(),
    });
    let originalObjectPath: string | undefined;
    if (isSupabaseConfigured() && isSupabaseServiceConfigured()) {
      const stored = await uploadKnowledgeOriginal(
        createSupabaseServiceClient(),
        { organizationId: session.organization.id, file },
      );
      originalObjectPath = stored.path;
    }
    await runOperation(addSourceOp, {
      collectionId: library.id,
      name: extracted.name,
      kind: "file",
      rawText: extracted.text,
      originalObjectPath,
      assistantIds,
    });
  } catch (error) {
    return { error: thrownMessage(error, "Upload failed") };
  }
}

/** Org-wide FAQ CSV export — same two-column shape as the per-assistant one. */
export async function exportOrgFaqsAction(): Promise<{ csv: string }> {
  const { db, organizationId } = await requireMember();
  const entries = await db.listOrgFaqs(organizationId);
  return {
    csv: serializeFaqCsv(
      entries.map((e) => ({ question: e.question, answer: e.answer }))
    ),
  };
}

export async function createFaqAction(
  assistantId: string,
  collectionId: string,
  question: string,
  answer: string,
) {
  // Guarding + hand-authored provenance live in createFaqOp (#622).
  await runOperation(createFaqOp, { assistantId, collectionId, question, answer });
}

/**
 * Bulk FAQ import from a two-column CSV (question, answer) — the "Import
 * FAQs" modal. Parsing/validation lives in lib/faq-csv.ts; every valid row
 * becomes an OKF FAQ concept through the same persistConcept path as a
 * single Q&A. Invalid rows are reported back, never fatal.
 */
export async function importFaqsAction(formData: FormData): Promise<{
  imported: number;
  skipped: string[];
}> {
  await requireMember("edit");
  const assistantId = String(formData.get("assistantId") ?? "");
  const collectionId = String(formData.get("collectionId") ?? "");
  const file = formData.get("file");
  if (!assistantId || !collectionId || !(file instanceof File)) {
    throw new Error("Missing assistant, collection, or file");
  }
  if (file.size > FAQ_CSV_MAX_BYTES) {
    throw new Error("File is too large, the maximum supported size is 10 MB");
  }

  const { rows, skipped } = parseFaqCsv(await file.text());
  if (rows.length === 0) {
    return { imported: 0, skipped };
  }

  const { imported } = await runOperation(importFaqsOp, {
    assistantId,
    collectionId,
    fileName: file.name,
    rows,
  });
  return { imported, skipped };
}

export async function updateFaqAction(
  assistantId: string,
  conceptId: string,
  question: string,
  answer: string,
) {
  const { db, session } = await requireMember("edit");
  const connections = await db.listProviderConnections(session.organization.id);
  const existing = await db.getConcept(conceptId);
  const concept = await db.updateConcept(conceptId, {
    frontmatter: {
      // Carry the prior frontmatter forward: an accepted Suggested Fix holds
      // `sources` and a `verified` stamp that a wholesale rewrite would erase.
      // The old `verified.at` deliberately stays put — content changing without
      // re-confirmation is exactly the signal §5.2 keeps `generated` and
      // `verified` separate to express (edited-since-last-reviewed).
      ...existing?.frontmatter,
      type: "FAQ",
      title: question.trim(),
      description: answer.slice(0, 140),
      generated: {
        by: okfActor.human(session.userId),
        at: new Date().toISOString(),
      },
    },
    body: answer,
  });
  // The FAQ's Source carries the question as its name (PRD #726) — keep it
  // in step so the hub's FAQs tab shows the edited question.
  if (existing?.sourceId) {
    const faqSource = await db.getSource(existing.sourceId);
    if (faqSource?.kind === "faq") {
      await db.updateSource(faqSource.id, {
        name: question.trim().slice(0, 500),
      });
    }
  }
  await db.deleteChunksByConcept(conceptId);
  await embedConcept({
    db,
    assistantId,
    collectionId: concept.collectionId,
    conceptId,
    title: question.trim(),
    body: answer,
    connections,
  });
  revalidatePath(`/assistants/${assistantId}`);
  revalidatePath("/knowledge/faqs");
}

/**
 * Re-embed backfill (#312): re-indexes every Concept that still has
 * null-embedding chunks (content ingested with no embedding provider, or
 * during a provider outage). Run after adding/fixing an embedding provider.
 */
export async function reembedKnowledgeAction(assistantId: string) {
  const { db, session } = await requireMember("edit");
  const connections = await db.listProviderConnections(session.organization.id);
  const conceptIds = await db.listNullEmbeddingConceptIds(assistantId);
  let reembedded = 0;
  for (const conceptId of conceptIds) {
    const concept = await db.getConcept(conceptId);
    if (!concept) continue;
    await db.deleteChunksByConcept(conceptId);
    await embedConcept({
      db,
      assistantId,
      collectionId: concept.collectionId,
      conceptId,
      title: concept.frontmatter.title ?? concept.path,
      body: concept.body,
      connections,
    });
    reembedded += 1;
  }
  revalidatePath(`/assistants/${assistantId}`);
  return { pending: conceptIds.length, reembedded };
}

export async function deleteSourceAction(
  assistantId: string,
  sourceId: string,
) {
  // Cascade capture + graph retirement live in deleteSourceOp (#622).
  await runOperation(deleteSourceOp, { id: sourceId });
}

export async function deleteConceptAction(
  assistantId: string,
  conceptId: string,
) {
  // A FAQ Concept owns a `faq` Source (PRD #726): deleting the FAQ retires
  // the whole Source so no orphaned hub row survives (cascade + graph
  // retirement live in deleteSourceOp).
  {
    const { db } = await requireMember("edit");
    const concept = await db.getConcept(conceptId);
    if (concept?.sourceId) {
      const source = await db.getSource(concept.sourceId);
      if (source?.kind === "faq") {
        await runOperation(deleteSourceOp, { id: source.id });
        return;
      }
    }
  }
  await orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "assistantEditor", assistantId }],
    },
    async ({ db }) => {
      // Capture the Collection before the delete so the graph document can be
      // retired too (ADR-0017). Inert without a graph worker.
      const concept = await db.getConcept(conceptId);
      await db.deleteConcept(conceptId);
      if (concept) {
        await enqueueGraphSyncJob(
          { op: "remove", collectionId: concept.collectionId, conceptId },
          { db },
        );
      }
    },
  );
}

/**
 * Backfills a Knowledge Collection into its derived Knowledge Graph — the
 * on-demand counterpart to the automatic per-Concept sync (used to seed a
 * Collection that predates the graph, or to reconcile after an outage).
 * Idempotent; inert without a graph worker.
 */
export async function backfillCollectionGraphAction(
  assistantId: string,
  collectionId: string,
): Promise<{ enqueued: number }> {
  return orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "assistantEditor", assistantId }],
    },
    ({ db }) => backfillCollectionToGraph(collectionId, { db }),
  );
}

// --- Conversations (preview history) ----------------------------------------------------

export async function listConversationsAction(
  assistantId: string,
): Promise<Conversation[]> {
  const { db, session } = await requireMember();
  return db.listConversations(assistantId, "member", session.userId);
}

export async function getConversationMessagesAction(
  conversationId: string,
): Promise<StoredMessage[]> {
  const { db } = await requireMember();
  return db.listMessages(conversationId);
}

/**
 * The reference-parity Inbox export (#561): the 29-field Conversation records
 * with their full `Messages[]` transcripts and serialized `AgenticTrace`.
 *
 * Server-side because the transcripts are not on the client (the Inbox loads one
 * at a time) and because the reasoning gate has to be *enforced*, not asked for —
 * an export leaves the console, so a Member below the gate must not be able to
 * request the chain-of-thought by passing a flag.
 *
 * Bounded twice over, because one click here turns into one transcript read per
 * Conversation: the id list is capped, and the reads run in fixed-size batches
 * rather than one `Promise.all` over the whole selection — 500 concurrent reads
 * would be a self-inflicted load spike on the tenant's own database. RLS re-scopes
 * every id on the way through, so a forged id returns nothing.
 */
export async function exportInboxConversationsAction(
  conversationIds: string[],
): Promise<ConversationExportRow[]> {
  const { db, session } = await requireMember();
  const wanted = new Set(
    conversationIds.slice(0, INBOX_EXPORT_MAX_CONVERSATIONS),
  );
  if (wanted.size === 0) return [];
  const conversations = (
    await db.listInboxConversations(session.organization.id)
  ).filter((c) => wanted.has(c.id));

  const inputs: Array<{
    conversation: (typeof conversations)[number];
    messages: StoredMessage[];
  }> = [];
  for (let i = 0; i < conversations.length; i += INBOX_EXPORT_READ_BATCH) {
    const batch = conversations.slice(i, i + INBOX_EXPORT_READ_BATCH);
    inputs.push(
      ...(await Promise.all(
        batch.map(async (conversation) => ({
          conversation,
          messages: await db.listMessages(conversation.id),
        })),
      )),
    );
  }

  return conversationExportRows(inputs, {
    includeReasoning: canViewReasoning(session.role),
    iterationLimit: MAX_AGENT_ITERATIONS,
  });
}

export async function deleteConversationAction(conversationId: string) {
  await runOperation(deleteConversationOp, { id: conversationId });
}

export async function setConversationPinnedAction(
  conversationId: string,
  pinned: boolean,
) {
  await runOperation(setConversationPinnedOp, { id: conversationId, pinned });
}

export async function sendConversationFeedbackAction(
  conversationId: string,
  text: string,
) {
  await runOperation(sendConversationFeedbackOp, { id: conversationId, text });
}

export async function setMessageFeedbackAction(
  messageId: string,
  feedback: -1 | 0 | 1,
) {
  await runOperation(setMessageFeedbackOp, { messageId, feedback });
}

// --- Improvements -----------------------------------------------------------

export async function listImprovementsAction(): Promise<ImprovementListItem[]> {
  const { db, session } = await requireMember();
  return db.listImprovements(session.organization.id);
}

export async function listImprovementMessagesAction(
  improvementId: string,
): Promise<ImprovementAssociation[]> {
  const { db } = await requireMember();
  return db.listImprovementMessages(improvementId);
}

/**
 * The three reads the Improvement detail page does, in one round trip — so the
 * Improvements drawer renders the same screen without a navigation.
 * Returns null when the id is unknown or belongs to another Organization.
 */
export async function getImprovementDetailAction(
  improvementId: string,
): Promise<{
  improvement: Improvement;
  associations: ImprovementAssociation[];
  proposal: ImprovementProposal | null;
} | null> {
  const { db, session } = await requireMember();
  const improvement = await db.getImprovement(improvementId);
  if (!improvement || improvement.organizationId !== session.organization.id) {
    return null;
  }
  const [associations, proposal] = await Promise.all([
    db.listImprovementMessages(improvement.id),
    db.getImprovementProposal(improvement.id),
  ]);
  return { improvement, associations, proposal };
}

export async function listConversationImprovementLinksAction(
  conversationId: string,
): Promise<ImprovementMessageLink[]> {
  const { db } = await requireMember();
  return db.listConversationImprovementLinks(conversationId);
}

/** Verifier verdicts for a conversation's messages (Inbox transcript badges). */
export async function listConversationAnswerVerdictsAction(
  conversationId: string,
): Promise<AnswerVerdict[]> {
  const { db } = await requireMember();
  return db.listConversationAnswerVerdicts(conversationId);
}

/** "Improve Answer" → Create New Improvement: makes an item + links the message. */
export async function createImprovementFromMessageAction(
  messageId: string,
  title: string,
): Promise<Improvement> {
  return orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "improvementList" }, { kind: "inbox" }],
    },
    async ({ db, session }) => {
      const improvement = await raiseImprovement(db, session.organization.id, {
        title,
        createdBy: session.userId,
        messageId,
      });
      // Flagging an answer for improvement is a thumbs-down: if it was
      // graph-served, score it 1 with the flag text so the graph demotes its
      // material (#389). Fail-soft / inert without a worker.
      await forwardGraphFeedback({
        db,
        organizationId: session.organization.id,
        messageId,
        score: feedbackScore(-1),
        text: title,
      });
      // Draft a Suggested Fix for the flagged answer (#390).
      await enqueueDraftProposalJob(
        { improvementId: improvement.id, messageId },
        { db },
      );
      return improvement;
    },
  );
}

/**
 * Accept a Suggested Fix (#390): create the drafted FAQ as a real OKF Concept
 * (the normal persistConcept path → re-embeds + graph fan-out), record the
 * created Concept on the proposal, and advance the Improvement to In Review.
 */
export async function acceptImprovementProposalAction(
  improvementId: string,
): Promise<void> {
  await orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "improvement", id: improvementId }, { kind: "inbox" }],
    },
    async ({ db, session }) => {
      const proposal = await db.getImprovementProposal(improvementId);
      if (!proposal || proposal.status !== "draft") {
        throw new Error("No draft Suggested Fix to accept");
      }
      const { targetAssistantId, targetCollectionId } = proposal.payload;
      // A FAQ needs a Collection; fall back to the assistant's first one when the
      // flagged conversation was unanchored.
      const collectionId =
        targetCollectionId ??
        (await db.listCollections(targetAssistantId))[0]?.id ??
        null;
      if (!collectionId) {
        throw new Error(
          "The assistant has no Knowledge Collection to add the FAQ to",
        );
      }
      // The drafter's provenance, resolved to OKF v0.2 (§5.1): each Concept the
      // draft drew on becomes a bundle-relative `sources` entry, so the new FAQ
      // records its derivation instead of losing it at accept time. Concepts
      // deleted since the draft are dropped rather than pointing nowhere.
      const draftedFrom = (
        await Promise.all(
          proposal.payload.sources.map(async (s) => {
            const cited = await db.getConcept(s.conceptId).catch(() => null);
            return cited
              ? {
                  id: s.conceptId,
                  resource: `/${cited.path}`,
                  title: s.conceptTitle,
                }
              : null;
          }),
        )
      ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      const at = new Date().toISOString();
      const concept = await persistFaqConcept({
        db,
        organizationId: session.organization.id,
        assistantId: targetAssistantId,
        collectionId,
        question: proposal.payload.draftQuestion,
        answer: proposal.payload.draftAnswer,
        // Agent-drafted, then confirmed by the person who clicked accept — the
        // one place the platform produces a `human-reviewed` trust tier (§5.3).
        provenance: {
          generated: {
            by: okfActor.agent("suggested-fix-drafter", proposal.payload.model),
            at,
          },
          verified: [{ by: okfActor.human(session.userId), at }],
          ...(draftedFrom.length > 0 ? { sources: draftedFrom } : {}),
        },
      });
      await db.updateImprovementProposal(proposal.id, {
        status: "accepted",
        acceptedConceptId: concept.id,
      });
      await db.updateImprovement(improvementId, { status: "in_review" });
      // The new FAQ lands in the target assistant's Knowledge — refresh it too
      // (orgMutation only revalidates the improvement/inbox entities).
      revalidatePath(`/assistants/${targetAssistantId}`);
    },
  );
}

/** Dismiss a Suggested Fix with a reason (#390). Knowledge is never touched. */
export async function dismissImprovementProposalAction(
  improvementId: string,
  reason: string,
): Promise<void> {
  await orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "improvement", id: improvementId }],
    },
    async ({ db }) => {
      const proposal = await db.getImprovementProposal(improvementId);
      if (!proposal || proposal.status !== "draft") return;
      await db.updateImprovementProposal(proposal.id, {
        status: "dismissed",
        dismissReason: reason.trim().slice(0, 1000),
      });
    },
  );
}

/** "Improve Answer" → Link Existing Improvement (also "Link to a different …"). */
export async function linkMessageToImprovementAction(
  messageId: string,
  improvementId: string,
): Promise<void> {
  await orgMutation(
    {
      capability: "edit",
      entities: [
        { kind: "improvementList" },
        { kind: "improvement", id: improvementId },
        { kind: "inbox" },
      ],
    },
    ({ db }) => db.linkImprovementMessage(improvementId, messageId),
  );
}

export async function unlinkImprovementMessageAction(
  improvementId: string,
  messageId: string,
): Promise<void> {
  await orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "improvement", id: improvementId }, { kind: "inbox" }],
    },
    ({ db }) => db.unlinkImprovementMessage(improvementId, messageId),
  );
}

export async function updateImprovementAction(
  id: string,
  patch: ImprovementPatch,
): Promise<void> {
  // Guard + update in updateImprovementOp (#625); the assignment/closure
  // notifications ride the notifyImprovementUpdate port.
  await runOperation(updateImprovementOp, { id, patch });
}

export async function deleteImprovementAction(id: string): Promise<void> {
  await orgMutation(
    { capability: "edit", entities: [{ kind: "improvementList" }] },
    ({ db }) => db.deleteImprovement(id),
  );
  redirect("/improvements");
}

// --- Standing goals ------------------------------------------------------------

export async function createGoalAction(
  assistantId: string,
  input: { question: string; expectations: GoalExpectations },
): Promise<void> {
  await runOperation(createAssistantGoalOp, { assistantId, ...input });
}

export async function updateGoalAction(
  assistantId: string,
  goalId: string,
  patch: {
    question?: string;
    expectations?: GoalExpectations;
    status?: GoalStatus;
  },
): Promise<void> {
  await runOperation(updateAssistantGoalOp, { assistantId, goalId, patch });
}

export async function deleteGoalAction(
  assistantId: string,
  goalId: string,
): Promise<void> {
  await runOperation(deleteAssistantGoalOp, { assistantId, goalId });
}

// --- Alerts ------------------------------------------------------------------

/** "I have resolved this": marks the alert resolved by the current member. */
export async function resolveAlertAction(alertId: string): Promise<void> {
  await runOperation(resolveAlertOp, { id: alertId });
}

// --- Entities + Records (org structured data, #663) ---------------------------

/**
 * Guard shared by every Entity mutation: RLS already walls off other orgs on
 * Supabase, but the mock store has no RLS — resolve the Entity and check the
 * Organization explicitly so both implementations behave identically.
 */
async function requireOrgEntity(
  db: Db,
  organizationId: string,
  entityId: string
): Promise<Entity> {
  const entity = await db.table("entities").get(entityId);
  if (!entity || entity.organizationId !== organizationId) {
    throw new Error("Entity not found");
  }
  return entity;
}

export async function createEntityAction(
  input: EntityInput
): Promise<{ entity?: Entity; error?: string }> {
  try {
    return { entity: await runOperation(createEntityOp, input) };
  } catch (error) {
    return { error: thrownMessage(error, "Could not create the Entity") };
  }
}

export async function updateEntityAction(
  entityId: string,
  patch: { name?: string; description?: string }
): Promise<void> {
  await runOperation(updateEntityOp, { id: entityId, patch });
}

export async function deleteEntityAction(entityId: string): Promise<void> {
  await runOperation(deleteEntityOp, { id: entityId });
}

export interface EntityImportReport {
  upserted: number;
  rejected: string[];
  error?: string;
}

/**
 * CSV import (#663): parse + validate against the Entity's schema, then
 * upsert idempotently by the key attribute. Bad rows are reported and
 * skipped; a header-level problem rejects the whole file.
 */
export async function importEntityRecordsAction(
  entityId: string,
  csvText: string
): Promise<EntityImportReport> {
  return runOperation(importEntityRecordsOp, { entityId, csv: csvText });
}

/** Records browser read (paged) — any member of the Entity's org. */
/** The client-facing sync source shape (#670): sealed headers never leave the server. */
export interface EntitySyncStatus {
  config:
    | {
        url: string;
        cadenceHours: number;
        prune: boolean;
        mapping: Record<string, string>;
        hasHeaders: boolean;
        lastSyncedAt: string | null;
      }
    | null;
  runs: EntitySyncRun[];
}

export async function getEntitySyncStatusAction(
  entityId: string
): Promise<EntitySyncStatus> {
  const { db, session } = await requireMember("member");
  await requireOrgEntity(db, session.organization.id, entityId);
  const [config, runs] = await Promise.all([
    db.getEntitySyncConfig(entityId),
    db.listEntitySyncRuns(entityId, 5),
  ]);
  return {
    config: config
      ? {
          url: config.url,
          cadenceHours: config.cadenceHours,
          prune: config.prune,
          mapping: config.mapping,
          hasHeaders: Boolean(config.sealedHeaders),
          lastSyncedAt: config.lastSyncedAt,
        }
      : null,
    runs,
  };
}

/**
 * Configure an Entity's REST/JSON sync source (#670). Auth headers are
 * sealed before storage (like other stored secrets); an empty header list
 * keeps any previously sealed headers, since the client never sees them.
 */
export async function saveEntitySyncConfigAction(
  entityId: string,
  input: {
    url: string;
    headers: Array<{ name: string; value: string }>;
    /** Explicitly drop previously sealed headers (they're otherwise kept). */
    clearHeaders?: boolean;
    cadenceHours: number;
    prune: boolean;
    mapping: Record<string, string>;
  }
): Promise<{ error?: string }> {
  return orgMutation(
    { capability: "edit", entities: [{ kind: "dataEntities" }] },
    async ({ db, session }) => {
      await requireOrgEntity(db, session.organization.id, entityId);
      let url: URL;
      try {
        url = new URL(input.url);
      } catch {
        return { error: "Enter a valid URL." };
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        return { error: "The sync source must be an http(s) URL." };
      }
      const cadenceHours = Math.max(1, Math.floor(input.cadenceHours || 24));
      const meaningful = input.headers.filter((h) => h.name.trim());
      const existing = await db.getEntitySyncConfig(entityId);
      const sealedHeaders = input.clearHeaders
        ? null
        : meaningful.length > 0
          ? sealSecret(JSON.stringify(meaningful))
          : (existing?.sealedHeaders ?? null);
      await db.upsertEntitySyncConfig(entityId, {
        url: url.toString(),
        sealedHeaders,
        cadenceHours,
        prune: input.prune,
        mapping: input.mapping,
      });
      return {};
    }
  );
}

export async function deleteEntitySyncConfigAction(entityId: string): Promise<void> {
  await orgMutation(
    { capability: "edit", entities: [{ kind: "dataEntities" }] },
    async ({ db, session }) => {
      await requireOrgEntity(db, session.organization.id, entityId);
      await db.deleteEntitySyncConfig(entityId);
    }
  );
}

/**
 * "Sync now" (#670): enqueues the same durable job the cron sweep runs.
 * Authorization happens on the caller's RLS-scoped db; the enqueue (and the
 * `after()` accelerator that drains it) runs on the service-role db, because
 * the job ledger and run reports are operated by the job layer, not by
 * member sessions — exactly as the cron sweep does.
 */
export async function syncEntityNowAction(entityId: string): Promise<void> {
  await orgMutation(
    { capability: "edit", entities: [{ kind: "dataEntities" }] },
    async ({ db, session }) => {
      const entity = await requireOrgEntity(db, session.organization.id, entityId);
      const config = await db.getEntitySyncConfig(entityId);
      if (!config) throw new Error("Configure a sync source first");
      await enqueueEntitySyncJob(
        {
          entityId,
          organizationId: entity.organizationId,
          force: true,
        },
        { db: getWidgetDb() }
      );
    }
  );
}

export async function listEntityRecordsAction(
  entityId: string,
  opts?: { limit?: number; offset?: number }
): Promise<{ records: EntityRecord[]; total: number }> {
  const result = await runOperation(listEntityRecordsOp, {
    entityId,
    limit: opts?.limit,
    offset: opts?.offset,
  });
  return { records: result.data, total: result.total };
}
