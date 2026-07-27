/**
 * Suggested Fix drafting (ADR-0017 / #390): when an Improvement is raised from a
 * flagged answer, draft a reviewable knowledge fix — a FAQ question/answer +
 * rationale + the Sources it drew on — with ONE structured-output LLM call over
 * (conversation excerpt + flagged answer + the Member's description + retrieved
 * knowledge context). The draft is stored for human review; nothing edits
 * knowledge until a Member accepts it.
 *
 * Context retrieval goes through the assistant's active Knowledge Engine
 * (`withGraphEngine` over the vector searcher), so graph context is used when
 * available and vector otherwise — matching how the widget answers.
 *
 * Best-effort: no model credential, no flagged message, or an LLM error simply
 * leaves the Improvement without a proposal (the UI shows a "no proposal"
 * state). It never throws into the caller that raised the Improvement.
 */

import { generateObject } from "ai";
import { z } from "zod";
import type { ImprovementProposalSource } from "@agent-hub/core";
import { messageText } from "@agent-hub/core";

import type { Db } from "@agent-hub/db";
import { embedText } from "./embeddings";
import { withGraphEngine } from "./graph-search";
import { getClassifierModel } from "./models";
import type { KnowledgeSearcher } from "./types";
import { meterUsage } from "./usage";

const PROPOSAL_SCHEMA = z.object({
  draftQuestion: z
    .string()
    .max(500)
    .describe("A concise FAQ question capturing what the visitor actually asked."),
  draftAnswer: z
    .string()
    .max(4000)
    .describe(
      "The correct, self-contained answer, grounded ONLY in the provided knowledge context. If the context does not support a confident answer, say what is missing instead of inventing one."
    ),
  rationale: z
    .string()
    .max(600)
    .describe("One short paragraph: why the original answer fell short and how this fixes it."),
});

const DRAFTER_SYSTEM = [
  "You improve a customer's help knowledge base. You are given a conversation where the assistant's answer was flagged as inadequate, the human reviewer's note, and excerpts of the existing knowledge.",
  "Draft a single FAQ (question + answer) that would let the assistant answer correctly next time.",
  "Ground the answer strictly in the provided knowledge excerpts; do not invent facts. Keep it generic and reusable, not tied to one visitor. Never mention this process or that the answer was flagged.",
].join(" ");

/** Everything the drafter needs, rehydrated from the Db so the job payload stays
 * a set of ids. Null when the Improvement can't produce a proposal. */
async function gatherContext(
  db: Db,
  improvementId: string,
  messageId: string
): Promise<{
  organizationId: string;
  assistantId: string;
  question: string;
  flaggedAnswer: string;
  description: string;
  transcript: string;
  searcher: KnowledgeSearcher;
  collectionId: string | null;
  conversationId: string;
} | null> {
  const [improvement, conversation] = await Promise.all([
    db.getImprovement(improvementId),
    db.getConversationForMessage(messageId),
  ]);
  if (!improvement || !conversation) return null;
  const assistant = await db.getAssistant(conversation.assistantId);
  if (!assistant) return null;

  const messages = await db.listMessages(conversation.id);
  const flagged = messages.find((m) => m.id === messageId);
  const flaggedAnswer = messageText(flagged?.content ?? [], " ").trim();
  if (!flaggedAnswer) return null;

  // The visitor question that preceded the flagged answer (context for the FAQ).
  const flaggedIndex = messages.findIndex((m) => m.id === messageId);
  const priorUser = [...messages.slice(0, flaggedIndex)]
    .reverse()
    .find((m) => m.role === "user");
  const question = messageText(priorUser?.content ?? [], " ").trim();

  const transcript = messages
    .slice(Math.max(0, flaggedIndex - 4), flaggedIndex + 1)
    .map((m) => `${m.role}: ${messageText(m.content, " ").trim()}`)
    .join("\n");

  const connections = await db.listProviderConnections(assistant.organizationId);
  const collectionId = conversation.collectionId;
  const vector: KnowledgeSearcher = async (query, options) => {
    const scoped = options?.scope === "assistant" ? null : collectionId;
    const embedding = await embedText(query, connections, {
      db,
      organizationId: assistant.organizationId,
      assistantId: assistant.id,
      conversationId: conversation.id,
    });
    return db.searchChunks(assistant.id, scoped, { embedding, text: query, limit: 6 });
  };
  const searcher = withGraphEngine({
    db,
    organizationId: assistant.organizationId,
    assistantId: assistant.id,
    collectionId,
    conversationId: conversation.id,
    useGraph: (assistant.knowledgeEngine ?? "graph") === "graph",
    vector,
  });

  return {
    organizationId: assistant.organizationId,
    assistantId: assistant.id,
    question,
    flaggedAnswer,
    description: improvement.description || improvement.title,
    transcript,
    searcher,
    collectionId,
    conversationId: conversation.id,
  };
}

/**
 * Drafts and stores the Suggested Fix for an Improvement. Idempotent — replaces
 * any prior draft. Best-effort: returns without persisting when it can't draft
 * (no model credential, no flagged answer, LLM error).
 */
export async function draftImprovementProposal(deps: {
  db: Db;
  improvementId: string;
  messageId: string;
}): Promise<void> {
  const { db } = deps;
  const ctx = await gatherContext(db, deps.improvementId, deps.messageId).catch(
    (error) => {
      console.error("[proposal] context gathering failed:", error);
      return null;
    }
  );
  if (!ctx) return;

  const connections = await db.listProviderConnections(ctx.organizationId);
  const classifier = getClassifierModel("anthropic", connections);
  if (!classifier) return; // No credential → leave a "no proposal" state.

  // Retrieve knowledge context via the assistant's active engine.
  const query = [ctx.question, ctx.description].filter(Boolean).join(" — ") || ctx.flaggedAnswer;
  const results = await ctx.searcher(query, { scope: "assistant" }).catch((error) => {
    // Retrieval failed (graph/vector outage) — draft from the flagged answer +
    // note alone rather than starving the proposal, but leave a breadcrumb.
    console.error("[proposal] context retrieval failed:", error);
    return [];
  });
  const contextText = results
    .map((r) => `## ${r.conceptTitle}\n${r.content.slice(0, 1500)}`)
    .join("\n\n");
  const sources: ImprovementProposalSource[] = results.map((r) => ({
    conceptId: r.conceptId,
    conceptTitle: r.conceptTitle,
    sourceName: r.sourceName,
  }));

  try {
    const { object, usage } = await generateObject({
      model: classifier.model,
      schema: PROPOSAL_SCHEMA,
      system: DRAFTER_SYSTEM,
      prompt: [
        `Recent conversation:\n"""${ctx.transcript}"""`,
        `Flagged answer:\n"""${ctx.flaggedAnswer}"""`,
        `Reviewer note:\n"""${ctx.description}"""`,
        `Existing knowledge excerpts:\n"""${contextText || "(none found)"}"""`,
      ].join("\n\n"),
    });

    await db.createImprovementProposal({
      improvementId: deps.improvementId,
      organizationId: ctx.organizationId,
      payload: {
        draftQuestion: object.draftQuestion,
        draftAnswer: object.draftAnswer,
        rationale: object.rationale,
        sources,
        model: classifier.modelId,
        targetAssistantId: ctx.assistantId,
        targetCollectionId: ctx.collectionId,
      },
    });

    await meterUsage(db, [
      {
        organizationId: ctx.organizationId,
        assistantId: ctx.assistantId,
        conversationId: ctx.conversationId,
        messageId: deps.messageId,
        stage: "improvement_proposal",
        provider: classifier.provider,
        modelId: classifier.modelId,
        credentialKind: classifier.credentialKind,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
      },
    ]);
  } catch (error) {
    // Leave the Improvement without a proposal; the UI shows a "no proposal"
    // state and the reviewer can still work the item.
    console.error("[proposal] drafting failed:", error);
  }
}
