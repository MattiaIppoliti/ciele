import { describe, expect, it } from "vitest";
import type { Role } from "@agent-hub/core";
import { defaultGuardrail } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import {
  askAssistantOp,
  assistantPatchSchema,
  createAssistantOp,
  deleteAssistantOp,
  duplicateAssistantOp,
  getAssistantOp,
  listAssistantsOp,
  updateAssistantOp,
} from "./assistants";
import { OperationError, type OperationContext } from "./operation";

/**
 * Operations tested over the in-memory Db, external behavior only: what an
 * operation returns and what a subsequent read observes. Capability
 * enforcement is the calling surface's job; here we pin the declarations.
 */

const ctx = (over: Partial<OperationContext> = {}): OperationContext => ({
  organizationId: DEMO_ORG.id,
  userId: DEMO_MEMBER.userId,
  role: "editor" as Role,
  db: getMockDb(),
  ...over,
});

const foreignCtx = () => ctx({ organizationId: "some-other-org" });

describe("assistants operations", () => {
  it("declares the catalogue contract: capability + mutated entities", () => {
    expect(listAssistantsOp.capability).toBe("member");
    expect(createAssistantOp.capability).toBe("edit");
    expect(deleteAssistantOp.capability).toBe("publish");
    expect(createAssistantOp.entities({ title: "x" }, undefined as never)).toEqual([
      { kind: "assistantList" },
    ]);
    expect(updateAssistantOp.entities({ id: "a1", patch: {} }, undefined as never)).toEqual([
      { kind: "assistant", id: "a1" },
    ]);
  });

  it("create → get → update → delete round-trips through one context", async () => {
    const created = await createAssistantOp.run(ctx(), {
      title: "Ops Fixture",
      description: "made by the ops test",
    });
    expect(created.organizationId).toBe(DEMO_ORG.id);

    const fetched = await getAssistantOp.run(ctx(), { id: created.id });
    expect(fetched.title).toBe("Ops Fixture");

    const updated = await updateAssistantOp.run(ctx(), {
      id: created.id,
      patch: { title: "Ops Fixture v2", answeringStyle: "terse" },
    });
    expect(updated.title).toBe("Ops Fixture v2");

    await deleteAssistantOp.run(ctx(), { id: created.id });
    await expect(
      getAssistantOp.run(ctx(), { id: created.id })
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses cross-org access as not_found, before mutating", async () => {
    const created = await createAssistantOp.run(ctx(), { title: "Mine" });
    for (const attempt of [
      getAssistantOp.run(foreignCtx(), { id: created.id }),
      updateAssistantOp.run(foreignCtx(), { id: created.id, patch: { title: "x" } }),
      deleteAssistantOp.run(foreignCtx(), { id: created.id }),
      duplicateAssistantOp.run(foreignCtx(), { id: created.id }),
    ]) {
      await expect(attempt).rejects.toBeInstanceOf(OperationError);
    }
    // Nothing changed under the failed attempts.
    const still = await getAssistantOp.run(ctx(), { id: created.id });
    expect(still.title).toBe("Mine");
  });

  it("validates input at the schema seam", () => {
    expect(createAssistantOp.input.safeParse({ title: "" }).success).toBe(false);
    expect(createAssistantOp.input.safeParse({ title: "ok" }).success).toBe(true);
    expect(
      updateAssistantOp.input.safeParse({ id: "a", patch: { title: "" } }).success
    ).toBe(false);
    // Unknown patch keys are stripped, not persisted.
    const parsed = updateAssistantOp.input.parse({
      id: "a",
      patch: { title: "ok", organizationId: "evil" },
    });
    expect("organizationId" in parsed.patch).toBe(false);
  });

  it("duplicate copies config and flows, leaves knowledge behind", async () => {
    const db = getMockDb();
    const source = await createAssistantOp.run(ctx(), { title: "Original" });
    await updateAssistantOp.run(ctx(), {
      id: source.id,
      patch: { answeringStyle: "friendly", suggestedQuestions: ["Q1"] },
    });
    const sourceFlows = await db.listFlows(source.id);

    const copy = await duplicateAssistantOp.run(ctx(), { id: source.id });
    expect(copy.title).toBe("Original (copy)");

    const copied = await getAssistantOp.run(ctx(), { id: copy.id });
    expect(copied.answeringStyle).toBe("friendly");
    expect(copied.suggestedQuestions).toEqual(["Q1"]);

    const copyFlows = await db.listFlows(copy.id);
    expect(copyFlows.map((f) => f.name).sort()).toEqual(
      sourceFlows.map((f) => f.name).sort()
    );
    // Knowledge stays with the original.
    expect(await db.listCollections(copy.id)).toHaveLength(0);
  });

  it("delete leaves org-owned knowledge intact (PRD #726)", async () => {
    const withPort = ctx();
    const assistant = await createAssistantOp.run(withPort, { title: "Doomed" });
    const collection = await getMockDb().createCollection(assistant.id, {
      name: "notes",
    });
    const source = await getMockDb().createSource({
      collectionId: collection.id,
      name: "shared note",
      kind: "text",
    });
    await getMockDb().setSourceAssistantLinks(source.id, [assistant.id]);
    await deleteAssistantOp.run(withPort, { id: assistant.id });
    // Knowledge is org-owned: only the links die with the assistant.
    expect(await getMockDb().getCollection(collection.id)).not.toBeNull();
    expect(await getMockDb().listSourceAssistantLinks(source.id)).toEqual([]);
  });
});


describe("Study Mode settings", () => {
  const studyMode = { enabled: true, formats: ["multiple_choice"], instructions: "Use short questions." };
  it("accepts supported settings and rejects empty, unknown, duplicated or oversized values", () => {
    expect(assistantPatchSchema.safeParse({ tools: { studyMode } }).success).toBe(true);
    for (const invalid of [
      { ...studyMode, formats: [] },
      { ...studyMode, formats: ["arbitrary_html"] },
      { ...studyMode, formats: ["flashcards", "flashcards"] },
      { ...studyMode, instructions: "x".repeat(10001) },
      { ...studyMode, enabled: "true" },
    ]) expect(assistantPatchSchema.safeParse({ tools: { studyMode: invalid } }).success).toBe(false);
  });
});

describe("askAssistantOp", () => {
  const answer = {
    conversationId: "conv-1",
    messageId: "msg-1",
    flowName: "Default behavior",
    answer: "Open the Library, then Applications.",
    sources: [],
    error: null,
  };

  it("asks the port for this Assistant's answer and hands it back whole", async () => {
    const assistant = await createAssistantOp.run(ctx(), { title: "Ask target" });
    const asked: unknown[] = [];
    const result = await askAssistantOp.run(
      ctx({ ports: { askAssistant: async (input) => (asked.push(input), answer) } }),
      { id: assistant.id, question: "How do I connect Salesforce?" }
    );
    expect(result).toEqual(answer);
    expect(asked).toEqual([
      { assistantId: assistant.id, question: "How do I connect Salesforce?", conversationId: null },
    ]);
    // A new Conversation lands in the Inbox; nothing else changes.
    expect(askAssistantOp.entities({} as never, result)).toEqual([{ kind: "inbox" }]);
    expect(askAssistantOp.capability).toBe("member");
  });

  it("says an unpublished Assistant must be published first", async () => {
    const assistant = await createAssistantOp.run(ctx(), { title: "Draft only" });
    await expect(
      askAssistantOp.run(ctx({ ports: { askAssistant: async () => null } }), {
        id: assistant.id,
        question: "Anyone there?",
      })
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("never reaches the port for another Organization's Assistant", async () => {
    const assistant = await createAssistantOp.run(ctx(), { title: "Ours" });
    let called = false;
    await expect(
      askAssistantOp.run(
        { ...foreignCtx(), ports: { askAssistant: async () => ((called = true), answer) } },
        { id: assistant.id, question: "Hi" }
      )
    ).rejects.toBeInstanceOf(OperationError);
    expect(called).toBe(false);
  });

  it("refuses without a turn backend and trims the question", async () => {
    const assistant = await createAssistantOp.run(ctx(), { title: "No port" });
    await expect(
      askAssistantOp.run(ctx({ ports: {} }), { id: assistant.id, question: "Hi" })
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(askAssistantOp.input.safeParse({ id: "a", question: "  " }).success).toBe(false);
  });
});

describe("a model pinned to a source", () => {
  it("keeps the source through the patch schema, on the model and every allowed ref", () => {
    const parsed = assistantPatchSchema.parse({
      modelSource: "ai_gateway",
      allowedModels: [
        { provider: "anthropic", modelId: "claude-sonnet-5", source: "api_key" },
        { provider: "anthropic", modelId: "claude-sonnet-5" },
      ],
    });
    expect(parsed.modelSource).toBe("ai_gateway");
    expect(parsed.allowedModels?.map((ref) => ref.source)).toEqual(["api_key", undefined]);
    expect(assistantPatchSchema.parse({ modelSource: null }).modelSource).toBeNull();
  });

  it("refuses a source nobody defined, and a personal subscription", () => {
    for (const modelSource of ["carrier_pigeon", "subscription"])
      expect(assistantPatchSchema.safeParse({ modelSource }).success).toBe(false);
  });
});

describe("Guardrails settings", () => {
  const regex = { ...defaultGuardrail("regexp_guardrail", "r1"), pattern: "\\d{16}" };
  it("accepts a valid list and refuses one a turn could not enforce", () => {
    expect(assistantPatchSchema.safeParse({ guardrails: [regex] }).success).toBe(true);
    expect(assistantPatchSchema.safeParse({ guardrails: [] }).success).toBe(true);
    for (const invalid of [
      [{ ...regex, pattern: "(unclosed" }],
      [{ ...regex, type: "jailbreak_detector" }],
      [regex, { ...regex }],
      [{ ...defaultGuardrail("sensitive_content_stream", "s"), startMarker: "<x>" }],
      "not a list",
    ]) expect(assistantPatchSchema.safeParse({ guardrails: invalid }).success).toBe(false);
  });
});
