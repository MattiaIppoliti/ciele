import type {
  Concept,
  ConceptFrontmatter,
  Entity,
  Improvement,
  ImprovementPatch,
  Role,
  SsoConnection,
  Provider,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import type { ZodType } from "zod";
import type { MutatedEntity } from "./entities";

/**
 * The operations layer (#620) — the one seam both admin surfaces stand on.
 *
 * An operation is (context, validated input) → result, declaring up front
 * the capability it requires and the entities it mutates. The web app's
 * server actions and the /api/v1 routes both execute the SAME operation;
 * what differs per surface is only how the context is resolved (session +
 * RLS-scoped Db vs API key + org-pinned Db) and what the declarations are
 * turned into (capability → requireMember vs 403; entities → revalidatePath).
 *
 * This package is framework-free on purpose: no next/*, no HTTP shapes —
 * those belong to the callers.
 */

/** Who an operation runs as, resolved by the calling surface. */
export interface OperationContext {
  organizationId: string;
  /** The acting Member's user id; empty string for an API-key caller. */
  userId: string;
  /** Already-authorized Role — capability was checked by the caller. */
  role: Role;
  /**
   * The surface's Db: RLS-scoped (web session) or org-pinned (API key).
   * Operations never construct a Db and never widen what it can reach.
   */
  db: Db;
  /**
   * Host ports for side effects that need more Db surface than the pinned
   * view exposes (job enqueueing, the OKF persist pipeline, crawls). Each
   * caller wires its own implementation over its own Db — the operation is
   * the guard, the port is the effect. Absent ports no-op (or, where the
   * operation cannot succeed without one, raise a clear invalid_input) so
   * the demo/mock deployment stays correct unwired.
   */
  ports?: OperationPorts;
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
  /** Reclaim a deleted Collection's derived graph dataset (ADR-0017). */
  purgeCollectionGraph?(collectionId: string): Promise<void>;
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
 * thrown message on the web surface — operations throw one vocabulary, each
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
  /** Parsed by the calling surface before `run` — run() may assume validity. */
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
