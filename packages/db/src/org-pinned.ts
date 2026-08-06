import type { Db } from "./types";

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
const CONVERSATION_SCOPED_METHODS = new Set<keyof Db>(["listMessages"]);

/**
 * Methods whose first parameter is an improvementId — Improvements carry
 * their organizationId directly, so the guard is one resolve (#625).
 */
const IMPROVEMENT_SCOPED_METHODS = new Set<keyof Db>([
  "updateImprovement",
  "listImprovementMessages",
  "getImprovementProposal",
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
