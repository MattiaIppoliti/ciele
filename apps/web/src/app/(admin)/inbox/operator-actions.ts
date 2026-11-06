"use server";

import {
  OperationError,
  getConversationOp,
  getOperatorStatusOp,
  listMemberNotificationsOp,
  listQuickTextsOp,
  listWaitingConversationsOp,
  setHelpDeskOperatorsOp,
  setOperatorStatusOp,
  readConversationLiveOp,
  releaseConversationOp,
  replyToConversationOp,
  takeOverConversationOp,
  type ConversationLive,
  type TakeOverResult,
  type WaitingConversation,
} from "@ciele/ops";
import type { OperatorStatus, QuickText, StoredMessage } from "@agent-hub/core";
import { resolveQuickText } from "@agent-hub/agent";
import { CapabilityRefusedError } from "@/lib/authz";
import { runOperation } from "@/lib/operations";

/**
 * Human operators in the Inbox (#1082). Each action answers with a result
 * rather than throwing for the expected refusals: "Dana is already answering
 * this conversation" is something the Member should read, not an error page.
 */
export type OperatorActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function attempt<T>(run: () => Promise<T>): Promise<OperatorActionResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (error instanceof OperationError || error instanceof CapabilityRefusedError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

export async function takeOverConversationAction(
  conversationId: string
): Promise<OperatorActionResult<TakeOverResult>> {
  return attempt(() => runOperation(takeOverConversationOp, { id: conversationId }));
}

export async function replyToConversationAction(
  conversationId: string,
  text: string
): Promise<OperatorActionResult<StoredMessage>> {
  return attempt(() => runOperation(replyToConversationOp, { id: conversationId, text }));
}

export async function releaseConversationAction(
  conversationId: string
): Promise<OperatorActionResult<TakeOverResult>> {
  return attempt(() => runOperation(releaseConversationOp, { id: conversationId }));
}

export async function listWaitingConversationsAction(): Promise<
  OperatorActionResult<WaitingConversation[]>
> {
  return attempt(() => runOperation(listWaitingConversationsOp, {}));
}

/** Staff a Help Desk's Live operator channel (#1084). */
export async function setHelpDeskOperatorsAction(
  helpDeskId: string,
  operators: Array<{ memberId: string; capacity: number }>
): Promise<OperatorActionResult<number>> {
  return attempt(async () => (await runOperation(setHelpDeskOperatorsOp, { helpDeskId, operators })).length);
}

/** The signed-in Member's own Available/Away status (#1084). */
export async function getOperatorStatusAction(): Promise<OperatorActionResult<OperatorStatus>> {
  return attempt(async () => (await runOperation(getOperatorStatusOp, {})).status);
}

export async function setOperatorStatusAction(
  status: OperatorStatus
): Promise<OperatorActionResult<OperatorStatus>> {
  return attempt(async () => (await runOperation(setOperatorStatusOp, { status })).status);
}

/**
 * The Organization's Quick Texts with their bodies filled from this
 * Conversation (#1085), for the reply box's `/` picker. Read whole on open:
 * the list is small and filtering is instant on the client.
 */
export async function quickTextsForConversationAction(
  conversationId: string
): Promise<OperatorActionResult<Array<Pick<QuickText, "id" | "title" | "folder"> & { text: string }>>> {
  return attempt(async () => {
    const [{ conversation }, quickTexts] = await Promise.all([
      runOperation(getConversationOp, { id: conversationId }),
      runOperation(listQuickTextsOp, {}).catch(() => [] as QuickText[]),
    ]);
    return quickTexts.map((quickText) => ({
      id: quickText.id,
      title: quickText.title,
      folder: quickText.folder,
      text: resolveQuickText(quickText.body, conversation),
    }));
  });
}

export async function readConversationLiveAction(
  conversationId: string,
  after: string
): Promise<OperatorActionResult<ConversationLive>> {
  return attempt(() => runOperation(readConversationLiveOp, { id: conversationId, after }));
}

/** Renew only the live console lease and refresh durable assignment notices. */
export async function renewOperatorPresenceAction(): Promise<OperatorActionResult<{ status: OperatorStatus; notificationIds: string[] | null }>> {
  return attempt(async () => {
    const { status } = await runOperation(setOperatorStatusOp, { status: "available", renewOnly: true });
    const notices = status === "available" ? await runOperation(listMemberNotificationsOp, { kinds: ["conversation_assigned"], unreadOnly: true, limit: 200 }).catch(() => null) : [];
    return { status, notificationIds: notices?.map(row => row.id) ?? null };
  });
}
