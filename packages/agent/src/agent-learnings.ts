import { generateObject } from "ai";
import { z } from "zod";
import { appendAgentLearning, messageText } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { getClassifierModel } from "./models";
import { meterUsage } from "./usage";

/**
 * The Agent memory layer's writer (#771): what a Teammate learned, distilled
 * at the end of a turn.
 *
 * Distilled, never the transcript. A log of what was said is a worse input
 * than nothing, because next turn the model reads its own past words as
 * established fact. What earns a line here is a *durable* fact about doing the
 * standing role, and the bar is deliberately high enough that most turns write
 * nothing: a layer that grows by a line per turn is a layer that is mostly
 * noise by Friday.
 *
 * Best-effort throughout. No model credential, no exchange to read, or an LLM
 * error simply leaves the layer as it was. It runs from the durable job ledger
 * (`distill_agent_memory`), so a failure retries rather than disappearing, and
 * an unwired deployment stays correct with an empty Agent layer.
 */

const LEARNING_SCHEMA = z.object({
  worthKeeping: z
    .boolean()
    .describe(
      "True only if this conversation taught something durable about doing this role. Most conversations teach nothing; false is the normal answer."
    ),
  learning: z
    .string()
    .max(240)
    .describe(
      "One sentence, in the organization's own language, stating the durable fact. Empty when worthKeeping is false."
    ),
});

const DISTILLER_SYSTEM = [
  "You maintain an AI teammate's notebook of what it has learned about doing its job inside one organization.",
  "You are given the teammate's standing role and the last exchange it had with a colleague. Decide whether the exchange taught something durable.",
  "Durable means: a convention this organization uses, a name they have for something, a preference in how work is done here, a correction a colleague made. It has to be useful in a conversation with a DIFFERENT colleague next month.",
  "NOT durable: what was discussed, what the colleague wanted today, anything about one person (their profile is kept separately), anything the teammate could look up, and anything it already knows.",
  "Refusing is the normal answer. Say worthKeeping: false unless the line you would write is one you would want read back in six months.",
].join(" ");

/** How much of the tail the distiller reads. Two turns is the exchange. */
const TRANSCRIPT_TAIL = 4;

export async function distillAgentLearning(input: {
  db: Db;
  organizationId: string;
  teammateId: string;
  conversationId: string;
}): Promise<{ appended: boolean }> {
  const { db, organizationId, teammateId, conversationId } = input;
  const teammate = await db.table("teammates").get(teammateId);
  if (!teammate || teammate.organizationId !== organizationId) {
    return { appended: false };
  }
  // A retired Teammate answers nothing more, so it learns nothing more.
  if (teammate.deletedAt) return { appended: false };

  const messages = await db.listMessages(conversationId);
  const tail = messages.slice(-TRANSCRIPT_TAIL);
  const exchange = tail
    .map((m) => `${m.role}: ${messageText(m.content, " ").trim()}`)
    .filter((line) => line.length > line.indexOf(":") + 2)
    .join("\n");
  if (!exchange) return { appended: false };

  const connections = await db.listProviderConnections(organizationId);
  // Organization connections only, never the Member's personal subscription:
  // this runs unattended off the job ledger, and ADR-0007 as amended by #769
  // allows a personal plan to power its owner's own turns, not background work.
  const classifier = getClassifierModel(teammate.modelProvider, connections);
  // No usable credential: the layer stays as it was, which is a correct
  // outcome rather than a degraded one.
  if (!classifier) return { appended: false };

  let result;
  try {
    result = await generateObject({
      model: classifier.model,
      schema: LEARNING_SCHEMA,
      system: DISTILLER_SYSTEM,
      prompt: [
        `The teammate's standing role, in the organization's words:\n${teammate.roleDescription || "(none given)"}`,
        "",
        `The exchange:\n${exchange}`,
      ].join("\n"),
    });
  } catch (error) {
    console.error("[agent-memory] distillation failed:", error);
    throw error;
  }

  await meterUsage(db, [
    {
      organizationId,
      // A Teammate turn attributes to no Assistant (#768): its id would be a
      // dangling reference in a column that points at `assistants`.
      assistantId: null,
      conversationId,
      stage: "agent_memory",
      provider: classifier.provider,
      modelId: classifier.modelId,
      credentialKind: classifier.credentialKind,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    },
  ]);

  const learning = result.object.learning.trim();
  if (!result.object.worthKeeping || !learning) return { appended: false };

  const existing = await db.getMemoryDocument(organizationId, {
    scope: "agent",
    teammateId,
  });
  const body = appendAgentLearning(
    existing?.body ?? "",
    learning,
    new Date().toISOString()
  );
  // Unchanged body means the append fell off the front cap immediately, which
  // only happens when a single learning exceeds the whole layer. Nothing to
  // record, and a history entry saying so would be noise.
  if (body === (existing?.body ?? "")) return { appended: false };

  await db.writeMemoryDocument({
    organizationId,
    owner: { scope: "agent", teammateId },
    body,
    note: "Learned from a conversation",
    teammateId,
  });
  return { appended: true };
}
