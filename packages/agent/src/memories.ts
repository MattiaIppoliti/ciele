import { generateObject } from "ai";
import { z } from "zod";
import { messageText } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { embedTexts } from "./embeddings";
import { getClassifierModel } from "./models";
import { createTurnSession, MEMORY_FACT_MAX } from "./session";
import { meterUsage, usageTotals } from "./usage";

/**
 * Long-term memory promotion (#664): the background half of the memory loop.
 * When a Conversation goes quiet, a `promote_memories` job (jobs.ts) calls
 * {@link promoteConversationMemories}: it reads the transcript tail plus the
 * session-memory facts, asks a small model for the durable facts worth
 * carrying into the user's NEXT conversation, embeds them, and upserts them
 * keyed to the verified SSO subject. Recall (turn.ts) then injects the top-k
 * relevant memories as the "Long-term memory" prompt block on a conversation's
 * first turn and offers the `searchMemories` tool (tools.ts) mid-conversation.
 *
 * Everything here is gated and fail-soft: SSO subjects only, org toggle off by
 * default, budget-exhausted orgs skip extraction, and nothing in this module
 * ever runs on the chat request path.
 */

/** How many memories a recall (prompt block or tool call) returns at most. */
export const MEMORY_RECALL_LIMIT = 5;

/**
 * How long a conversation must stay quiet before its promotion job runs. A
 * new turn enqueues a fresh job, and an older job that finds messages newer
 * than itself defers to that fresher one — so only the conversation's last
 * turn actually extracts.
 */
export const MEMORY_QUIET_MS = 15 * 60_000;

/** Transcript tail the extraction reads (most recent messages). */
const EXTRACT_TAIL_LIMIT = 30;
const MAX_FACTS_PER_EXTRACTION = 5;

// No .max() on the array: an over-eager model must degrade to the best few
// (sliced below), never to a validation error → nothing promoted.
const FACTS_SCHEMA = z.object({
  facts: z.array(z.string().max(MEMORY_FACT_MAX)),
});

const EXTRACT_SYSTEM = [
  "You extract durable facts about a signed-in user from one finished support-chat conversation, so the assistant can recognize them next time.",
  "Promote ONLY what stays true beyond this conversation: explicit preferences (\"prefers email\"), standing instructions (\"always ship to the Berlin office\"), and stable facts the user stated about themselves or their account.",
  "Never promote: anything the assistant said, one-off requests, questions, guesses, sentiments, or details tied to this conversation's specific issue.",
  `Each fact must be one short self-contained sentence in the user's own language. Return at most ${MAX_FACTS_PER_EXTRACTION} facts — an empty list is the right answer for most conversations.`,
].join(" ");

export interface PromoteMemoriesInput {
  db: Db;
  conversationId: string;
  organizationId: string;
  /**
   * When the promotion job was enqueued. Messages newer than this mean a
   * later turn happened (which enqueued its own job) — this run defers.
   */
  enqueuedAt?: string;
}

export type PromoteMemoriesOutcome = {
  promoted: number;
  /** Why nothing was promoted; absent on a productive run. */
  skipped?:
    | "not-found"
    | "not-sso"
    | "disabled"
    | "superseded"
    | "budget-exhausted"
    | "no-model"
    | "nothing-durable";
};

/**
 * True when the org has a daily token limit and has already spent it — the
 * extraction call is deliberate spend, so it skips (fail-soft, retried by a
 * later conversation's job). Read errors fail open like the chat-path check:
 * accounting problems must never wedge the memory loop.
 */
async function orgBudgetExhausted(db: Db, organizationId: string): Promise<boolean> {
  try {
    const budget = await db.getOrgBudget(organizationId);
    if (budget?.dailyTokenLimit == null) return false;
    return (await db.getOrgTokensUsedToday(organizationId)) >= budget.dailyTokenLimit;
  } catch {
    return false;
  }
}

/**
 * Executes one promotion: gate → extract → embed → upsert. Returns what
 * happened instead of throwing on the expected skip paths, so the job layer
 * only retries genuine failures (model/db errors thrown from inside).
 */
export async function promoteConversationMemories(
  input: PromoteMemoriesInput
): Promise<PromoteMemoriesOutcome> {
  const { db, conversationId, organizationId } = input;

  const conversation = await db.getConversation(conversationId);
  if (!conversation) return { promoted: 0, skipped: "not-found" };
  // Anonymous Visitors (and Preview members) never produce Memories — the
  // capability keys strictly on the verified SSO subject (ADR-0018).
  if (conversation.subjectType !== "sso") return { promoted: 0, skipped: "not-sso" };
  if (!(await db.getMemoryEnabled(organizationId))) {
    return { promoted: 0, skipped: "disabled" };
  }

  const messages = await db.listRecentMessages(conversationId, EXTRACT_TAIL_LIMIT);
  if (messages.length === 0) return { promoted: 0, skipped: "nothing-durable" };
  // Quiet check: a message newer than this job means a later turn enqueued a
  // fresher job — succeed as a no-op and let that one extract the full tail.
  if (
    input.enqueuedAt &&
    messages.some((m) => m.createdAt > input.enqueuedAt!)
  ) {
    return { promoted: 0, skipped: "superseded" };
  }

  if (await orgBudgetExhausted(db, organizationId)) {
    return { promoted: 0, skipped: "budget-exhausted" };
  }

  const assistant = await db.getAssistant(conversation.assistantId);
  const connections = await db.listProviderConnections(organizationId);
  // Extraction runs on the small classifier-tier model; without any
  // credentialed provider there is nothing to extract with.
  const extractor = getClassifierModel(
    assistant?.modelProvider ?? "google",
    connections
  );
  if (!extractor) return { promoted: 0, skipped: "no-model" };

  const transcript = messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${messageText(m.content)}`)
    .join("\n");
  const sessionFacts = createTurnSession(
    conversationId,
    conversation.sessionState
  ).memory();

  const { object, usage } = await generateObject({
    model: extractor.model,
    schema: FACTS_SCHEMA,
    system: EXTRACT_SYSTEM,
    prompt: [
      sessionFacts.length > 0
        ? `Session-memory facts already noted during the conversation:\n${sessionFacts.map((f) => `- ${f}`).join("\n")}\n`
        : "",
      `Conversation transcript:\n"""\n${transcript}\n"""`,
    ].join("\n"),
  });
  await meterUsage(db, [
    {
      organizationId,
      assistantId: conversation.assistantId,
      conversationId,
      stage: "memory_extract",
      provider: extractor.provider,
      modelId: extractor.modelId,
      credentialKind: extractor.credentialKind,
      ...usageTotals(usage),
    },
  ]);

  const facts = object.facts
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
    .slice(0, MAX_FACTS_PER_EXTRACTION);
  if (facts.length === 0) return { promoted: 0, skipped: "nothing-durable" };

  const embeddings = await embedTexts(facts, connections, {
    db,
    organizationId,
    assistantId: conversation.assistantId,
    conversationId,
  });
  const promoted = await db.upsertMemories(
    { organizationId, subjectId: conversation.subjectId },
    facts.map((text, i) => ({
      text,
      embedding: embeddings[i] ?? null,
      conversationId,
    }))
  );
  return { promoted };
}
