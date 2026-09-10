import type { Db } from "./types";

/**
 * The org-pinning wrapper for API-key requests (#619, grown per-domain from
 * #620 on).
 *
 * A key-authenticated request has no Supabase session, so it runs on a
 * service-role client and RLS cannot be the tenancy boundary the way it is
 * for signed-in Members. This wrapper takes RLS's place, and it, not the
 * call sites, owns the scoping:
 *
 * - **Fail-closed**: only methods explicitly listed here are callable;
 *   everything else throws `OrgPinnedDbError`. A new /api/v1 route earns its
 *   Db surface by extending these lists in the same PR, and the contract
 *   suite pins the wrapper's behavior over both adapters.
 * - **Pinned or resolved, never trusted**: org-scoped methods get the
 *   caller's organizationId argument *replaced*; id-addressed methods are
 *   resolved to their owning row first and refused (`cross_org`) when it
 *   belongs to another Organization. A route can therefore never leak or
 *   mutate another tenant's rows by forwarding unvalidated input.
 *
 * Id-addressed methods come in exactly two behaviors, each a resolver-keyed
 * table below:
 * - `GUARDED_METHODS` ("resolve owner → throw"): the id is resolved to its
 *   owning Organization and a foreign or missing row throws `cross_org`.
 * - `NULL_READ_METHODS` ("post-check read → null"): single-row reads where a
 *   foreign row reads as absent, not as an error, the API surface must not
 *   disclose that the id exists elsewhere.
 */

/** Methods whose first parameter is an organizationId, pinned on call. */
const ORG_SCOPED_METHODS = new Set<keyof Db>([
  "listApplicationConnections",
  // Filing an Improvement from an unattended triage run (#772).
  "createImprovement",
  "listAssistants",
  "listAssistantsPage",
  "listAssistantShellSummaries",
  "createAssistant",
  "getInboxPage",
  "getInboxFacets",
  "listImprovements",
  "listImprovementsPage",
  "getMemoryEnabled",
  "setMemoryEnabled",
  "listMemorySubjects",
  "listMemorySubjectsPage",
  "listEntitiesPage",
  "getSsoConnection",
  "setSsoConnection",
  "setSsoConnectionValidation",
  "listHelpDesks",
  "createHelpDesk",
  "listAlerts",
  "listMembers",
  "updateMemberRole",
  "removeMember",
  "listInvites",
  "createInvite",
  "updateOrganization",
  "listApiKeys",
  "createApiKey",
  "listOrgKnowledgeSources",
  "listOrgKnowledgeSourceOptions",
  "listOrgFaqs",
  "getOrCreateOrgLibraryCollection",
  "clearSsoConnection",
  "listProviderConnections",
  "createProviderConnection",
  "getEmbeddingConnectionId",
  "setEmbeddingConnectionId",
]);

/**
 * Resolves the Organization that owns the row an id addresses; null when the
 * row (or anything on its ownership chain) does not exist.
 */
type OwnerResolver = (
  inner: Db,
  id: string,
  organizationId: string
) => Promise<string | null>;

const assistantOwner: OwnerResolver = async (inner, id) =>
  (await inner.getAssistant(id))?.organizationId ?? null;

const flowOwner: OwnerResolver = async (inner, id, organizationId) => {
  const flow = await inner.getFlow(id);
  return flow ? assistantOwner(inner, flow.assistantId, organizationId) : null;
};

/**
 * Collection ownership (PRD #726 contract): Collections are org-owned, so
 * the `organization_id` stamp is the whole check.
 */
const collectionOwner: OwnerResolver = async (inner, id) =>
  (await inner.getCollection(id))?.organizationId ?? null;

const sourceOwner: OwnerResolver = async (inner, id, organizationId) => {
  const source = await inner.getSource(id);
  return source
    ? collectionOwner(inner, source.collectionId, organizationId)
    : null;
};

/**
 * conversationId → owner → organization.
 *
 * A Conversation is owned by an Assistant **or** by a Teammate (#768), never
 * both, so ownership is whichever of the two the row points at. A row pointing
 * at neither resolves to null and is unreachable through this view, rather than
 * quietly visible to every tenant.
 */
/**
 * proposalId → organization. A Suggested Fix carries its own stamp, so this is
 * one read rather than a walk through the Improvement the caller named.
 */
const improvementProposalOwner: OwnerResolver = async (inner, id) =>
  (await inner.getImprovementProposalById(id))?.organizationId ?? null;

const conversationOwnerOf: OwnerResolver = async (
  inner,
  id,
  organizationId
) => {
  const conversation = await inner.getConversation(id);
  if (!conversation) return null;
  return conversationRowOwner(inner, conversation, organizationId);
};

async function conversationRowOwner(
  inner: Db,
  conversation: { assistantId: string | null; teammateId: string | null },
  organizationId: string
): Promise<string | null> {
  if (conversation.assistantId) {
    return assistantOwner(inner, conversation.assistantId, organizationId);
  }
  if (conversation.teammateId) {
    const teammate = await inner.table("teammates").get(conversation.teammateId);
    return teammate?.organizationId ?? null;
  }
  return null;
}

const conversationOwner = conversationOwnerOf;

/** messageId → conversation → its owner → organization. */
const messageOwner: OwnerResolver = async (inner, id, organizationId) => {
  const conversation = await inner.getConversationForMessage(id);
  return conversation
    ? conversationRowOwner(inner, conversation, organizationId)
    : null;
};

const helpDeskOwner: OwnerResolver = async (inner, id) =>
  (await inner.getHelpDesk(id))?.organizationId ?? null;

/** Improvements carry their organizationId directly: one resolve (#625). */
const improvementOwner: OwnerResolver = async (inner, id) =>
  (await inner.getImprovement(id))?.organizationId ?? null;

const memoryOwner: OwnerResolver = async (inner, id) =>
  (await inner.getMemory(id))?.organizationId ?? null;

const publicationOwner: OwnerResolver = async (inner, id, organizationId) => {
  const publication = await inner.getPublication(id);
  return publication
    ? assistantOwner(inner, publication.assistantId, organizationId)
    : null;
};

const skillOwner: OwnerResolver = async (inner, id) =>
  (await inner.table("skills").get(id))?.organizationId ?? null;

/**
 * teammateId → organization (#768). The row carries the stamp, so this is one
 * read rather than a walk.
 */
const teammateOwner: OwnerResolver = async (inner, id) =>
  (await inner.table("teammates").get(id))?.organizationId ?? null;

/** channelId → organization (#778). Same shape: the row is stamped. */
const channelOwner: OwnerResolver = async (inner, id) =>
  (await inner.table("teammateChannels").get(id))?.organizationId ?? null;

const entityOwner: OwnerResolver = async (inner, id) =>
  (await inner.table("entities").get(id))?.organizationId ?? null;

/** Rows only reachable by membership in an org-scoped list. */
const inviteOwner: OwnerResolver = async (inner, id, organizationId) =>
  (await inner.listInvites(organizationId)).some((invite) => invite.id === id)
    ? organizationId
    : null;

const apiKeyOwner: OwnerResolver = async (inner, id, organizationId) =>
  (await inner.listApiKeys(organizationId)).some((key) => key.id === id)
    ? organizationId
    : null;

const providerConnectionOwner: OwnerResolver = async (
  inner,
  id,
  organizationId
) =>
  (await inner.listProviderConnections(organizationId)).some(
    (connection) => connection.id === id
  )
    ? organizationId
    : null;

/** Application Connections carry their organizationId directly (#839). */
const applicationConnectionOwner: OwnerResolver = async (inner, id) =>
  (await inner.getSafeApplicationConnection(id))?.organizationId ?? null;

/** Human review requests carry their organizationId directly (#841). */
const reviewRequestOwner: OwnerResolver = async (inner, id) =>
  (await inner.table("reviewRequests").get(id))?.organizationId ?? null;

const alertOwner: OwnerResolver = async (inner, id, organizationId) =>
  (await inner.listAlerts(organizationId)).some((alert) => alert.id === id)
    ? organizationId
    : null;

const supportChannelOwner: OwnerResolver = async (
  inner,
  id,
  organizationId
) => {
  for (const desk of await inner.listHelpDesks(organizationId)) {
    const channels = await inner.listSupportChannels(desk.id);
    if (channels.some((channel) => channel.id === id)) return organizationId;
  }
  return null;
};

/**
 * "Resolve owner → throw" family: the first argument is an id whose owning
 * Organization must be the pinned one, otherwise `cross_org`.
 */
const GUARDED_METHODS: Partial<Record<keyof Db, OwnerResolver>> = {
  // assistantId-addressed
  listFlows: assistantOwner,
  createFlow: assistantOwner,
  reorderFlows: assistantOwner,
  listCollections: assistantOwner,
  listAssistantSkills: assistantOwner,
  setAssistantSkills: assistantOwner,
  createPublication: assistantOwner,
  deletePublications: assistantOwner,
  getLatestPublication: assistantOwner,
  createAssistantGoal: assistantOwner,
  getApiIntegration: assistantOwner,
  deleteApiIntegration: assistantOwner,
  updateAssistant: assistantOwner,
  deleteAssistant: assistantOwner,
  // flow → assistant → organization
  updateFlow: flowOwner,
  deleteFlow: flowOwner,
  // collection → organization (#622)
  listSources: collectionOwner,
  listConcepts: collectionOwner,
  // source → collection → organization (#622). The link mutations (#726)
  // get an extra assistant-side check in their dedicated branch below.
  deleteSource: sourceOwner,
  listSourceAssistantLinks: sourceOwner,
  // teammate → organization (#768). Without this the Teammates domain's thread
  // reads are unreachable over a key, which is how they shipped: the drift
  // tests check that the CLI, the MCP tool and the route agree about a name,
  // and none of them calls the operation, so a Db surface nobody exposed
  // failed at runtime and nowhere else.
  listTeammateConversations: teammateOwner,
  // channel → organization (#778): the transcript reads. `appendChannelMessage`
  // is deliberately absent, and that absence is the reason posting into a
  // channel has no /api/v1 route: a message starts a chain, and a chain is a
  // streamed, model-driven thing rather than a request/response one.
  listChannelMessages: channelOwner,
  listChannelChainMessages: channelOwner,
  // conversation → assistant → organization (#624)
  listMessages: conversationOwner,
  getInboxConversationReview: conversationOwner,
  // The feedback-triage template's dedup walk (#772).
  listConversationImprovementLinks: conversationOwner,
  setConversationPinned: conversationOwner,
  updateConversationMetadata: conversationOwner,
  deleteConversation: conversationOwner,
  setMessageFeedback: messageOwner,
  // improvements (#625)
  updateImprovement: improvementOwner,
  linkImprovementMessage: improvementOwner,
  // Addressed by the proposal's own id, not by its Improvement's.
  updateImprovementProposal: improvementProposalOwner,
  listImprovementMessages: improvementOwner,
  getImprovementAssociationPage: improvementOwner,
  getImprovementProposal: improvementOwner,
  // generic-table rows
  upsertEntityRecords: entityOwner,
  listEntityRecords: entityOwner,
  countEntityRecords: entityOwner,
  queryEntityRecords: entityOwner,
  deleteSkill: skillOwner,
  // help desks + support channels
  updateHelpDesk: helpDeskOwner,
  deleteHelpDesk: helpDeskOwner,
  listSupportChannels: helpDeskOwner,
  createSupportChannel: helpDeskOwner,
  reorderSupportChannels: helpDeskOwner,
  setTicketingIntegration: helpDeskOwner,
  clearTicketingIntegration: helpDeskOwner,
  updateSupportChannel: supportChannelOwner,
  deleteSupportChannel: supportChannelOwner,
  // goals
  // rows found by membership in an org-scoped list
  revokeInvite: inviteOwner,
  revokeApiKey: apiKeyOwner,
  deleteProviderConnection: providerConnectionOwner,
  resolveAlert: alertOwner,
  deleteMemory: memoryOwner,
};

/**
 * "Post-check read → null" family: single-row reads where a foreign (or
 * broken-chain) row reads as absent rather than erroring.
 */
const NULL_READ_METHODS: Partial<Record<keyof Db, OwnerResolver>> = {
  getAssistant: assistantOwner,
  // Applications domain (#839): the safe read only, never the sealed
  // credential, which no key surface returns.
  getSafeApplicationConnection: applicationConnectionOwner,
  decideReviewRequest: reviewRequestOwner,
  getFlow: flowOwner,
  getCollection: collectionOwner,
  getSource: sourceOwner,
  getConversation: conversationOwner,
  getConversationForMessage: messageOwner,
  getPublication: publicationOwner,
  getHelpDesk: helpDeskOwner,
  getImprovement: improvementOwner,
  getImprovementProposalById: improvementProposalOwner,
  getMemory: memoryOwner,
};

/**
 * Tables exposed through the generic accessor over the API-key surface.
 * Every pinned table's rows carry an `organizationId` stamp, which is what
 * the pinning below relies on. A new table earns its exposure by joining this
 * set in the same PR as the route that needs it (fail-closed like the method
 * lists above).
 */
const PINNED_TABLES = new Set([
  "entities",
  "skills",
  "projects",
  // AI Teammates (#768) and their channels (#778). Every row carries an
  // `organizationId` stamp, which is what the pinning below relies on.
  // `teammateGrants`, `teammateRoutines` and `teammateRosterHidden` stay out:
  // no /api/v1 route reaches them, and fail-closed means a table earns its
  // exposure from a route, not from being adjacent to one.
  "teammates",
  "teammateChannels",
  "teammateChannelParticipants",
  "assistantGoals",
  // Human review requests (#841): `/api/v1/reviews` lists and decides them.
  "reviewRequests",
] as const);
type PinnedTableName = typeof PINNED_TABLES extends Set<infer T> ? T : never;

/**
 * The org-pinning rules for one generic table accessor: lists are filtered
 * and inserts stamped with the pinned Organization; id-addressed reads
 * resolve foreign rows to null; id-addressed writes refuse them (`cross_org`).
 */
function pinTableAccessor<
  T extends {
    list(filter?: object, options?: object): Promise<Array<{ organizationId?: string }>>;
    get(id: string): Promise<{ organizationId?: string } | null>;
    insert(values: object): Promise<unknown>;
    update(id: string, patch: never): Promise<unknown>;
    delete(id: string): Promise<void>;
  },
>(name: string, table: T, organizationId: string): T {
  const assertOwned = async (operation: string, id: string) => {
    const row = await table.get(id);
    if (!row || row.organizationId !== organizationId) {
      throw new OrgPinnedDbError(operation, "cross_org");
    }
  };
  return {
    ...table,
    list: (filter: object = {}, options?: object) =>
      table.list({ ...filter, organizationId }, options),
    get: async (id: string) => {
      const row = await table.get(id);
      return row?.organizationId === organizationId ? row : null;
    },
    insert: (values: object) => table.insert({ ...values, organizationId }),
    update: async (id: string, patch: never) => {
      await assertOwned(`table(${name}).update`, id);
      return table.update(id, patch);
    },
    delete: async (id: string) => {
      await assertOwned(`table(${name}).delete`, id);
      await table.delete(id);
    },
  } as T;
}

export type OrgPinnedDbErrorReason = "not_exposed" | "cross_org";

export class OrgPinnedDbError extends Error {
  readonly reason: OrgPinnedDbErrorReason;
  constructor(method: string, reason: OrgPinnedDbErrorReason) {
    super(
      reason === "not_exposed"
        ? `Db.${method} is not exposed over the API-key surface`
        : `Db.${method}: row does not belong to the pinned Organization`
    );
    this.name = "OrgPinnedDbError";
    this.reason = reason;
  }
}

/**
 * A `Db` view locked to one Organization. Structurally still a `Db` so route
 * code and the operations layer type-check, but any method outside the
 * allow-lists throws, and every id argument is resolved before it is trusted.
 */
export function createOrgPinnedDb(inner: Db, organizationId: string): Db {
  async function assertOwner(
    method: string,
    resolver: OwnerResolver,
    id: unknown
  ) {
    if ((await resolver(inner, String(id), organizationId)) !== organizationId) {
      throw new OrgPinnedDbError(method, "cross_org");
    }
  }

  return new Proxy(inner, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      const method = prop as keyof Db;
      const call = (...args: unknown[]) =>
        (value as (...a: unknown[]) => unknown).call(target, ...args);

      if (ORG_SCOPED_METHODS.has(method)) {
        return (...args: unknown[]) => call(organizationId, ...args.slice(1));
      }

      if (method === "table") {
        return (name: unknown) => {
          if (!PINNED_TABLES.has(name as PinnedTableName)) {
            throw new OrgPinnedDbError(`table(${String(name)})`, "not_exposed");
          }
          return pinTableAccessor(
            String(name),
            inner.table(name as PinnedTableName),
            organizationId
          );
        };
      }

      if (method === "listMemories" || method === "deleteSubjectMemories") {
        return (...args: unknown[]) => {
          const subject = (args[0] ?? {}) as { subjectId?: unknown };
          return call({
            ...subject,
            organizationId,
            subjectId: String(subject.subjectId ?? ""),
          });
        };
      }

      if (method === "listOrganizations") {
        return async () =>
          (await inner.listOrganizations()).filter(
            (organization) => organization.id === organizationId
          );
      }

      if (method === "setApiIntegration") {
        return async (...args: unknown[]) => {
          const input = args[0] as { assistantId?: unknown; organizationId?: unknown };
          await assertOwner(String(prop), assistantOwner, input.assistantId);
          return call({ ...input, organizationId });
        };
      }

      // Link mutations address a Source AND name Assistants: both sides are
      // resolved before the call, so an API key can never link an Organization's
      // Source to somebody else's Assistant (PRD #726).
      if (
        method === "setSourceAssistantLinks" ||
        method === "setSourceDirectAccess"
      ) {
        return async (...args: unknown[]) => {
          await assertOwner(String(prop), sourceOwner, args[0]);
          const assistantIds =
            method === "setSourceAssistantLinks"
              ? (args[1] as string[])
              : [String(args[1])];
          for (const assistantId of assistantIds) {
            await assertOwner(String(prop), assistantOwner, assistantId);
          }
          return call(...args);
        };
      }

      /**
       * A Teammate's own memory write (#771). The Organization arrives inside
       * the input object rather than as the first argument, so it is stamped
       * the way `listMemories` is, and a forged one in the payload cannot place
       * a document in another tenant.
       *
       * Only the write is here. Reading a document, its history and reverting
       * one are console operations on the Member's own session, so they stay
       * behind RLS and earn no exposure they do not need.
       */
      if (method === "writeMemoryDocument") {
        return (...args: unknown[]) =>
          call({ ...((args[0] ?? {}) as object), organizationId });
      }

      /**
       * A Suggested Fix is created against an Improvement, and its own
       * `organizationId` arrives inside the input object rather than as the
       * first argument. Resolve the Improvement, then stamp the org, so a
       * forged organizationId in the payload cannot place a proposal in
       * somebody else's tenant.
       */
      if (method === "createImprovementProposal") {
        return async (...args: unknown[]) => {
          const input = (args[0] ?? {}) as { improvementId?: unknown };
          await assertOwner(String(prop), improvementOwner, input.improvementId);
          return call({ ...(args[0] as object), organizationId });
        };
      }

      if (method === "createSource") {
        return async (...args: unknown[]) => {
          const input = args[0] as { collectionId?: unknown };
          await assertOwner(String(prop), collectionOwner, input?.collectionId);
          return call(...args);
        };
      }

      if (method === "listChannelMessageWindows") {
        return async (...args: unknown[]) => {
          const channelIds = Array.isArray(args[0])
            ? (args[0] as string[])
            : [];
          const organizationChannels = await inner
            .table("teammateChannels")
            .list({ organizationId });
          const allowed = new Set(organizationChannels.map((channel) => channel.id));
          for (const channelId of channelIds) {
            if (!allowed.has(channelId)) {
              throw new OrgPinnedDbError(String(prop), "cross_org");
            }
          }
          return call(...args);
        };
      }

      const guard = GUARDED_METHODS[method];
      if (guard) {
        return async (...args: unknown[]) => {
          await assertOwner(String(prop), guard, args[0]);
          return call(...args);
        };
      }

      const readOwner = NULL_READ_METHODS[method];
      if (readOwner) {
        return async (...args: unknown[]) => {
          const owner = await readOwner(inner, String(args[0]), organizationId);
          return owner === organizationId ? call(...args) : null;
        };
      }

      return () => {
        throw new OrgPinnedDbError(String(prop), "not_exposed");
      };
    },
  });
}
