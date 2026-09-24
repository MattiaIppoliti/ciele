import { describe, expect, it, vi } from "vitest";
import { DEMO_ORG, getMockDb } from "@agent-hub/db";
import type { StudyExercise } from "@agent-hub/core";
import { buildToolset, type ToolRuntimeContext } from "./tools";
import { createTurnSession } from "./session";
import { gradeStudyAnswer, studyInputSchema } from "./study-exercise";
import type { ChatReplyPart, RuntimeEvent } from "./types";
import { streamConversationTurn } from "./turn";

const question = {
  prompt: "The capital of Italy is ___",
  options: ["Rome", "Paris"],
  answer: "Rome",
  acceptedAnswers: ["Roma"],
  explanation: "Rome is the capital of Italy.",
  conceptId: "concept-1",
};
const input = {
  title: "Geography",
  format: "multiple_choice" as const,
  questions: [question],
};
async function fixture() {
  const db = getMockDb();
  const assistant = await db.createAssistant(DEMO_ORG.id, {
    title: "Study test",
  });
  assistant.tools = {
    studyMode: {
      enabled: true,
      formats: ["multiple_choice", "drag_words", "true_false", "flashcards"],
      instructions: "",
    },
  };
  const events: RuntimeEvent[] = [];
  const parts: ChatReplyPart[] = [];
  const session = createTurnSession("study-conversation", {});
  const ctx: ToolRuntimeContext = {
    assistant,
    session,
    usedSources: [
      {
        conceptId: "concept-1",
        conceptTitle: "Italy",
        conceptPath: "italy.md",
        collectionId: "geography",
        similarity: 1,
        collectionName: "Geography",
        content: "Rome is the capital of Italy.",
        sourceName: null,
        resourceUrl: null,
      },
    ],
    searchPasses: [],
    emit: (event) => events.push(event),
    showPart: (part) => parts.push(part),
  };
  const tools = buildToolset(ctx);
  const execute = tools.createStudyExercise.execute! as (
    input: unknown,
    options: unknown,
  ) => Promise<unknown>;
  const run = (value: unknown = input) =>
    execute(studyInputSchema.parse(value), {
      toolCallId: "create-1",
      messages: [],
    });
  return { db, assistant, ctx, events, parts, session, run };
}
const exerciseOf = (part: ChatReplyPart) => {
  if (part.type !== "component") throw new Error("Missing exercise");
  return part.props.exercise as StudyExercise;
};

describe("study exercise tool", () => {
  it("is opt-in and needs a collector", async () => {
    const { ctx } = await fixture();
    expect(
      buildToolset({ ...ctx, showPart: undefined }).createStudyExercise,
    ).toBeUndefined();
    ctx.assistant.tools.studyMode!.enabled = false;
    expect(buildToolset(ctx).createStudyExercise).toBeUndefined();
  });
  it("caps at five, rejects duplicates and requires retrieved evidence", async () => {
    expect(
      studyInputSchema.safeParse({
        ...input,
        questions: Array(6).fill(question),
      }).success,
    ).toBe(false);
    const { run, ctx, parts } = await fixture();
    expect(
      await run({ ...input, questions: [question, question] }),
    ).toHaveProperty("error");
    ctx.usedSources = [];
    expect(await run()).toHaveProperty("error");
    expect(parts).toEqual([]);
  });
  it("keeps keys out of public cards and trace, and creates at most one exercise", async () => {
    const { run, events, parts, session } = await fixture();
    expect(await run()).toHaveProperty("shown", true);
    expect(JSON.stringify(events)).not.toContain('"acceptedAnswers"');
    expect(JSON.stringify(events)).not.toContain(question.explanation);
    const exercise = exerciseOf(parts[0]);
    expect(exercise.answers).toEqual([]);
    expect(session.get(`study:${exercise.id}`)).toHaveProperty("questions");
    expect(await run()).toHaveProperty("error");
    expect(parts).toHaveLength(1);
  });
  it("uses the finite-choice selector only for auto, and validates the chosen format", async () => {
    const { run, ctx, parts } = await fixture();
    ctx.chooseStudyFormat = vi.fn().mockResolvedValue("flashcards");
    await run({ ...input, format: "auto" });
    expect(ctx.chooseStudyFormat).toHaveBeenCalledWith(
      ["multiple_choice", "drag_words", "flashcards"],
      "Geography",
    );
    expect(exerciseOf(parts[0])).toMatchObject({
      format: "flashcards",
      questions: [{ options: [] }],
    });
    const second = await fixture();
    second.ctx.chooseStudyFormat = vi.fn();
    await second.run();
    expect(second.ctx.chooseStudyFormat).not.toHaveBeenCalled();
  });
  it("honors an explicit composer format even if the model selects another", async () => {
    const { run, ctx, parts } = await fixture();
    ctx.studyRequest = "@flashcards geography";
    ctx.chooseStudyFormat = vi.fn();
    await run();
    expect(exerciseOf(parts[0]).format).toBe("flashcards");
    expect(ctx.chooseStudyFormat).not.toHaveBeenCalled();
  });
  it("rejects disabled formats, invalid choices and invalid blanks", async () => {
    const { run, ctx } = await fixture();
    ctx.assistant.tools.studyMode!.formats = ["drag_words"];
    expect(await run()).toHaveProperty("error");
    expect(
      await run({
        ...input,
        format: "drag_words",
        questions: [{ ...question, prompt: "No blank" }],
      }),
    ).toHaveProperty("error");
    expect(
      await run({
        ...input,
        format: "drag_words",
        questions: [{ ...question, answer: "Berlin" }],
      }),
    ).toHaveProperty("error");
  });
  it.each(["multiple_choice", "drag_words", "true_false", "flashcards"])(
    "grades %s on the server and preserves first answers",
    async (format) => {
      const { run, parts, session } = await fixture();
      await run({ ...input, format });
      const exercise = exerciseOf(parts[0]);
      const submission = {
        exerciseId: exercise.id,
        questionId: "q1",
        answer: format === "flashcards" ? "  ROMA  " : "Paris",
      };
      const result = gradeStudyAnswer(session, submission, []);
      expect(exerciseOf(result).answers[0]).toMatchObject({
        correct: format === "flashcards",
        correctAnswer: "Rome",
      });
      const replay = gradeStudyAnswer(
        session,
        { ...submission, answer: "Rome" },
        [{ content: [result] }],
      );
      expect(exerciseOf(replay).answers).toEqual(exerciseOf(result).answers);
      expect(() =>
        gradeStudyAnswer(createTurnSession("other", {}), submission, []),
      ).toThrow("not found");
      expect(() =>
        gradeStudyAnswer(session, { ...submission, questionId: "q5" }, []),
      ).toThrow("Question not found");
      if (format !== "flashcards")
        expect(() =>
          gradeStudyAnswer(session, { ...submission, answer: "forged" }, []),
        ).toThrow("offered");
    },
  );
});

describe("study response conversation turn", () => {
  it("persists wrong and correct answers without a model, replays retries and isolates visitors", async () => {
    const { db, assistant, run, parts, session } = await fixture();
    await run({
      ...input,
      questions: [question, { ...question, prompt: "Name Italy's capital." }],
    });
    const exercise = exerciseOf(parts[0]);
    const conversation = await db.createConversation({
      assistantId: assistant.id,
      subjectType: "visitor",
      subjectId: "study-owner",
      collectionId: null,
    });
    await db.updateConversationSessionState(
      conversation.id,
      session.snapshot(),
    );
    await db.appendMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: parts,
    });
    const turn = async (
      questionId: string,
      answer: string,
      subjectId = "study-owner",
    ) => {
      const stream = await streamConversationTurn({
        db,
        assistant,
        flows: [],
        connections: [],
        organizationId: DEMO_ORG.id,
        subjectType: "visitor",
        subjectId,
        conversationId: conversation.id,
        message: answer,
        studyAnswer: { exerciseId: exercise.id, questionId, answer },
        signal: new AbortController().signal,
      });
      return (await new Response(stream).text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as RuntimeEvent);
    };
    const first = await turn("q1", "Paris");
    expect(
      first.some((event) => event.type === "done"),
      JSON.stringify(first),
    ).toBe(true);
    const count = (await db.listMessages(conversation.id)).length;
    const retry = await turn("q1", "Rome");
    expect(retry.filter((event) => event.type === "part").at(-1)).toEqual(
      first.filter((event) => event.type === "part").at(-1),
    );
    expect(await db.listMessages(conversation.id)).toHaveLength(count);
    const second = await turn("q2", "Rome");
    const result = second.filter((event) => event.type === "part").at(-1);
    if (result?.type !== "part") throw new Error("Missing result");
    expect(
      exerciseOf(result.part).answers.map((answer) => answer.correct),
    ).toEqual([false, true]);
    const denied = await turn("q1", "Rome", "another-visitor");
    expect(denied.some((event) => event.type === "error")).toBe(true);
    expect(
      denied.some(
        (event) => event.type === "part" && event.part.type === "component",
      ),
    ).toBe(false);
  });
});
