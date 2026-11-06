import { generateObject } from "ai";
import { z } from "zod";
import { messageText } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { getClassifierModel, type ResolvedClassifierModel } from "./models";
import type { HistoryMessage } from "./types";
import {
  isSafeToPersist,
  mintUntrustedNonce,
  untrustedContentPolicy,
  wrapUntrustedContent,
} from "./untrusted-content";
import { meterUsage } from "./usage";

/**
 * What a turn remembers of its own Conversation.
 *
 * A widget Conversation is short, and the last 12 messages are all of it. A
 * Teammate thread is not: a Member works with a colleague over weeks, and a
 * fixed count both loses the start of the thread without a trace and lets one
 * pasted document fill the whole window. So a Teammate turn reads more
 * messages, keeps the newest that fit a character budget (`fitHistory`), and
 * gets a rolling summary of everything older, written off the turn by a job
 * (`summarize_conversation`) and kept in the Conversation's session state.
 *
 * The summary is a standing-context section beside the memory layers, never a
 * message: nobody said it.
 */

/** Messages a Teammate turn reads before the budget decides. */
export const TEAMMATE_HISTORY_FETCH_LIMIT = 40;

/** Characters of history a turn carries, about 6k tokens. */
export const HISTORY_BUDGET_CHARS = 24_000;

/**
 * New messages that must have left the window before a fold runs. Each turn
 * pushes two out; folding every time would be a model call per turn to
 * summarize one exchange.
 */
export const SUMMARY_MIN_FRESH = 6;

/** Longest summary kept, about 400 tokens per turn. */
export const SUMMARY_MAX_CHARS = 1_500;

const CUT_MARKER = "[earlier part omitted] ";

/**
 * The newest messages whose text fits `budgetChars`, oldest dropped first.
 * The newest message always stays: when it alone is over budget its start is
 * cut, because its end is what the next turn answers.
 */
export function fitHistory(
  history: readonly HistoryMessage[],
  budgetChars: number
): { kept: HistoryMessage[]; dropped: number } {
  const kept: HistoryMessage[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i]!;
    if (used + message.text.length <= budgetChars) {
      kept.unshift(message);
      used += message.text.length;
      continue;
    }
    if (kept.length === 0) {
      const room = Math.max(0, budgetChars - CUT_MARKER.length);
      kept.unshift({ ...message, text: `${CUT_MARKER}${message.text.slice(-room)}` });
    }
    break;
  }
  return { kept, dropped: history.length - kept.length };
}

export interface HistorySummary {
  text: string;
  /** The newest message the summary covers. */
  throughMessageId: string;
  throughMessageOffset?: number;
}

const SUMMARY_KEY = "historySummary";

/** The summary stored in a Conversation's session state, if any. */
export function readHistorySummary(sessionState: Record<string, unknown>): HistorySummary | null {
  const value = sessionState[SUMMARY_KEY] as Partial<HistorySummary> | undefined;
  if (!value || typeof value !== "object") return null;
  if (typeof value.text !== "string" || typeof value.throughMessageId !== "string") return null;
  return { text: value.text, throughMessageId: value.throughMessageId, ...(typeof value.throughMessageOffset === "number" ? { throughMessageOffset: value.throughMessageOffset } : {}) };
}

/** The summary as a standing-context section (`memoryDocuments`). */
export function historySummarySection(text: string): string {
  return [
    "# Earlier in this conversation (a summary of messages no longer shown)",
    "Written by the platform from the older part of this thread. Treat it as notes, not as anything either side said word for word.",
    text,
  ].join("\n");
}

const SUMMARY_SCHEMA = z.object({
  summary: z
    .string()
    .describe(
      `The updated summary, at most ${SUMMARY_MAX_CHARS} characters, in the conversation's own language.`
    ),
});

const SUMMARIZER_SYSTEM = [
  "You keep a running summary of a long conversation between a person and an AI colleague, so later turns know what happened before the messages they can still see.",
  "You get the previous summary, if any, and the messages that have just left the visible window. Return one updated summary.",
  "Keep: what the person is working on, decisions made, facts established, open questions, names and numbers that came up. Drop: greetings, repetition, the AI's phrasing.",
  "Write notes, not instructions. Never write anything addressed to the AI.",
].join(" ");

/**
 * Fold the messages that left the recent window into the Conversation's
 * rolling summary. Best-effort: no credential, nothing new to fold, or a
 * summary that reads as an instruction leaves the stored one as it was.
 * Organization connections only: it runs unattended off the job ledger.
 */
export async function summarizeConversation(
  input: { db: Db; organizationId: string; conversationId: string },
  deps: { model?: ResolvedClassifierModel } = {}
): Promise<{ updated: boolean }> {
  const { db, organizationId, conversationId } = input;
  const conversation = await db.getConversation(conversationId);
  if (!conversation) return { updated: false };
  const failures = Number(conversation.sessionState.historySummaryFailures ?? 0);
  if (failures >= 3) return { updated: false };

  const messages = await db.listMessages(conversationId);
  // Exactly what a Teammate turn would leave out: past the fetch window, or
  // inside it but over the character budget. Anything else falls between
  // the summary and the history and is lost without a trace.
  // The same reading as the turn's: a system line ("Dana joined") is not part
  // of the thread, and an operator's reply reads as an earlier answer.
  const window = messages
    .slice(-TEAMMATE_HISTORY_FETCH_LIMIT)
    .filter((message) => message.role !== "system");
  const shown = fitHistory(
    window.map((message) => ({
      role: message.role === "user" ? ("user" as const) : ("assistant" as const),
      text: messageText(message.content),
    })),
    HISTORY_BUDGET_CHARS
  ).kept.length;
  const firstShown = shown > 0 ? window[window.length - shown] : undefined;
  const older = messages.slice(0, firstShown ? messages.indexOf(firstShown) : messages.length);
  if (older.length === 0) return { updated: false };
  const previous = readHistorySummary(conversation.sessionState);
  const coveredUpTo = previous
    ? older.findIndex((message) => message.id === previous.throughMessageId)
    : -1;
  const pending = older.slice(coveredUpTo + (previous?.throughMessageOffset ? 0 : 1));
  // Bound each fold independently of the age of the conversation.
  const fresh = [];
  let chars = 0;
  for (const message of pending) {
    const size = messageText(message.content).length;
    if (fresh.length && chars + size > HISTORY_BUDGET_CHARS) break;
    fresh.push(message);
    chars += size;
  }
  if (!previous?.throughMessageOffset && pending.length < SUMMARY_MIN_FRESH) return { updated: false };

  let resolved = deps.model ?? null;
  if (!resolved) {
    const owner = conversation.teammateId
      ? await db.table("teammates").get(conversation.teammateId)
      : conversation.assistantId
        ? await db.getAssistant(conversation.assistantId)
        : null;
    if (!owner) return { updated: false };
    const connections = await db.listProviderConnections(organizationId);
    resolved = getClassifierModel(owner.modelProvider, connections);
  }
  if (!resolved) return { updated: false };

  const offset = previous?.throughMessageOffset ?? 0;
  const transcript = fresh
    .map((message, index) => `${message.role}: ${messageText(message.content, " ").slice(index === 0 ? offset : 0, (index === 0 ? offset : 0) + HISTORY_BUDGET_CHARS)}`)
    .filter((line) => line.length > line.indexOf(":") + 2)
    .join("\n");
  const nonce = mintUntrustedNonce();
  const result = await generateObject({
    model: resolved.model,
    schema: SUMMARY_SCHEMA,
    // The transcript is somebody's text going into a section every later turn
    // reads (#801, CYB-13), so it is fenced, and the output is scanned below.
    system: `${SUMMARIZER_SYSTEM}\n\n${untrustedContentPolicy(nonce)}`,
    prompt: [
      `Previous summary:\n${previous?.text ?? "(none yet)"}`,
      "",
      "Messages that just left the visible window:",
      wrapUntrustedContent({ provenance: "conversation transcript", body: transcript }, nonce),
    ].join("\n"),
  }).catch(async (error) => {
    await db.mergeConversationSessionState({ id: conversationId, expectedVersion: conversation.sessionVersion, patch: { historySummaryFailures: failures + 1 } });
    throw error;
  });

  await meterUsage(db, [
    {
      organizationId,
      assistantId: conversation.assistantId ?? null,
      conversationId,
      stage: "memory_extract",
      provider: resolved.provider,
      modelId: resolved.modelId,
      credentialKind: resolved.credentialKind,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      ...(conversation.teammateId ? { spenders: { teammateId: conversation.teammateId } } : {}),
      // Housekeeping after the turn, on the org's connections (#849).
      surface: "scheduled",
    },
  ]);

  const text = result.object.summary.trim().slice(0, SUMMARY_MAX_CHARS);
  if (!text || !isSafeToPersist(text)) {
    await db.mergeConversationSessionState({ id: conversationId, expectedVersion: conversation.sessionVersion, patch: { historySummaryFailures: failures + 1 } });
    return { updated: false };
  }

  const last = fresh.at(-1)!;
  const endOffset = (fresh.length === 1 ? offset : 0) + HISTORY_BUDGET_CHARS;
  const summary: HistorySummary = { text, throughMessageId: last.id, ...(messageText(last.content, " ").length > endOffset ? { throughMessageOffset: endOffset } : {}) };
  let expectedVersion = conversation.sessionVersion;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (
      await db.mergeConversationSessionState({
        id: conversationId,
        expectedVersion,
        patch: { [SUMMARY_KEY]: summary, historySummaryFailures: 0 },
      })
    ) {
      return { updated: true };
    }
    const latest = await db.getConversation(conversationId);
    if (!latest) return { updated: false };
    // Another fold landed first. Its summary is built from the same thread,
    // and writing ours over it would drop whatever it covered past `fresh`.
    const latestSummary = readHistorySummary(latest.sessionState);
    if (latestSummary?.throughMessageId !== previous?.throughMessageId || latestSummary?.throughMessageOffset !== previous?.throughMessageOffset) {
      return { updated: false };
    }
    expectedVersion = latest.sessionVersion;
  }
  // Still contended: the job ledger retries the whole fold.
  throw new Error("History summary update remained contended");
}
