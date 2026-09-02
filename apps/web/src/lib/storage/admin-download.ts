import type { NextRequest } from "next/server";
import { isSupabaseConfigured } from "@agent-hub/db";
import type { ObjectAccessObjectKind } from "@agent-hub/core";
import { requireMember } from "@/lib/authz";
import { CAPABILITY_GUARDS } from "@/lib/rbac";
import {
  deliverObject,
  objectAccessLedger,
  recordObjectAccess,
} from "@/lib/storage/deliver-object";
import { getServiceRoleDb } from "@/lib/service-db";
import {
  createSupabaseServiceClient,
  isSupabaseServiceConfigured,
} from "@/lib/supabase/service";

/**
 * The admin download shape both proxy routes share (#801, CYB-05): resolve the
 * caller, build the ledger context, refuse with a recorded row, deliver with a
 * counted one. The two routes differ only in how they find the object, so
 * that is the one thing a caller supplies.
 *
 * `requireMember("member")` rather than `requireMember("edit")`: the stricter
 * form *throws* on a role failure, which a route handler turns into a 500 with
 * nothing on the ledger. The capability is checked here instead, the same way
 * the /api/v1 seam does it, so a refusal is a 403 and a recorded event.
 */
export interface AdminDownloadTarget {
  bucket: string;
  path: string;
  filename: string;
}

export async function serveAdminDownload(
  request: NextRequest,
  input: {
    objectKind: ObjectAccessObjectKind;
    /** The Source the object belongs to, for the ledger; exports have none. */
    sourceId?: string;
    /** The ledger path when the object cannot be resolved (`source:<id>`). */
    fallbackPath: string;
    /**
     * Finds the object on the caller's org-scoped Db. Null when it does not
     * exist for this organization, which is how a foreign id is answered: a
     * 404 with a ledger row, never someone else's file.
     */
    resolve: (
      db: Awaited<ReturnType<typeof requireMember>>["db"],
      organizationId: string
    ) => Promise<AdminDownloadTarget | null>;
  }
): Promise<Response> {
  const { db, session } = await requireMember();
  const organizationId = session.organization.id;

  const target = await input.resolve(db, organizationId);
  const ledger = objectAccessLedger({
    db,
    serviceDb: isSupabaseServiceConfigured() ? getServiceRoleDb() : null,
    actor: { organizationId, kind: "member", id: session.userId },
    objectKind: input.objectKind,
    path: target?.path ?? input.fallbackPath,
    sourceId: input.sourceId,
    requestHeaders: request.headers,
  });

  // Checked here rather than by `requireMember("edit")`, which throws: a
  // refused download should be a 403 with a ledger row, not a 500 with none.
  if (!CAPABILITY_GUARDS.edit(session.role)) {
    await recordObjectAccess({ ...ledger, result: "refused" });
    return new Response("Forbidden", { status: 403 });
  }
  if (!target) {
    await recordObjectAccess({ ...ledger, result: "refused" });
    return new Response("Not found", { status: 404 });
  }
  if (!isSupabaseConfigured() || !isSupabaseServiceConfigured()) {
    return new Response("Object storage is not configured", { status: 503 });
  }

  const response = await deliverObject({
    ...ledger,
    storage: createSupabaseServiceClient(),
    bucket: target.bucket,
    filename: target.filename,
  });
  return response ?? new Response("Download failed", { status: 502 });
}
