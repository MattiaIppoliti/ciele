import { tool } from "ai";
import { z } from "zod";
import type { StudyExercise, StudyFormat } from "@agent-hub/core";
import { studyRequestFormat } from "@agent-hub/core";
import type { ToolRuntimeContext } from "./tools";
import type { ChatReplyPart } from "./types";
import type { TurnSession } from "./session";

const formats = [
  "multiple_choice",
  "drag_words",
  "true_false",
  "flashcards",
] as const;
const questionSchema = z.object({
  prompt: z.string().trim().min(1).max(1000),
  options: z.array(z.string().trim().min(1).max(300)).max(6),
  answer: z.string().trim().min(1).max(300),
  acceptedAnswers: z.array(z.string().trim().min(1).max(300)).max(5),
  explanation: z.string().trim().min(1).max(1500),
  conceptId: z.string().min(1),
});
export const studyInputSchema = z.object({
  title: z.string().trim().min(1).max(150),
  format: z.enum([...formats, "auto"]),
  questions: z.array(questionSchema).min(1).max(5),
});
export const studySubmissionSchema = z
  .object({
    exerciseId: z.string().uuid(),
    questionId: z.string().regex(/^q[1-5]$/),
    answer: z.string().trim().min(1).max(300),
  })
  .strict();
type Key = z.infer<typeof studyInputSchema> & {
  id: string;
  format: StudyFormat;
};
const booleanPairs = [
  ["true", "false"],
  ["vero", "falso"],
  ["vrai", "faux"],
  ["verdadero", "falso"],
  ["wahr", "falsch"],
  ["waar", "onwaar"],
  ["verdadeiro", "falso"],
];
const isBooleanOptions = (options: string[]) =>
  options.length === 2 &&
  booleanPairs.some((pair) =>
    pair.every((value) =>
      options.some((option) => normalize(option) === value),
    ),
  );
const sessionKey = (id: string) => `study:${id}`;
const normalize = (s: string) =>
  s.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");

export function studyPart(exercise: StudyExercise): ChatReplyPart {
  return {
    type: "component",
    action: "search_knowledge",
    name: "study_exercise",
    callId: exercise.id,
    props: { exercise },
  };
}

export function publicExercise(key: Key): StudyExercise {
  return {
    id: key.id,
    title: key.title,
    format: key.format,
    questions: key.questions.map((q, index) => ({
      id: `q${index + 1}`,
      prompt: q.prompt,
      options: key.format === "flashcards" ? [] : q.options,
    })),
    answers: [],
  };
}

/** Only finite format choices go to Jev. The model supplies grounded content;
 * our catalogue owns layout, controls, limits, and grading. */
export function studyExerciseTool(ctx: ToolRuntimeContext) {
  let created = false;
  const settings = ctx.assistant.tools.studyMode!;
  return tool({
    description: `Create one interactive study exercise, only when the visitor asks to practise or uses @quiz, @dwords, @truefalse, @flashcards or @study. Retrieve knowledge FIRST. Create at most 5 distinct questions, in the visitor's language, each citing a retrieved conceptId. Do not reveal solutions in the answer text. For multiple_choice use 2–6 options and exactly one correct option. true_false has exactly two localized true/false options. For drag_words put exactly one ___ in each prompt and offer words as options. Flashcards ask for one missing word or short phrase with no options. Include accepted spelling variants. Use auto only when no format was requested; auto questions must work both as multiple choice and short-answer flashcards. Allowed formats: ${settings.formats.join(", ")}. Custom study instructions: ${settings.instructions.slice(0, 10000)}`,
    inputSchema: studyInputSchema,
    execute: async (input, options) => {
      if (created) return { error: "Only one exercise per turn is allowed." };
      created = true;
      const callId = options.toolCallId;
      ctx.loop?.spend();
      const startedAt = Date.now();
      // Never stream or persist the answer key in tool arguments or trace.
      ctx.emit({
        type: "tool-start",
        tool: "createStudyExercise",
        callId,
        label: "Creating study exercise",
        input: {
          title: input.title,
          format: input.format,
          questions: input.questions.length,
        },
      });
      try {
        if (!settings.enabled || !settings.formats.length)
          throw new Error("Study mode is disabled.");
        if (
          input.questions.some(
            (q) =>
              !ctx.usedSources.some(
                (source) => source.conceptId === q.conceptId,
              ),
          )
        )
          throw new Error(
            "Every question must cite knowledge retrieved in this turn. Search first.",
          );
        if (
          new Set(input.questions.map((q) => normalize(q.prompt))).size !==
          input.questions.length
        )
          throw new Error("Questions must be distinct.");
        const requested = studyRequestFormat(ctx.studyRequest ?? "") ?? input.format;
        const candidates = settings.formats.filter((format) =>
          input.questions.every(
            (question) =>
              format === "flashcards" ||
              (question.options.length >= 2 &&
                question.options.includes(question.answer) &&
                (format !== "true_false" ||
                  isBooleanOptions(question.options)) &&
                (format !== "drag_words" ||
                  question.prompt.split("___").length === 2)),
          ),
        );
        if (!candidates.length)
          throw new Error("Questions do not fit any enabled format.");
        const format =
          requested === "auto"
            ? ((await ctx.chooseStudyFormat?.(candidates, input.title)) ??
              candidates[0])
            : requested;
        if (!settings.formats.includes(format))
          throw new Error("This exercise format is disabled.");
        for (const question of input.questions) {
          if (
            format !== "flashcards" &&
            (question.options.length < 2 ||
              !question.options.includes(question.answer) ||
              new Set(question.options.map(normalize)).size !==
                question.options.length)
          )
            throw new Error(
              "Provide distinct options including the exact correct answer.",
            );
          if (format === "true_false" && question.options.length !== 2)
            throw new Error("True/false needs exactly two options.");
          if (
            format === "drag_words" &&
            question.prompt.split("___").length !== 2
          )
            throw new Error(
              "Each drag-the-words question needs exactly one ___ blank.",
            );
        }
        const key: Key = { ...input, format, id: crypto.randomUUID() };
        ctx.session.set(sessionKey(key.id), key);
        const part = studyPart(publicExercise(key));
        ctx.showPart?.(part);
        ctx.emit({ type: "part", part });
        ctx.emit({
          type: "tool-end",
          callId,
          tool: "createStudyExercise",
          ok: true,
          summary: `Created ${input.questions.length} questions`,
          durationMs: Date.now() - startedAt,
        });
        return {
          shown: true,
          note: "The interactive exercise is visible. Briefly invite the visitor to answer it. Do not repeat questions, disclose answers, or generate an external link.",
        };
      } catch (error) {
        created = false;
        const message =
          error instanceof Error ? error.message : "Could not create exercise";
        ctx.emit({
          type: "tool-end",
          callId,
          tool: "createStudyExercise",
          ok: false,
          summary: message,
          durationMs: Date.now() - startedAt,
        });
        return { error: message };
      }
    },
  });
}

/** Grade only a question owned by this conversation. Prior responses come from
 * committed transcript snapshots, so retrying a response cannot change a mark. */
export function gradeStudyAnswer(
  session: TurnSession,
  raw: unknown,
  previous: readonly { content: unknown[] }[],
): ChatReplyPart {
  const submission = studySubmissionSchema.parse(raw);
  const saved = session.get(sessionKey(submission.exerciseId));
  if (!saved || typeof saved !== "object")
    throw new Error("Exercise not found in this conversation.");
  const parsed = studyInputSchema.parse(saved);
  if (parsed.format === "auto") throw new Error("Invalid stored exercise.");
  const exercise = publicExercise({
    ...parsed,
    format: parsed.format,
    id: submission.exerciseId,
  });
  for (const message of previous) {
    for (const rawPart of message.content) {
      const part = rawPart as Extract<ChatReplyPart, { type: "component" }>;
      if (part?.type === "component" && part.name === "study_exercise") {
        const snapshot = part.props.exercise as StudyExercise;
        if (snapshot?.id === exercise.id) {
          for (const answer of snapshot.answers)
            if (
              !exercise.answers.some((a) => a.questionId === answer.questionId)
            )
              exercise.answers.push(answer);
        }
      }
    }
  }
  const index = exercise.questions.findIndex(
    (q) => q.id === submission.questionId,
  );
  if (index < 0) throw new Error("Question not found.");
  if (exercise.answers.some((a) => a.questionId === submission.questionId))
    return studyPart(exercise);
  const key = parsed.questions[index];
  if (
    exercise.format !== "flashcards" &&
    !key.options.includes(submission.answer)
  )
    throw new Error("Select one of the offered answers.");
  exercise.answers.push({
    questionId: submission.questionId,
    answer: submission.answer,
    correct: (exercise.format === "flashcards" ? [key.answer, ...key.acceptedAnswers] : [key.answer]).some(
      (a) => normalize(a) === normalize(submission.answer),
    ),
    correctAnswer: key.answer,
    explanation: key.explanation,
  });
  return studyPart(exercise);
}
