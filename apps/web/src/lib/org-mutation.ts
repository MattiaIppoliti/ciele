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
    case "organization":
      return [
        { path: "/settings/general" },
        { path: "/", scope: "layout" },
      ];
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
    case "teammateList":
      return [{ path: "/teammates" }];
    case "teammate":
      return [{ path: `/teammates/${entity.id}` }];
    case "channelList":
      // The channels share the Teammates roster (#778), so a channel change
      // refreshes that page and not a list of its own.
      return [{ path: "/teammates" }];
    case "channel":
      // A concrete path, so no `scope`: one channel page, one id.
      return [{ path: `/teammates/channels/${entity.id}` }];
    // One entity or the other, but the same two routes: Projects have no page
    // of their own since they moved into the Teammate configuration panel, so
    // a Project change reaches the roster (whose create dialog offers the live
    // Projects) and every Teammate page.
    case "project":
    case "projectList":
      return [
        { path: "/teammates" },
        // Every Teammate page at once: the Project a Teammate reads is picked
        // in its configuration panel, so which Teammates a Project change
        // reaches is not knowable from the entity.
        { path: "/teammates/[teammateId]", scope: "page" },
      ];
    case "myMemory":
      return [{ path: "/settings/memory" }];
    case "knowledgeHub":
      // The tab segments render the tables; the layout route carries nothing.
      return [
        { path: "/library/websites" },
        { path: "/library/files" },
        { path: "/library/faqs" },
      ];
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
      // `scope` is part of the identity, and the empty string stands for
      // "omitted" rather than a scope name, so an explicit `"page"` on the
      // same path stays a separate call.
      const key = `${scope ?? ""}:${path}`;
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
        : options.entities
    );
  }

  return result;
}
