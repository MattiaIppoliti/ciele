import type {
  Teammate,
  TeammateCapabilityCeiling,
  TeammateGrant,
  TeammateGrantDomain,
} from "./types";
import { TEAMMATE_GRANT_DOMAINS } from "./types";

/**
 * What an AI Teammate is allowed to *do* (#770), as pure functions of its grant
 * rows and its ceiling.
 *
 * Two rules, and they compose in one direction only:
 *
 * 1. **A grant row is the grant.** No row for a domain means the Teammate has
 *    no tool for it and no way to reach it. Absence is refusal, not a default,
 *    which is why there is no `enabled` flag anywhere in here.
 * 2. **The ceiling caps every granted domain at once.** Granting `improvements`
 *    with a `member` ceiling buys the reading half of that domain and nothing
 *    else. The ceiling never *adds* anything: an ungranted domain stays shut at
 *    any ceiling.
 *
 * Both decide; the operations layer refuses. Keeping them here is what lets the
 * same answer be computed when registering the turn's tools, when running one,
 * and in a test with no database.
 */

/**
 * The one ladder, ranking both ends of the comparison.
 *
 * A ceiling is named after the capability it tops out at, so "how high is this
 * ceiling" and "how high does this operation reach" are questions about the
 * same three rungs. Two maps with identical entries were two things to keep in
 * step for no gain.
 *
 * The three org-administration capabilities (`manageMembers`, `manageApiKeys`,
 * `changeRoles`) are absent on purpose: no ceiling admits them, so an operation
 * declaring one is refused for every Teammate rather than gated behind a rung
 * nobody can be given. Above `publish` a Teammate simply cannot go.
 */
const CAPABILITY_RANK: Record<string, number> = {
  member: 1,
  edit: 2,
  publish: 3,
};

/**
 * What a transcript card can say an action belonged to.
 *
 * Every grantable domain, plus `memory`: the two memory writes (#771) are
 * ungated on purpose, so they have no grant row to name, but the card still has
 * to say what the write touched. Spelling that out as a type is what stops the
 * alternative, a `"memory" as TeammateGrantDomain` cast at the two call sites,
 * which invented a fourth grant domain that typecheck could not see and handed
 * it to the card anyway.
 */
export type TeammateActionDomain = TeammateGrantDomain | "memory";

/** The default a Teammate is created with: it may read and write, not publish. */
export const DEFAULT_TEAMMATE_CEILING: TeammateCapabilityCeiling = "edit";

/**
 * Whether an operation's declared capability fits under this ceiling.
 *
 * An unknown capability is refused rather than ranked. That is the whole reason
 * the map is a lookup and not a comparison against a list of forbidden names: a
 * capability added to the operations layer tomorrow is denied to Teammates
 * until somebody decides otherwise, instead of quietly landing under `publish`.
 */
export function ceilingAllowsCapability(
  ceiling: TeammateCapabilityCeiling,
  capability: string
): boolean {
  const wanted = CAPABILITY_RANK[capability];
  const allowed = CAPABILITY_RANK[ceiling];
  return wanted !== undefined && allowed !== undefined && wanted <= allowed;
}

/** The domains this Teammate holds a row for, in the vocabulary's own order. */
export function grantedDomains(
  grants: readonly Pick<TeammateGrant, "domain">[]
): TeammateGrantDomain[] {
  const held = new Set(grants.map((grant) => grant.domain));
  return TEAMMATE_GRANT_DOMAINS.filter((domain) => held.has(domain));
}

/** Whether a domain was granted at all, before the ceiling gets a say. */
export function hasGrant(
  grants: readonly Pick<TeammateGrant, "domain">[],
  domain: TeammateGrantDomain
): boolean {
  return grants.some((grant) => grant.domain === domain);
}

/**
 * Whether this Teammate may accept its own Suggested Fix, the one write that
 * amends ADR-0017's "a Member must accept" invariant (#770).
 *
 * Two conditions, both explicit. The bypass flag is the admin's decision, and
 * the `knowledge` grant is what accepting actually does: it writes a FAQ
 * Concept into the organization's knowledge. A bypass with no knowledge grant
 * is a permission to perform an action the Teammate was never given, so it
 * grants nothing.
 */
export function mayAcceptSuggestedFix(
  teammate: Pick<Teammate, "approvalBypass">,
  grants: readonly Pick<TeammateGrant, "domain">[]
): boolean {
  return teammate.approvalBypass && hasGrant(grants, "knowledge");
}

/**
 * What the model is told when it reaches for something it was not given.
 *
 * Written for the model, not for a log: it has to be specific enough that the
 * Teammate says "I don't have access to the inbox here" to its colleague
 * instead of retrying the same call, and plain enough that the colleague can
 * act on it (ask an admin) without knowing the word "grant".
 */
export function actionRefusal(domain: string): string {
  return `You have no ${domain} access in this organization. Tell the person you are talking to that this action needs an administrator to grant it, and do not try again this turn.`;
}
