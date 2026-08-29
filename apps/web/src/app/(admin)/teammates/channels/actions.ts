"use server";

import type { TeammateChannel } from "@agent-hub/core";
import {
  addChannelMembersOp,
  addChannelTeammatesOp,
  createChannelOp,
  deleteChannelOp,
  markChannelReadOp,
  removeChannelMemberOp,
  removeChannelTeammateOp,
  updateChannelOp,
} from "@ciele/ops";
import { runOperation } from "@/lib/operations";

/**
 * Channel mutations (#778). Thin adapters, like the Teammates actions beside
 * them: the behaviour, the membership rule and the revalidation targets all come
 * from the operation.
 *
 * Posting a message is deliberately NOT here. A message starts a chain, which
 * streams, and a server action cannot stream; it goes through
 * `/api/teammates/channels/[channelId]/chat`, which runs the same operation and
 * then the chain.
 */

export async function createChannelAction(input: {
  name: string;
  memberIds?: string[];
  teammateIds?: string[];
  projectId?: string | null;
}): Promise<TeammateChannel> {
  return runOperation(createChannelOp, input);
}

export async function updateChannelAction(
  id: string,
  patch: { name?: string; projectId?: string | null }
): Promise<TeammateChannel> {
  return runOperation(updateChannelOp, { id, patch });
}

export async function deleteChannelAction(id: string): Promise<void> {
  await runOperation(deleteChannelOp, { id });
}

export async function addChannelMembersAction(
  id: string,
  userIds: string[]
): Promise<void> {
  await runOperation(addChannelMembersOp, { id, userIds });
}

export async function addChannelTeammatesAction(
  id: string,
  teammateIds: string[]
): Promise<void> {
  await runOperation(addChannelTeammatesOp, { id, teammateIds });
}

/** Remove a colleague, or leave: the operation decides which rule applies. */
export async function removeChannelMemberAction(
  id: string,
  userId: string
): Promise<void> {
  await runOperation(removeChannelMemberOp, { id, userId });
}

export async function removeChannelTeammateAction(
  id: string,
  teammateId: string
): Promise<void> {
  await runOperation(removeChannelTeammateOp, { id, teammateId });
}

/** Move this Member's own read marker to now. */
export async function markChannelReadAction(id: string): Promise<void> {
  await runOperation(markChannelReadOp, { id });
}
