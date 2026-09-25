import "server-only";

import { createHash } from "node:crypto";
import {
  openSecret,
  type ProviderConnection,
  type VoiceModelRef,
  type VoiceProvider,
  type VoiceLanguage,
} from "@agent-hub/core";
import { voicePronunciation } from "@/lib/voice-languages";

export type VoiceCatalogModel = VoiceModelRef & {
  label: string;
  kind: "transcription" | "speech";
  languageCodes?: string[];
};
export type VoiceCatalogVoice = {
  provider: VoiceProvider;
  id: string;
  name: string;
  description: string;
  modelIds?: string[];
};
export type VoiceCatalog = {
  models: VoiceCatalogModel[];
  voices: VoiceCatalogVoice[];
  errors: string[];
};

const PROVIDERS: VoiceProvider[] = ["google", "openai", "elevenlabs"];
const NAMES: Record<VoiceProvider, string> = {
  google: "Google AI Studio", openai: "OpenAI", elevenlabs: "ElevenLabs",
};
const ENV: Record<VoiceProvider, string> = {
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  openai: "OPENAI_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
};
const GOOGLE = "https://generativelanguage.googleapis.com/v1beta";
const OPENAI = "https://api.openai.com/v1";
const ELEVEN = "https://api.elevenlabs.io";
const cache = new Map<string, { expires: number; value: Promise<VoiceCatalog> }>();

type Json = Record<string, unknown>;
const object = (value: unknown): Json =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const rows = (value: unknown): Json[] => Array.isArray(value) ? value.map(object) : [];
const string = (value: unknown): string => typeof value === "string" ? value : "";

/** The caller supplies connections from its authenticated organization only. */
function credential(connections: ProviderConnection[], provider: VoiceProvider): string | undefined {
  for (const connection of connections) {
    if (connection.provider !== provider || connection.type !== "api_key" || !connection.encryptedKey) continue;
    try {
      const key = openSecret(connection.encryptedKey).trim();
      if (key) return key;
    } catch {
      // Match runtime resolution when an old connection cannot be decrypted.
    }
  }
  return process.env[ENV[provider]]?.trim() || undefined;
}

function headers(provider: VoiceProvider, key: string): Record<string, string> {
  if (provider === "google") return { "x-goog-api-key": key };
  if (provider === "elevenlabs") return { "xi-api-key": key };
  return { Authorization: `Bearer ${key}` };
}

/** Never relay provider response bodies: they can include secrets or input text. */
async function request(provider: VoiceProvider, url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: "no-store", redirect: "error" });
  } catch {
    if (init.signal?.aborted) throw new Error("The voice request was cancelled or timed out.");
    throw new Error(`${NAMES[provider]} could not be reached. Please try again.`);
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) {
      throw new Error(`${NAMES[provider]} denied access. Check the connected API key and its permissions.`);
    }
    if (response.status === 429) throw new Error(`${NAMES[provider]} has reached its usage limit. Check billing or try again later.`);
    if (response.status === 400 || response.status === 404 || response.status === 422) {
      throw new Error(`${NAMES[provider]} could not process this voice request. Refresh the available models and check the audio format.`);
    }
    throw new Error(`${NAMES[provider]} is temporarily unavailable. Please try again.`);
  }
  return response;
}

async function json(provider: VoiceProvider, url: string, init: RequestInit): Promise<unknown> {
  const response = await request(provider, url, init);
  try { return await response.json(); }
  catch { throw new Error(`${NAMES[provider]} returned an unreadable response. Please try again.`); }
}

function modelKind(provider: VoiceProvider, id: string): VoiceCatalogModel["kind"] | undefined {
  if (provider === "google") {
    if (/^gemini-\d+(?:\.\d+)?-transcribe(?:-preview(?:-[\w-]+)?)?$/.test(id)) return "transcription";
    if (/^gemini-[\w.-]*tts(?:-preview(?:-[\w-]+)?)?$/.test(id)) return "speech";
  } else if (provider === "openai") {
    if (/^(?:whisper-1|gpt-transcribe|gpt-4o-(?:mini-)?transcribe)(?:-\d{4}-\d{2}-\d{2})?$/.test(id)) return "transcription";
    if (/^(?:tts-1(?:-hd)?|gpt-4o-mini-tts)(?:-\d{4}-\d{2}-\d{2}|-\d{4})?$/.test(id)) return "speech";
  } else {
    if (/^scribe_v\d+$/.test(id)) return "transcription";
    if (/^eleven_[a-z0-9_]+$/.test(id)) return "speech";
  }
}

const GOOGLE_PREBUILT: Record<string, string> = {
  Zephyr: "Bright", Puck: "Upbeat", Charon: "Informative", Kore: "Firm",
  Fenrir: "Excitable", Leda: "Youthful", Orus: "Firm", Aoede: "Breezy",
  Callirrhoe: "Easy-going", Autonoe: "Bright", Enceladus: "Breathy", Iapetus: "Clear",
  Umbriel: "Easy-going", Algieba: "Smooth", Despina: "Smooth", Erinome: "Clear",
  Algenib: "Gravelly", Rasalgethi: "Informative", Laomedeia: "Upbeat", Achernar: "Soft",
  Alnilam: "Firm", Schedar: "Even", Gacrux: "Mature", Pulcherrima: "Forward",
  Achird: "Friendly", Zubenelgenubi: "Casual", Vindemiatrix: "Gentle",
  Sadachbia: "Lively", Sadaltager: "Knowledgeable", Sulafat: "Warm",
};
const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer", "verse", "marin", "cedar"];
const OPENAI_LEGACY_VOICES = new Set(["alloy", "ash", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer"]);
const modernGoogleSpeech = (id: string) => !/^gemini-(?:2\.5|3\.1)-/.test(id);

async function providerCatalog(provider: VoiceProvider, key: string): Promise<VoiceCatalog> {
  const result: VoiceCatalog = { models: [], voices: [], errors: [] };
  const professionalVoiceModels = new Set<string>();
  const init = { headers: headers(provider, key), signal: AbortSignal.timeout(20_000) };
  try {
    if (provider === "google") {
      let page = "";
      const seen = new Set<string>();
      do {
        const data = object(await json(provider, `${GOOGLE}/models?pageSize=1000${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`, init));
        for (const model of rows(data.models)) {
          const modelId = string(model.name).replace(/^models\//, "");
          const kind = modelKind(provider, modelId);
          if (kind) result.models.push({ provider, modelId, kind, label: string(model.displayName) || modelId });
        }
        page = string(data.nextPageToken);
        if (seen.has(page)) break;
        seen.add(page);
      } while (page);
    } else if (provider === "openai") {
      const data = object(await json(provider, `${OPENAI}/models`, init));
      for (const model of rows(data.data)) {
        const modelId = string(model.id);
        const kind = modelKind(provider, modelId);
        if (kind) result.models.push({ provider, modelId, kind, label: modelId });
      }
    } else {
      // /models is also public. Verify the credential before exposing account
      // capabilities, including Scribe (not consistently returned by /models).
      await json(provider, `${ELEVEN}/v1/user`, init);
      const data = await json(provider, `${ELEVEN}/v1/models`, init);
      for (const model of rows(data)) {
        const modelId = string(model.model_id);
        const kind = modelKind(provider, modelId);
        if (kind && (kind === "transcription" || model.can_do_text_to_speech === true)) {
          const languageCodes = rows(model.languages).map((language) => string(language.language_id)).filter(Boolean);
          result.models.push({ provider, modelId, kind, label: string(model.name) || modelId,
            ...(kind === "speech" ? { languageCodes } : {}),
          });
          if (kind === "speech" && model.serves_pro_voices === true) professionalVoiceModels.add(modelId);
        }
      }
      // Official batch STT endpoint: /docs/api-reference/speech-to-text/convert.
      // Like listed TTS models, this confirms support, not remaining quota.
      if (!result.models.some((model) => model.modelId === "scribe_v2")) {
        result.models.push({ provider, modelId: "scribe_v2", kind: "transcription", label: "Scribe v2" });
      }
    }
  } catch (error) {
    return { models: [], voices: [], errors: [error instanceof Error ? error.message : `${NAMES[provider]} catalog could not be loaded.`] };
  }
  const speechModels = result.models.filter((model) => model.kind === "speech").map((model) => model.modelId);
  if (!speechModels.length) return result;
  if (provider === "openai") {
    result.voices = OPENAI_VOICES.map((id) => ({
      provider, id, name: id[0].toUpperCase() + id.slice(1), description: "OpenAI built-in voice · Multilingual",
      modelIds: speechModels.filter((model) => !model.startsWith("tts-1") || OPENAI_LEGACY_VOICES.has(id)),
    })).filter((voice) => voice.modelIds.length > 0);
    return result;
  }
  // These documented studio voices work across all Gemini TTS generations.
  if (provider === "google") result.voices = Object.entries(GOOGLE_PREBUILT).map(([id, description]) => ({ provider, id, name: id, description, modelIds: speechModels }));
  try {
    let page = "";
    const seen = new Set<string>();
    do {
      const url = provider === "google"
        ? `${GOOGLE}/voices?page_size=1000${page ? `&page_token=${encodeURIComponent(page)}` : ""}`
        : `${ELEVEN}/v2/voices?page_size=100${page ? `&next_page_token=${encodeURIComponent(page)}` : ""}`;
      const data = object(await json(provider, url, init));
      for (const voice of rows(data.voices)) {
        const id = string(provider === "google" ? voice.id : voice.voice_id);
        if (!id || result.voices.some((v) => v.id === id)) continue;
        const isProfessional = voice.category === "professional" || object(voice.sharing).category === "professional";
        const fineTuningStates = object(object(voice.fine_tuning).state);
        const modelIds = provider === "google"
          ? speechModels.filter(modernGoogleSpeech)
          : speechModels.filter((modelId) => !isProfessional || (
            professionalVoiceModels.has(modelId) && fineTuningStates[modelId] === "fine_tuned"
          ));
        // Professional clones are trained separately for each model. A voice
        // still queued, unverified or training is not a usable selection.
        if (!modelIds.length) continue;
        result.voices.push({
          provider, id, name: string(voice.display_name) || string(voice.name) || id,
          description: string(voice.description) || Object.values(object(voice.labels)).filter((label) => typeof label === "string").join(" · "),
          modelIds,
        });
      }
      page = string(data.next_page_token);
      if (seen.has(page)) break;
      seen.add(page);
    } while (page);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : `${NAMES[provider]} voices could not be loaded.`);
  }
  return result;
}

/** Live, credential-scoped discovery. Never cache credentials or synthesized audio. */
export async function getVoiceCatalog(connections: ProviderConnection[]): Promise<VoiceCatalog> {
  const catalogs = await Promise.all(PROVIDERS.map(async (provider) => {
    const key = credential(connections, provider);
    if (!key) return { models: [], voices: [], errors: [] } as VoiceCatalog;
    const fingerprint = createHash("sha256").update(`${provider}\0${key}`).digest("hex");
    const existing = cache.get(fingerprint);
    if (existing && existing.expires > Date.now()) return existing.value;
    for (const [id, entry] of cache) if (entry.expires <= Date.now()) cache.delete(id);
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    const value = providerCatalog(provider, key);
    cache.set(fingerprint, { expires: Date.now() + 60_000, value });
    return value;
  }));
  return {
    models: catalogs.flatMap((catalog) => catalog.models),
    voices: catalogs.flatMap((catalog) => catalog.voices),
    errors: catalogs.flatMap((catalog) => catalog.errors),
  };
}

function ready(connections: ProviderConnection[], model: VoiceModelRef, kind: VoiceCatalogModel["kind"], signal: AbortSignal) {
  if (!PROVIDERS.includes(model.provider) || modelKind(model.provider, model.modelId) !== kind) throw new Error("Select a supported voice model in General settings.");
  const key = credential(connections, model.provider);
  if (!key) throw new Error(`Connect a ${NAMES[model.provider]} API key to use this voice model.`);
  return { headers: headers(model.provider, key), signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]) };
}

function interactionContent(data: Json): Json[] {
  // REST returns steps; output_text/output_audio are SDK convenience properties.
  return rows(data.steps).filter((step) => step.type === "model_output").flatMap((step) => rows(step.content));
}

export async function transcribeVoice(connections: ProviderConnection[], model: VoiceModelRef, file: File, signal: AbortSignal, language: VoiceLanguage = "auto"): Promise<string> {
  const init = ready(connections, model, "transcription", signal);
  if (file.size === 0 || file.size > 10 * 1024 * 1024) throw new Error("Record audio between 1 byte and 10 MB.");
  let text: string;
  if (model.provider === "google") {
    const sourceMime = file.type.split(";")[0].toLowerCase();
    // Safari records AAC in an MP4 container; Gemini calls that format M4A.
    const mimeType = sourceMime === "audio/mp4" ? "audio/m4a" : sourceMime === "audio/x-wav" ? "audio/wav" : sourceMime;
    const data = object(await json(model.provider, `${GOOGLE}/interactions`, {
      ...init, method: "POST", headers: { ...init.headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.modelId, store: false,
        input: [{ type: "audio", mime_type: mimeType, data: Buffer.from(await file.arrayBuffer()).toString("base64") }],
        // Native ASR preserves the spoken language; never ask a chat model to
        // translate the recording. An empty hint list enables auto detection.
        generation_config: { transcription_config: { language_codes: language === "auto" ? [] : [language] } },
      }),
    }));
    text = string(data.output_text) || interactionContent(data).filter((part) => part.type === "text").map((part) => string(part.text)).join("");
  } else {
    const form = new FormData();
    form.set("file", file);
    form.set(model.provider === "openai" ? "model" : "model_id", model.modelId);
    if (language !== "auto") form.set(model.provider === "openai" ? "language" : "language_code", language);
    if (model.provider === "openai") form.set("response_format", "json");
    else { form.set("tag_audio_events", "false"); form.set("diarize", "false"); }
    const data = object(await json(model.provider, model.provider === "openai" ? `${OPENAI}/audio/transcriptions` : `${ELEVEN}/v1/speech-to-text`, { ...init, method: "POST", body: form }));
    text = string(data.text);
  }
  if (!text.trim()) throw new Error("No speech was detected. Please record your question again.");
  return text.trim();
}

function pcmWave(pcm: Uint8Array, sampleRate = 24000): Uint8Array {
  const result = Buffer.alloc(44 + pcm.byteLength);
  result.write("RIFF", 0); result.writeUInt32LE(36 + pcm.byteLength, 4); result.write("WAVEfmt ", 8);
  result.writeUInt32LE(16, 16); result.writeUInt16LE(1, 20); result.writeUInt16LE(1, 22);
  result.writeUInt32LE(sampleRate, 24); result.writeUInt32LE(sampleRate * 2, 28);
  result.writeUInt16LE(2, 32); result.writeUInt16LE(16, 34); result.write("data", 36);
  result.writeUInt32LE(pcm.byteLength, 40); result.set(pcm, 44);
  return result;
}

export async function synthesizeVoice(connections: ProviderConnection[], model: VoiceModelRef, voiceId: string, text: string, signal: AbortSignal, language: VoiceLanguage = "auto"): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const init = ready(connections, model, "speech", signal);
  if (!voiceId || voiceId.length > 200 || !text.trim() || text.length > 4096) throw new Error("Select a voice and use text between 1 and 4,096 characters.");
  const post = { ...init, method: "POST", headers: { ...init.headers, "Content-Type": "application/json" } };
  const pronunciation = language === "auto" ? undefined : voicePronunciation(language);
  if (model.provider === "google") {
    let audio: Json;
    if (modernGoogleSpeech(model.modelId)) {
      const data = object(await json("google", `${GOOGLE}/interactions`, {
        ...post, body: JSON.stringify({ model: model.modelId, store: false, input: [{ type: "user_input", content: [{ type: "text", text, ...(pronunciation ? { annotations: [{ type: "speech_metadata", style: pronunciation }] } : {}) }] }], response_format: { type: "audio", mime_type: "audio/wav" }, generation_config: { speech_config: [{ voice: voiceId }] } }),
      }));
      audio = interactionContent(data).find((part) => part.type === "audio") || object(data.output_audio);
    } else {
      if (!GOOGLE_PREBUILT[voiceId]) throw new Error("This Google model requires a built-in studio voice.");
      const data = object(await json("google", `${GOOGLE}/models/${encodeURIComponent(model.modelId)}:generateContent`, {
        ...post, body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { ...(language === "auto" ? {} : { languageCode: language }), voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceId } } } } }),
      }));
      const part = rows(object(rows(data.candidates)[0]?.content).parts).find((part) => object(part.inlineData).data);
      const inline = object(part?.inlineData);
      audio = { data: inline.data, mime_type: inline.mimeType };
    }
    const data = string(audio.data);
    if (!data) throw new Error("Google AI Studio did not return audio. Please try again.");
    const bytes = Buffer.from(data, "base64");
    const mimeType = string(audio.mime_type) || "audio/wav";
    if (/audio\/(?:L16|pcm)/i.test(mimeType)) {
      const rate = Number(/rate=(\d+)/.exec(mimeType)?.[1] || 24000);
      return { bytes: pcmWave(bytes, rate), mimeType: "audio/wav" };
    }
    return { bytes, mimeType };
  }
  if (model.provider === "openai" && (!OPENAI_VOICES.includes(voiceId) || (model.modelId.startsWith("tts-1") && !OPENAI_LEGACY_VOICES.has(voiceId)))) throw new Error("This voice is not supported by the selected OpenAI model.");
  const response = await request(model.provider, model.provider === "openai" ? `${OPENAI}/audio/speech` : `${ELEVEN}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    ...post, body: JSON.stringify(model.provider === "openai"
      ? { model: model.modelId, voice: voiceId, input: text, response_format: "mp3", ...(pronunciation && !model.modelId.startsWith("tts-1") ? { instructions: pronunciation } : {}) }
      : { model_id: model.modelId, text, ...(language !== "auto" && model.modelId !== "eleven_multilingual_v2" ? { language_code: language } : {}) }),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new Error(`${NAMES[model.provider]} did not return audio. Please try again.`);
  return { bytes, mimeType: "audio/mpeg" };
}
