import type { Assistant, Flow, StudyFormat } from "./types";

export const STUDY_MODE_FLOW_ID = "builtin-study-mode";

/** Composer commands are explicit routing requests, not classification hints. */
export function studyRequestFormat(message: string): StudyFormat | "auto" | null {
  const tag = message.trim().match(/^@(quiz|dwords|truefalse|flashcards|study)\b/i)?.[1]?.toLowerCase();
  const formats: Record<string, StudyFormat | "auto"> = {
    quiz: "multiple_choice", dwords: "drag_words", truefalse: "true_false",
    flashcards: "flashcards", study: "auto",
  };
  return tag ? formats[tag] : null;
}

/** A settings-owned flow, derived from the publication just like its tool.
 * It has no independently mutable database row or enable switch. */
export function studyModeFlow(assistant: Pick<Assistant, "id" | "tools">): Flow | null {
  if (!assistant.tools.studyMode?.enabled || !assistant.tools.studyMode.formats.length) return null;
  return {
    id: STUDY_MODE_FLOW_ID,
    assistantId: assistant.id,
    name: "Study Mode",
    description: "The visitor explicitly asks to practise a topic with an interactive quiz, true/false questions, drag-the-words or flashcards. Create an exercise, not an ordinary answer. Do not select this flow for ordinary information questions.",
    builtIn: true, enabled: true, position: -1, trigger: "message", triggerSettings: {},
    conditionLogic: "all", conditions: [], actions: ["search_knowledge"],
    actionSettings: { search_knowledge: {
      searchGuidelines: "This is a study request. Search for the topic without the @quiz/@dwords/@truefalse/@flashcards/@study command. Gather material for up to five questions, then call createStudyExercise before readyToAnswer. If there is no suitable material, explain that an exercise needs study material instead of answering the topic as a normal support question.",
      answeringStyle: "The visitor requested an interactive exercise. If createStudyExercise succeeded, briefly invite them to complete the card. Never reveal solutions or repeat the questions in prose. If no exercise could be created, explain why and ask for study material or a supported topic. Do not claim an exercise exists unless its tool succeeded.",
    } },
    customMessage: "", isDefault: false,
  };
}
