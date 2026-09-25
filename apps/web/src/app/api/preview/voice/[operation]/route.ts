import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { checkVoiceRate, readVoiceBody, runVoiceRequest, voiceErrorResponse, VoiceRequestError } from "@/lib/voice-http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: NextRequest, { params }: { params: Promise<{ operation: string }> }) {
  try {
    const session = await getSession();
    if (!session?.organization) throw new VoiceRequestError("Unauthorized", 401);
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) throw new VoiceRequestError("Forbidden", 403);
    checkVoiceRate(request, session.organization.id, session.userId);
    const { operation } = await params;
    const body = await readVoiceBody(request, operation);
    const db = await getDb();
    const assistant = await db.getAssistant(body.assistantId);
    if (!assistant || assistant.organizationId !== session.organization.id) throw new VoiceRequestError("Not found", 404);
    const connections = await db.listProviderConnections(session.organization.id);
    return await runVoiceRequest({ body, operation, settings: assistant.voice, connections, signal: request.signal, allowSample: true });
  } catch (error) { return voiceErrorResponse(error); }
}
