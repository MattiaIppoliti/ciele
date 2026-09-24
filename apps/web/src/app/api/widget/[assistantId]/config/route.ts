import { NextRequest } from "next/server";
import { proactiveDwellSeconds, proactiveTriggers } from "@agent-hub/core";
import { chatModelOptions } from "@agent-hub/agent";
import { resolveWidgetContext, widgetOptions } from "@/lib/widget-db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assistantId: string }> }
) {
  const ctx = await resolveWidgetContext(request, params);
  if (ctx instanceof Response) return ctx;

  const { assistant, collections, flows } = ctx.publication.config;

  // The picker's rows, resolved here rather than in the widget: the client has
  // no business knowing which providers the Organization holds credentials for,
  // and an empty list is the honest answer for every Assistant that never
  // opened the choice. Connections are read live, not off the snapshot, so
  // revoking a credential closes the picker without a republish.
  const connections = await ctx.db.listProviderConnections(
    assistant.organizationId
  );
  const models = chatModelOptions(
    { provider: assistant.modelProvider, modelId: assistant.modelId },
    assistant.allowedModels,
    connections
  );

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
      // the host page nothing. A capability hint, not an authorization, the
      // runtime re-selects the flows when an event is reported.
      proactiveTriggers: proactiveTriggers(flows),
      // The dwell thresholds the embed must arm a timer for (#547). Distinct and
      // ascending; the server still re-checks each flow's own threshold.
      proactiveDwellSeconds: proactiveDwellSeconds(flows),
      models,
    },
    {
      headers: {
        ...ctx.cors,
        // The host-page launcher and model picker may reuse this response for
        // five minutes. After that, they must fetch current Publication and
        // Provider Connection data; stale-while-revalidate could serve an old
        // launcher for another hour after Publish. The chat route still checks
        // a selected model against live connections on every turn.
        "Cache-Control": "public, max-age=300, must-revalidate",
        // The CORS headers above depend on the caller's Origin, caches must
        // not serve one origin's response to another.
        Vary: "Origin",
      },
    }
  );
}

export const OPTIONS = widgetOptions;
