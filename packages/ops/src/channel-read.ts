import type {
  ChannelMessage,
  ChannelRosterEntry,
  ChannelUnread,
  Teammate,
  TeammateChannel,
  TeammateChannelParticipant,
} from "@agent-hub/core";
import {
  channelMemberIds,
  channelRoster,
  channelTeammateIds,
  channelUnread,
  messageText,
} from "@agent-hub/core";

import type { OperationContext } from "./operation";

export interface ChannelReadIndex {
  channels: TeammateChannel[];
  participantsByChannel: Map<string, TeammateChannelParticipant[]>;
}
export interface ChannelRosterProjection {
  teammates: Teammate[];
  roster: ChannelRosterEntry[];
}

export interface ChannelSummary {
  channel: TeammateChannel;
  memberIds: string[];
  teammateIds: string[];
  unread: ChannelUnread;
  lastMessagePreview: string;
  lastMessageAt: string | null;
}

export interface ChannelView extends ChannelRosterProjection {
  channel: TeammateChannel;
  participants: TeammateChannelParticipant[];
  messages: ChannelMessage[];
  canManage: boolean;
}

const UNREAD_SCAN_LIMIT = 30;

/** Rows grouped by their channel, each group in input order. */
function byChannel<T extends { channelId: string }>(
  rows: readonly T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.channelId);
    if (group) group.push(row);
    else groups.set(row.channelId, [row]);
  }
  return groups;
}

/** One channel/seat index shared by ordinary and oversight list adapters. */
export async function loadChannelReadIndex(
  ctx: OperationContext,
): Promise<ChannelReadIndex> {
  const [channels, participants] = await Promise.all([
    ctx.db.table("teammateChannels").list({
      organizationId: ctx.organizationId,
    }),
    ctx.db.table("teammateChannelParticipants").list({
      organizationId: ctx.organizationId,
    }),
  ]);
  return { channels, participantsByChannel: byChannel(participants) };
}

/** Names and live Teammate rows, with each Organization table read once. */
export async function hydrateChannelRoster(
  ctx: OperationContext,
  participants: readonly TeammateChannelParticipant[],
): Promise<ChannelRosterProjection> {
  const memberIds = new Set(channelMemberIds(participants));
  const teammateIds = new Set(channelTeammateIds(participants));
  const [members, organizationTeammates] = await Promise.all([
    ctx.db.listMembers(ctx.organizationId),
    ctx.db.table("teammates").list({ organizationId: ctx.organizationId }),
  ]);
  const teammates = organizationTeammates.filter((teammate) =>
    teammateIds.has(teammate.id),
  );
  return {
    teammates,
    roster: channelRoster(
      members.filter((member) => memberIds.has(member.userId)),
      teammates,
    ),
  };
}

/**
 * Last-message and unread projection for any selected Channel set. Transcript
 * work is one bounded adapter read, irrespective of the number of Channels.
 */
export async function summarizeChannels(
  ctx: OperationContext,
  channels: readonly TeammateChannel[],
  participantsByChannel: ReadonlyMap<
    string,
    readonly TeammateChannelParticipant[]
  >,
  userId: string,
): Promise<ChannelSummary[]> {
  const messages = await ctx.db.listChannelMessageWindows(
    channels.map((channel) => channel.id),
    UNREAD_SCAN_LIMIT,
  );
  const messagesByChannel = byChannel(messages);
  return channels
    .map((channel) => {
      const participants = participantsByChannel.get(channel.id) ?? [];
      const transcript = messagesByChannel.get(channel.id) ?? [];
      const seat = participants.find((row) => row.userId === userId);
      const last = transcript[transcript.length - 1];
      return {
        channel,
        memberIds: channelMemberIds(participants),
        teammateIds: channelTeammateIds(participants),
        unread: channelUnread(transcript, seat?.lastReadAt ?? null, userId),
        lastMessagePreview: last ? messageText(last.content).slice(0, 160) : "",
        lastMessageAt: last?.createdAt ?? null,
      };
    })
    .sort((a, b) => (a.channel.updatedAt < b.channel.updatedAt ? 1 : -1));
}

export async function hydrateChannelView(
  ctx: OperationContext,
  channel: TeammateChannel,
  participants: TeammateChannelParticipant[],
  canManage: boolean,
): Promise<ChannelView> {
  const [projection, messages] = await Promise.all([
    hydrateChannelRoster(ctx, participants),
    ctx.db.listChannelMessages(channel.id),
  ]);
  return { channel, participants, ...projection, messages, canManage };
}
