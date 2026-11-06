import { afterEach, expect, it, vi } from "vitest";
import { defaultGuardrail, type AssistantGuardrail, type ProviderConnection } from "@agent-hub/core";
import { DEMO_ORG, getMockDb } from "@agent-hub/db";
import { answerModerationRules, scoreSavedAnswer } from "./answer-moderation";
import { streamConversationTurn } from "./turn";
import { registerRuntimeHost } from "./host";
import * as engine from "./engine";
const db = getMockDb();
const connection: ProviderConnection = { id: "answer-openai", organizationId: DEMO_ORG.id, provider: "openai", type: "api_key", displayName: "OpenAI", encryptedKey: "plain:sk-test", keyHint: "", config: {}, preferredForEmbedding: false, createdBy: null, createdAt: "2026-01-01T00:00:00Z" };
const rule = { ...defaultGuardrail("moderation", "answer-mod"), alsoScoreAnswers: true } as AssistantGuardrail;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); registerRuntimeHost({ scheduleAfterResponse: () => {} }); });
it("only scores enabled answer checks and records provider unavailability without blocking", async () => {
  const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Moderation" });
  const conversation = await db.createConversation({ assistantId: assistant.id, subjectType: "visitor", subjectId: "answer-check" });
  const message = await db.appendMessage({ conversationId: conversation.id, role: "assistant", content: [{ type: "text", action: "basic_reply", generated: true, text: "Hello" }] });
  vi.spyOn(db, "listProviderConnections").mockResolvedValue([]);
  await scoreSavedAnswer(db, DEMO_ORG.id, { messageId: message.id, guardrails: answerModerationRules([rule]) });
  expect((await db.getMessage(message.id))?.trace?.guardrails).toContainEqual(expect.objectContaining({ target: "answer", outcome: "unavailable" }));
  expect(answerModerationRules([{ ...rule, enabled: false }])).toEqual([]);
});
it("queues after saving and performs no answer provider call before the response completes", async () => {
  const after: Array<() => unknown> = [];
  registerRuntimeHost({ scheduleAfterResponse: work => { after.push(work); } });
  const endpoint = vi.fn(async () => new Response(JSON.stringify({ results: [{ flagged: true, categories: { hate: true }, category_scores: { hate: 0.9, violence: 0.2, sexual: 0.1 } }] })));
  vi.stubGlobal("fetch", endpoint);
  vi.spyOn(db, "listProviderConnections").mockResolvedValue([connection]);
  vi.spyOn(engine, "runAssistantChat").mockResolvedValue({ parts: [{ type: "text", action: "basic_reply", generated: true, text: "Generated answer" }], effects: [], flowId: null, flowName: "Basic Interaction", usage: [] });
  const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Post-commit" });
  assistant.guardrails = [rule];
  const stream = await streamConversationTurn({ db, assistant, flows: await db.listFlows(assistant.id), connections: [], organizationId: DEMO_ORG.id, subjectType: "visitor", subjectId: "post-commit", conversationId: null, message: "hello", signal: new AbortController().signal });
  const events = (await new Response(stream).text()).trim().split("\n").map(line => JSON.parse(line));
  const done = events.reverse().find(event => event.type === "done");
  expect(done?.messageId).toBeTruthy();
  expect(await db.getMessage(done.messageId)).not.toBeNull();
  expect(endpoint).not.toHaveBeenCalled();
  expect(after.length).toBeGreaterThan(0);
  for (const work of after) await work();
  expect(endpoint).toHaveBeenCalledTimes(1);
  expect((await db.getMessage(done.messageId))?.trace?.guardrails).toContainEqual(expect.objectContaining({ target: "answer", outcome: "logged", flagged: true, scores: expect.any(Array) }));
  expect((await db.getConversation(done.conversationId))?.metadata.flaggedAnswer).toBe(true);
});

it("scores generated parts and clarification, excludes verbatim text, and replays without another provider call", async () => {
  const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Mixed answer" });
  const conversation = await db.createConversation({ assistantId: assistant.id, subjectType: "visitor", subjectId: "mixed-answer" });
  const message = await db.appendMessage({ conversationId: conversation.id, role: "assistant", content: [
    { type: "text", action: "custom_message", text: "VERBATIM_EXCLUDED" },
    { type: "text", action: "basic_reply", generated: true, text: "Generated courtesy" },
    { type: "clarify", question: "Which course?", options: [] },
  ] });
  const endpoint = vi.fn(async () => new Response(JSON.stringify({ results: [{ flagged: false, categories: {}, category_scores: { hate: 0.01 } }] })));
  vi.spyOn(db, "listProviderConnections").mockResolvedValue([connection]);
  const payload = { messageId: message.id, guardrails: answerModerationRules([rule]) };
  await scoreSavedAnswer(db, DEMO_ORG.id, payload, endpoint);
  await scoreSavedAnswer(db, DEMO_ORG.id, payload, endpoint);
  expect(endpoint).toHaveBeenCalledTimes(1);
  const sent = JSON.stringify(endpoint.mock.calls);
  expect(sent).toContain("Generated courtesy");
  expect(sent).toContain("Which course?");
  expect(sent).not.toContain("VERBATIM_EXCLUDED");
});
