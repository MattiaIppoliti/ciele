import "server-only";
import type { AssistantVoiceSettings, ProviderConnection, VoiceModelRef } from "@agent-hub/core";
import type { NextRequest } from "next/server";
import { createRateLimiter, clientAddress } from "@/lib/rate-limit";
import { getVoiceCatalog, synthesizeVoice, transcribeVoice } from "@/lib/voice-providers";
import { availableVoiceLanguages, isVoiceLanguage, selectedVoiceLanguage, voiceSample } from "@/lib/voice-languages";

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_AUDIO_BYTES + 64 * 1024;
const callerLimit = createRateLimiter({ limit: 12, windowMs: 60_000 });
const orgLimit = createRateLimiter({ limit: 120, windowMs: 60_000 });
export const VOICE_SAMPLE_TEXT = voiceSample("auto");

export class VoiceRequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function checkVoiceRate(request: NextRequest, organizationId: string, subject?: string) {
  // The address bucket also bounds anonymous callers that rotate visitor IDs.
  for (const allowed of [
    callerLimit.check(`${organizationId}:${clientAddress(request.headers)}`),
    ...(subject ? [callerLimit.check(`${organizationId}:subject:${subject}`)] : []),
    orgLimit.check(organizationId),
  ]) {
    if (!allowed.allowed) throw new VoiceRequestError("Too many voice requests. Try again in a minute.", 429);
  }
}

/** Bound streamed requests too: Content-Length is not authoritative. */
export async function readVoiceBody(request: NextRequest, operation: string) {
  if (operation !== "transcribe" && operation !== "speech") throw new VoiceRequestError("Not found", 404);
  const max = operation === "transcribe" ? MAX_BODY_BYTES : 32_000;
  if (Number(request.headers.get("content-length")) > max) throw new VoiceRequestError("Audio is too large. Record a shorter message.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new VoiceRequestError("Missing request body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new VoiceRequestError("Request is too large", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const body = new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } });
  try {
    if (operation === "transcribe") {
      const form = await body.formData();
      return { assistantId: String(form.get("assistantId") ?? ""), visitorId: String(form.get("visitorId") ?? ""), file: form.get("file"), conversationId: "", messageId: "", text: undefined, sample: false, model: undefined, voiceId: undefined, language: undefined };
    }
    const json: unknown = await body.json();
    if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error();
    const value = json as Record<string, unknown>;
    return { assistantId: typeof value.assistantId === "string" ? value.assistantId : "", visitorId: typeof value.visitorId === "string" ? value.visitorId : "", file: null, conversationId: typeof value.conversationId === "string" ? value.conversationId : "", messageId: typeof value.messageId === "string" ? value.messageId : "", text: value.text, sample: value.sample === true, model: value.model, voiceId: value.voiceId, language: value.language };
  } catch { throw new VoiceRequestError("Invalid voice request"); }
}

export async function validateVoiceSelection(connections: ProviderConnection[], settings: AssistantVoiceSettings) {
  if (!settings.enabled) return;
  const catalog = await getVoiceCatalog(connections);
  for (const kind of ["transcription", "speech"] as const) {
    const selected = settings[kind];
    if (!catalog.models.some((m) => m.kind === kind && m.provider === selected.provider && m.modelId === selected.modelId)) {
      throw new VoiceRequestError(`The selected ${kind} model is unavailable. Check your API connection in Settings.`, 422);
    }
  }
  if (!catalog.voices.some((v) => v.provider === settings.speech.provider && v.id === settings.voiceId && (!v.modelIds || v.modelIds.includes(settings.speech.modelId)))) {
    throw new VoiceRequestError("The selected voice is unavailable. Choose another voice.", 422);
  }
  const speechModel = catalog.models.find((model) => model.kind === "speech" && model.provider === settings.speech.provider && model.modelId === settings.speech.modelId)!;
  if (!availableVoiceLanguages(speechModel).some((language) => language.value === selectedVoiceLanguage(settings))) {
    throw new VoiceRequestError("The output language is unavailable for this model. Choose another language or Auto.", 422);
  }
}

function parseModel(value: unknown): VoiceModelRef {
  if (!value || typeof value !== "object") throw new VoiceRequestError("Choose a playback model");
  const model = value as Record<string, unknown>;
  if (!["google", "openai", "elevenlabs"].includes(String(model.provider)) || typeof model.modelId !== "string" || !/^[a-zA-Z0-9._-]{1,200}$/.test(model.modelId)) throw new VoiceRequestError("Invalid playback model");
  return model as unknown as VoiceModelRef;
}

export async function runVoiceRequest(input: {
  body: Awaited<ReturnType<typeof readVoiceBody>>;
  operation: string;
  settings?: AssistantVoiceSettings;
  connections: ProviderConnection[];
  signal: AbortSignal;
  allowSample?: boolean;
  headers?: HeadersInit;
}) {
  const { body, operation, settings, connections, signal } = input;
  const headers = new Headers(input.headers);
  headers.set("Cache-Control", "no-store");
  let model: VoiceModelRef;
  let voiceId = settings?.voiceId ?? "";
  if (operation === "speech" && body.sample && input.allowSample) {
    model = parseModel(body.model);
    if (typeof body.voiceId !== "string" || !/^[a-zA-Z0-9._-]{1,200}$/.test(body.voiceId)) throw new VoiceRequestError("Choose a voice");
    voiceId = body.voiceId;
  } else {
    if (!settings?.enabled) throw new VoiceRequestError("Voice mode is disabled", 404);
    model = settings[operation === "transcribe" ? "transcription" : "speech"];
  }
  const catalog = await getVoiceCatalog(connections);
  if (!catalog.models.some((m) => m.kind === (operation === "transcribe" ? "transcription" : "speech") && m.provider === model.provider && m.modelId === model.modelId)) {
    throw new VoiceRequestError("The voice model is unavailable. Check the provider connection.", 422);
  }
  if (operation === "transcribe") {
    const file = body.file;
    if (!(file instanceof File) || !file.size || file.size > MAX_AUDIO_BYTES) throw new VoiceRequestError("Record a message smaller than 4 MB", 413);
    const mime = file.type.split(";")[0];
    if (!["audio/webm", "audio/mp4", "audio/m4a", "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/ogg"].includes(mime)) throw new VoiceRequestError("Unsupported audio format", 415);
    const text = (await transcribeVoice(connections, model, file, signal, settings?.inputLanguage ?? "auto")).trim();
    if (!text) throw new VoiceRequestError("No speech detected. Please try again.", 422);
    return Response.json({ text: text.slice(0, 10000) }, { headers });
  }
  if (!catalog.voices.some((v) => v.provider === model.provider && v.id === voiceId && (!v.modelIds || v.modelIds.includes(model.modelId)))) throw new VoiceRequestError("The voice is unavailable", 422);
  const isSample = body.sample && input.allowSample;
  if (isSample && body.language !== undefined && !isVoiceLanguage(body.language)) throw new VoiceRequestError("Choose a supported voice language", 422);
  const selectedLanguage = isSample && isVoiceLanguage(body.language) ? body.language : selectedVoiceLanguage(settings);
  const catalogModel = catalog.models.find((entry) => entry.kind === "speech" && entry.provider === model.provider && entry.modelId === model.modelId)!;
  const language = availableVoiceLanguages(catalogModel).some((entry) => entry.value === selectedLanguage) ? selectedLanguage : "auto";
  const text = isSample ? voiceSample(language) : body.text;
  if (typeof text !== "string" || !text.trim() || text.length > 4000) throw new VoiceRequestError("Audio playback supports up to 4,000 characters per message", 422);
  const audio = await synthesizeVoice(connections, model, voiceId, text.trim(), signal, language);
  headers.set("Content-Type", audio.mimeType);
  return new Response(new Uint8Array(audio.bytes), { headers });
}

export function voiceErrorResponse(error: unknown, headers?: HeadersInit) {
  return Response.json({ error: error instanceof VoiceRequestError ? error.message : "Voice service unavailable. Check the API key, model access and provider quota." }, { status: error instanceof VoiceRequestError ? error.status : 502, headers: { ...Object.fromEntries(new Headers(headers)), "Cache-Control": "no-store" } });
}
