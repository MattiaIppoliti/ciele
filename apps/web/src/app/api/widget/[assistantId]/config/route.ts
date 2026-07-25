import { NextRequest } from "next/server";
import { resolveWidgetContext, widgetOptions } from "@/lib/widget-db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assistantId: string }> }
) {
  const ctx = await resolveWidgetContext(request, params);
  if (ctx instanceof Response) return ctx;

  const { assistant, collections } = ctx.publication.config;
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
