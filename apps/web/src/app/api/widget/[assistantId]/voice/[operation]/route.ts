import { messageText } from "@agent-hub/core";
import { NextRequest } from "next/server";
import { resolveWidgetContext, widgetOptions, widgetSubject, subjectOwnsConversation } from "@/lib/widget-db";
import { checkVoiceRate, readVoiceBody, runVoiceRequest, voiceErrorResponse, VoiceRequestError } from "@/lib/voice-http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: NextRequest, { params }: { params: Promise<{ assistantId: string; operation: string }> }) {
  let headers: HeadersInit = {};
  try {
    const ctx = await resolveWidgetContext(request, params);
    if (ctx instanceof Response) return ctx;
    headers = ctx.cors;
    const origin = request.headers.get("origin");
    // Widget runs in Ciele's iframe; cross-origin callers must satisfy its allow-list.
    if (origin && origin !== request.nextUrl.origin && new Headers(headers).get("Access-Control-Allow-Origin") === "null") throw new VoiceRequestError("Forbidden", 403);
    const assistant = ctx.publication.config.assistant;
    if (!assistant.voice?.enabled) throw new VoiceRequestError("Voice mode is disabled", 404);
    const gated = widgetSubject(request, assistant.organizationId, "");
    if (assistant.requireSignIn && !gated.gate) throw new VoiceRequestError("Sign in to use voice mode", 401);
    checkVoiceRate(request, assistant.organizationId, gated.id || undefined);
    const { operation } = await params;
    const body = await readVoiceBody(request, operation);
    if (!gated.gate && (!body.visitorId || body.visitorId.length > 200)) throw new VoiceRequestError("Missing visitor identity");
    if (operation === "speech") {
      const subject = widgetSubject(request, assistant.organizationId, body.visitorId);
      const conversation = await ctx.db.getConversation(body.conversationId);
      if (!subjectOwnsConversation(conversation, assistant.id, subject)) throw new VoiceRequestError("Message not found", 404);
      const message = (await ctx.db.listMessages(conversation.id)).find((entry) => entry.id === body.messageId && entry.role === "assistant");
      if (!message) throw new VoiceRequestError("Message not found", 404);
      body.text = messageText(message.content);
      body.sample = false;
    }
    const connections = await ctx.db.listProviderConnections(assistant.organizationId);
    return await runVoiceRequest({ body, operation, settings: assistant.voice, connections, signal: request.signal, headers });
  } catch (error) { return voiceErrorResponse(error, headers); }
}
export const OPTIONS = widgetOptions;
