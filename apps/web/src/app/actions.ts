"use server";

import type {
  AnswerVerdict,
  AnthropicWifFederatedConfig,
  ApiEndpointSpec,
  ApiIntegrationAuthType,
  Assistant,
  AssistantPatch,
  AzureOpenAiFederatedConfig,
  Concept,
  ConceptFrontmatter,
  Conversation,
  FlowAction,
  FlowActionSettings,
  FlowInput,
  FlowPatch,
  FlowTrigger,
  GoalExpectations,
  GoalStatus,
  GoogleVertexFederatedConfig,
  Improvement,
  ImprovementAssociation,
  ImprovementListItem,
  ImprovementMessageLink,
  ImprovementPatch,
  ImprovementProposal,
  OpenAiCompatibleConfig,
  OrganizationPatch,
  ProfilePatch,
  Provider,
  RecrawlSchedule,
  Role,
  Skill,
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
  actionAllowedForTrigger,
  buildPublicationConfig,
  okfActor,
  openSecret,
  sealSecret,
  sortFlows,
  thrownMessage,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { isSupabaseConfigured, raiseImprovement } from "@agent-hub/db";

import { SSO_GATE_COOKIE, getSsoProvider, isGateValidForOrg } from "@/lib/sso";
import {
  listEscalationDesks,
  type EscalationHelpDesk,
} from "@/lib/escalation-desks";
import { improvementAssignedEmail, improvementClosedEmail } from "@/lib/notify";
import {
  backfillCollectionToGraph,
  beginWebsiteCrawl,
  embedConcept,
  enqueueDraftProposalJob,
  enqueueGraphSyncJob,
  enqueueIngestJob,
  extractSourceText,
  feedbackScore,
  forwardGraphFeedback,
  finalizeWebsiteCrawl,
  InvalidProviderKeyError,
  persistConcept,
  restartWebsiteCrawl,
  sendEmail,
  testApiRequest,
  testOpenAiCompatibleConnection,
  updateWebsiteSourceConfiguration,
  validateProviderApiKey,
  type ApiRequestTestResult,
  type OpenAiCompatibleTestResult,
} from "@agent-hub/agent";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ACTIVE_ORG_COOKIE } from "@/lib/auth";
import { type MemberContext, requireMember, requireSession } from "@/lib/authz";
import { orgMutation } from "@/lib/org-mutation";
import { FAQ_CSV_MAX_BYTES, parseFaqCsv } from "@/lib/faq-csv";
import { isPlatformOwner, setPlatformSystemPrompt } from "@/lib/platform";
import { getDb } from "@/lib/data";
import { invalidatePublication } from "@/lib/widget-db";
import { canChangeRoles, canManageMembers, canViewReasoning } from "@/lib/rbac";
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
  const { db, session } = await requireMember("manageMembers");
  const organization = await db.updateOrganization(
    session.organization.id,
    patch,
  );
  revalidatePath("/", "layout");
  return organization;
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
 * Which Provider Connection embeds this Organization's knowledge (#437).
 * `null` returns to the runtime's automatic provider order. Changing it does
 * not re-embed anything already stored — see the card's own warning.
 */
export async function updateEmbeddingConnectionAction(
  connectionId: string | null,
): Promise<void> {
  await orgMutation(
    { capability: "manageMembers", entities: [{ kind: "aiSettings" }] },
    ({ db, session }) =>
      db.setEmbeddingConnectionId(session.organization.id, connectionId),
  );
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
async function assertMayManageMemberTier(
  ctx: MemberContext,
  userId: string,
  targetRole?: Role,
) {
  const { db, session } = ctx;
  if (canChangeRoles(session.role)) return;
  if (targetRole === "owner")
    throw new Error("Only owners can grant ownership");
  const members = await db.listMembers(session.organization.id);
  const target = members.find((m) => m.userId === userId);
  if (target?.role === "owner")
    throw new Error("Only owners can change an owner");
}

export async function updateMemberRoleAction(userId: string, role: Role) {
  await orgMutation(
    { capability: "manageMembers", entities: [{ kind: "members" }] },
    async (ctx) => {
      await assertMayManageMemberTier(ctx, userId, role);
      await ctx.db.updateMemberRole(ctx.session.organization.id, userId, role);
    },
  );
}

export async function removeMemberAction(userId: string) {
  // Admins remove anyone below the owner tier; any Member may remove
  // themselves (leave org).
  const ctx = await requireMember();
  const { db, session } = ctx;
  if (userId !== session.userId) {
    if (!canManageMembers(session.role)) throw new Error("Not allowed");
    await assertMayManageMemberTier(ctx, userId);
  }
  await db.removeMember(session.organization.id, userId);
  revalidatePath("/settings/members");
}

export async function createInviteAction(role: Role, email?: string) {
  return orgMutation(
    { capability: "manageMembers", entities: [{ kind: "members" }] },
    ({ db, session }) => db.createInvite(session.organization.id, role, email),
  );
}

export async function revokeInviteAction(inviteId: string) {
  await orgMutation(
    { capability: "manageMembers", entities: [{ kind: "members" }] },
    ({ db }) => db.revokeInvite(inviteId),
  );
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
  const assistant = await orgMutation(
    { capability: "edit", entities: [{ kind: "assistantList" }] },
    ({ db, session }) => db.createAssistant(session.organization.id, input),
  );
  redirect(`/assistants/${assistant.id}`);
}

export async function updateAssistantAction(id: string, patch: AssistantPatch) {
  await orgMutation(
    { capability: "edit", entities: [{ kind: "assistant", id }] },
    ({ db }) => db.updateAssistant(id, patch),
  );
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
  await orgMutation(
    { capability: "publish", entities: [{ kind: "assistantList" }] },
    async ({ db }) => {
      // Deleting an Assistant cascade-deletes its Collections and Concepts (FK
      // on delete cascade), which would leave each Collection's per-collection
      // graph dataset orphaned on the worker (ADR-0017). Capture the Collections
      // first and enqueue one whole-dataset purge each — a per-Concept remove
      // fan-out would be unbounded for a large collection. Inert without a graph
      // worker (enqueueGraphSyncJob no-ops).
      const collections = await db.listCollections(id);
      await db.deleteAssistant(id);
      for (const collection of collections) {
        await enqueueGraphSyncJob(
          { op: "purge", collectionId: collection.id },
          { db },
        );
      }
    },
  );
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
 * conversations stay with the original.
 */
export async function duplicateAssistantAction(id: string): Promise<Assistant> {
  const { db, session } = await requireMember("edit");
  const source = await db.getAssistant(id);
  if (!source || source.organizationId !== session.organization.id)
    throw new Error("Assistant not found");

  const copy = await db.createAssistant(session.organization.id, {
    title: `${source.title} (copy)`,
    nickname: source.nickname,
    description: source.description,
  });
  await db.updateAssistant(copy.id, {
    avatarUrl: source.avatarUrl,
    welcomeMessage: source.welcomeMessage,
    aiDisclaimer: source.aiDisclaimer,
    suggestedQuestions: source.suggestedQuestions,
    quickReplies: source.quickReplies,
    answeringStyle: source.answeringStyle,
    chatLauncherEnabled: source.chatLauncherEnabled,
    modelProvider: source.modelProvider,
    modelId: source.modelId,
    style: source.style,
    allowedDomains: source.allowedDomains,
    helpDeskSettings: source.helpDeskSettings,
    tools: source.tools,
  });
  // Skills are org-level, so the copy can share the source's attachments.
  const attachedSkills = await db.listAssistantSkills(source.id);
  if (attachedSkills.length > 0) {
    await db.setAssistantSkills(
      copy.id,
      attachedSkills.map((s) => s.id),
    );
  }

  // createAssistant seeds the built-in flow set; overwrite the seeds with the
  // source's versions (matched by name) and recreate any custom flows.
  const [sourceFlows, copyFlows] = await Promise.all([
    db.listFlows(source.id).then(sortFlows),
    db.listFlows(copy.id).then(sortFlows),
  ]);
  const consumed = new Set<string>();
  const orderedCopyIds: string[] = [];
  for (const flow of sourceFlows) {
    const patch: FlowPatch = {
      name: flow.name,
      description: flow.description,
      enabled: flow.enabled,
      trigger: flow.trigger,
      triggerSettings: flow.triggerSettings,
      conditionLogic: flow.conditionLogic,
      conditions: flow.conditions,
      actions: flow.actions,
      actionSettings: flow.actionSettings,
      customMessage: flow.customMessage,
    };
    const seed = copyFlows.find(
      (f) =>
        !consumed.has(f.id) &&
        f.name === flow.name &&
        f.builtIn === flow.builtIn &&
        f.isDefault === flow.isDefault,
    );
    if (seed) {
      consumed.add(seed.id);
      await db.updateFlow(seed.id, patch);
      if (!flow.isDefault) orderedCopyIds.push(seed.id);
    } else {
      const created = await db.createFlow(copy.id, {
        name: flow.name,
        description: flow.description,
        trigger: flow.trigger,
        triggerSettings: flow.triggerSettings,
        conditionLogic: flow.conditionLogic,
        conditions: flow.conditions,
        actions: flow.actions,
        actionSettings: flow.actionSettings,
        customMessage: flow.customMessage,
      });
      if (!flow.enabled) await db.updateFlow(created.id, { enabled: false });
      orderedCopyIds.push(created.id);
    }
  }
  // Seeded flows the source no longer has (e.g. a deleted built-in).
  for (const leftover of copyFlows) {
    if (!consumed.has(leftover.id) && !leftover.isDefault) {
      await db.deleteFlow(leftover.id);
    }
  }
  await db.reorderFlows(copy.id, orderedCopyIds);

  revalidatePath("/");
  return copy;
}

// --- Flows ------------------------------------------------------------------------

/**
 * The trigger/action pairing rule (#541), enforced where it can't be bypassed.
 *
 * The Flow Builder already only offers the actions a trigger allows, but the
 * editor is UI: a stale client or a direct call must not be able to store a
 * proactive flow that runs generative actions, or a message flow that answers with
 * an unprompted notification.
 */
function assertTriggerActions(
  trigger: FlowTrigger,
  actions: FlowAction[] | undefined,
) {
  const invalid = (actions ?? []).find(
    (action) => !actionAllowedForTrigger(action, trigger),
  );
  if (invalid) {
    throw new Error(
      `The "${invalid}" action cannot run on the "${trigger}" trigger.`,
    );
  }
}

export async function createFlowAction(assistantId: string, input: FlowInput) {
  assertTriggerActions(input.trigger ?? "message", input.actions);
  await orgMutation(
    { capability: "edit", entities: [{ kind: "flows", assistantId }] },
    ({ db }) => db.createFlow(assistantId, input),
  );
}

export async function updateFlowAction(
  assistantId: string,
  flowId: string,
  patch: FlowPatch,
) {
  await orgMutation(
    { capability: "edit", entities: [{ kind: "flows", assistantId }] },
    async ({ db }) => {
      // A patch may move the trigger, the actions, or only one of the two — the
      // rule applies to the pair that will be stored, so the stored flow supplies
      // whichever half the patch leaves alone.
      if (patch.trigger !== undefined || patch.actions !== undefined) {
        const stored = (await db.listFlows(assistantId)).find(
          (flow) => flow.id === flowId,
        );
        assertTriggerActions(
          patch.trigger ?? stored?.trigger ?? "message",
          patch.actions ?? stored?.actions,
        );
      }
      return db.updateFlow(flowId, patch);
    },
  );
}

export async function deleteFlowAction(assistantId: string, flowId: string) {
  await orgMutation(
    { capability: "edit", entities: [{ kind: "flows", assistantId }] },
    ({ db }) => db.deleteFlow(flowId),
  );
}

export async function reorderFlowsAction(
  assistantId: string,
  orderedIds: string[],
) {
  await orgMutation(
    { capability: "edit", entities: [{ kind: "flows", assistantId }] },
    ({ db }) => db.reorderFlows(assistantId, orderedIds),
  );
}

// --- Help desks ---------------------------------------------------------------------

export async function createHelpDeskAction(input: {
  name: string;
  description?: string;
}) {
  return orgMutation(
    { capability: "edit", entities: [{ kind: "helpDeskList" }] },
    ({ db, session }) => db.createHelpDesk(session.organization.id, input),
  );
}

export async function updateHelpDeskAction(
  id: string,
  patch: {
    name?: string;
    description?: string;
    autoGenerateImprovements?: boolean;
  },
) {
  await orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "helpDeskList" }, { kind: "helpDesk", id }],
    },
    ({ db }) => db.updateHelpDesk(id, patch),
  );
}

export async function deleteHelpDeskAction(id: string) {
  await orgMutation(
    { capability: "edit", entities: [{ kind: "helpDeskList" }] },
    ({ db }) => db.deleteHelpDesk(id),
  );
}

export async function createSupportChannelAction(
  helpDeskId: string,
  input: SupportChannelInput,
) {
  return orgMutation(
    { capability: "edit", entities: [{ kind: "helpDesk", id: helpDeskId }] },
    ({ db }) => db.createSupportChannel(helpDeskId, input),
  );
}

export async function updateSupportChannelAction(
  helpDeskId: string,
  channelId: string,
  patch: SupportChannelPatch,
) {
  return orgMutation(
    { capability: "edit", entities: [{ kind: "helpDesk", id: helpDeskId }] },
    ({ db }) => db.updateSupportChannel(channelId, patch),
  );
}

export async function deleteSupportChannelAction(
  helpDeskId: string,
  channelId: string,
) {
  await orgMutation(
    { capability: "edit", entities: [{ kind: "helpDesk", id: helpDeskId }] },
    ({ db }) => db.deleteSupportChannel(channelId),
  );
}

export async function reorderSupportChannelsAction(
  helpDeskId: string,
  orderedIds: string[],
) {
  await orgMutation(
    { capability: "edit", entities: [{ kind: "helpDesk", id: helpDeskId }] },
    ({ db }) => db.reorderSupportChannels(helpDeskId, orderedIds),
  );
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
  await orgMutation(
    { capability: "edit", entities: [{ kind: "helpDesk", id: helpDeskId }] },
    ({ db }) =>
      db.setTicketingIntegration(helpDeskId, {
        platform: "servicenow",
        name: input.name.trim(),
        config: {
          baseUrl: input.baseUrl.trim(),
          clientId: input.clientId.trim(),
          clientSecret: sealSecret(input.clientSecret),
          username: input.username.trim(),
          password: sealSecret(input.password),
        },
      }),
  );
}

export async function disconnectTicketingIntegrationAction(helpDeskId: string) {
  await orgMutation(
    { capability: "edit", entities: [{ kind: "helpDesk", id: helpDeskId }] },
    ({ db }) => db.clearTicketingIntegration(helpDeskId),
  );
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
  },
): Promise<{ error?: string }> {
  return orgMutation(
    {
      capability: "manageMembers",
      entities: [{ kind: "assistant", id: assistantId }],
      revalidateIf: (r: { error?: string }) => !r.error,
    },
    async ({ db, session }) => {
      if (input.provider !== "entra") {
        return { error: "This provider isn't available yet." };
      }
      const clientId = input.clientId.trim();
      const tenantId = input.tenantId.trim();
      const clientSecret = input.clientSecret.trim();
      if (!clientId || !tenantId || !clientSecret) {
        return {
          error: "Client ID, Tenant ID and Client secret are all required.",
        };
      }
      await db.setSsoConnection(session.organization.id, {
        provider: input.provider,
        config: { clientId, tenantId },
        encryptedSecret: sealSecret(clientSecret),
      });
      return {};
    },
  );
}

export async function validateSsoConnectionAction(
  assistantId: string,
): Promise<{ ok: boolean; error?: string }> {
  return orgMutation(
    {
      capability: "manageMembers",
      entities: [{ kind: "assistant", id: assistantId }],
    },
    async ({ db, session }) => {
      const connection = await db.getSsoConnection(session.organization.id);
      if (!connection)
        return { ok: false, error: "No connection to validate." };
      const provider = getSsoProvider(connection.provider);
      if (!provider?.validate) {
        return { ok: false, error: "This provider can't be validated." };
      }
      const result = await provider.validate({
        config: connection.config,
        clientSecret: connection.encryptedSecret
          ? openSecret(connection.encryptedSecret)
          : null,
      });
      await db.setSsoConnectionValidation(
        session.organization.id,
        result.ok ? "valid" : "invalid",
      );
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },
  );
}

export async function disconnectSsoConnectionAction(assistantId: string) {
  await orgMutation(
    {
      capability: "manageMembers",
      entities: [{ kind: "assistant", id: assistantId }],
    },
    ({ db, session }) => db.clearSsoConnection(session.organization.id),
  );
}

export async function setAssistantRequireSignInAction(
  assistantId: string,
  requireSignIn: boolean,
) {
  await orgMutation(
    { capability: "edit", entities: [{ kind: "assistant", id: assistantId }] },
    ({ db }) => db.updateAssistant(assistantId, { requireSignIn }),
  );
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
  return orgMutation(
    {
      capability: "edit",
      entities: attachToAssistantId
        ? [{ kind: "assistantEditor", assistantId: attachToAssistantId }]
        : [],
    },
    async ({ db, session }) => {
      const skill = await db.createSkill(session.organization.id, {
        name: input.name.trim(),
        description: input.description?.trim(),
        prompt: input.prompt,
      });
      if (attachToAssistantId) {
        const attached = await db.listAssistantSkills(attachToAssistantId);
        await db.setAssistantSkills(attachToAssistantId, [
          ...attached.map((s) => s.id),
          skill.id,
        ]);
      }
      return skill;
    },
  );
}

export async function updateSkillAction(
  assistantId: string,
  skillId: string,
  patch: SkillPatch,
) {
  await orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "assistantEditor", assistantId }],
    },
    ({ db }) => db.updateSkill(skillId, patch),
  );
}

export async function deleteSkillAction(assistantId: string, skillId: string) {
  await orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "assistantEditor", assistantId }],
    },
    ({ db }) => db.deleteSkill(skillId),
  );
}

/** Replaces which org Skills this assistant runs with (ordered). */
export async function setAssistantSkillsAction(
  assistantId: string,
  skillIds: string[],
) {
  await orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "assistantEditor", assistantId }],
    },
    ({ db }) => db.setAssistantSkills(assistantId, skillIds),
  );
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
  const { db } = await requireMember();
  const integration = await db.getApiIntegration(assistantId);
  if (!integration) return null;
  return {
    name: integration.name,
    baseUrl: integration.baseUrl,
    authType: integration.authType,
    authHeaderName: integration.authHeaderName,
    authUsername: integration.authUsername,
    hasCredential: integration.encryptedCredential !== null,
    endpoints: integration.endpoints,
  };
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
  return orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "assistantEditor", assistantId }],
      revalidateIf: (result) => !result.error,
    },
    async ({ db, session }) => {
      // An https base URL is the boundary every catalogued path resolves inside,
      // so it is validated before anything is stored rather than at query time.
      let base: URL;
      try {
        base = new URL(input.baseUrl.trim());
      } catch {
        return {
          error: "Enter a valid base URL, e.g. https://api.example.com",
        };
      }
      if (base.protocol !== "https:") {
        return { error: "The base URL must use https." };
      }
      const endpoints = input.endpoints.filter((e) => e.path.trim());
      if (endpoints.length === 0) {
        return { error: "Describe at least one endpoint." };
      }
      await db.setApiIntegration({
        assistantId,
        organizationId: session.organization.id,
        name: input.name.trim() || base.hostname,
        baseUrl: base.toString().replace(/\/$/, ""),
        authType: input.authType,
        authHeaderName: input.authHeaderName?.trim() ?? "",
        authUsername: input.authUsername?.trim() ?? "",
        ...(input.credential === undefined
          ? {}
          : {
              encryptedCredential: input.credential
                ? sealSecret(input.credential)
                : null,
            }),
        endpoints,
      });
      return {};
    },
  );
}

export async function deleteApiIntegrationAction(assistantId: string) {
  await orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "assistantEditor", assistantId }],
    },
    ({ db }) => db.deleteApiIntegration(assistantId),
  );
}

// --- Publish (snapshot semantics, CONTEXT.md: Publication) ------------------------------

export async function publishAssistantAction(assistantId: string) {
  return orgMutation(
    {
      capability: "publish",
      entities: [{ kind: "assistantEditor", assistantId }],
    },
    async ({ db }) => {
      const [assistant, flows, collections, skills] = await Promise.all([
        db.getAssistant(assistantId),
        db.listFlows(assistantId),
        db.listCollections(assistantId),
        db.listAssistantSkills(assistantId),
      ]);
      if (!assistant) throw new Error("Assistant not found");
      const publication = await db.createPublication(
        assistantId,
        buildPublicationConfig(assistant, flows, collections, skills),
      );
      invalidatePublication(assistantId);
      return publication.version;
    },
  );
}

export async function unpublishAssistantAction(assistantId: string) {
  await orgMutation(
    {
      capability: "publish",
      entities: [{ kind: "assistantEditor", assistantId }],
    },
    async ({ db }) => {
      const assistant = await db.getAssistant(assistantId);
      if (!assistant) throw new Error("Assistant not found");
      await db.deletePublications(assistantId);
      invalidatePublication(assistantId);
    },
  );
}

export async function republishAction(
  assistantId: string,
  publicationId: string,
) {
  return orgMutation(
    {
      capability: "publish",
      entities: [{ kind: "assistantEditor", assistantId }],
    },
    async ({ db }) => {
      const old = await db.getPublication(publicationId);
      if (!old || old.assistantId !== assistantId)
        throw new Error("Publication not found");
      const publication = await db.createPublication(assistantId, old.config);
      invalidatePublication(assistantId);
      return publication.version;
    },
  );
}

// --- Provider connections ------------------------------------------------------------

/** Non-secret suffix shown in the UI so keys can be told apart. */
function keyHintOf(secret: string): string {
  return secret.length >= 4 ? `…${secret.slice(-4)}` : "";
}

const KNOWN_PROVIDERS: Provider[] = ["anthropic", "openai", "google"];

/**
 * BYOK: seals and stores an org API key (admins). Returns an error message
 * instead of throwing for expected failures, so the client can toast it.
 */
export async function createProviderConnectionAction(
  provider: Provider,
  apiKey: string,
  displayName?: string,
): Promise<{ error?: string }> {
  return orgMutation(
    {
      capability: "manageMembers",
      entities: [{ kind: "aiSettings" }],
      revalidateIf: (r: { error?: string }) => !r.error,
    },
    async ({ db, session }) => {
      // `provider` crosses a server-action boundary — validate before it ever
      // reaches the key probe or a DB write, rather than trusting the type.
      if (!KNOWN_PROVIDERS.includes(provider))
        return { error: "Unknown provider" };
      const trimmed = apiKey.trim();
      if (!trimmed) return { error: "API key is required" };
      try {
        await validateProviderApiKey(provider, trimmed);
      } catch (error) {
        if (error instanceof InvalidProviderKeyError)
          return { error: error.message };
        throw error;
      }
      await db.createProviderConnection(session.organization.id, {
        type: "api_key",
        provider,
        displayName: displayName?.trim() ?? "",
        encryptedKey: sealSecret(trimmed),
        keyHint: keyHintOf(trimmed),
        createdBy: session.userId,
      });
      return {};
    },
  );
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
  return orgMutation(
    {
      capability: "manageMembers",
      entities: [{ kind: "aiSettings" }],
      revalidateIf: (r: { error?: string }) => !r.error,
    },
    async ({ db, session }) => {
      const projectId = input.projectId.trim();
      const location = input.location.trim();
      const workloadIdentityAudience = input.workloadIdentityAudience.trim();
      const serviceAccountEmail = input.serviceAccountEmail?.trim() ?? "";
      if (!projectId) return { error: "Google Cloud project ID is required" };
      if (!location) return { error: "Vertex location is required" };
      if (!workloadIdentityAudience) {
        return { error: "Workload Identity Federation audience is required" };
      }
      const config: GoogleVertexFederatedConfig = {
        kind: "google_vertex",
        projectId,
        location,
        workloadIdentityAudience,
        ...(serviceAccountEmail ? { serviceAccountEmail } : {}),
      };
      await db.createProviderConnection(session.organization.id, {
        type: "federated",
        provider: "google",
        displayName:
          input.displayName?.trim() ||
          `Google Vertex (${projectId}/${location})`,
        encryptedKey: null,
        keyHint: "",
        createdBy: session.userId,
        config,
      });
      return {};
    },
  );
}

export async function createAnthropicWifFederatedConnectionAction(input: {
  displayName?: string;
  workloadIdentityAudience: string;
  organizationId?: string;
  workspaceId?: string;
}): Promise<{ error?: string }> {
  return orgMutation(
    {
      capability: "manageMembers",
      entities: [{ kind: "aiSettings" }],
      revalidateIf: (r: { error?: string }) => !r.error,
    },
    async ({ db, session }) => {
      const workloadIdentityAudience = input.workloadIdentityAudience.trim();
      const organizationId = input.organizationId?.trim() ?? "";
      const workspaceId = input.workspaceId?.trim() ?? "";
      if (!workloadIdentityAudience) {
        return { error: "Workload Identity Federation audience is required" };
      }
      const config: AnthropicWifFederatedConfig = {
        kind: "anthropic_wif",
        workloadIdentityAudience,
        ...(organizationId ? { organizationId } : {}),
        ...(workspaceId ? { workspaceId } : {}),
      };
      await db.createProviderConnection(session.organization.id, {
        type: "federated",
        provider: "anthropic",
        displayName: input.displayName?.trim() || "Anthropic WIF",
        encryptedKey: null,
        keyHint: "",
        createdBy: session.userId,
        config,
      });
      return {};
    },
  );
}

export async function createAzureOpenAiFederatedConnectionAction(input: {
  displayName?: string;
  tenantId: string;
  endpoint: string;
  deployment: string;
  clientId?: string;
  audience?: string;
}): Promise<{ error?: string }> {
  return orgMutation(
    {
      capability: "manageMembers",
      entities: [{ kind: "aiSettings" }],
      revalidateIf: (r: { error?: string }) => !r.error,
    },
    async ({ db, session }) => {
      const tenantId = input.tenantId.trim();
      const endpoint = input.endpoint.trim();
      const deployment = input.deployment.trim();
      const clientId = input.clientId?.trim() ?? "";
      const audience = input.audience?.trim() ?? "";
      if (!tenantId) return { error: "Azure tenant ID is required" };
      if (!endpoint) return { error: "Azure OpenAI endpoint is required" };
      if (!deployment) return { error: "Azure OpenAI deployment is required" };
      const config: AzureOpenAiFederatedConfig = {
        kind: "azure_openai",
        tenantId,
        endpoint,
        deployment,
        ...(clientId ? { clientId } : {}),
        ...(audience ? { audience } : {}),
      };
      await db.createProviderConnection(session.organization.id, {
        type: "federated",
        provider: "azure_openai",
        displayName:
          input.displayName?.trim() || `Azure OpenAI (${deployment})`,
        encryptedKey: null,
        keyHint: "",
        createdBy: session.userId,
        config,
      });
      return {};
    },
  );
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
  return orgMutation(
    {
      capability: "manageMembers",
      entities: [{ kind: "aiSettings" }],
      revalidateIf: (r: { error?: string }) => !r.error,
    },
    async ({ db, session }) => {
      const baseUrl = input.baseUrl.trim();
      const chatModel = input.chatModel.trim();
      const embeddingModel = input.embeddingModel?.trim() ?? "";
      const apiKey = input.apiKey?.trim() ?? "";
      const embeddingDims = input.embeddingDims;
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(baseUrl);
      } catch {
        return { error: "Base URL must be a valid http(s) URL" };
      }
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return { error: "Base URL must be a valid http(s) URL" };
      }
      if (!chatModel) return { error: "Chat model is required" };
      if (
        embeddingDims !== undefined &&
        (!Number.isInteger(embeddingDims) || embeddingDims <= 0)
      ) {
        return { error: "Embedding dimensions must be a positive integer" };
      }
      const config: OpenAiCompatibleConfig = {
        kind: "openai_compatible",
        baseUrl,
        chatModel,
        ...(embeddingModel ? { embeddingModel } : {}),
        ...(embeddingDims !== undefined ? { embeddingDims } : {}),
      };
      await db.createProviderConnection(session.organization.id, {
        type: "api_key",
        provider: "openai_compatible",
        displayName: input.displayName?.trim() || "OpenAI-compatible",
        encryptedKey: apiKey ? sealSecret(apiKey) : null,
        keyHint: apiKey ? keyHintOf(apiKey) : "",
        createdBy: session.userId,
        config,
      });
      return {};
    },
  );
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
  await orgMutation(
    { capability: "manageMembers", entities: [{ kind: "aiSettings" }] },
    async ({ db, session }) => {
      // Resolve within the caller's org so a foreign id can't be deleted, and
      // keep all org-owned Provider Connections admin-managed.
      const connections = await db.listProviderConnections(
        session.organization.id,
      );
      const connection = connections.find((c) => c.id === id);
      if (!connection) throw new Error("Connection not found");
      await db.deleteProviderConnection(id);
    },
  );
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
  const { db } = await requireMember("edit");
  const [assistant, collection] = await Promise.all([
    db.getAssistant(assistantId),
    db.getCollection(collectionId),
  ]);
  if (!assistant || !collection) throw new Error("Not found");

  let originalObjectPath: string | null = null;
  if (original && isSupabaseConfigured() && isSupabaseServiceConfigured()) {
    const stored = await uploadKnowledgeOriginal(
      createSupabaseServiceClient(),
      {
        organizationId: assistant.organizationId,
        file: original,
      },
    );
    originalObjectPath = stored.path;
  }

  const source = await db.createSource({
    collectionId,
    name,
    kind,
    originalObjectPath,
    ...(sourceUrl ? { config: { url: sourceUrl } } : {}),
  });
  await enqueueIngestJob(
    {
      kind: "ingest_source",
      assistantId,
      collectionId,
      sourceId: source.id,
      rawText,
    },
    { db },
  );
  revalidatePath(`/assistants/${assistantId}`);
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
  await orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "assistantEditor", assistantId }, { kind: "alerts" }],
    },
    ({ db }) => restartWebsiteCrawl({ db, sourceId }),
  );
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

// FAQs mode: each FAQ is an OKF concept of type "FAQ".
/**
 * Persists a Q&A as an OKF FAQ Concept through the single knowledge write path
 * (re-embeds; #387 fan-out re-ingests to the graph). Shared by the manual "Add
 * FAQ" and the accepted Suggested Fix so the slug/frontmatter shape lives once.
 */
async function persistFaqConcept(args: {
  db: Db;
  assistantId: string;
  collectionId: string;
  question: string;
  answer: string;
  connections: Awaited<ReturnType<Db["listProviderConnections"]>>;
  /**
   * OKF v0.2 trust + provenance for the Concept this writes (§5.1/§5.2) — who
   * authored it, who confirmed it, what it derives from. Required rather than
   * defaulted: the two callers differ exactly here (a person typing a FAQ is
   * `human:` generated; an accepted Suggested Fix is agent-generated and
   * human-*verified*), and silently defaulting would misattribute one of them.
   */
  provenance: Pick<ConceptFrontmatter, "generated" | "verified" | "sources">;
}): Promise<Concept> {
  const question = args.question.trim();
  const slug =
    question
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "faq";
  return persistConcept({
    db: args.db,
    assistantId: args.assistantId,
    collectionId: args.collectionId,
    sourceId: null,
    path: `faq/${slug}.md`,
    frontmatter: {
      type: "FAQ",
      title: question,
      description: args.answer.slice(0, 140),
      ...args.provenance,
    },
    body: args.answer,
    connections: args.connections,
  });
}

export async function createFaqAction(
  assistantId: string,
  collectionId: string,
  question: string,
  answer: string,
) {
  const { db, session } = await requireMember("edit");
  const connections = await db.listProviderConnections(session.organization.id);
  await persistFaqConcept({
    db,
    assistantId,
    collectionId,
    question,
    answer,
    connections,
    // Typed by a person in the FAQ editor: hand-authored, and the act of
    // writing it is not a verification event (§5.2 keeps those distinct).
    provenance: {
      generated: {
        by: okfActor.human(session.userId),
        at: new Date().toISOString(),
      },
    },
  });
  revalidatePath(`/assistants/${assistantId}`);
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
  const { db, session } = await requireMember("edit");
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

  const connections = await db.listProviderConnections(session.organization.id);
  const stamp = new Date().toISOString();
  for (const [index, row] of rows.entries()) {
    const slug =
      row.question
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "faq";
    await persistConcept({
      db,
      assistantId,
      collectionId,
      sourceId: null,
      path: `faq/${slug}-${index}.md`,
      frontmatter: {
        type: "FAQ",
        title: row.question,
        description: row.answer.slice(0, 140),
        // Hand-authored content the member supplied in bulk — the person, not
        // the importer, is the author; the CSV is what it derives from (§5.1).
        generated: { by: okfActor.human(session.userId), at: stamp },
        sources: [
          {
            id: "faq-csv",
            resource: `upload "${file.name}"`,
            title: file.name,
          },
        ],
      },
      body: row.answer,
      connections,
    });
  }

  revalidatePath(`/assistants/${assistantId}`);
  return { imported: rows.length, skipped };
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
  await orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "assistantEditor", assistantId }],
    },
    async ({ db }) => {
      // Deleting a Source cascade-deletes its Concepts (FK on delete cascade),
      // so capture their ids first and retire their graph documents too — the
      // Collection survives, so orphaned docs would otherwise pollute its live
      // retrieval (ADR-0017). Inert without a graph worker.
      const source = await db.getSource(sourceId);
      const conceptIds = source
        ? (await db.listConcepts(source.collectionId))
            .filter((c) => c.sourceId === sourceId)
            .map((c) => c.id)
        : [];
      await db.deleteSource(sourceId);
      if (source) {
        for (const conceptId of conceptIds) {
          await enqueueGraphSyncJob(
            { op: "remove", collectionId: source.collectionId, conceptId },
            { db },
          );
        }
      }
    },
  );
}

export async function deleteConceptAction(
  assistantId: string,
  conceptId: string,
) {
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
  const { db } = await requireMember();
  await db.deleteConversation(conversationId);
}

export async function setConversationPinnedAction(
  conversationId: string,
  pinned: boolean,
) {
  const { db } = await requireMember();
  await db.setConversationPinned(conversationId, pinned);
}

export async function sendConversationFeedbackAction(
  conversationId: string,
  text: string,
) {
  const { db } = await requireMember();
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty feedback");
  await db.updateConversationMetadata(conversationId, {
    feedbackText: trimmed.slice(0, 2000),
    feedbackAt: new Date().toISOString(),
  });
}

export async function setMessageFeedbackAction(
  messageId: string,
  feedback: -1 | 0 | 1,
) {
  const { db } = await requireMember();
  await db.setMessageFeedback(messageId, feedback);
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
      const connections = await db.listProviderConnections(
        session.organization.id,
      );
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
        assistantId: targetAssistantId,
        collectionId,
        question: proposal.payload.draftQuestion,
        answer: proposal.payload.draftAnswer,
        connections,
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
  await orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "improvementList" }, { kind: "improvement", id }],
    },
    async ({ db, session }) => {
      const before = await db.getImprovement(id);
      const updated = await db.updateImprovement(id, patch);

      // Fire the assignment / closure notifications (see notify.ts — logs for now).
      if (before) {
        const key = `IMP-${updated.seq}`;
        const members = await db.listMembers(session.organization.id);
        const emailOf = (userId: string | null) =>
          userId
            ? (members.find((m) => m.userId === userId)?.email ?? null)
            : null;

        if (
          patch.assigneeId !== undefined &&
          patch.assigneeId !== before.assigneeId &&
          updated.assigneeId
        ) {
          const to = emailOf(updated.assigneeId);
          if (to)
            await sendEmail(
              improvementAssignedEmail({
                to,
                key,
                title: updated.title,
                actorEmail: session.email,
              }),
            );
        }

        if (patch.status === "done" && before.status !== "done") {
          const to = emailOf(updated.createdBy);
          if (to)
            await sendEmail(
              improvementClosedEmail({
                to,
                key,
                title: updated.title,
                actorEmail: session.email,
              }),
            );
        }
      }
    },
  );
}

export async function deleteImprovementAction(id: string): Promise<void> {
  await orgMutation(
    { capability: "edit", entities: [{ kind: "improvementList" }] },
    ({ db }) => db.deleteImprovement(id),
  );
  redirect("/improvements");
}

// --- Standing goals ------------------------------------------------------------

function sanitizeExpectations(input: GoalExpectations): GoalExpectations {
  const expectations: GoalExpectations = {};
  if (input.mustCiteSources) expectations.mustCiteSources = true;
  const url = input.expectedSourceUrl?.trim();
  if (url) expectations.expectedSourceUrl = url;
  const fragments = (input.mustContain ?? [])
    .map((f) => f.trim())
    .filter(Boolean);
  if (fragments.length > 0) expectations.mustContain = fragments;
  return expectations;
}

export async function createGoalAction(
  assistantId: string,
  input: { question: string; expectations: GoalExpectations },
): Promise<void> {
  await orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "assistantEditor", assistantId }],
    },
    ({ db }) => {
      const question = input.question.trim();
      if (!question) throw new Error("The goal question is required.");
      return db.createAssistantGoal(assistantId, {
        question,
        expectations: sanitizeExpectations(input.expectations),
      });
    },
  );
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
  await orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "assistantEditor", assistantId }],
    },
    ({ db }) =>
      db.updateAssistantGoal(goalId, {
        question: patch.question?.trim() || undefined,
        expectations: patch.expectations
          ? sanitizeExpectations(patch.expectations)
          : undefined,
        status: patch.status,
      }),
  );
}

export async function deleteGoalAction(
  assistantId: string,
  goalId: string,
): Promise<void> {
  await orgMutation(
    {
      capability: "edit",
      entities: [{ kind: "assistantEditor", assistantId }],
    },
    ({ db }) => db.deleteAssistantGoal(goalId),
  );
}

// --- Alerts ------------------------------------------------------------------

/** "I have resolved this": marks the alert resolved by the current member. */
export async function resolveAlertAction(alertId: string): Promise<void> {
  await orgMutation(
    { capability: "edit", entities: [{ kind: "alerts" }] },
    ({ db, session }) => db.resolveAlert(alertId, session.userId),
  );
}
