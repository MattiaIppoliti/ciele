/**
 * The Chat summary a Support Channel attaches to an Escalation (#1081).
 *
 * One classifier-tier call over the transcript, made when a Visitor escalates
 * through an email or API endpoint channel whose Conversation Data has Chat
 * summary on, so the person who picks it up knows what was asked and what the
 * AI already answered without reading everything.
 *
 * Best-effort by construction: no connection, a provider error or the
 * timeout return null, and the escalation goes out without it. It runs on the
 * Organization's own connections only (no Member is on this path, so no
 * personal subscription can resolve), under the post-turn PII masking scope,
 * and it is metered in the AI Usage Ledger.
 */

import { generateText } from "ai";
import type { Db } from "@agent-hub/db";
import type { StoredMessage } from "@agent-hub/core";
import { messageText } from "@agent-hub/core";
import { getClassifierModel } from "./models";
import { withPostTurnMasking } from "./pii-masking";
import { meterUsage } from "./usage";

/** How much transcript the summariser reads, the most recent turns kept. */
export const ESCALATION_SUMMARY_INPUT_CHARS = 12_000;

/** How long the escalation waits for a summary before going out without one. */
export const ESCALATION_SUMMARY_TIMEOUT_MS = 15_000;

const SYSTEM = [
  "You summarise a support conversation for the person on the team who will pick it up.",
  "Write one or two short paragraphs of plain text.",
  "Say what the visitor asked or needs, and what the assistant already answered or tried.",
  "Write in the language the visitor wrote in.",
  "Do not address the reader, do not recommend next steps, and never invent a fact that is not in the conversation.",
].join(" ");

function transcriptOf(messages: readonly Pick<StoredMessage, "role" | "content" | "authorName">[]): string {
  const lines = messages.flatMap((message) => {
    if (message.role === "system") return [];
    const text = messageText(message.content ?? [], " ").trim();
    if (!text) return [];
    const speaker =
      message.role === "user" ? "Visitor" : message.role === "operator" ? `Support (${message.authorName ?? "team"})` : "Assistant";
    return [`${speaker}: ${text}`];
  });
  const transcript = lines.join("\n");
  return transcript.length <= ESCALATION_SUMMARY_INPUT_CHARS
    ? transcript
    : `…\n${transcript.slice(transcript.length - ESCALATION_SUMMARY_INPUT_CHARS)}`;
}

export async function summariseEscalation(input: {
  db: Db;
  organizationId: string;
  assistantId: string;
  messages: readonly StoredMessage[];
  timeoutMs?: number;
}): Promise<string | null> {
  // Before the Visitor wrote anything there is nothing to summarise.
  if (!input.messages.some((message) => message.role === "user")) return null;
  try {
    const connections = await input.db.listProviderConnections(input.organizationId);
    // No KeyResolution: the Organization's own connections, never a Member's
    // personal subscription.
    const classifier = getClassifierModel("anthropic", connections);
    if (!classifier) return null;
    const result = await withPostTurnMasking(
      input.db,
      input.assistantId,
      async () => input.messages,
      () =>
        generateText({
          model: classifier.model,
          system: SYSTEM,
          prompt: `Conversation:\n"""${transcriptOf(input.messages)}"""`,
          abortSignal: AbortSignal.timeout(input.timeoutMs ?? ESCALATION_SUMMARY_TIMEOUT_MS),
        })
    );
    await meterUsage(input.db, [
      {
        organizationId: input.organizationId,
        assistantId: input.assistantId,
        stage: "escalation_summary",
        provider: classifier.provider,
        modelId: classifier.modelId,
        credentialKind: classifier.credentialKind,
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
        surface: "widget",
      },
    ]);
    const summary = result.text.trim();
    return summary.length > 0 ? summary : null;
  } catch (error) {
    console.error("[escalation] chat summary failed:", error);
    return null;
  }
}
