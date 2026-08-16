import { NextRequest } from "next/server";
import { isSupabaseConfigured } from "@agent-hub/db";
import { canServeOriginal } from "@/lib/direct-access";
import { KNOWLEDGE_ORIGINALS_BUCKET } from "@/lib/storage/assets";
import {
  createSupabaseServiceClient,
  isSupabaseServiceConfigured,
} from "@/lib/supabase/service";
import { resolveWidgetContext, widgetOptions } from "@/lib/widget-db";

/**
 * Direct access (PRD #726): hands a chat visitor the original of a cited file
 * Source — but only when the published assistant's link row carries the flag.
 * Every refusal is a uniform 404 so a probing visitor can never learn WHICH
 * leg failed (unpublished / unlinked / flag off / no original). Successful
 * calls redirect to a short-lived signed URL against the private originals
 * bucket — the object itself is never publicly reachable.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assistantId: string; sourceId: string }> }
) {
  const ctx = await resolveWidgetContext(request, params);
  if (ctx instanceof Response) return ctx;
  const { db, cors } = ctx;
  const { assistantId, sourceId } = await params;
  const refuse = () =>
    new Response("Not found", { status: 404, headers: cors });

  const source = await db.getSource(sourceId);
  const links = source ? await db.listSourceAssistantLinks(source.id) : [];
  const link = links.find((l) => l.assistantId === assistantId) ?? null;
  if (
    !canServeOriginal({
      // resolveWidgetContext already refused assistants with no live
      // Publication, so reaching here means published.
      published: true,
      linkDirectAccess: link ? link.directAccess : null,
      source,
    })
  ) {
    return refuse();
  }
  if (!isSupabaseConfigured() || !isSupabaseServiceConfigured()) {
    return refuse();
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service.storage
    .from(KNOWLEDGE_ORIGINALS_BUCKET)
    .createSignedUrl(source!.originalObjectPath!, 600);
  if (error || !data?.signedUrl) return refuse();
  return Response.redirect(data.signedUrl, 302);
}

export const OPTIONS = widgetOptions;
