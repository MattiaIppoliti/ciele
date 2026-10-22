import type { NextRequest } from "next/server";
import { OperationError, getProjectFileOp } from "@ciele/ops";
import { requireMember } from "@/lib/authz";
import { runOperation } from "@/lib/operations";
import { getServiceRoleDb } from "@/lib/service-db";
import {
  attachmentDisposition,
  deliverObject,
  objectAccessLedger,
  recordObjectAccess,
} from "@/lib/storage/deliver-object";
import { WORK_FILES_BUCKET, memoryWorkFile } from "@/lib/storage/work-files";
import { createSupabaseServiceClient, isSupabaseServiceConfigured, objectStorageClient } from "@/lib/supabase/service";

/**
 * A Project file's bytes (#1068), for whoever can read its Project, Viewers
 * included. `files.get` is the authorization: a file in a Project the caller
 * cannot read is a 404, and every answer, refusals too, lands on the
 * object-access ledger (#801, CYB-05) like any other private object. Always an
 * attachment; the console previews an image or a PDF by fetching it, never by
 * navigating to it.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const { db, session } = await requireMember();
  const organizationId = session.organization.id;

  const file = await runOperation(getProjectFileOp, { id: fileId }).catch((error: unknown) => {
    if (error instanceof OperationError) return null;
    throw error;
  });
  const ledger = objectAccessLedger({
    db,
    serviceDb: isSupabaseServiceConfigured() ? getServiceRoleDb() : null,
    actor: { organizationId, kind: "member", id: session.userId },
    objectKind: "work_file",
    path: file?.storagePath ?? `file:${fileId}`,
    requestHeaders: request.headers,
  });
  if (!file) {
    await recordObjectAccess({ ...ledger, result: "refused" });
    return new Response("Not found", { status: 404 });
  }

  // No bucket (the demo): the bytes are in this process's memory.
  if (!objectStorageClient()) {
    const object = memoryWorkFile(file.storagePath);
    if (!object) return new Response("Not found", { status: 404 });
    await recordObjectAccess({ ...ledger, result: "served", bytes: object.bytes.byteLength });
    return new Response(object.bytes.slice().buffer, {
      headers: {
        "content-type": file.contentType,
        "content-disposition": attachmentDisposition(file.name),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }

  const response = await deliverObject({
    ...ledger,
    storage: createSupabaseServiceClient(),
    bucket: WORK_FILES_BUCKET,
    filename: file.name,
    responseHeaders: { "x-content-type-options": "nosniff" },
  });
  return response ?? new Response("Download failed", { status: 502 });
}
