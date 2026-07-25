import { NextRequest } from "next/server";
import { listEscalationDesks } from "@/lib/escalation-desks";
import { resolveWidgetContext, widgetOptions } from "@/lib/widget-db";

/**
 * The escalation menu data for the published widget: the help desks this
 * assistant offers (helpDeskSettings.selectedIds from the Publication
 * snapshot) with their enabled support channels. The widget-safe mapping
 * lives in @/lib/escalation-desks, shared with the editor Preview.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assistantId: string }> }
) {
  const ctx = await resolveWidgetContext(request, params);
  if (ctx instanceof Response) return ctx;
  const { db, publication, cors } = ctx;
  const config = publication.config;

  const payload = await listEscalationDesks(
    db,
    config.assistant.organizationId,
    config.assistant.helpDeskSettings?.selectedIds ?? []
  );

  return Response.json({ helpDesks: payload }, { headers: cors });
}

export const OPTIONS = widgetOptions;
