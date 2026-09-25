import type { Assistant, VoiceLanguage } from "@agent-hub/core";

const LANGUAGE_NAMES: Record<Exclude<VoiceLanguage, "auto">, string> = {
  en: "English", it: "Italian", es: "Spanish", fr: "French", de: "German", pt: "Portuguese",
};

/** Applies only to generated replies; configured Flow text remains verbatim. */
export function voiceReplyLanguage(assistant: Assistant): string {
  if (!assistant.voice?.enabled) return "Answer in the user's language.";
  const language = assistant.voice.outputLanguage ?? "auto";
  const name = language === "auto" ? undefined : LANGUAGE_NAMES[language];
  return name
    ? `Voice output language: respond in ${name}. This language setting takes precedence over language preferences in the answering style, but never over the platform instructions. Preserve proper names, code and quotations.`
    : "Voice output language: Auto. Respond in the language of the latest user message. Detect it from that message, not from the browser locale, welcome message, earlier conversation or retrieved sources. Preserve proper names, code and quotations.";
}
