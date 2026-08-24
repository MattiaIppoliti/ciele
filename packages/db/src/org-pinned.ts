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
  "listAssistants",
  "createAssistant",
  "listInboxConversations",
  "listImprovements",
  "getMemoryEnabled",
  "setMemoryEnabled",
  "listMemorySubjects",
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

const conversationOwner: OwnerResolver = async (inner, id, organizationId) => {
  const conversation = await inner.getConversation(id);
  return conversation
    ? assistantOwner(inner, conversation.assistantId, organizationId)
    : null;
};

/** messageId → conversation → assistant → organization. */
const messageOwner: OwnerResolver = async (inner, id, organizationId) => {
  const conversation = await inner.getConversationForMessage(id);
  return conversation
    ? assistantOwner(inner, conversation.assistantId, organizationId)
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

const goalOwner: OwnerResolver = async (inner, id, organizationId) => {
  for (const assistant of await inner.listAssistants(organizationId)) {
    const goals = await inner.listAssistantGoals(assistant.id);
    if (goals.some((goal) => goal.id === id)) return organizationId;
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
  listAssistantGoals: assistantOwner,
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
  // conversation → assistant → organization (#624)
  listMessages: conversationOwner,
  setConversationPinned: conversationOwner,
  updateConversationMetadata: conversationOwner,
  deleteConversation: conversationOwner,
  setMessageFeedback: messageOwner,
  // improvements (#625)
  updateImprovement: improvementOwner,
  listImprovementMessages: improvementOwner,
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
  updateAssistantGoal: goalOwner,
  deleteAssistantGoal: goalOwner,
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
  getFlow: flowOwner,
  getCollection: collectionOwner,
  getSource: sourceOwner,
  getConversation: conversationOwner,
  getConversationForMessage: messageOwner,
  getPublication: publicationOwner,
  getHelpDesk: helpDeskOwner,
  getImprovement: improvementOwner,
  getMemory: memoryOwner,
};

/**
 * Tables exposed through the generic accessor over the API-key surface.
 * Every pinned table's rows carry an `organizationId` stamp, which is what
 * the pinning below relies on. A new table earns its exposure by joining this
 * set in the same PR as the route that needs it (fail-closed like the method
 * lists above).
 */
const PINNED_TABLES = new Set(["entities", "skills"] as const);
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

      if (method === "createSource") {
        return async (...args: unknown[]) => {
          const input = args[0] as { collectionId?: unknown };
          await assertOwner(String(prop), collectionOwner, input?.collectionId);
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
