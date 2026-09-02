import { revalidatePath } from "next/cache";
import type { MutatedEntity } from "@ciele/ops";
import { expireOrganizationInsights } from "@/lib/insights/cache";
import {
  requireMember,
  type MemberCapability,
  type MemberContext,
} from "@/lib/authz";

/**
 * The one shape every org-scoped admin mutation follows: resolve the Member
 * with the required capability, run the mutation against the request-scoped
 * Db, then revalidate the admin routes that render what was mutated.
 *
 * Revalidation targets are never hand-listed at call sites. Actions declare
 * WHICH domain entity they touched and the entity→path map below derives the
 * `revalidatePath` calls (path-based per ADR-0005, admin reads are
 * force-dynamic, so the only real effect is purging the client router cache).
 * Forgetting a path stops being possible; adding a route means extending the
 * map, once.
 *
 * Non-org-scoped actions (sign-out, org create/switch, profile, platform
 * settings) stay outside this helper on purpose: they are session-scoped, not
 * Member-capability-scoped.
 */

/**
 * The entity vocabulary itself moved to `@ciele/ops` (#620) so operations can
 * declare what they mutate without knowing about routes; this module keeps
 * the entity→path table, which is web-shaped knowledge. Re-exported for the
 * existing action imports.
 */
export type { MutatedEntity } from "@ciele/ops";

interface Revalidation {
  path: string;
  /**
   * Next's second argument. Omitted for a concrete path, which is the usual
   * case. `"layout"` also invalidates everything nested under it. `"page"` is
   * how a **dynamic** route is named for every one of its params at once
   * (`/teammates/[teammateId]`); passing a bracketed path without it warns and
   * does nothing, so the two always travel together.
   */
  scope?: "page" | "layout";
}

type EntityKind = MutatedEntity["kind"];
type EntityOf<K extends EntityKind> = Extract<MutatedEntity, { kind: K }>;

interface EntityRule<K extends EntityKind> {
  /** The admin routes that render this entity. */
  paths: (entity: EntityOf<K>) => Revalidation[];
  /**
   * Whether the Insights aggregate reads this entity. The overview counts
   * Conversations, answers, feedback and escalations per Assistant, so the
   * kinds that create or remove those rows expire the five-minute cache
   * (`lib/insights/report.ts`); the rest leave it alone.
   */
  insights: boolean;
}

/**
 * The single entity table (ADR-0005 as amended): one row per kind answers
 * both "which paths" and "does Insights care", so a new kind cannot be added
 * to one question and forgotten by the other.
 */
const ENTITY_RULES: { [K in EntityKind]: EntityRule<K> } = {
  assistantList: { paths: () => [{ path: "/" }], insights: true },
  // Deleting an Assistant takes its Conversations with it, and the filter
  // options list the Assistants that exist.
  assistant: {
    paths: (entity) => [
      { path: "/" },
      { path: `/assistants/${entity.id}`, scope: "layout" },
    ],
    insights: true,
  },
  flows: {
    paths: (entity) => [{ path: `/assistants/${entity.assistantId}` }],
    insights: false,
  },
  assistantEditor: {
    paths: (entity) => [{ path: `/assistants/${entity.assistantId}` }],
    insights: false,
  },
  helpDeskList: { paths: () => [{ path: "/help-desks" }], insights: false },
  helpDesk: {
    paths: (entity) => [{ path: `/help-desks/${entity.id}` }],
    insights: false,
  },
  aiSettings: { paths: () => [{ path: "/settings/ai" }], insights: false },
  members: { paths: () => [{ path: "/settings/members" }], insights: false },
  organization: {
    paths: () => [{ path: "/settings/general" }, { path: "/", scope: "layout" }],
    insights: false,
  },
  apiKeys: { paths: () => [{ path: "/settings/api-keys" }], insights: false },
  alerts: { paths: () => [{ path: "/alerts" }], insights: false },
  // An Improvement's linked messages carry the thumbs that make the Answer
  // Rating, and "Improve Answer" from the Inbox declares both kinds.
  improvementList: { paths: () => [{ path: "/improvements" }], insights: true },
  improvement: {
    paths: (entity) => [{ path: `/improvements/${entity.id}` }],
    insights: true,
  },
  // Feedback on a message, a deleted Conversation, an escalation: all of it
  // is what the overview counts.
  inbox: { paths: () => [{ path: "/inbox" }], insights: true },
  dataEntities: { paths: () => [{ path: "/settings/data" }], insights: false },
  teammateList: { paths: () => [{ path: "/teammates" }], insights: false },
  teammate: {
    paths: (entity) => [{ path: `/teammates/${entity.id}` }],
    insights: false,
  },
  // The channels share the Teammates roster (#778), so a channel change
  // refreshes that page and not a list of its own.
  channelList: { paths: () => [{ path: "/teammates" }], insights: false },
  // A concrete path, so no `scope`: one channel page, one id.
  channel: {
    paths: (entity) => [{ path: `/teammates/channels/${entity.id}` }],
    insights: false,
  },
  // One entity or the other, but the same routes: Projects have no page of
  // their own since they moved into the Teammate configuration panel, so a
  // Project change reaches the roster (whose create dialog offers the live
  // Projects), every Teammate page, and the Improvements board, where an
  // Improvement names the Project it belongs to.
  project: { paths: () => projectPaths(), insights: false },
  projectList: { paths: () => projectPaths(), insights: false },
  myMemory: { paths: () => [{ path: "/settings/memory" }], insights: false },
  // The tab segments render the tables; the layout route carries nothing.
  knowledgeHub: {
    paths: () => [
      { path: "/library/websites" },
      { path: "/library/files" },
      { path: "/library/applications" },
      { path: "/library/faqs" },
    ],
    insights: false,
  },
};

function projectPaths(): Revalidation[] {
  return [
    { path: "/teammates" },
    // Every Teammate page at once: the Project a Teammate reads is picked
    // in its configuration panel, so which Teammates a Project change
    // reaches is not knowable from the entity.
    { path: "/teammates/[teammateId]", scope: "page" },
    { path: "/improvements" },
  ];
}

function ruleFor<K extends EntityKind>(entity: EntityOf<K>): EntityRule<K> {
  return ENTITY_RULES[entity.kind as K];
}

/** The entity→paths half of the table. One entity may fan out to many routes. */
function revalidationsFor(entity: MutatedEntity): Revalidation[] {
  return ruleFor(entity).paths(entity);
}

/**
 * Turns declared entities into deduped `revalidatePath` calls, then expires
 * the Organization's Insights cache when any entity feeds the aggregate.
 * Shared by `orgMutation` (server actions), the /api/v1 mutation runner and
 * the Teammate action loop, so an API write refreshes the admin UI exactly
 * like the equivalent web write. `organizationId` is required, not optional:
 * a caller that could omit it would silently skip the Insights expiry, and
 * every caller has the id at hand.
 */
export function revalidateEntities(
  entities: MutatedEntity[],
  organizationId: string,
) {
  const seen = new Set<string>();
  for (const entity of entities) {
    for (const { path, scope } of revalidationsFor(entity)) {
      // `scope` is part of the identity, and the empty string stands for
      // "omitted" rather than a scope name, so an explicit `"page"` on the
      // same path stays a separate call.
      const key = `${scope ?? ""}:${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      revalidatePath(path, scope);
    }
  }
  if (entities.some((entity) => ruleFor(entity).insights)) {
    expireOrganizationInsights(organizationId);
  }
}

export interface OrgMutationOptions<T> {
  /** The Role capability requireMember enforces before the mutation runs. */
  capability: MemberCapability;
  /**
   * What the mutation touched. Pass a function when the entity ids are only
   * known from the result (e.g. a create returning the new id).
   */
  entities: MutatedEntity[] | ((result: T) => MutatedEntity[]);
  /**
   * Revalidate only when this predicate accepts the result, for mutations
   * that sometimes change nothing (polling, validation-error returns).
   * Defaults to always revalidating.
   */
  revalidateIf?: (result: T) => boolean;
}

/**
 * Run `fn` as an org-scoped admin mutation. The result is returned untouched,
 * so create-then-redirect flows call `redirect()` after this resolves, by
 * then revalidation has already happened, matching the previous hand-written
 * ordering.
 */
export async function orgMutation<T>(
  options: OrgMutationOptions<T>,
  fn: (ctx: MemberContext) => Promise<T>
): Promise<T> {
  const ctx = await requireMember(options.capability);
  const result = await fn(ctx);

  if (!options.revalidateIf || options.revalidateIf(result)) {
    revalidateEntities(
      typeof options.entities === "function"
        ? options.entities(result)
        : options.entities,
      ctx.organizationId,
    );
  }

  return result;
}
