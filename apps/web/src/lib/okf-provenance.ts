/**
 * Presentation view over an OKF v0.2 Concept's trust, lifecycle and provenance
 * frontmatter — the plain-TS module the Knowledge browser's concept card
 * delegates to, so the display rules are unit-tested (vitest only picks up
 * `.test.ts`; see apps/web/CLAUDE.md).
 *
 * The *derivations* stay in `@agent-hub/db` (`okf.ts`) — this only decides how
 * they read to an admin: which labels, and which `sources` entries are
 * followable links versus plain text. That split matters because a
 * `sources[].resource` is allowed to be a scope descriptor or an internal
 * storage key, not just a URL (OKF §5.1/§6.2), and rendering those as dead
 * anchors would imply a link that goes nowhere.
 */

import {
  conceptGeneratedAt,
  conceptStatus,
  isStale,
  lastVerifiedAt,
  trustTier,
  verificationEvents,
  type ConceptFrontmatter,
  type OkfStatus,
  type OkfTrustTier,
} from "@agent-hub/core";

const TRUST_LABELS: Record<OkfTrustTier, string> = {
  unverified: "Unverified",
  "machine-confirmed": "Machine-confirmed",
  "human-reviewed": "Human-reviewed",
};

/** One `sources` entry ready to render: linked only when actually followable. */
export interface ProvenanceSourceView {
  label: string;
  /** Absolute http(s) URL, or null when the resource is not a followable link. */
  href: string | null;
}

export interface ConceptProvenanceView {
  tier: OkfTrustTier;
  trustLabel: string;
  status: OkfStatus;
  /** True only when `status` is something other than the `stable` default. */
  showStatus: boolean;
  stale: boolean;
  generatedBy: string | null;
  generatedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  sources: ProvenanceSourceView[];
}

/** Absolute http(s) only — a storage key or scope descriptor is not a link. */
function hrefFor(resource: string): string | null {
  return /^https?:\/\//i.test(resource) ? resource : null;
}

/**
 * Reduces frontmatter to what the concept card shows. Every field is optional
 * upstream, so this never throws and never invents a value: absent provenance
 * renders as an unverified, stable concept with nothing else to say.
 */
export function conceptProvenanceView(
  frontmatter: ConceptFrontmatter,
  today?: string
): ConceptProvenanceView {
  const tier = trustTier(frontmatter);
  const status = conceptStatus(frontmatter);
  // The latest event is the one worth naming — §5.2's "how recently" is the
  // latest `at`, so the actor shown must be that same event's actor.
  const latestVerifiedAt = lastVerifiedAt(frontmatter);
  const latest =
    verificationEvents(frontmatter).find((event) => event.at === latestVerifiedAt) ??
    verificationEvents(frontmatter)[0];

  return {
    tier,
    trustLabel: TRUST_LABELS[tier],
    status,
    showStatus: status !== "stable",
    stale: isStale(frontmatter, today),
    generatedBy: frontmatter.generated?.by ?? null,
    generatedAt: conceptGeneratedAt(frontmatter),
    verifiedBy: latest?.by ?? null,
    verifiedAt: latestVerifiedAt,
    sources: (frontmatter.sources ?? []).map((source) => ({
      label: source.title ?? source.resource,
      href: hrefFor(source.resource),
    })),
  };
}
