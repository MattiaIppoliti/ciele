import type { AssistantVoiceSettings, VoiceLanguage, VoiceModelRef } from "@agent-hub/core";

export const VOICE_LANGUAGES: { value: VoiceLanguage; label: string; sample: string }[] = [
  { value: "auto", label: "Auto", sample: "Hello! I'm your AI assistant. How can I help you today?" },
  { value: "it", label: "Italiano", sample: "Ciao! Sono il tuo assistente AI. Come posso aiutarti oggi?" },
  { value: "en", label: "English", sample: "Hello! I'm your AI assistant. How can I help you today?" },
  { value: "es", label: "Español", sample: "¡Hola! Soy tu asistente de IA. ¿Cómo puedo ayudarte hoy?" },
  { value: "fr", label: "Français", sample: "Bonjour ! Je suis votre assistant IA. Comment puis-je vous aider aujourd'hui ?" },
  { value: "de", label: "Deutsch", sample: "Hallo! Ich bin dein KI-Assistent. Wie kann ich dir heute helfen?" },
  { value: "pt", label: "Português", sample: "Olá! Sou o seu assistente de IA. Como posso ajudar hoje?" },
];

export function isVoiceLanguage(value: unknown): value is VoiceLanguage {
  return VOICE_LANGUAGES.some((language) => language.value === value);
}

/** Older saved settings intentionally retain automatic language detection. */
export function selectedVoiceLanguage(settings: AssistantVoiceSettings | undefined): VoiceLanguage {
  const value = settings?.outputLanguage;
  return isVoiceLanguage(value) ? value : "auto";
}

export function voiceSample(language: VoiceLanguage) {
  return VOICE_LANGUAGES.find((entry) => entry.value === language)!.sample;
}

export function availableVoiceLanguages(model: VoiceModelRef & { languageCodes?: string[] }) {
  // ElevenLabs returns each model's language coverage. Do not offer a language
  // the selected model cannot speak, including older English-only models.
  return VOICE_LANGUAGES.filter((language) => language.value === "auto" || !model.languageCodes || model.languageCodes.includes(language.value));
}

export function voicePronunciation(language: Exclude<VoiceLanguage, "auto">) {
  const names = { it: "Italian", en: "English", es: "Spanish", fr: "French", de: "German", pt: "Portuguese" };
  return `Use natural ${names[language]} pronunciation. Read the supplied text exactly, without translating, adding or omitting words.`;
}
