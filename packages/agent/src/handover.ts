import type { Assistant, ProviderConnection } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";

import type { ActionEffect, ChatReplyPart, RunResult, UsageEvent } from "./types";
import {
  runAssistantChat,
  type HistoryMessage,
  type KnowledgeSearcher,
  type RuntimeEvent,
} from "./engine";
import { buildKnowledgeSearcher } from "./retrieval";
import type { KnowledgeDocumentReader } from "./knowledge-document-reader";
import type { TurnSession } from "./session";
import type { KeyResolution } from "./models";

/**
 * The handover continuation (#314): running one Conversation Turn's message a
 * second time, inside the Assistant a Flow handed it to.
 *
 * This is the turn's only re-entrant path, and it re-does most of what the
 * primary call's setup did, resolve a Publication, build a KnowledgeSearcher,
 * bind a document reader, fetch an API integration, so it lives here rather
 * than inline in `streamConversationTurn`, where the two setups sat 400 lines
 * apart and drifted silently whenever only one was updated.
 *
 * Three rules are the reason this is a module and not a helper:
 *
 * - **One hop.** The continuation's own handover signal is ignored; a chain of
 *   assistants handing a Visitor onward is a loop with a friendly name.
 * - **Never across tenants.** The target's Publication must belong to the same
 *   Organization. A Flow naming a foreign assistant id resolves to nothing.
 * - **Never worse than the acknowledgement.** An unpublished target, a missing
 *   Publication or any failure leaves the turn with what it already streamed,
 *   so a broken handover degrades to the acknowledgement rather than an error.
 */

export interface HandoverContinuationInput {
  db: Db;
  connections: ProviderConnection[];
  platformPrompt?: string;
  /** The Assistant the matched Flow handed off to, per `handoverTarget`. */
  targetId: string;
  /** The tenant boundary this may never cross. */
  organizationId: string;
  message: string;
  history: HistoryMessage[];
  conversationId: string;
  /**
   * The page the Conversation was launched from. A handover does not move the
   * Visitor, so the target's Flow Conditions gate on the same facts.
   */
  launchUrl?: string | null;
  session: TurnSession;
  alreadyClarified: boolean;
  /**
   * Binds a knowledge reader to one Assistant. The continuation reads as its
   * TARGET, so it gets the target's document boundary, never the originator's.
   */
  readKnowledgeDocumentFor: (assistantId: string) => KnowledgeDocumentReader;
  emit: (event: RuntimeEvent) => void;
  signal: AbortSignal;
  keyResolution?: KeyResolution;
}

export interface HandoverContinuation {
  parts: ChatReplyPart[];
  effects: ActionEffect[];
  usage: UsageEvent[];
  /** The target Assistant's title, for the composed workflow label. */
  targetTitle: string;
  /** The Flow the TARGET matched. */
  flowName: string;
}

/**
 * The Inbox's workflow marker for a handed-over turn: both Flows and the
 * Assistant between them, so a transcript reads as the route it took.
 */
export function handoverFlowName(
  originFlowName: string,
  targetTitle: string,
  continuationFlowName: string
): string {
  return `${originFlowName} → ${targetTitle}: ${continuationFlowName}`;
}

/**
 * Whether a run's handover signal names a real hop. A Flow that hands off to
 * its own Assistant would re-answer the same message twice.
 */
export function handoverTarget(
  result: Pick<RunResult, "handoverTo">,
  originAssistantId: string
): string | null {
  const target = result.handoverTo;
  return target && target !== originAssistantId ? target : null;
}

/**
 * Runs the message inside the target Assistant's latest Publication, or
 * returns null when there is nothing safe to run: no Publication, a target in
 * another Organization, or a failure the turn should absorb.
 *
 * Aborts are not absorbed: a cancelled Conversation Turn stays cancelled.
 */
export async function runHandoverContinuation(
  input: HandoverContinuationInput
): Promise<HandoverContinuation | null> {
  const { db, signal } = input;
  try {
    const publication = await db.getLatestPublication(input.targetId);
    const targetConfig = publication?.config;
    if (
      !targetConfig ||
      targetConfig.assistant.organizationId !== input.organizationId
    ) {
      return null;
    }
    const target: Assistant = {
      ...targetConfig.assistant,
      createdAt: publication.createdAt,
      updatedAt: publication.createdAt,
    };
    // Same factory as the live turn, so the continuation honors the TARGET
    // assistant's Knowledge Engine choice instead of silently running a
    // vector-only path production never uses elsewhere.
    const searchKnowledge: KnowledgeSearcher = buildKnowledgeSearcher({
      db,
      connections: input.connections,
      assistant: target,
      collectionId: null,
      conversationId: input.conversationId,
    });
    const continuation = await runAssistantChat({
      assistant: target,
      platformPrompt: input.platformPrompt,
      flows: targetConfig.flows,
      connections: input.connections,
      message: input.message,
      history: input.history,
      searchKnowledge,
      readKnowledgeDocument: input.readKnowledgeDocumentFor(target.id),
      apiIntegration: await db.getApiIntegration(target.id).catch(() => null),
      collectionId: null,
      session: input.session,
      alreadyClarified: input.alreadyClarified,
      skills: targetConfig.skills ?? [],
      routing: { url: input.launchUrl ?? undefined, now: new Date() },
      emit: input.emit,
      signal,
      keyResolution: input.keyResolution,
    });
    return {
      parts: continuation.parts,
      effects: continuation.effects,
      usage: continuation.usage,
      targetTitle: target.title,
      // The continuation's own `handoverTo` is deliberately not read: one hop.
      flowName: continuation.flowName,
    };
  } catch (error) {
    if (signal.aborted) throw error;
    console.error("[runtime] handover continuation failed:", error);
    return null;
  }
}

/**
 * Folds a continuation into the originating run: its parts, effects and usage
 * append in the order they happened, and the workflow label names the route.
 * Returns a new result rather than mutating, so the merge rule is one tested
 * expression.
 */
export function mergeHandoverContinuation(
  result: RunResult,
  continuation: HandoverContinuation
): RunResult {
  return {
    ...result,
    parts: [...result.parts, ...continuation.parts],
    effects: [...result.effects, ...continuation.effects],
    usage: [...result.usage, ...continuation.usage],
    flowName: handoverFlowName(
      result.flowName,
      continuation.targetTitle,
      continuation.flowName
    ),
  };
}
