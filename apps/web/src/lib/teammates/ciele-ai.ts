import { cache } from "react";
import {
  isCieleAi,
  type ModelRef,
  type Provider,
  type Teammate,
} from "@agent-hub/core";
import { MODEL_CATALOG } from "@agent-hub/agent/client";
import { createOrgPinnedDb, type Db } from "@agent-hub/db";
import { ensureCieleAiOp } from "@ciele/ops";
import { getServiceRoleDb } from "@/lib/service-db";

/**
 * Ciele AI on the web surface: creating it, the Knowledge Scope it searches,
 * and the models its chat offers. Its tools, and the rule that it acts with the
 * chatting Member's own Role, are `teammateToolset` in `@ciele/ops`.
 */

/**
 * Ciele AI for this Organization, created on first use. Memoised per request:
 * the Teammates layout and the `/teammates` page both ask on a first visit, and
 * two concurrent ensures would race each other to the insert.
 */
export const ensureCieleAi = cache(ensureCieleAiUncached);

async function ensureCieleAiUncached(organizationId: string, userId: string): Promise<Teammate> {
  // The pinned service view, because a Viewer's first visit must be able to
  // create the row and RLS lets only Editors insert Teammates. The operation is
  // what keeps that to one row of one shape.
  return ensureCieleAiOp.run(
    {
      organizationId,
      userId,
      // Not the caller's Role and not read: the operation is `member`, so the
      // lowest rung is the honest claim for a create that any Role triggers.
      role: "viewer",
      db: createOrgPinnedDb(getServiceRoleDb(), organizationId),
    },
    {}
  );
}

/**
 * The Knowledge Scope Ciele AI searches this turn: every Collection the Member
 * can read, resolved on their own RLS session so a Collection they cannot see
 * is not searched for them. Resolved per turn, never stored, so a Collection
 * added this morning is searched this afternoon.
 */
export async function cieleAiKnowledgeScope(
  db: Db,
  organizationId: string
): Promise<Pick<Teammate, "collectionIds" | "sourceIds">> {
  const collections = await db.listOrgCollections(organizationId);
  return { collectionIds: collections.map((collection) => collection.id), sourceIds: [] };
}

/**
 * The models a chat may be asked on. A Teammate's own allow-list, except that
 * Ciele AI ships with none and would then offer no picker at all: until
 * somebody narrows it in Configure it may be asked on every catalogue model,
 * and the picker still only shows what the Organization's connections serve.
 */
export function chatAllowedModels(
  teammate: Pick<Teammate, "allowedModels"> & Partial<Pick<Teammate, "systemKind">>
): ModelRef[] {
  const own = teammate.allowedModels ?? [];
  if (!isCieleAi(teammate) || own.length > 0) return [...own];
  return (Object.entries(MODEL_CATALOG) as [Provider, { id: string }[]][]).flatMap(
    ([provider, models]) => models.map((model) => ({ provider, modelId: model.id }))
  );
}
