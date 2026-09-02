import type { SupabaseClient } from "@supabase/supabase-js";
import type { Db } from "@agent-hub/db";
import type {
  ObjectAccessActorKind,
  ObjectAccessObjectKind,
  ObjectAccessResult,
} from "@agent-hub/core";
import { after } from "next/server";
import { clientAddress } from "@/lib/rate-limit";

/**
 * Serving a private object, with a durable record that it was served
 * (#801, CYB-05).
 *
 * The two download paths used to hand the caller a short-lived signed URL and
 * finish. Nothing recorded who asked or whether any bytes moved, and issuing a
 * URL is not evidence of a download: the URL may be shared, replayed inside its
 * window, or never used at all. So the app now stands in the path. It mints the
 * signed URL for itself, never for the caller, and streams the response
 * through, counting bytes on the way.
 *
 * Streamed rather than buffered: originals go up to 50 MiB, and holding one in
 * memory to weigh it would trade an evidence gap for an availability one. The
 * count lands when the stream ends, which is also the only moment anyone can
 * honestly say a transfer completed.
 *
 * The ledger write never fails the request. A refusal that was not recorded is
 * a gap worth an alert later; a refusal that turned into a 500 because the
 * ledger was down is an outage now.
 */

export interface ObjectAccessActor {
  organizationId: string;
  kind: ObjectAccessActorKind;
  id?: string | null;
}

export interface DeliverObjectInput {
  db: Db;
  /** Service-role client: the ledger must not be writable by the caller. */
  storage: SupabaseClient;
  bucket: string;
  path: string;
  actor: ObjectAccessActor;
  objectKind: ObjectAccessObjectKind;
  sourceId?: string | null;
  /** Filename offered to the browser; the object is always an attachment. */
  filename?: string;
  requestHeaders: Headers;
  /** Merged into the response (the widget path needs its CORS headers). */
  responseHeaders?: HeadersInit;
}

/** How long the app's own fetch of the object stays valid. Seconds. */
const INTERNAL_URL_TTL = 60;

/**
 * Starts a write and keeps the invocation alive for it. `after` is what stops
 * a serverless function being frozen with the insert still in flight, but it
 * needs a request scope, and the stream can end after that scope has closed
 * (a cancelled download) or outside one entirely (a test). Falling back to a
 * plain promise there is the right answer: the write still happens, it just
 * has no host guaranteeing it time.
 */
function keepAlive(work: Promise<void>): void {
  try {
    after(work);
  } catch {
    void work;
  }
}

/**
 * The ledger half of a delivery, assembled once. Three routes were building
 * the same six fields plus the same service-role-or-fall-back choice, which is
 * a type asking to exist: the ledger must be written by the service-role
 * client, because a Member editing their own audit trail is the thing an
 * append-only table exists to prevent.
 */
export function objectAccessLedger(input: {
  /** Fallback when object storage is unconfigured (demo and self-host without it). */
  db: Db;
  serviceDb: Db | null;
  actor: ObjectAccessActor;
  objectKind: ObjectAccessObjectKind;
  path: string;
  sourceId?: string | null;
  requestHeaders: Headers;
}): LedgerContext {
  return {
    db: input.serviceDb ?? input.db,
    actor: input.actor,
    objectKind: input.objectKind,
    path: input.path,
    sourceId: input.sourceId ?? null,
    requestHeaders: input.requestHeaders,
  };
}

/** What every ledger write and every delivery share. */
export type LedgerContext = Pick<
  DeliverObjectInput,
  "db" | "actor" | "objectKind" | "path" | "sourceId" | "requestHeaders"
>;

export async function recordObjectAccess(
  input: LedgerContext & { result: ObjectAccessResult; bytes?: number | null }
): Promise<void> {
  try {
    await input.db.recordObjectAccess({
      organizationId: input.actor.organizationId,
      actorKind: input.actor.kind,
      actorId: input.actor.id ?? null,
      objectKind: input.objectKind,
      objectPath: input.path,
      sourceId: input.sourceId ?? null,
      result: input.result,
      bytes: input.bytes ?? null,
      ip: clientAddress(input.requestHeaders),
      userAgent: input.requestHeaders.get("user-agent"),
      requestId:
        input.requestHeaders.get("x-request-id") ??
        input.requestHeaders.get("x-vercel-id"),
    });
  } catch (error) {
    console.error("[object-access] ledger write failed:", error);
  }
}

/**
 * Streams the object to the caller and records the transfer. Returns null when
 * the object could not be fetched, so the caller answers with its own refusal
 * shape (the widget's uniform 404, the admin's error) rather than one invented
 * here; the failure is already on the ledger by then.
 */
export async function deliverObject(
  input: DeliverObjectInput
): Promise<Response | null> {
  const { data, error } = await input.storage.storage
    .from(input.bucket)
    .createSignedUrl(input.path, INTERNAL_URL_TTL, { download: true });
  if (error || !data?.signedUrl) {
    await recordObjectAccess({ ...input, result: "failed" });
    return null;
  }

  const upstream = await fetch(data.signedUrl).catch(() => null);
  if (!upstream?.ok || !upstream.body) {
    await recordObjectAccess({ ...input, result: "failed" });
    return null;
  }

  let bytes = 0;
  // Written once, whichever way the stream ends. A transfer the client aborts
  // is exactly the case an access ledger should record, and recording it only
  // on `flush` meant an interrupted download left no row at all. It is
  // recorded as `aborted`, not `failed`: `failed` means our side broke and is
  // not a security event, while a caller who takes most of every original
  // and cancels has moved the bytes, and the bulk-download rule counts it.
  let recorded = false;
  const record = (result: ObjectAccessResult) => {
    if (recorded) return;
    recorded = true;
    keepAlive(recordObjectAccess({ ...input, result, bytes }));
  };

  // A hand-rolled pump rather than a TransformStream, because the case worth
  // recording is the one a transformer's `flush` never sees: the client going
  // away mid-download. `cancel` is where that lands.
  const reader = upstream.body.getReader();
  const counted = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          record("served");
          controller.close();
          return;
        }
        bytes += value.byteLength;
        controller.enqueue(value);
      } catch (error) {
        record("failed");
        controller.error(error);
      }
    },
    cancel(reason) {
      record("aborted");
      return reader.cancel(reason);
    },
  });

  const headers = new Headers(input.responseHeaders);
  headers.set(
    "content-type",
    upstream.headers.get("content-type") ?? "application/octet-stream"
  );
  // Only when the body is being passed through unchanged. `fetch` transparently
  // inflates a `content-encoding: gzip` response, so copying the compressed
  // length onto the inflated stream would truncate the download.
  const length = upstream.headers.get("content-length");
  if (length && !upstream.headers.get("content-encoding")) {
    headers.set("content-length", length);
  }
  // Always an attachment, never inline: an original that renders in the
  // browser is an original that can run script on this origin.
  headers.set(
    "content-disposition",
    `attachment; filename="${(input.filename ?? "download").replace(/["\\\r\n]/g, "")}"`
  );
  headers.set("cache-control", "private, no-store");

  return new Response(counted, { status: 200, headers });
}
