"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from "react";
import type { StudyExercise, StudySubmission } from "@agent-hub/core";
import {
  decodeRuntimeEvents,
  type ChatReplyPart,
} from "@agent-hub/agent/client";

interface StudyContextValue {
  first: Map<string, StudyExercise>;
  latest: Map<string, StudyExercise>;
  busy: boolean;
  submit?: (answer: StudySubmission) => Promise<void>;
}
const StudyContext = createContext<StudyContextValue | null>(null);
export const useStudyContext = () => useContext(StudyContext);

export function StudyProvider({
  children,
  replies,
  endpoint,
  request,
  disabled = false,
}: {
  children: ReactNode;
  replies: readonly (readonly ChatReplyPart[])[];
  endpoint?: string;
  request?: Record<string, unknown> | (() => Record<string, unknown>);
  disabled?: boolean;
}) {
  const [updates, setUpdates] = useState<Record<string, StudyExercise>>({});
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const { first, latest } = useMemo(() => {
    const first = new Map<string, StudyExercise>();
    const latest = new Map<string, StudyExercise>();
    for (const parts of replies)
      for (const part of parts) {
        if (part.type !== "component" || part.name !== "study_exercise")
          continue;
        const exercise = part.props.exercise as StudyExercise;
        if (
          !exercise?.id ||
          !Array.isArray(exercise.questions) ||
          !Array.isArray(exercise.answers)
        )
          continue;
        if (!first.has(exercise.id)) first.set(exercise.id, exercise);
        if (
          (latest.get(exercise.id)?.answers.length ?? -1) <=
          exercise.answers.length
        )
          latest.set(exercise.id, exercise);
      }
    for (const exercise of Object.values(updates)) {
      if (
        (latest.get(exercise.id)?.answers.length ?? -1) <=
        exercise.answers.length
      )
        latest.set(exercise.id, exercise);
    }
    return { first, latest };
  }, [replies, updates]);

  async function submit(studyAnswer: StudySubmission) {
    if (!endpoint || submitting.current || disabled)
      throw new Error("Please wait for the current reply.");
    submitting.current = true;
    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(typeof request === "function" ? request() : request),
          studyAnswer,
          message: studyAnswer.answer,
          turnId: crypto.randomUUID(),
        }),
      });
      if (!response.ok || !response.body)
        throw new Error("Could not save your answer. Try again.");
      let exercise: StudyExercise | undefined;
      let done = false;
      for await (const event of decodeRuntimeEvents(response.body)) {
        if (event.type === "error") throw new Error(event.message);
        if (
          event.type === "part" &&
          event.part.type === "component" &&
          event.part.name === "study_exercise"
        )
          exercise = event.part.props.exercise as StudyExercise;
        if (event.type === "done") done = true;
      }
      if (!exercise || !done)
        throw new Error("Your answer was not confirmed. Try again.");
      const confirmed = exercise;
      setUpdates((previous) => ({ ...previous, [confirmed.id]: confirmed }));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <StudyContext.Provider
      value={{
        first,
        latest,
        busy: busy || disabled,
        submit: endpoint ? submit : undefined,
      }}
    >
      {children}
    </StudyContext.Provider>
  );
}
