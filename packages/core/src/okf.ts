/**
 * Open Knowledge Format (OKF) **v0.2**, the frontmatter vocabulary a Concept
 * carries, plus the pure consumer derivations over it (ADR-0002).
 *
 * This is the one place the format lives. `types.ts` re-exports
 * {@link ConceptFrontmatter} so the domain model keeps a single Concept shape;
 * producers (ingestion, FAQ authoring, crawl) stamp the fields defined here,
 * and consumers (admin UI, runtime citations) read them only through the
 * derivations below, never by hand-rolling the `verified`-is-a-list-or-a-
 * mapping rule or the legacy `timestamp` fallback a second time.
 *
 * Two rules from the spec drive every signature here:
 *
 *  - **Everything except `type` is optional, and absence is meaningful** (§11).
 *    No derivation throws or rejects: an unverified concept is *distinguishable*
 *    from a verified one, never invalid. `trustTier` returns "unverified"
 *    rather than null; `conceptStatus` defaults to "stable" (§5.4).
 *  - **v0.1 documents stay readable** (§13.1). `timestamp` was superseded by
 *    `generated.at`; existing rows still carry it, so {@link conceptGeneratedAt}
 *    is the only sanctioned reader of either. We deliberately do NOT backfill
 *    `generated` onto v0.1 rows: `generated.by` is required within `generated`
 *    and we do not know who authored them, and inventing an actor would be a
 *    provenance lie. The spec blesses the read-time fallback instead.
 *
 * Unknown producer keys are preserved for free, frontmatter is stored as
 * jsonb and only ever read field-wise (§4.1 "MUST NOT reject").
 */

/** The OKF revision this platform produces and reads (§12). */
export const OKF_VERSION = "0.2";

/** Lifecycle state (§5.4). Absent ⇒ `stable`. */
export type OkfStatus = "draft" | "stable" | "deprecated";

/**
 * One material a concept derives from (§5.1). `resource` is required within an
 * entry and names either a followable artifact (URL, bundle-relative path) or
 * a scope descriptor it cannot follow (`pasted text "Fees 2026"`).
 */
export interface OkfSource {
  /** Stable key for per-claim `[^id]` footnote attribution; keyed, not positional. */
  id?: string;
  resource: string;
  title?: string;
  /** Credibility signal: who produced the source, in the actor convention (§7). */
  author?: string;
  /** Credibility signal: how often `resource` was exercised over `usage_window`. */
  usage_count?: number;
  /** Credibility signal: when the source itself last changed (`YYYY-MM-DD`). */
  last_modified?: string;
}

/** Frames every `usage_count` in a `sources` list with a date range (§5.1). */
export interface OkfUsageWindow {
  from: string;
  to: string;
}

/** A `{ by, at }` pair: `generated` (§5.2) and each `verified` event. */
export interface OkfActorStamp {
  /** An actor (§7): `<producer>/<version>`, `human:<id>`, or `process:<id>`. */
  by: string;
  /** ISO 8601 datetime. */
  at?: string;
}

/** A typed hole an Attested Computation's agent may fill (§10.2). */
export interface OkfParameter {
  name: string;
  type: string;
  required?: boolean;
}

/** Run instructions + the evidence a run must return (§10.2). */
export interface OkfExecutor {
  resource: string;
  receipt?: string[];
}

/** Deterministic (no-LLM) code that turns a receipt into a verdict (§10.2). */
export interface OkfAttester {
  resource: string;
}

/**
 * OKF v0.2 frontmatter. `type` is the only required field (§4.1); every other
 * family is optional and its absence is a signal, not an error.
 */
export interface ConceptFrontmatter {
  type: string;
  title?: string;
  description?: string;
  /** Canonical URI of the asset the concept *describes* (not what it derives from). */
  resource?: string;
  tags?: string[];

  // Provenance (§5.1)
  sources?: OkfSource[];
  usage_window?: OkfUsageWindow;

  // Trust (§5.2): who wrote it vs. who confirmed it, deliberately distinct.
  generated?: OkfActorStamp;
  /** One event or many; a bare mapping is a one-element list (§5.2). */
  verified?: OkfActorStamp | OkfActorStamp[];

  // Lifecycle (§5.4, §5.5)
  status?: OkfStatus;
  /** Absolute `YYYY-MM-DD`; stale when `today >= stale_after`. */
  stale_after?: string;

  /**
   * Attested Computation contract (§10). Modeled so a bundle authored elsewhere
   * survives a round-trip through this platform; nothing here produces or
   * executes one, OKF fixes the interface, we do not ship a runner.
   */
  runtime?: string;
  parameters?: OkfParameter[];
  computation?: string;
  executor?: OkfExecutor;
  attester?: OkfAttester;

  /**
   * @deprecated OKF v0.1, superseded by `generated.at` (§13.1). Still present
   * on rows written before the v0.2 upgrade; read via {@link conceptGeneratedAt}.
   */
  timestamp?: string;
}

// ── Actors (§7) ──────────────────────────────────────────────────────────────

/**
 * Builds the three actor forms. Producers MUST route through this rather than
 * interpolating strings, because {@link trustTier} keys off the `human:` prefix,
 * a hand-rolled `"human " + id` silently downgrades a human review.
 */
export const okfActor = {
  /** A person: `human:<id>`. */
  human: (id: string) => `human:${id}`,
  /** An automated process with no model behind it: `process:<id>`. */
  process: (id: string) => `process:${id}`,
  /** An agent or tool: `<producer>/<version>`, e.g. `okf-enricher/claude-opus-5`. */
  agent: (producer: string, version: string) => `${producer}/${version}`,
} as const;

/** Whether an actor string denotes a person (§7), the trust-tier hinge. */
export function isHumanActor(actor: string): boolean {
  return actor.startsWith("human:");
}

// ── Trust (§5.2, §5.3) ───────────────────────────────────────────────────────

/** Trust tier derived from `verified`, lowest to highest (§5.3). */
export type OkfTrustTier = "unverified" | "machine-confirmed" | "human-reviewed";

/**
 * Normalizes `verified` to a list: absent ⇒ `[]`, a bare `{ by, at }` mapping
 * ⇒ one element (§5.2, a MUST in §11). Every `verified` reader goes through
 * this, so the two-shapes rule is honored in exactly one place.
 */
export function verificationEvents(
  frontmatter: Pick<ConceptFrontmatter, "verified">
): OkfActorStamp[] {
  const { verified } = frontmatter;
  if (!verified) return [];
  const events = Array.isArray(verified) ? verified : [verified];
  return events.filter((event) => Boolean(event?.by));
}

/**
 * The concept's trust tier (§5.3). Advisory signal for display and ranking,
 * never access control, and never a reason to drop a concept.
 */
export function trustTier(
  frontmatter: Pick<ConceptFrontmatter, "verified">
): OkfTrustTier {
  const events = verificationEvents(frontmatter);
  if (events.length === 0) return "unverified";
  return events.some((event) => isHumanActor(event.by))
    ? "human-reviewed"
    : "machine-confirmed";
}

/** The most recent verification time ("how recently", §5.2), or null. */
export function lastVerifiedAt(
  frontmatter: Pick<ConceptFrontmatter, "verified">
): string | null {
  const stamps = verificationEvents(frontmatter)
    .map((event) => event.at)
    .filter((at): at is string => Boolean(at))
    .sort();
  return stamps[stamps.length - 1] ?? null;
}

/**
 * When the content last meaningfully changed: `generated.at`, falling back to
 * a legacy v0.1 `timestamp` (§13.1). The only sanctioned reader of either.
 */
export function conceptGeneratedAt(
  frontmatter: Pick<ConceptFrontmatter, "generated" | "timestamp">
): string | null {
  return frontmatter.generated?.at ?? frontmatter.timestamp ?? null;
}

// ── Lifecycle (§5.4, §5.5) ───────────────────────────────────────────────────

/** Lifecycle status; absent ⇒ `stable` (§5.4). */
export function conceptStatus(
  frontmatter: Pick<ConceptFrontmatter, "status">
): OkfStatus {
  return frontmatter.status ?? "stable";
}

/**
 * Whether the concept is past its freshness date (§5.5). An absolute date, so
 * this is a plain lexicographic `YYYY-MM-DD` comparison, no reference to when
 * the concept was read. No `stale_after` ⇒ never stale.
 */
export function isStale(
  frontmatter: Pick<ConceptFrontmatter, "stale_after">,
  today: string = new Date().toISOString().slice(0, 10)
): boolean {
  const staleAfter = frontmatter.stale_after;
  if (!staleAfter) return false;
  return today >= staleAfter;
}
