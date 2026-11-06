import { z } from "zod";
import { MODERATION_MODELS, type AssistantGuardrail } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { runInputGuardrails } from "./guardrails";
import { withPostTurnMasking } from "./pii-masking";
import { nonRetryable } from "./job-errors";
import type { JobHandler } from "./jobs";
const payloadSchema = z.object({ messageId: z.string().min(1), guardrails: z.array(z.object({ id: z.string().min(1), name: z.string(), model: z.enum(MODERATION_MODELS), categories: z.array(z.string()) })).max(20) });
export function answerModerationRules(guardrails: readonly AssistantGuardrail[] | undefined) {
  return (guardrails ?? []).flatMap(rule => rule.enabled && rule.type === "moderation" && rule.alsoScoreAnswers
    ? [{ id: rule.id, name: rule.name, model: rule.model, categories: rule.categories }] : []);
}
/** The saved final answer is read only by the post-response worker. */
export async function scoreSavedAnswer(db: Db, organizationId: string, payload: unknown, fetchOverride?: typeof fetch) {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) throw nonRetryable("Invalid answer moderation job");
  const message = await db.getMessage(parsed.data.messageId);
  if (!message || message.role !== "assistant") return;
  const conversation = await db.getConversation(message.conversationId);
  if (!conversation?.assistantId || conversation.teammateId) return;
  const assistant = await db.getAssistant(conversation.assistantId);
  if (assistant?.organizationId !== organizationId) throw nonRetryable("Assistant message not found");
  const text = message.content.flatMap(part => {
    if (!part || typeof part !== "object") return [];
    if ("type" in part && part.type === "text" && "generated" in part && part.generated === true && "text" in part && typeof part.text === "string") return [part.text];
    if ("type" in part && part.type === "clarify" && "question" in part && typeof part.question === "string") return [part.question];
    return [];
  }).join("\n").trim();
  if (!text) return;
  const pending = parsed.data.guardrails.filter(rule => !message.trace?.guardrails?.some(check => check.target === "answer" && check.id === rule.id));
  if (!pending.length) return;
  const connections = await db.listProviderConnections(organizationId);
  const guardrails: AssistantGuardrail[] = pending.map(rule => ({ ...rule, type: "moderation", enabled: true, action: "log", provider: "openai", onError: "allow", message: "" }));
  const result = await withPostTurnMasking(db, assistant.id, () => db.listMessages(conversation.id), () => runInputGuardrails(guardrails, text, { connections, decisionModel: null, fetch: fetchOverride }));
  for (const check of result.checks) await db.recordMessageModeration(organizationId, message.id, { ...check, target: "answer" });
}
export const answerModerationHandler: JobHandler = {
  perform: (record, { db }) => scoreSavedAnswer(db, record.organizationId, record.payload),
};
