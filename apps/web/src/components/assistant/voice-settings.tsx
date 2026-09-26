"use client";

import { useEffect, useRef, useState } from "react";
import type { AssistantVoiceSettings, VoiceModelRef, VoiceProvider } from "@agent-hub/core";
import { Button, Card, Badge } from "@agent-hub/ui";
import { Play, Square, RefreshCw, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/lib/toast";
import type { VoiceCatalog } from "@/lib/voice-providers";
import { availableVoiceLanguages, isVoiceLanguage, selectedVoiceLanguage, voiceSample, VOICE_LANGUAGES } from "@/lib/voice-languages";

export const EMPTY_VOICE_SETTINGS: AssistantVoiceSettings = {
  enabled: false,
  transcription: { provider: "google", modelId: "" },
  speech: { provider: "google", modelId: "" },
  voiceId: "",
  inputLanguage: "auto",
  outputLanguage: "auto",
};
const PROVIDER_LABEL: Record<VoiceProvider, string> = { google: "Google AI Studio", openai: "OpenAI", elevenlabs: "ElevenLabs" };
const modelKey = (model: VoiceModelRef) => `${model.provider}:${model.modelId}`;

export function VoiceSettings({ assistantId, value, onChange }: {
  assistantId: string;
  value: AssistantVoiceSettings;
  onChange: (settings: AssistantVoiceSettings) => void;
}) {
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [playing, setPlaying] = useState<string | null>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  const playback = useRef<{ audio?: HTMLAudioElement; url?: string; controller?: AbortController }>({});

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/assistants/${encodeURIComponent(assistantId)}/voice`, { signal: controller.signal })
      .then(async (res) => { if (!res.ok) throw new Error("Could not load voice models"); return res.json() as Promise<VoiceCatalog>; })
      .then((result) => { setCatalog(result); setLoadError(""); })
      .catch((error) => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Could not load voice models"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [assistantId, revision]);

  useEffect(() => () => {
    playback.current.controller?.abort();
    playback.current.audio?.pause();
    if (playback.current.url) URL.revokeObjectURL(playback.current.url);
  }, []);

  function stopPreview() {
    playback.current.controller?.abort();
    playback.current.audio?.pause();
    if (playback.current.url) URL.revokeObjectURL(playback.current.url);
    playback.current = {};
    setPlaying(null);
    setPreparing(null);
  }

  const transcription = catalog?.models.filter((model) => model.kind === "transcription") ?? [];
  const speech = catalog?.models.filter((model) => model.kind === "speech") ?? [];
  const compatibleVoices = catalog?.voices.filter((voice) => voice.provider === value.speech.provider && (!voice.modelIds || voice.modelIds.includes(value.speech.modelId))) ?? [];
  const voices = compatibleVoices.slice(0, 3);
  const currentVoice = compatibleVoices.find((voice) => voice.id === value.voiceId);
  // Keep an existing selection visible without increasing the three-choice limit.
  if (currentVoice && !voices.includes(currentVoice)) voices[voices.length - 1] = currentVoice;
  const playbackModel = speech.find((model) => modelKey(model) === modelKey(value.speech)) ?? value.speech;
  const languages = availableVoiceLanguages(playbackModel);
  const savedOutputLanguage = selectedVoiceLanguage(value);
  const outputLanguage = languages.some((language) => language.value === savedOutputLanguage) ? savedOutputLanguage : "auto";
  const connected = transcription.length > 0 && speech.length > 0;
  const selectedVoice = voices.find((voice) => voice.id === value.voiceId);

  function enable(enabled: boolean) {
    stopPreview();
    const input = transcription.find((m) => modelKey(m) === modelKey(value.transcription)) ?? transcription[0];
    const output = speech.find((m) => modelKey(m) === modelKey(value.speech)) ?? speech[0];
    onChange({
      ...value, enabled,
      transcription: input ? { provider: input.provider, modelId: input.modelId } : value.transcription,
      speech: output ? { provider: output.provider, modelId: output.modelId } : value.speech,
      voiceId: catalog?.voices.find((v) => v.provider === output?.provider && (!v.modelIds || v.modelIds.includes(output.modelId)) && v.id === value.voiceId)?.id
        ?? catalog?.voices.find((v) => v.provider === output?.provider && (!v.modelIds || v.modelIds.includes(output.modelId)))?.id ?? "",
    });
  }

  function selectModel(kind: "transcription" | "speech", key: string) {
    const model = catalog?.models.find((m) => m.kind === kind && modelKey(m) === key);
    if (!model) return;
    stopPreview();
    onChange({ ...value, [kind]: { provider: model.provider, modelId: model.modelId },
      ...(kind === "speech" ? { outputLanguage: availableVoiceLanguages(model).some((language) => language.value === (value.outputLanguage ?? "auto")) ? value.outputLanguage ?? "auto" : "auto", voiceId: catalog?.voices.find((v) => v.provider === model.provider && (!v.modelIds || v.modelIds.includes(model.modelId)) && v.id === value.voiceId)?.id
        ?? catalog?.voices.find((v) => v.provider === model.provider && (!v.modelIds || v.modelIds.includes(model.modelId)))?.id ?? "" } : {}),
    });
  }

  async function preview(voiceId: string) {
    const wasActive = playing === voiceId || preparing === voiceId;
    stopPreview();
    if (wasActive) return;
    const controller = new AbortController();
    playback.current.controller = controller;
    setPreparing(voiceId);
    try {
      const response = await fetch("/api/preview/voice/speech", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ assistantId, sample: true, model: value.speech, voiceId, language: outputLanguage }),
      });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || "Voice preview unavailable"); }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      playback.current = { audio, url, controller };
      audio.onended = stopPreview;
      audio.onerror = () => { stopPreview(); toast.error("This audio could not be played"); };
      await audio.play();
      if (!controller.signal.aborted) { setPreparing(null); setPlaying(voiceId); }
    } catch (error) {
      if (!controller.signal.aborted) { stopPreview(); toast.error(error instanceof Error ? error.message : "Voice preview unavailable"); }
    }
  }

  return (
    <Card size="sm" className="gap-0 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Voice mode</h2>
          <p className="text-muted-foreground mt-1 text-sm">Enable microphone input and AI-generated audio playback.</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Badge variant="outline" className="rounded-full">{value.enabled ? "Active" : "Inactive"}</Badge>
          <Switch aria-label="Enable voice mode" checked={value.enabled} onCheckedChange={enable} disabled={!value.enabled && (!connected || loading)} />
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{loading ? "Loading models from your connected providers…" : "Models available through your connected API keys."}</span>
        <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={() => { setLoading(true); setRevision((n) => n + 1); }}>
          <RefreshCw className="size-3.5" /> Refresh
        </Button>
      </div>
      {loadError && <p role="alert" className="mt-2 text-sm text-destructive">{loadError}</p>}
      {catalog?.errors.map((error) => <p key={error} className="mt-2 text-sm text-muted-foreground">{error}</p>)}
      {!loading && !connected && <p className="mt-3 text-sm text-muted-foreground">Connect a Google AI Studio, OpenAI or ElevenLabs API key in Settings → AI to make voice models available.</p>}
      {(value.enabled || connected) && !loading && (
        <div className="mt-4 space-y-5 border-t pt-4">
          {(["transcription", "speech"] as const).map((kind) => {
            const isInput = kind === "transcription";
            const models = isInput ? transcription : speech;
            const languageOptions = isInput ? VOICE_LANGUAGES : languages;
            const languageField = isInput ? "inputLanguage" : "outputLanguage";
            const currentModelKey = modelKey(value[kind]);
            const modelAvailable = models.some((model) => modelKey(model) === currentModelKey);
            return <section key={kind} className={isInput ? "space-y-3" : "space-y-3 border-t pt-5"} aria-label={isInput ? "Voice input" : "Voice output"}>
              <div>
                <h3 className="text-sm font-semibold">{isInput ? "Voice input" : "Voice output"}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{isInput
                  ? "Transcribe your microphone recording. Auto detects the spoken language without translating it."
                  : "Choose how the assistant speaks. Auto follows the language of the latest input."}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="min-w-0 space-y-2 text-sm font-medium">
                  <span>Model</span>
                  <Select value={currentModelKey} onValueChange={(key) => selectModel(kind, key)}>
                    <SelectTrigger className="w-full min-w-0 font-normal" aria-label={isInput ? "Voice input model" : "Voice output model"}>
                      <SelectValue placeholder="Choose a model" className="truncate" />
                    </SelectTrigger>
                    <SelectContent>
                      {!modelAvailable && value[kind].modelId && (
                        <SelectItem value={currentModelKey} disabled>
                          {value[kind].modelId} (unavailable)
                        </SelectItem>
                      )}
                      {(["google", "openai", "elevenlabs"] as const).map((provider) => {
                        const group = models.filter((model) => model.provider === provider);
                        return group.length ? (
                          <SelectGroup key={provider} aria-label={PROVIDER_LABEL[provider]}>
                            <SelectGroupLabel>{PROVIDER_LABEL[provider]}</SelectGroupLabel>
                            {group.map((model) => (
                              <SelectItem key={modelKey(model)} value={modelKey(model)}>{model.label}</SelectItem>
                            ))}
                          </SelectGroup>
                        ) : null;
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0 space-y-2 text-sm font-medium">
                  <span>Language</span>
                  <Select value={isInput ? value.inputLanguage ?? "auto" : outputLanguage} onValueChange={(language) => {
                    if (!isVoiceLanguage(language)) return;
                    stopPreview();
                    onChange({ ...value, [languageField]: language });
                  }}>
                    <SelectTrigger className="w-full min-w-0 font-normal" aria-label={isInput ? "Voice input language" : "Voice output language"}>
                      <SelectValue className="truncate" />
                    </SelectTrigger>
                    <SelectContent>
                      {languageOptions.map((language) => (
                        <SelectItem key={language.value} value={language.value}>
                          {language.value === "auto" ? isInput ? "Auto · detect language" : "Auto · follow input" : language.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {isInput && <p className="text-xs text-muted-foreground">Pick a language to improve recognition of short phrases.</p>}
            </section>;
          })}
          <div className="flex items-start justify-between gap-3">
            <div><h3 className="text-sm font-semibold">Voice</h3><p className="text-muted-foreground mt-1 text-xs">{selectedVoice ? `Selected: ${selectedVoice.name}. Save changes to apply.` : "Choose a playback model and voice."}</p></div>
            <details className="max-w-56 text-xs text-muted-foreground"><summary className="cursor-pointer">Preview transcript</summary><p className="pt-2">{voiceSample(outputLanguage)}</p></details>
          </div>
          <p className="text-muted-foreground text-xs">Voices speak the output language above. Changes apply to new answers only.</p>
          <div role="radiogroup" aria-label="Playback voice" className="space-y-2">
            {value.speech.modelId && voices.map((voice) => <div key={voice.id} className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 transition-colors ${value.voiceId === voice.id ? "border-foreground/50 bg-muted/30" : "border-border"}`}>
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <input type="radio" name={`voice-${assistantId}`} value={voice.id} checked={value.voiceId === voice.id} onChange={() => { stopPreview(); onChange({ ...value, voiceId: voice.id }); }} className="accent-foreground" />
                <span className="min-w-0"><span className="block text-sm font-medium">{voice.name}</span><span className="text-muted-foreground block text-xs">{voice.description || PROVIDER_LABEL[voice.provider]}</span></span>
              </label>
              <div className="ml-auto flex shrink-0 items-center gap-2">
              <Button type="button" size="icon" variant="outline" className="size-8 shrink-0 rounded-full" aria-label={`${playing === voice.id || preparing === voice.id ? "Stop" : "Preview"} ${voice.name}`} onClick={() => void preview(voice.id)}>
                {preparing === voice.id ? <Loader2 className="size-3.5 animate-spin" /> : playing === voice.id ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
              </Button>
              </div>
            </div>)}
          </div>
        </div>
      )}
    </Card>
  );
}
