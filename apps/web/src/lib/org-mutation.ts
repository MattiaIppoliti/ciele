import { revalidatePath } from "next/cache";
import type { MutatedEntity } from "@ciele/ops";
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
 * `revalidatePath` calls (path-based per ADR-0005 — admin reads are
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
  scope?: "layout";
}

/** The single entity→paths table (ADR-0005). One entity may fan out to many routes. */
function revalidationsFor(entity: MutatedEntity): Revalidation[] {
  switch (entity.kind) {
    case "assistantList":
      return [{ path: "/" }];
    case "assistant":
      return [
        { path: "/" },
        { path: `/assistants/${entity.id}`, scope: "layout" },
      ];
    case "flows":
      return [{ path: `/assistants/${entity.assistantId}` }];
    case "assistantEditor":
      return [{ path: `/assistants/${entity.assistantId}` }];
    case "helpDeskList":
      return [{ path: "/help-desks" }];
    case "helpDesk":
      return [{ path: `/help-desks/${entity.id}` }];
    case "aiSettings":
      return [{ path: "/settings/ai" }];
    case "members":
      return [{ path: "/settings/members" }];
    case "apiKeys":
      return [{ path: "/settings/api-keys" }];
    case "alerts":
      return [{ path: "/alerts" }];
    case "improvementList":
      return [{ path: "/improvements" }];
    case "improvement":
      return [{ path: `/improvements/${entity.id}` }];
    case "inbox":
      return [{ path: "/inbox" }];
    case "dataEntities":
      return [{ path: "/settings/data" }];
    case "dataAssistant":
      return [{ path: "/data-assistant" }];
  }
}

/**
 * Turns declared entities into deduped `revalidatePath` calls. Shared by
 * `orgMutation` (server actions) and the /api/v1 mutation runner, so an API
 * write refreshes the admin UI exactly like the equivalent web write.
 */
export function revalidateEntities(entities: MutatedEntity[]) {
  const seen = new Set<string>();
  for (const entity of entities) {
    for (const { path, scope } of revalidationsFor(entity)) {
      const key = `${scope ?? "page"}:${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      revalidatePath(path, scope);
    }
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
   * Revalidate only when this predicate accepts the result — for mutations
   * that sometimes change nothing (polling, validation-error returns).
   * Defaults to always revalidating.
   */
  revalidateIf?: (result: T) => boolean;
}

/**
 * Run `fn` as an org-scoped admin mutation. The result is returned untouched,
 * so create-then-redirect flows call `redirect()` after this resolves — by
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
        : options.entities
    );
  }

  return result;
}
