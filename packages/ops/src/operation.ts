import type {
  Concept,
  ConceptFrontmatter,
  Entity,
  Improvement,
  ImprovementPatch,
  Provider,
  ReviewRequest,
  Role,
  SsoConnection,
  TeammateCapabilityCeiling,
  TeammateGrantDomain,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import type { ZodType } from "zod";
import type { MutatedEntity } from "./entities";

/**
 * The operations layer (#620): the one seam both admin surfaces stand on.
 *
 * An operation is (context, validated input) → result, declaring up front
 * the capability it requires and the entities it mutates. The web app's
 * server actions and the /api/v1 routes both execute the SAME operation;
 * what differs per surface is only how the context is resolved (session +
 * RLS-scoped Db vs API key + org-pinned Db) and what the declarations are
 * turned into (capability → requireMember vs 403; entities → revalidatePath).
 *
 * This package is framework-free on purpose: no next/*, no HTTP shapes,
 * those belong to the callers.
 */

/** Who an operation runs as, resolved by the calling surface. */
export interface OperationContext {
  organizationId: string;
  /**
   * The acting Member's user id.
   *
   * Not a way to tell a human from a machine: an API-key call carries the
   * key's **creator** (`actorUserId: key.createdBy`), so this is a member id on
   * both paths and is empty only where a surface has nobody to name. An
   * operation that must behave differently for a key needs a different signal,
   * not this one.
   */
  userId: string;
  /** Already-authorized Role, capability was checked by the caller. */
  role: Role;
  /**
   * The acting Member's email and display name (#841), when the surface knows
   * them. A Human review's assignees are emails, so deciding one needs the
   * actor's; an API key has none and decides only through the admin override.
   */
  actorEmail?: string;
  actorName?: string | null;
  /**
   * Set when this run is an AI Teammate acting inside a turn (#770).
   *
   * Its presence changes who the operation runs *as*, not who asked. Capability
   * comes from the Teammate's grants and ceiling; `role` above stays the
   * invoking Member's and is no longer the gate, which is why a Viewer can ask
   * a granted Teammate to move a board item and it moves. `userId` also stays
   * the Member's, so every mutation still records the human who asked.
   */
  teammate?: TeammateActor;
  /**
   * The surface's Db: RLS-scoped (web session) or org-pinned (API key).
   * Operations never construct a Db and never widen what it can reach.
   */
  db: Db;
  /**
   * Host ports for side effects that need more Db surface than the pinned
   * view exposes (job enqueueing, the OKF persist pipeline, crawls). Each
   * caller wires its own implementation over its own Db, the operation is
   * the guard, the port is the effect. Absent ports no-op (or, where the
   * operation cannot succeed without one, raise a clear invalid_input) so
   * the demo/mock deployment stays correct unwired.
   */
  ports?: OperationPorts;
}

/**
 * The acting Teammate, resolved by the calling surface from its row and its
 * grant rows. A plain value rather than the `Teammate` type: the operations
 * layer needs what it may do, not its avatar seed.
 */
export interface TeammateActor {
  id: string;
  /** Shown on the transcript card and in refusals, so the model can say who. */
  name: string;
  ceiling: TeammateCapabilityCeiling;
  /** Domains with a grant row. Absence is refusal; there is no default. */
  grants: readonly TeammateGrantDomain[];
  approvalBypass: boolean;
  /**
   * The Project it is attached to, or null (#771). Carried on the actor rather
   * than passed per call, so the Project-decision tool takes no target: the
   * model names what to write, never where.
   */
  projectId?: string | null;
}

export interface OperationPorts {
  /** Read the org's Entities when freezing a Publication snapshot. */
  listPublicationEntities?(organizationId: string): Promise<Entity[]>;
  /**
   * Grant a system Teammate its one domain at creation (#838). A port because
   * the grant table's RLS is admin-only (#770) while the Flow Canvas is an
   * Editor's surface: the host writes the row with its system Db, and the
   * operation stays the one place that decides *which* row. Absent, the
   * operation inserts through its own Db, which is what the mock and the
   * contract tests exercise.
   */
  grantSystemTeammate?(grant: {
    organizationId: string;
    teammateId: string;
    domain: TeammateGrantDomain;
    grantedBy: string | null;
  }): Promise<void>;
  /**
   * What happens after a Human review closes (#841): approved runs the rest of
   * the Flow, rejected or expired persists the halt message. The host owns it
   * because it is a Conversation Turn: queued on the job ledger in production,
   * run inline for a simulated Preview request so the transcript can show the
   * next message at once. Returns that message when it ran inline.
   */
  afterReviewDecided?(
    review: ReviewRequest
  ): Promise<{ messageId: string; content: unknown[] } | null>;
  /**
   * The decision write itself (#841): a compare-and-set on the pending row,
   * run by the host on its system Db because the table has no member write
   * policy (the assignee rule lives in the operation, and a member policy
   * would let PostgREST bypass it). Absent, the operation writes through its
   * own Db, which the mock allows.
   */
  decideReviewRequest?: Db["decideReviewRequest"];
  /** Probe a BYOK provider credential before it is persisted. */
  validateProviderApiKey?(
    provider: Exclude<Provider, "openai_compatible">,
    apiKey: string
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Validate a stored SSO connection without exposing its sealed secret. */
  validateSsoConnection?(
    connection: SsoConnection
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Retire one deleted Concept's graph document (ADR-0017). */
  removeConceptGraph?(collectionId: string, conceptId: string): Promise<void>;
  /** Defer the OKF pipeline (extract→enrich→chunk→embed) to an Ingestion Job. */
  enqueueIngest?(job: {
    assistantId: string;
    collectionId: string;
    sourceId: string;
    rawText: string;
  }): Promise<void>;
  /** Persist one FAQ Concept through the shared OKF persist path. */
  persistFaq?(args: {
    assistantId: string;
    collectionId: string;
    question: string;
    answer: string;
    provenance: Pick<ConceptFrontmatter, "generated" | "verified" | "sources">;
    /** Disambiguates bundle paths in bulk imports (e.g. "-3"). */
    pathSuffix?: string;
  }): Promise<Concept>;
  /**
   * Re-embed one updated Concept's chunks (the operation already deleted the
   * stale ones). Wired over the surface's Db + the org's Provider Connections.
   */
  reembedConcept?(args: {
    assistantId: string;
    collectionId: string;
    conceptId: string;
    title: string;
    body: string;
  }): Promise<void>;
  /** Restart a website Source's crawl lifecycle. */
  restartCrawl?(sourceId: string): Promise<void>;
  /** Tell the widget cache a new latest Publication exists (#623). */
  invalidatePublication?(assistantId: string): Promise<void> | void;
  /** Fire assignment/closure notifications after an Improvement update (#625). */
  notifyImprovementUpdate?(args: {
    before: Improvement;
    updated: Improvement;
    patch: ImprovementPatch;
  }): Promise<void>;
  /**
   * Tell the other systems to stop before a Conversation with open webhook
   * gates is deleted (#842). The subscription rows cascade with the
   * Conversation, so a delete without this leaves the other system calling an
   * address that no longer resolves. A port because the calls are the
   * runtime's egress; absent, the delete proceeds without them.
   */
  unsubscribeWebhooks?(conversationId: string): Promise<void>;
}

/** Same ladder the web app's authz seam speaks. */
export type OperationCapability =
  | "member"
  | "edit"
  | "publish"
  | "manageMembers"
  | "manageApiKeys"
  | "changeRoles";

/**
 * A caller-attributable failure. `code` maps to an HTTP status on the API
 * surface (not_found → 404, invalid_input → 400, conflict → 409) and to a
 * thrown message on the web surface, operations throw one vocabulary, each
 * surface translates once.
 */
export class OperationError extends Error {
  readonly code: "not_found" | "invalid_input" | "conflict";
  constructor(code: OperationError["code"], message: string) {
    super(message);
    this.name = "OperationError";
    this.code = code;
  }
}

export interface Operation<In, Out> {
  /** Stable catalogue name, e.g. "assistants.create". */
  name: string;
  capability: OperationCapability;
  /** Parsed by the calling surface before `run`, run() may assume validity. */
  input: ZodType<In>;
  /** What a successful run mutated; [] for reads. */
  entities(input: In, result: Out): MutatedEntity[];
  run(ctx: OperationContext, input: In): Promise<Out>;
}

/** Identity helper: keeps inference tight at definition sites. */
export function defineOperation<In, Out>(
  op: Operation<In, Out>
): Operation<In, Out> {
  return op;
}
