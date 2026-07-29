import { NextRequest } from "next/server";
import { proactiveDwellSeconds, proactiveTriggers } from "@agent-hub/core";
import { resolveWidgetContext, widgetOptions } from "@/lib/widget-db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assistantId: string }> }
) {
  const ctx = await resolveWidgetContext(request, params);
  if (ctx instanceof Response) return ctx;

  const { assistant, collections, flows } = ctx.publication.config;
  return Response.json(
    {
      version: ctx.publication.version,
      nickname: assistant.nickname || assistant.title,
      avatarUrl: assistant.avatarUrl ?? null,
      welcomeMessage: assistant.welcomeMessage,
      aiDisclaimer: assistant.aiDisclaimer,
      suggestedQuestions: assistant.suggestedQuestions,
      quickReplies: assistant.quickReplies ?? [],
      chatLauncherEnabled: assistant.chatLauncherEnabled,
      style: assistant.style,
      collections,
      // Which proactive triggers this Publication has flows for (#542). The embed
      // arms only these listeners, so an assistant with no proactive flows costs
      // the host page nothing. A capability hint, not an authorization — the
      // runtime re-selects the flows when an event is reported.
      proactiveTriggers: proactiveTriggers(flows),
      // The dwell thresholds the embed must arm a timer for (#547). Distinct and
      // ascending; the server still re-checks each flow's own threshold.
      proactiveDwellSeconds: proactiveDwellSeconds(flows),
    },
    {
      headers: {
        ...ctx.cors,
        // Publication-derived: safe to cache briefly in browsers/CDNs so
        // every host-page view stops paying an origin round-trip. A Publish
        // reaches new visitors immediately and cached ones within max-age.
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        // The CORS headers above depend on the caller's Origin — caches must
        // not serve one origin's response to another.
        Vary: "Origin",
      },
    }
  );
}

export const OPTIONS = widgetOptions;
