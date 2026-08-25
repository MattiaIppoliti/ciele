import { z } from "zod";
import type {
  ChannelMessage,
  ChannelRosterEntry,
  ChannelUnread,
  Teammate,
  TeammateChannel,
  TeammateChannelParticipant,
} from "@agent-hub/core";
import {
  canAddToChannel,
  canAddTeammateToChannel,
  canManageChannel,
  channelMemberIds,
  channelRoster,
  channelTeammateIds,
  channelUnread,
  isChannelMember,
  isTeammateRetired,
  mentionedTeammateIds,
  messageText,
  parseChannelMentions,
} from "@agent-hub/core";
import { OperationError, defineOperation, type OperationContext } from "./operation";

/**
 * Teammate channels (#778): the group thread as an org resource.
 *
 * Three access rules, and keeping them apart is the point.
 *
 * - **Capability** is `member` on almost everything here. Opening a channel and
 *   inviting colleagues is not configuring an agent, so the Editor+ gate that
 *   guards a Teammate's persona deliberately does not apply (#776). The two
 *   oversight reads are the exception: they declare `manageMembers`, because
 *   reading a thread you were not invited to is an admin act.
 * - **Membership** is the visibility rule. A channel a Member is not in refuses
 *   with `not_found`, never "forbidden": invite-based means a colleague does not
 *   learn which threads exist without them.
 * - **The manage rule** (creator or org admin) covers the name, the bound
 *   Project, removing people and deleting the thread. Everyone in the channel
 *   may *add*, because invite-based group chat where only one person can invite
 *   is a queue in front of one person.
 *
 * Mention fan-out lives here too, in `postChannelMessageOp`: the message is
 * persisted with the ids it addressed, and the Teammates among them are what the
 * runtime is asked to run. The caps are the chain runner's, because they are
 * counted across turns; the perimeter is this layer's, because it is the roster.
 */

const idSchema = z.object({ id: z.string().min(1) });
const ID_LIST = z.array(z.string().min(1)).max(50);

/** Anything a channel operation needs about the thread it was handed. */
interface ResolvedChannel {
  channel: TeammateChannel;
  participants: TeammateChannelParticipant[];
}

function viewerOf(ctx: OperationContext) {
  return { userId: ctx.userId, role: ctx.role };
}

/**
 * The Member acting, or a refusal.
 *
 * A channel is a thread between people, so every operation here needs somebody
 * to be. An organization API key has a creator but no seat, and putting `''`
 * into a `uuid` column would fail as a database error where an answer belongs.
 */
function requireActor(ctx: OperationContext): string {
  if (!ctx.userId) {
    throw new OperationError(
      "invalid_input",
      "A channel is a thread between colleagues, so this needs a signed-in member rather than an API key."
    );
  }
  return ctx.userId;
}

async function loadChannel(
  ctx: OperationContext,
  id: string
): Promise<ResolvedChannel | null> {
  const channel = await ctx.db.table("teammateChannels").get(id);
  if (!channel || channel.organizationId !== ctx.organizationId) return null;
  const participants = await ctx.db
    .table("teammateChannelParticipants")
    .list({ channelId: id });
  return { channel, participants };
}

/** id → a channel this Member is in, or `not_found`. */
async function requireChannel(
  ctx: OperationContext,
  id: string
): Promise<ResolvedChannel> {
  const resolved = await loadChannel(ctx, id);
  if (!resolved || !isChannelMember(resolved.participants, ctx.userId)) {
    throw new OperationError("not_found", "Channel not found");
  }
  return resolved;
}

/** id → a channel this Member may change (creator or org admin). */
async function requireManageableChannel(
  ctx: OperationContext,
  id: string
): Promise<ResolvedChannel> {
  const resolved = await loadChannel(ctx, id);
  const manages = resolved
    ? canManageChannel(resolved.channel, viewerOf(ctx))
    : false;
  if (
    !resolved ||
    (!isChannelMember(resolved.participants, ctx.userId) && !manages)
  ) {
    throw new OperationError("not_found", "Channel not found");
  }
  if (!manages) {
    throw new OperationError(
      "invalid_input",
      "Only whoever opened this channel, or an organization admin, can change it."
    );
  }
  return resolved;
}

/** id → any channel in the org, for the two admin oversight reads. */
async function requireOrgChannel(
  ctx: OperationContext,
  id: string
): Promise<ResolvedChannel> {
  const resolved = await loadChannel(ctx, id);
  if (!resolved) throw new OperationError("not_found", "Channel not found");
  return resolved;
}

/** The Teammates seated here, live rows only. */
async function seatedTeammates(
  ctx: OperationContext,
  participants: readonly TeammateChannelParticipant[]
): Promise<Teammate[]> {
  const ids = new Set(channelTeammateIds(participants));
  if (ids.size === 0) return [];
  const teammates = await ctx.db
    .table("teammates")
    .list({ organizationId: ctx.organizationId });
  return teammates.filter((teammate) => ids.has(teammate.id));
}

/** The roster as the mention resolver reads it: everybody seated, by name. */
async function rosterOf(
  ctx: OperationContext,
  participants: readonly TeammateChannelParticipant[]
): Promise<ChannelRosterEntry[]> {
  const seatedMembers = new Set(channelMemberIds(participants));
  const [members, teammates] = await Promise.all([
    ctx.db.listMembers(ctx.organizationId),
    seatedTeammates(ctx, participants),
  ]);
  return channelRoster(
    members.filter((member) => seatedMembers.has(member.userId)),
    // A retired Teammate keeps its seat so its past messages still resolve to a
    // name, and it takes no turn: `postChannelMessage` never targets one.
    teammates
  );
}

/** One row of the channel list in the Teammates roster. */
export interface ChannelSummary {
  channel: TeammateChannel;
  memberIds: string[];
  teammateIds: string[];
  unread: ChannelUnread;
  /** The last thing said, for the roster row. Empty on a channel with no messages. */
  lastMessagePreview: string;
  lastMessageAt: string | null;
}

/** How much transcript the roster reads per channel to count unreads. */
const UNREAD_SCAN_LIMIT = 30;

async function summarize(
  ctx: OperationContext,
  channel: TeammateChannel,
  participants: readonly TeammateChannelParticipant[],
  userId: string
): Promise<ChannelSummary> {
  const messages = await ctx.db.listChannelMessages(
    channel.id,
    UNREAD_SCAN_LIMIT
  );
  const seat = participants.find((row) => row.userId === userId);
  const last = messages[messages.length - 1];
  return {
    channel,
    memberIds: channelMemberIds(participants),
    teammateIds: channelTeammateIds(participants),
    unread: channelUnread(messages, seat?.lastReadAt ?? null, userId),
    lastMessagePreview: last ? messageText(last.content).slice(0, 160) : "",
    lastMessageAt: last?.createdAt ?? null,
  };
}

/**
 * The channels this Member is in, most recently active first.
 *
 * One participants read for the whole organization rather than one per channel:
 * the roster page renders channels beside the 1:1 threads, and a query per row
 * is how a sidebar becomes the slowest thing on the page.
 */
export const listChannelsOp = defineOperation({
  name: "channels.list",
  capability: "member",
  input: z.object({}),
  entities: () => [],
  run: async (ctx): Promise<ChannelSummary[]> => {
    const userId = ctx.userId;
    if (!userId) return [];
    const [channels, allSeats] = await Promise.all([
      ctx.db.table("teammateChannels").list({
        organizationId: ctx.organizationId,
      }),
      ctx.db.table("teammateChannelParticipants").list({
        organizationId: ctx.organizationId,
      }),
    ]);
    const byChannel = new Map<string, TeammateChannelParticipant[]>();
    for (const seat of allSeats) {
      const rows = byChannel.get(seat.channelId);
      if (rows) rows.push(seat);
      else byChannel.set(seat.channelId, [seat]);
    }
    const mine = channels.filter((channel) =>
      isChannelMember(byChannel.get(channel.id) ?? [], userId)
    );
    const summaries = await Promise.all(
      mine.map((channel) =>
        summarize(ctx, channel, byChannel.get(channel.id) ?? [], userId)
      )
    );
    return summaries.sort((a, b) =>
      a.channel.updatedAt < b.channel.updatedAt ? 1 : -1
    );
  },
});

/** One channel: the thread, its roster, and the names a mention can reach. */
export interface ChannelView {
  channel: TeammateChannel;
  participants: TeammateChannelParticipant[];
  teammates: Teammate[];
  roster: ChannelRosterEntry[];
  messages: ChannelMessage[];
  /** Whether this caller may rename it, rebind it, or remove people. */
  canManage: boolean;
}

export const getChannelOp = defineOperation({
  name: "channels.get",
  capability: "member",
  input: idSchema,
  entities: () => [],
  run: async (ctx, { id }): Promise<ChannelView> => {
    const { channel, participants } = await requireChannel(ctx, id);
    const [teammates, roster, messages] = await Promise.all([
      seatedTeammates(ctx, participants),
      rosterOf(ctx, participants),
      ctx.db.listChannelMessages(id),
    ]);
    return {
      channel,
      participants,
      teammates,
      roster,
      messages,
      canManage: canManageChannel(channel, viewerOf(ctx)),
    };
  },
});

export const channelInputSchema = z.object({
  name: z.string().min(1).max(120),
  /** Colleagues to invite straight away; the creator is always seated. */
  memberIds: ID_LIST.optional(),
  teammateIds: ID_LIST.optional(),
  projectId: z.string().min(1).nullable().optional(),
});

export const createChannelOp = defineOperation({
  name: "channels.create",
  capability: "member",
  input: channelInputSchema,
  entities: () => [{ kind: "channelList" as const }],
  run: async (ctx, input): Promise<TeammateChannel> => {
    const userId = requireActor(ctx);
    const projectId = input.projectId
      ? (await requireLiveProject(ctx, input.projectId)).id
      : null;
    const channel = await ctx.db.table("teammateChannels").insert({
      organizationId: ctx.organizationId,
      name: input.name,
      projectId,
      createdBy: userId,
    });
    const inOrg = await orgMemberIds(ctx);
    // The creator's own seat first: without it they would have opened a thread
    // they cannot see, since membership is the visibility rule.
    await seatMember(ctx, channel.id, userId, userId, inOrg);
    for (const memberId of input.memberIds ?? []) {
      if (memberId === userId) continue;
      await seatMember(ctx, channel.id, memberId, userId, inOrg);
    }
    for (const teammateId of input.teammateIds ?? []) {
      await seatTeammate(ctx, channel.id, teammateId, userId);
    }
    return channel;
  },
});

/** What a channel edit accepts. Named so the API contract can render it. */
export const channelPatchSchema = z
  .object({
    name: z.string().min(1).max(120),
    projectId: z.string().min(1).nullable(),
  })
  .partial();

/** The two roster bodies, named for the same reason. */
export const channelMembersSchema = z.object({ userIds: ID_LIST });
export const channelTeammatesSchema = z.object({ teammateIds: ID_LIST });

export const updateChannelOp = defineOperation({
  name: "channels.update",
  capability: "member",
  input: z.object({
    id: z.string().min(1),
    patch: channelPatchSchema,
  }),
  entities: ({ id }) => [
    { kind: "channel" as const, id },
    { kind: "channelList" as const },
  ],
  run: async (ctx, { id, patch }): Promise<TeammateChannel> => {
    await requireManageableChannel(ctx, id);
    if (patch.projectId) await requireLiveProject(ctx, patch.projectId);
    return ctx.db.table("teammateChannels").update(id, patch);
  },
});

/**
 * Close the channel.
 *
 * A hard delete, and unlike a Teammate's tombstone that is the right shape
 * here: a Teammate's transcripts live nowhere but its own thread, so retiring it
 * has to keep them, whereas a channel *is* the thread, and the people in it
 * asked for it to exist. Restricted to whoever opened it (or an admin), because
 * the transcript belongs to everybody who was in it.
 */
export const deleteChannelOp = defineOperation({
  name: "channels.delete",
  capability: "member",
  input: idSchema,
  entities: ({ id }) => [
    { kind: "channel" as const, id },
    { kind: "channelList" as const },
  ],
  run: async (ctx, { id }): Promise<void> => {
    await requireManageableChannel(ctx, id);
    await ctx.db.table("teammateChannels").delete(id);
  },
});

/** A live, unarchived Project, or a refusal explaining which it failed. */
async function requireLiveProject(ctx: OperationContext, projectId: string) {
  const project = await ctx.db.table("projects").get(projectId);
  if (!project || project.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Project not found");
  }
  if (project.archived) {
    throw new OperationError(
      "invalid_input",
      `${project.name} is archived, so its decisions are read-only and would reach nobody in this channel.`
    );
  }
  return project;
}

/**
 * Seat one Member.
 *
 * `orgMemberIds` is passed in rather than read here: inviting a list of
 * colleagues would otherwise re-read the whole roster once per name.
 */
async function seatMember(
  ctx: OperationContext,
  channelId: string,
  userId: string,
  addedBy: string,
  orgMemberIds: Set<string>
): Promise<void> {
  if (!orgMemberIds.has(userId)) {
    throw new OperationError("not_found", "Member not found");
  }
  const held = await ctx.db
    .table("teammateChannelParticipants")
    .list({ channelId, userId });
  // Inviting twice is inviting. The unique index would refuse the second row,
  // and there is nothing to tell anybody about that.
  if (held.length > 0) return;
  await ctx.db.table("teammateChannelParticipants").insert({
    organizationId: ctx.organizationId,
    channelId,
    userId,
    addedBy,
  });
}

async function seatTeammate(
  ctx: OperationContext,
  channelId: string,
  teammateId: string,
  addedBy: string
): Promise<void> {
  const teammate = await ctx.db.table("teammates").get(teammateId);
  // `not_found` for "no such Teammate", "another Organization's", "somebody
  // else's private one" and "retired", on purpose: adding a private Teammate to
  // a channel of colleagues is a disclosure, so the refusal must not confirm it
  // exists (#776).
  if (
    !teammate ||
    teammate.organizationId !== ctx.organizationId ||
    !canAddTeammateToChannel(teammate, viewerOf(ctx))
  ) {
    throw new OperationError("not_found", "Teammate not found");
  }
  const held = await ctx.db
    .table("teammateChannelParticipants")
    .list({ channelId, teammateId });
  if (held.length > 0) return;
  await ctx.db.table("teammateChannelParticipants").insert({
    organizationId: ctx.organizationId,
    channelId,
    teammateId,
    addedBy,
  });
}

/** The Organization's Member ids, read once per operation that seats people. */
async function orgMemberIds(ctx: OperationContext): Promise<Set<string>> {
  const members = await ctx.db.listMembers(ctx.organizationId);
  return new Set(members.map((member) => member.userId));
}

/** Whoever is in the channel may invite: that is what invite-based means. */
async function requireInviter(
  ctx: OperationContext,
  id: string
): Promise<ResolvedChannel> {
  const resolved = await loadChannel(ctx, id);
  if (
    !resolved ||
    !canAddToChannel(resolved.participants, resolved.channel, viewerOf(ctx))
  ) {
    throw new OperationError("not_found", "Channel not found");
  }
  return resolved;
}

export const addChannelMembersOp = defineOperation({
  name: "channels.members.add",
  capability: "member",
  input: z.object({ id: z.string().min(1), userIds: ID_LIST }),
  entities: ({ id }) => [
    { kind: "channel" as const, id },
    { kind: "channelList" as const },
  ],
  run: async (ctx, { id, userIds }): Promise<void> => {
    const actor = requireActor(ctx);
    await requireInviter(ctx, id);
    const inOrg = await orgMemberIds(ctx);
    for (const userId of userIds) {
      await seatMember(ctx, id, userId, actor, inOrg);
    }
  },
});

export const addChannelTeammatesOp = defineOperation({
  name: "channels.teammates.add",
  capability: "member",
  input: z.object({ id: z.string().min(1), teammateIds: ID_LIST }),
  entities: ({ id }) => [
    { kind: "channel" as const, id },
    { kind: "channelList" as const },
  ],
  run: async (ctx, { id, teammateIds }): Promise<void> => {
    const actor = requireActor(ctx);
    await requireInviter(ctx, id);
    for (const teammateId of teammateIds) {
      await seatTeammate(ctx, id, teammateId, actor);
    }
  },
});

/**
 * Remove a Member, or leave.
 *
 * Removing somebody else is the manage rule; removing yourself is always
 * allowed, because a colleague who was invited into a thread must be able to
 * step out of it without asking the person who invited them.
 */
export const removeChannelMemberOp = defineOperation({
  name: "channels.members.remove",
  capability: "member",
  input: z.object({ id: z.string().min(1), userId: z.string().min(1) }),
  entities: ({ id }) => [
    { kind: "channel" as const, id },
    { kind: "channelList" as const },
  ],
  run: async (ctx, { id, userId }): Promise<void> => {
    const actor = requireActor(ctx);
    const resolved =
      userId === actor
        ? await requireChannel(ctx, id)
        : await requireManageableChannel(ctx, id);
    const seat = resolved.participants.find((row) => row.userId === userId);
    if (!seat) return;
    await ctx.db.table("teammateChannelParticipants").delete(seat.id);
  },
});

export const removeChannelTeammateOp = defineOperation({
  name: "channels.teammates.remove",
  capability: "member",
  input: z.object({ id: z.string().min(1), teammateId: z.string().min(1) }),
  entities: ({ id }) => [
    { kind: "channel" as const, id },
    { kind: "channelList" as const },
  ],
  run: async (ctx, { id, teammateId }): Promise<void> => {
    const resolved = await requireManageableChannel(ctx, id);
    const seat = resolved.participants.find(
      (row) => row.teammateId === teammateId
    );
    if (!seat) return;
    await ctx.db.table("teammateChannelParticipants").delete(seat.id);
  },
});

/** What posting produced: the durable message, and who it asks to answer. */
export interface PostedChannelMessage {
  message: ChannelMessage;
  /**
   * The seated, live Teammates the message addressed, in the order it addressed
   * them. Empty is the normal case for a message between colleagues, and it
   * means no turn runs: mention-only is the whole activation rule (#775).
   */
  targets: string[];
  roster: ChannelRosterEntry[];
  teammates: Teammate[];
  channel: TeammateChannel;
}

export const postChannelMessageOp = defineOperation({
  name: "channels.messages.post",
  capability: "member",
  input: z.object({
    id: z.string().min(1),
    message: z.string().min(1).max(8000),
  }),
  entities: ({ id }) => [
    { kind: "channel" as const, id },
    { kind: "channelList" as const },
  ],
  run: async (ctx, input): Promise<PostedChannelMessage> => {
    const actor = requireActor(ctx);
    const { channel, participants } = await requireChannel(ctx, input.id);
    const [teammates, roster] = await Promise.all([
      seatedTeammates(ctx, participants),
      rosterOf(ctx, participants),
    ]);
    const live = new Set(
      teammates
        .filter((teammate) => !isTeammateRetired(teammate))
        .map((teammate) => teammate.id)
    );
    const mentions = parseChannelMentions(input.message, roster);
    const message = await ctx.db.appendChannelMessage({
      organizationId: ctx.organizationId,
      channelId: channel.id,
      authorType: "member",
      authorUserId: actor,
      content: [{ type: "text", text: input.message }],
      mentions,
    });
    // Posting is reading: nobody has unread messages of their own.
    await markRead(ctx, participants, actor);
    return {
      message,
      // A retired Teammate keeps its seat and its history and answers nothing
      // more, here as in its own thread (#767).
      targets: mentionedTeammateIds(mentions, roster).filter((id) =>
        live.has(id)
      ),
      roster,
      teammates: teammates.filter((teammate) => live.has(teammate.id)),
      channel,
    };
  },
});

async function markRead(
  ctx: OperationContext,
  participants: readonly TeammateChannelParticipant[],
  userId: string
): Promise<void> {
  const seat = participants.find((row) => row.userId === userId);
  if (!seat) return;
  await ctx.db
    .table("teammateChannelParticipants")
    .update(seat.id, { lastReadAt: new Date().toISOString() });
}

/**
 * Mark the channel read up to now.
 *
 * `member`, and no manage rule: a read marker is a fact about one person's own
 * seat, which is also why the operation takes no member id, it always moves the
 * caller's.
 */
export const markChannelReadOp = defineOperation({
  name: "channels.read",
  capability: "member",
  input: idSchema,
  entities: () => [{ kind: "channelList" as const }],
  run: async (ctx, { id }): Promise<void> => {
    const actor = requireActor(ctx);
    const { participants } = await requireChannel(ctx, id);
    await markRead(ctx, participants, actor);
  },
});

/**
 * Every channel in the organization, for the Inbox (#778, story 15).
 *
 * `manageMembers`: this is the one read that ignores membership, so it is gated
 * by the capability an Owner or Admin has and nobody else does. Deliberately a
 * separate operation rather than a flag on `channels.list`, because a flag on a
 * read is how an oversight surface quietly becomes the default one.
 */
export const listOrgChannelsOp = defineOperation({
  name: "channels.oversight.list",
  capability: "manageMembers",
  input: z.object({}),
  entities: () => [],
  run: async (ctx): Promise<ChannelSummary[]> => {
    const [channels, allSeats] = await Promise.all([
      ctx.db.table("teammateChannels").list({
        organizationId: ctx.organizationId,
      }),
      ctx.db.table("teammateChannelParticipants").list({
        organizationId: ctx.organizationId,
      }),
    ]);
    const summaries = await Promise.all(
      channels.map((channel) =>
        summarize(
          ctx,
          channel,
          allSeats.filter((seat) => seat.channelId === channel.id),
          // An admin reading somebody else's thread has no unread count of
          // their own in it, and inventing one would mark it read for them.
          ""
        )
      )
    );
    return summaries.sort((a, b) =>
      a.channel.updatedAt < b.channel.updatedAt ? 1 : -1
    );
  },
});

/** One channel's transcript for oversight, membership not required. */
export const readOrgChannelOp = defineOperation({
  name: "channels.oversight.read",
  capability: "manageMembers",
  input: idSchema,
  entities: () => [],
  run: async (ctx, { id }): Promise<ChannelView> => {
    const { channel, participants } = await requireOrgChannel(ctx, id);
    const [teammates, roster, messages] = await Promise.all([
      seatedTeammates(ctx, participants),
      rosterOf(ctx, participants),
      ctx.db.listChannelMessages(id),
    ]);
    return {
      channel,
      participants,
      teammates,
      roster,
      messages,
      // Oversight reads; changing somebody else's thread is not part of it.
      canManage: false,
    };
  },
});
