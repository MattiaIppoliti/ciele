import type {
  Concept,
  ConceptFrontmatter,
  Entity,
  Improvement,
  ImprovementPatch,
  Role,
  SsoConnection,
  Provider,
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
