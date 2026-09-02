import { NextRequest } from "next/server";
import { isSupabaseConfigured } from "@agent-hub/db";
import { canServeOriginal } from "@/lib/direct-access";
import { KNOWLEDGE_ORIGINALS_BUCKET } from "@/lib/storage/assets";
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
import {
  resolveWidgetContext,
  widgetOptions,
  widgetSubject,
} from "@/lib/widget-db";
import { clientAddress, createRateLimiter } from "@/lib/rate-limit";

/**
 * Per-address budget for this route (#801, review of CYB-05). The route is
 * reachable without any session, and every refused probe used to append a
 * service-role row to the append-only ledger, which handed an anonymous loop
 * unbounded writes into the very table that exists to make probes visible.
 * Thirty per ten minutes is far above a person clicking citations and far
 * below a flood; past it the request is refused *without* a ledger row, so
 * the flood stays bounded in the audit too, its first thirty rows are the
 * evidence, and the widget's other traffic is untouched.
 */
const downloadLimiter = createRateLimiter({ limit: 30, windowMs: 10 * 60 * 1000 });

/**
 * Direct access (PRD #726): hands a chat visitor the original of a cited file
 * Source: but only when the published assistant's link row carries the flag.
 * Every refusal is a uniform 404 so a probing visitor can never learn WHICH
 * leg failed (unpublished / unlinked / flag off / no original).
 *
 * The bytes are streamed through this route rather than handed over as a
 * signed-URL redirect (#801, CYB-05). A redirect leaves no evidence: the URL
 * lives on in a browser history, can be shared inside its window, and may
 * never be fetched at all. Standing in the path is what makes the ledger row
 * say a transfer happened, and how many bytes it was.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assistantId: string; sourceId: string }> }
) {
  const ctx = await resolveWidgetContext(request, params);
  if (ctx instanceof Response) return ctx;
  const { db, cors, publication } = ctx;
  if (!downloadLimiter.check(clientAddress(request.headers)).allowed) {
    return new Response("Too many requests", { status: 429, headers: ctx.cors });
  }
  const { assistantId, sourceId } = await params;
  const organizationId = publication.config.assistant.organizationId;
  const refuse = () => new Response("Not found", { status: 404, headers: cors });

  const source = await db.getSource(sourceId);
  const links = source ? await db.listSourceAssistantLinks(source.id) : [];
  const link = links.find((l) => l.assistantId === assistantId) ?? null;
  const allowed = canServeOriginal({
    // resolveWidgetContext already refused assistants with no live
    // Publication, so reaching here means published.
    published: true,
    linkDirectAccess: link ? link.directAccess : null,
    source,
  });

  const serviceConfigured = isSupabaseConfigured() && isSupabaseServiceConfigured();
  // The signed-in subject when the widget carries an SSO gate cookie, which is
  // a verified identity. Otherwise the anonymous visitor id the widget sends
  // with the link, which is caller-supplied and therefore a correlation hint
  // and not an identity: it groups one browser's downloads, and a caller who
  // wants to look like several can. What the row is evidence of either way is
  // the object, the IP, the time and the byte count.
  const subject = widgetSubject(
    request,
    organizationId,
    request.nextUrl.searchParams.get("visitorId")?.trim() || "anonymous"
  );
  const ledger = objectAccessLedger({
    db,
    serviceDb: serviceConfigured ? getServiceRoleDb() : null,
    actor: { organizationId, kind: "visitor", id: subject.id },
    objectKind: "knowledge_original",
    path: source?.originalObjectPath ?? `source:${sourceId}`,
    sourceId,
    requestHeaders: request.headers,
  });

  // A refusal is the event worth counting: repeated ones from one address are
  // what a probe looks like, and nothing recorded them before.
  if (!allowed) {
    await recordObjectAccess({ ...ledger, result: "refused" });
    return refuse();
  }
  if (!serviceConfigured) return refuse();

  const response = await deliverObject({
    ...ledger,
    storage: createSupabaseServiceClient(),
    bucket: KNOWLEDGE_ORIGINALS_BUCKET,
    filename: source!.name,
    responseHeaders: cors,
  });
  return response ?? refuse();
}

export const OPTIONS = widgetOptions;
