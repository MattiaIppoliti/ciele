import { revalidatePath } from "next/cache";
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
 * A domain entity an admin mutation can touch. Kinds are atomic and composable:
 * an action passes every entity it affected, and overlapping paths dedupe. The
 * exact `revalidatePath` set an action produced by hand is reproduced by its
 * declared entities.
 */
export type MutatedEntity =
  | { kind: "assistantList" }
  /** One Assistant's config: the dashboard card and the whole editor layout. */
  | { kind: "assistant"; id: string }
  /** An Assistant's Flow list: the editor page that renders the router. */
  | { kind: "flows"; assistantId: string }
  /** Any Assistant-editor sub-resource (knowledge, skills, goals, publish). */
  | { kind: "assistantEditor"; assistantId: string }
  /** The org Help Desk directory. */
  | { kind: "helpDeskList" }
  /** One Help Desk's detail page (channels, ticketing). */
  | { kind: "helpDesk"; id: string }
  /** The AI/org settings page (budget, prompt, provider connections). */
  | { kind: "aiSettings" }
  /** The org members roster. */
  | { kind: "members" }
  /** The org API keys page (#618). */
  | { kind: "apiKeys" }
  /** The operational Alerts page. */
  | { kind: "alerts" }
  /** The Improvements Kanban. */
  | { kind: "improvementList" }
  /** One Improvement's detail page. */
  | { kind: "improvement"; id: string }
  /** The conversation Inbox. */
  | { kind: "inbox" };

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
    const entities =
      typeof options.entities === "function"
        ? options.entities(result)
        : options.entities;
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

  return result;
}
