import type { Db } from "./types";
import type { DbTableAccessor } from "./table-access";

/**
 * The org-pinning wrapper for API-key requests (#619, grown per-domain from
 * #620 on).
 *
 * A key-authenticated request has no Supabase session, so it runs on a
 * service-role client and RLS cannot be the tenancy boundary the way it is
 * for signed-in Members. This wrapper takes RLS's place, and it — not the
 * call sites — owns the scoping:
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
 */

/** Methods whose first parameter is an organizationId — pinned on call. */
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
  "listSkills",
  "createSkill",
  "listAlerts",
  "listMembers",
  "updateMemberRole",
  "removeMember",
  "listInvites",
  "createInvite",
  "updateOrganization",
  "listApiKeys",
  "createApiKey",
  "clearSsoConnection",
  "listProviderConnections",
  "createProviderConnection",
  "getEmbeddingConnectionId",
  "setEmbeddingConnectionId",
]);

/**
 * Methods whose first parameter is an assistantId — guarded by resolving the
 * Assistant and checking its Organization before delegating.
 */
const ASSISTANT_SCOPED_METHODS = new Set<keyof Db>([
  "listFlows",
  "createFlow",
  "reorderFlows",
  "listCollections",
  "listAssistantSkills",
  "setAssistantSkills",
  "createPublication",
  "deletePublications",
  "getLatestPublication",
  "listAssistantGoals",
  "createAssistantGoal",
  "getApiIntegration",
  "deleteApiIntegration",
]);

/** Assistant-id-addressed mutations, same guard as above (single id arg). */
const ASSISTANT_ID_METHODS = new Set<keyof Db>([
  "updateAssistant",
  "deleteAssistant",
]);

/**
 * Methods whose first parameter is a flowId — guarded by resolving
 * flow → assistant → organization.
 */
const FLOW_SCOPED_METHODS = new Set<keyof Db>(["updateFlow", "deleteFlow"]);

/**
 * Methods whose first parameter is a collectionId — guarded by resolving
 * collection → assistant → organization (#622).
 */
const COLLECTION_SCOPED_METHODS = new Set<keyof Db>([
  "listSources",
  "listConcepts",
]);

/** Source-id-addressed mutations, guarded source → collection → org (#622). */
const SOURCE_ID_METHODS = new Set<keyof Db>(["deleteSource"]);

/**
 * Methods whose first parameter is a conversationId — guarded by resolving
 * conversation → assistant → organization (#624).
 */
const CONVERSATION_SCOPED_METHODS = new Set<keyof Db>([
  "listMessages",
  "setConversationPinned",
  "updateConversationMetadata",
  "deleteConversation",
]);

const MESSAGE_SCOPED_METHODS = new Set<keyof Db>(["setMessageFeedback"]);

/**
 * Methods whose first parameter is an improvementId — Improvements carry
 * their organizationId directly, so the guard is one resolve (#625).
 */
const IMPROVEMENT_SCOPED_METHODS = new Set<keyof Db>([
  "updateImprovement",
  "listImprovementMessages",
  "getImprovementProposal",
]);

const ENTITY_SCOPED_METHODS = new Set<keyof Db>([
  "upsertEntityRecords",
  "listEntityRecords",
  "countEntityRecords",
  "queryEntityRecords",
]);

const HELP_DESK_SCOPED_METHODS = new Set<keyof Db>([
  "updateHelpDesk",
  "deleteHelpDesk",
  "listSupportChannels",
  "createSupportChannel",
  "reorderSupportChannels",
  "setTicketingIntegration",
  "clearTicketingIntegration",
]);

const SUPPORT_CHANNEL_SCOPED_METHODS = new Set<keyof Db>([
  "updateSupportChannel",
  "deleteSupportChannel",
]);

const SKILL_SCOPED_METHODS = new Set<keyof Db>(["updateSkill", "deleteSkill"]);

const GOAL_SCOPED_METHODS = new Set<keyof Db>([
  "updateAssistantGoal",
  "deleteAssistantGoal",
]);

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
  async function assertAssistantOwned(method: string, assistantId: unknown) {
    const assistant = await inner.getAssistant(String(assistantId));
    if (!assistant || assistant.organizationId !== organizationId) {
      throw new OrgPinnedDbError(method, "cross_org");
    }
  }

  async function assistantIdOfCollection(
    method: string,
    collectionId: unknown
  ): Promise<string> {
    const collection = await inner.getCollection(String(collectionId));
    if (!collection) throw new OrgPinnedDbError(method, "cross_org");
    await assertAssistantOwned(method, collection.assistantId);
    return collection.assistantId;
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
          if (name !== "entities") {
            throw new OrgPinnedDbError(`table(${String(name)})`, "not_exposed");
          }
          const table = inner.table("entities");
          const assertOwned = async (operation: string, id: string) => {
            const entity = await table.get(id);
            if (!entity || entity.organizationId !== organizationId) {
              throw new OrgPinnedDbError(operation, "cross_org");
            }
          };
          const pinned: DbTableAccessor<"entities"> = {
            list: (filter = {}, options) =>
              table.list({ ...filter, organizationId }, options),
            get: async (id) => {
              const entity = await table.get(id);
              return entity?.organizationId === organizationId ? entity : null;
            },
            insert: (values) => table.insert({ ...values, organizationId }),
            update: async (id, patch) => {
              await assertOwned("table(entities).update", id);
              return table.update(id, patch);
            },
            delete: async (id) => {
              await assertOwned("table(entities).delete", id);
              await table.delete(id);
            },
          };
          return pinned;
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

      if (method === "getFlow") {
        // Post-check read like getAssistant: foreign rows read as absent.
        return async (...args: unknown[]) => {
          const flow = await inner.getFlow(String(args[0]));
          if (!flow) return null;
          const assistant = await inner.getAssistant(flow.assistantId);
          return assistant && assistant.organizationId === organizationId
            ? flow
            : null;
        };
      }

      if (method === "listOrganizations") {
        return async () =>
          (await inner.listOrganizations()).filter(
            (organization) => organization.id === organizationId
          );
      }

      if (method === "revokeInvite") {
        return async (...args: unknown[]) => {
          const owned = (await inner.listInvites(organizationId)).some(
            (invite) => invite.id === String(args[0])
          );
          if (!owned) throw new OrgPinnedDbError(String(prop), "cross_org");
          return call(...args);
        };
      }

      if (method === "revokeApiKey") {
        return async (...args: unknown[]) => {
          const owned = (await inner.listApiKeys(organizationId)).some(
            (key) => key.id === String(args[0])
          );
          if (!owned) throw new OrgPinnedDbError(String(prop), "cross_org");
          return call(...args);
        };
      }

      if (method === "setApiIntegration") {
        return async (...args: unknown[]) => {
          const input = args[0] as { assistantId?: unknown; organizationId?: unknown };
          await assertAssistantOwned(String(prop), input.assistantId);
          return call({ ...input, organizationId });
        };
      }

      if (method === "deleteProviderConnection") {
        return async (...args: unknown[]) => {
          const owned = (await inner.listProviderConnections(organizationId)).some(
            (connection) => connection.id === String(args[0])
          );
          if (!owned) throw new OrgPinnedDbError(String(prop), "cross_org");
          return call(...args);
        };
      }

      if (method === "getAssistant") {
        // Post-check read: a foreign row reads as absent, not as an error —
        // the API surface must not disclose that the id exists elsewhere.
        return async (...args: unknown[]) => {
          const assistant = await inner.getAssistant(String(args[0]));
          return assistant && assistant.organizationId === organizationId
            ? assistant
            : null;
        };
      }

      if (method === "getConversationForMessage") {
        return async (...args: unknown[]) => {
          const conversation = await inner.getConversationForMessage(String(args[0]));
          if (!conversation) return null;
          const assistant = await inner.getAssistant(conversation.assistantId);
          return assistant && assistant.organizationId === organizationId
            ? conversation
            : null;
        };
      }

      if (MESSAGE_SCOPED_METHODS.has(method)) {
        return async (...args: unknown[]) => {
          const conversation = await inner.getConversationForMessage(String(args[0]));
          if (!conversation) throw new OrgPinnedDbError(String(prop), "cross_org");
          await assertAssistantOwned(String(prop), conversation.assistantId);
          return call(...args);
        };
      }

      if (method === "getHelpDesk") {
        return async (...args: unknown[]) => {
          const desk = await inner.getHelpDesk(String(args[0]));
          return desk && desk.organizationId === organizationId ? desk : null;
        };
      }

      if (HELP_DESK_SCOPED_METHODS.has(method)) {
        return async (...args: unknown[]) => {
          const desk = await inner.getHelpDesk(String(args[0]));
          if (!desk || desk.organizationId !== organizationId) {
            throw new OrgPinnedDbError(String(prop), "cross_org");
          }
          return call(...args);
        };
      }

      if (SUPPORT_CHANNEL_SCOPED_METHODS.has(method)) {
        return async (...args: unknown[]) => {
          const channelId = String(args[0]);
          const desks = await inner.listHelpDesks(organizationId);
          let owned = false;
          for (const desk of desks) {
            const channels = await inner.listSupportChannels(desk.id);
            if (channels.some((channel) => channel.id === channelId)) {
              owned = true;
              break;
            }
          }
          if (!owned) throw new OrgPinnedDbError(String(prop), "cross_org");
          return call(...args);
        };
      }

      if (SKILL_SCOPED_METHODS.has(method)) {
        return async (...args: unknown[]) => {
          const owned = (await inner.listSkills(organizationId)).some(
            (skill) => skill.id === String(args[0])
          );
          if (!owned) throw new OrgPinnedDbError(String(prop), "cross_org");
          return call(...args);
        };
      }

      if (GOAL_SCOPED_METHODS.has(method)) {
        return async (...args: unknown[]) => {
          const goalId = String(args[0]);
          const assistants = await inner.listAssistants(organizationId);
          for (const assistant of assistants) {
            const goals = await inner.listAssistantGoals(assistant.id);
            if (goals.some((goal) => goal.id === goalId)) return call(...args);
          }
          throw new OrgPinnedDbError(String(prop), "cross_org");
        };
      }

      if (method === "resolveAlert") {
        return async (...args: unknown[]) => {
          const owned = (await inner.listAlerts(organizationId)).some(
            (alert) => alert.id === String(args[0])
          );
          if (!owned) throw new OrgPinnedDbError(String(prop), "cross_org");
          return call(...args);
        };
      }
      if (ENTITY_SCOPED_METHODS.has(method)) {
        return async (...args: unknown[]) => {
          const entity = await inner.table("entities").get(String(args[0]));
          if (!entity || entity.organizationId !== organizationId) {
            throw new OrgPinnedDbError(String(prop), "cross_org");
          }
          return call(...args);
        };
      }

      if (method === "deleteMemory") {
        return async (...args: unknown[]) => {
          const memory = await inner.getMemory(String(args[0]));
          if (!memory || memory.organizationId !== organizationId) {
            throw new OrgPinnedDbError(String(prop), "cross_org");
          }
          return call(...args);
        };
      }

      if (method === "getMemory") {
        return async (...args: unknown[]) => {
          const memory = await inner.getMemory(String(args[0]));
          return memory && memory.organizationId === organizationId ? memory : null;
        };
      }

      if (
        ASSISTANT_SCOPED_METHODS.has(method) ||
        ASSISTANT_ID_METHODS.has(method)
      ) {
        return async (...args: unknown[]) => {
          await assertAssistantOwned(String(prop), args[0]);
          return call(...args);
        };
      }

      if (FLOW_SCOPED_METHODS.has(method)) {
        return async (...args: unknown[]) => {
          const flow = await inner.getFlow(String(args[0]));
          if (!flow) throw new OrgPinnedDbError(String(prop), "cross_org");
          await assertAssistantOwned(String(prop), flow.assistantId);
          return call(...args);
        };
      }

      if (method === "getCollection") {
        return async (...args: unknown[]) => {
          const collection = await inner.getCollection(String(args[0]));
          if (!collection) return null;
          const assistant = await inner.getAssistant(collection.assistantId);
          return assistant && assistant.organizationId === organizationId
            ? collection
            : null;
        };
      }

      if (COLLECTION_SCOPED_METHODS.has(method)) {
        return async (...args: unknown[]) => {
          await assistantIdOfCollection(String(prop), args[0]);
          return call(...args);
        };
      }

      if (method === "getSource") {
        return async (...args: unknown[]) => {
          const source = await inner.getSource(String(args[0]));
          if (!source) return null;
          try {
            await assistantIdOfCollection(String(prop), source.collectionId);
          } catch {
            return null;
          }
          return source;
        };
      }

      if (method === "createSource") {
        return async (...args: unknown[]) => {
          const input = args[0] as { collectionId?: unknown };
          await assistantIdOfCollection(String(prop), input?.collectionId);
          return call(...args);
        };
      }

      if (SOURCE_ID_METHODS.has(method)) {
        return async (...args: unknown[]) => {
          const source = await inner.getSource(String(args[0]));
          if (!source) throw new OrgPinnedDbError(String(prop), "cross_org");
          await assistantIdOfCollection(String(prop), source.collectionId);
          return call(...args);
        };
      }

      if (method === "getConversation") {
        return async (...args: unknown[]) => {
          const conversation = await inner.getConversation(String(args[0]));
          if (!conversation) return null;
          const assistant = await inner.getAssistant(conversation.assistantId);
          return assistant && assistant.organizationId === organizationId
            ? conversation
            : null;
        };
      }

      if (CONVERSATION_SCOPED_METHODS.has(method)) {
        return async (...args: unknown[]) => {
          const conversation = await inner.getConversation(String(args[0]));
          if (!conversation) throw new OrgPinnedDbError(String(prop), "cross_org");
          await assertAssistantOwned(String(prop), conversation.assistantId);
          return call(...args);
        };
      }

      if (method === "getPublication") {
        return async (...args: unknown[]) => {
          const publication = await inner.getPublication(String(args[0]));
          if (!publication) return null;
          const assistant = await inner.getAssistant(publication.assistantId);
          return assistant && assistant.organizationId === organizationId
            ? publication
            : null;
        };
      }

      if (method === "getImprovement") {
        return async (...args: unknown[]) => {
          const improvement = await inner.getImprovement(String(args[0]));
          return improvement && improvement.organizationId === organizationId
            ? improvement
            : null;
        };
      }

      if (IMPROVEMENT_SCOPED_METHODS.has(method)) {
        return async (...args: unknown[]) => {
          const improvement = await inner.getImprovement(String(args[0]));
          if (!improvement || improvement.organizationId !== organizationId) {
            throw new OrgPinnedDbError(String(prop), "cross_org");
          }
          return call(...args);
        };
      }

      return () => {
        throw new OrgPinnedDbError(String(prop), "not_exposed");
      };
    },
  });
}
