"use client";

import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  LoaderCircle,
  X,
  GraduationCap,
} from "lucide-react";
import { defineCatalog } from "@json-render/core";
import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react";
import { schema } from "@json-render/react/schema";
import { z } from "zod";
import type { StudyExercise, StudyFormat } from "@agent-hub/core";
import { Button, Input } from "@agent-hub/ui";
import { useStudyContext } from "./study-context";

export const STUDY_LABELS: Record<StudyFormat, string> = {
  multiple_choice: "Multiple choice",
  drag_words: "Drag the words",
  true_false: "True / False",
  flashcards: "Flashcards",
};

function Results({ exercise }: { exercise: StudyExercise }) {
  const complete = exercise.answers.length === exercise.questions.length;
  return (
    <details
      className="w-full overflow-hidden rounded-2xl border border-border bg-muted/40 text-sm"
      open
    >
      <summary className="press flex cursor-pointer items-center gap-3 p-4">
        <GraduationCap className="size-5 shrink-0" />
        <span>
          <span className="block font-medium">
            {STUDY_LABELS[exercise.format]} ·{" "}
            {complete ? "Completed" : "Unfinished"}
          </span>
          <span className="text-muted-foreground">
            {exercise.answers.length} of {exercise.questions.length} answered ·{" "}
            {exercise.answers.filter((a) => a.correct).length} correct
          </span>
        </span>
      </summary>
      <ol className="divide-y border-t px-4">
        {exercise.questions.map((question, index) => {
          const answer = exercise.answers.find(
            (a) => a.questionId === question.id,
          );
          return (
            <li key={question.id} className="flex gap-3 py-4">
              {answer ? (
                answer.correct ? (
                  <Check
                    aria-label="Correct"
                    className="mt-0.5 size-4 shrink-0 text-emerald-600"
                  />
                ) : (
                  <X
                    aria-label="Incorrect"
                    className="mt-0.5 size-4 shrink-0 text-rose-600"
                  />
                )
              ) : (
                <CircleHelp
                  aria-label="Not answered"
                  className="text-muted-foreground mt-0.5 size-4 shrink-0"
                />
              )}
              <div className="min-w-0 space-y-1 break-words">
                <p>
                  <strong>{index + 1}.</strong> {question.prompt}
                </p>
                {answer ? (
                  <>
                    <p className="text-muted-foreground">
                      Your answer:{" "}
                      <span
                        className={
                          answer.correct
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-rose-700 dark:text-rose-400"
                        }
                      >
                        {answer.answer}
                      </span>
                    </p>
                    <p>
                      Correct:{" "}
                      <span className="text-emerald-700 dark:text-emerald-400">
                        {answer.correctAnswer}
                      </span>
                    </p>
                    <p className="text-muted-foreground">
                      {answer.explanation}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">Not answered</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

/** Approval-card layout from the supplied reference. Choice formats deliberately
 * have no custom-answer input; only flashcards accept a typed answer. */
function ExerciseCard({ exercise }: { exercise: StudyExercise }) {
  const context = useStudyContext();
  const [step, setStep] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const question =
    exercise.questions[Math.min(step, exercise.questions.length - 1)];
  if (!question) return null;
  const result = exercise.answers.find((a) => a.questionId === question.id);
  const answer = result?.answer ?? drafts[question.id] ?? "";
  const readonly = !context?.submit;
  if (readonly || exercise.answers.length === exercise.questions.length)
    return <Results exercise={exercise} />;
  const busy = context.busy;
  const choose = (value: string) =>
    setDrafts((previous) => ({ ...previous, [question.id]: value }));
  async function check() {
    setError("");
    try {
      await context?.submit?.({
        exerciseId: exercise.id,
        questionId: question.id,
        answer,
      });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save your answer.",
      );
    }
  }
  return (
    <div
      className="w-full overflow-hidden rounded-2xl border border-border bg-muted/40 p-4 text-sm"
      aria-busy={busy}
    >
      <div className="flex items-start gap-3">
        <CircleHelp className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <h3 className="min-w-0 flex-1 text-base font-medium leading-5">
              {exercise.title}
            </h3>
            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
              {step + 1}/{exercise.questions.length}
            </span>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            {STUDY_LABELS[exercise.format]}
          </p>
          <p
            className="mt-3 whitespace-pre-wrap leading-6"
            onDragOver={(event) => {
              if (exercise.format === "drag_words") event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              const value = event.dataTransfer.getData("text/plain");
              if (!busy && !result && question.options.includes(value))
                choose(value);
            }}
          >
            {exercise.format === "drag_words"
              ? question.prompt.split("___").map((text, index) => (
                  <span key={index}>
                    {index > 0 && (
                      <span className="mx-1 inline-block min-w-20 rounded-lg border border-dashed border-primary/50 bg-background px-3 py-1 text-center font-medium">
                        {answer || "___"}
                      </span>
                    )}
                    {text}
                  </span>
                ))
              : question.prompt}
          </p>
          {exercise.format === "flashcards" ? (
            <Input
              aria-label="Missing word"
              placeholder="Your answer…"
              className="mt-3 rounded-xl bg-background"
              value={answer}
              maxLength={300}
              disabled={busy || Boolean(result)}
              onChange={(event) => choose(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  answer.trim() &&
                  !result &&
                  !busy
                ) {
                  event.preventDefault();
                  void check();
                }
              }}
            />
          ) : (
            <fieldset
              disabled={busy || Boolean(result)}
              className="mt-3 grid gap-0.5"
            >
              <legend className="sr-only">Choose an answer</legend>
              {question.options.map((option) => (
                <label
                  key={option}
                  draggable={
                    exercise.format === "drag_words" && !result && !busy
                  }
                  onDragStart={(event) =>
                    event.dataTransfer.setData("text/plain", option)
                  }
                  className={`press flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-2 hover:bg-background/70 ${answer === option ? "bg-background/80" : ""}`}
                >
                  <input
                    type="radio"
                    name={`${exercise.id}-${question.id}`}
                    value={option}
                    checked={answer === option}
                    onChange={() => choose(option)}
                    className="size-4 accent-current"
                  />
                  <span>{option}</span>
                </label>
              ))}
            </fieldset>
          )}
          {exercise.format === "drag_words" && !result && (
            <p className="text-muted-foreground mt-2 text-xs">
              Drag a word to the blank, or select it below.
            </p>
          )}
          {result && (
            <div role="status" className="mt-3 rounded-xl bg-background/70 p-3">
              <p
                className={
                  result.correct
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-rose-700 dark:text-rose-400"
                }
              >
                {result.correct
                  ? "Correct"
                  : `Correct answer: ${result.correctAnswer}`}
              </p>
              <p className="text-muted-foreground mt-1">{result.explanation}</p>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-3 text-destructive">
              {error}
            </p>
          )}
          <div className="mt-4 flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous question"
              disabled={busy || step === 0}
              onClick={() => setStep((s) => s - 1)}
              className="rounded-full"
            >
              <ArrowLeft className="size-4" />
            </Button>
            <span
              className="flex gap-1.5"
              aria-label={`Question ${step + 1} of ${exercise.questions.length}`}
            >
              {exercise.questions.map((q, index) => (
                <span
                  key={q.id}
                  className={`size-1.5 rounded-full bg-foreground ${index === step ? "" : "opacity-30"}`}
                />
              ))}
            </span>
            {result ? (
              <Button
                size="sm"
                className="ml-auto rounded-full"
                onClick={() =>
                  setStep((s) => Math.min(s + 1, exercise.questions.length - 1))
                }
                disabled={step === exercise.questions.length - 1}
              >
                Next <ArrowRight className="size-3.5" />
              </Button>
            ) : (
              <Button
                size="sm"
                className="ml-auto rounded-full"
                disabled={busy || !answer.trim()}
                onClick={() => void check()}
              >
                {busy ? (
                  <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                ) : (
                  <>
                    Check <ArrowRight className="size-3.5" />
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// App-owned component catalogue and props. No generated HTML, JavaScript,
// network actions or JSONL layout stream is interpreted by the client.
const entry = {
  props: z.object({ exercise: z.custom<StudyExercise>() }),
  description: "A bounded study exercise with server-checked answers.",
};
const catalog = defineCatalog(schema, {
  components: {
    MultipleChoice: entry,
    DragWords: entry,
    TrueFalse: entry,
    Flashcards: entry,
  },
  actions: {},
});
const renderCard = ({ props }: { props: { exercise: StudyExercise } }) => (
  <ExerciseCard exercise={props.exercise} />
);
const { registry } = defineRegistry(catalog, {
  components: {
    MultipleChoice: renderCard,
    DragWords: renderCard,
    TrueFalse: renderCard,
    Flashcards: renderCard,
  },
});
const components: Record<StudyFormat, string> = {
  multiple_choice: "MultipleChoice",
  drag_words: "DragWords",
  true_false: "TrueFalse",
  flashcards: "Flashcards",
};

export function StudyExerciseReply({ exercise }: { exercise: StudyExercise }) {
  const context = useStudyContext();
  if (
    !exercise?.id ||
    !Array.isArray(exercise.questions) ||
    !components[exercise.format]
  )
    return null;
  // One activity card in the transcript; later persisted response snapshots
  // update the original card instead of drawing five copies in Inbox.
  if (
    context?.first.has(exercise.id) &&
    context.first.get(exercise.id) !== exercise
  )
    return null;
  const current = context?.latest.get(exercise.id) ?? exercise;
  const spec = {
    root: current.id,
    elements: {
      [current.id]: {
        type: components[current.format],
        props: { exercise: current },
        children: [],
      },
    },
  };
  return (
    <JSONUIProvider registry={registry}>
      <Renderer spec={spec} registry={registry} />
    </JSONUIProvider>
  );
}
