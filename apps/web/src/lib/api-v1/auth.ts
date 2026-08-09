import type { Role } from "@agent-hub/core";
import { API_KEY_PREFIX, hashApiKeySecret } from "@agent-hub/core";
import { createOrgPinnedDb, type Db } from "@agent-hub/db";
import {
  canChangeRoles,
  canEdit,
  canManageApiKeys,
  canManageMembers,
  canPublish,
} from "@/lib/rbac";
import { getApiV1Db } from "@/lib/api-v1/db";
import { apiError } from "@/lib/api-v1/http";

/**
 * The authentication seam every /api/v1 route goes through (#619) — the
 * API-key twin of `requireMember`: resolve the caller, check the capability,
 * hand back a Db that cannot leave the caller's Organization.
 */

export interface ApiKeyContext {
  organizationId: string;
  /** The Role the key acts with (capped at its creator's at mint time). */
  role: Role;
  keyId: string;
  /** Human who delegated this key; used for audit fields on derived writes. */
  actorUserId: string;
  /** Org-pinned, fail-closed Db view — the only Db routes may touch. */
  db: Db;
}

/** Same ladder as server actions; "member" = any valid key. */
export type ApiCapability =
  | "member"
  | "edit"
  | "publish"
  | "manageMembers"
  | "manageApiKeys"
  | "changeRoles";

const CAPABILITY_GUARDS: Record<
  Exclude<ApiCapability, "member">,
  (role: Role | null) => boolean
> = {
  edit: canEdit,
  publish: canPublish,
  manageMembers: canManageMembers,
  manageApiKeys: canManageApiKeys,
  changeRoles: canChangeRoles,
};

const unauthorized = () =>
  apiError(401, "unauthorized", "Provide a valid API key as a Bearer token");

/**
 * Resolves `Authorization: Bearer ciele_sk_…` to an ApiKeyContext, or the
 * 401 Response to return as-is. Missing header, wrong scheme, unknown secret
 * and revoked key are deliberately the same 401 — the response never says
 * which part failed. Stamps `lastUsedAt` best-effort on success.
 */
export async function resolveApiKeyContext(
  request: Request
): Promise<ApiKeyContext | Response> {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, secret, ...rest] = header.split(" ");
  if (
    scheme?.toLowerCase() !== "bearer" ||
    !secret ||
    rest.length > 0 ||
    !secret.startsWith(API_KEY_PREFIX)
  ) {
    return unauthorized();
  }

  const db = getApiV1Db();
  const key = await db.getApiKeyByHash(hashApiKeySecret(secret));
  if (!key || key.revokedAt) return unauthorized();

  await db.touchApiKeyLastUsed(key.id).catch(() => {});

  return {
    organizationId: key.organizationId,
    role: key.role,
    keyId: key.id,
    actorUserId: key.createdBy,
    db: createOrgPinnedDb(db, key.organizationId),
  };
}

/**
 * The 403 gate: null when the key's Role covers the capability, otherwise
 * the error Response to return. Same rank ladder as the web app's actions.
 */
export function requireApiCapability(
  ctx: ApiKeyContext,
  capability: ApiCapability
): Response | null {
  if (capability === "member") return null;
  if (CAPABILITY_GUARDS[capability](ctx.role)) return null;
  return apiError(
    403,
    "forbidden",
    `This API key's role (${ctx.role}) does not allow this operation`
  );
}
