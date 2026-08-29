import type {
  ChannelMessage,
  Member,
  Teammate,
  TeammateChannel,
  TeammateChannelParticipant,
} from "./types";
import type { TeammateViewer } from "./teammate";

/**
 * Teammate channels (#778), as pure rules: who is in one, who may change it,
 * which colleagues a message addressed, and when a fan-out has to stop.
 *
 * Everything here is a function of rows plus the asking Member, which is what
 * lets the operations layer, the chain runner and a server component reach the
 * same answer. The two that carry the most weight are the mention resolver and
 * the chain accounting, and they are pure for the same reason the Insights
 * oracle is: "the eleventh turn does not run" has to be assertable without a
 * model, a database or a clock.
 */

/**
 * How many Teammate turns one human message may set off.
 *
 * A chain is everything one message triggers: the Teammates it mentioned, the
 * ones they mentioned, and so on. Ten is enough for a real fan-out (a question
 * to a chief of staff that pulls in three specialists, each of whom answers and
 * asks one follow-up) and small enough that a runaway costs the organization one
 * ordinary conversation's worth of tokens rather than a bill. Fixed in v1 on
 * purpose: an org-configurable cap is a budget feature, and it is out of scope.
 */
export const CHANNEL_CHAIN_TURN_CAP = 10;

/**
 * How many turns any single Teammate may take in one chain.
 *
 * Two, because the ping-pong is the failure mode that actually happens: A
 * mentions B, B thanks A, A thanks B, forever. The first reply is the answer and
 * the second is the follow-up after somebody else spoke; a third is a
 * conversation with itself. Note this bites long before the chain cap in the
 * two-Teammate case, which is where it is meant to bite.
 */
export const CHANNEL_CHAIN_TEAMMATE_TURN_CAP = 2;

/**
 * A Member's display name, the one `@` has to match.
 *
 * In the domain package because two surfaces now need the same answer: the
 * Members table renders it, and a channel mention resolves against it. Two
 * copies of this rule would mean a Member whose mention works in one place and
 * not the other.
 */
export function memberDisplayName(
  member: Pick<Member, "userId" | "email" | "firstName" | "lastName" | "username">
): string {
  const full = [member.firstName, member.lastName].filter(Boolean).join(" ");
  if (full) return full;
  if (member.username) return member.username;
  if (member.email) return member.email.split("@")[0];
  return member.userId;
}

/**
 * The channel roster as the mention resolver and the prompt read it: every
 * Member and every Teammate seated, by the name somebody would type.
 */
export function channelRoster(
  members: readonly Pick<
    Member,
    "userId" | "email" | "firstName" | "lastName" | "username"
  >[],
  teammates: readonly Pick<Teammate, "id" | "name">[]
): ChannelRosterEntry[] {
  return [
    ...members.map((member) => ({
      id: member.userId,
      name: memberDisplayName(member),
      kind: "member" as const,
    })),
    ...teammates.map((teammate) => ({
      id: teammate.id,
      name: teammate.name,
      kind: "teammate" as const,
    })),
  ];
}

/** Someone a message can address: a Member or a Teammate in this channel. */
export interface ChannelRosterEntry {
  /** The Member's user id, or the Teammate's id. */
  id: string;
  /** What `@` has to be followed by to reach them. */
  name: string;
  kind: "member" | "teammate";
}

/**
 * Who a message addressed, in the order it addressed them, deduped.
 *
 * Resolved against the channel roster and nothing else, which is the whole
 * perimeter (#775): a Teammate that writes `@Somebody Else` reaches nobody,
 * because a name that is not in this channel is not a mention. There is no
 * refusal to write and no error to handle, an outsider simply does not resolve,
 * and an Assistant never can.
 *
 * Longest name first, so `@Inbox Specialist` is one mention rather than a hit on
 * a colleague called Inbox. The character after the name must not be a word
 * character, so `@Sam` never lands on Sammy.
 *
 * Names, not ids, because a person types a name. Two consequences worth stating:
 * renaming a Teammate changes how it is mentioned from that moment (mentions are
 * resolved when a message is posted, never re-resolved afterwards), and two
 * participants with the same name resolve to whichever the roster lists first.
 * Neither is worth an id syntax nobody would type.
 */
export function parseChannelMentions(
  text: string,
  roster: readonly ChannelRosterEntry[]
): string[] {
  const candidates = [...roster]
    .filter((entry) => entry.name.trim().length > 0)
    .sort((a, b) => b.name.trim().length - a.name.trim().length)
    .map((entry) => ({ id: entry.id, name: entry.name.trim().toLowerCase() }));
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (let at = lower.indexOf("@"); at !== -1; at = lower.indexOf("@", at + 1)) {
    for (const candidate of candidates) {
      if (!lower.startsWith(candidate.name, at + 1)) continue;
      const next = lower[at + 1 + candidate.name.length];
      if (next && /[\w-]/.test(next)) continue;
      if (!found.includes(candidate.id)) found.push(candidate.id);
      // Consume the name, so a longer match cannot be re-read as a shorter one.
      at += candidate.name.length;
      break;
    }
  }
  return found;
}

/** Of everyone a message addressed, the Teammates: the only ones that reply. */
export function mentionedTeammateIds(
  mentions: readonly string[],
  roster: readonly ChannelRosterEntry[]
): string[] {
  const teammates = new Set(
    roster.filter((entry) => entry.kind === "teammate").map((entry) => entry.id)
  );
  return mentions.filter((id) => teammates.has(id));
}

/** Why a queued Teammate turn will not run. */
export type ChainCapReason = "chain_cap" | "teammate_cap";

export type ChainVerdict = { run: true } | { run: false; reason: ChainCapReason };

/**
 * Whether the next queued turn may run, given the turns this chain already took.
 *
 * `taken` is the Teammate id of every turn already run in this chain, in order,
 * which the runner has from the persisted messages rather than from a counter it
 * keeps. That matters: a chain that resumed, retried or partially failed is
 * accounted from what actually happened, and there is no second number to
 * disagree with the transcript.
 */
export function chainTurnVerdict(
  taken: readonly string[],
  teammateId: string
): ChainVerdict {
  if (taken.length >= CHANNEL_CHAIN_TURN_CAP) {
    return { run: false, reason: "chain_cap" };
  }
  const own = taken.filter((id) => id === teammateId).length;
  if (own >= CHANNEL_CHAIN_TEAMMATE_TURN_CAP) {
    return { run: false, reason: "teammate_cap" };
  }
  return { run: true };
}

/**
 * The transcript marker a cap leaves behind (#778, story 5).
 *
 * In the transcript rather than in a toast, because "the fan-out stopped here"
 * is part of what happened: without it a chain that was cut off looks like a
 * chain that decided it was finished, and the Member re-asks the same question
 * wondering why nobody answered.
 */
export function chainCapMarker(
  reason: ChainCapReason,
  teammateName?: string
): string {
  if (reason === "chain_cap") {
    return `Chain cap reached: ${CHANNEL_CHAIN_TURN_CAP} teammate replies came out of one message, so anything still queued was dropped. Send another message to carry on.`;
  }
  const who = teammateName?.trim() || "That teammate";
  return `${who} already replied ${CHANNEL_CHAIN_TEAMMATE_TURN_CAP} times to this message, so it was not asked again. Send another message to carry on.`;
}

/** The Members in a channel, in the order they were added. */
export function channelMemberIds(
  participants: readonly TeammateChannelParticipant[]
): string[] {
  return participants
    .map((row) => row.userId)
    .filter((id): id is string => Boolean(id));
}

/** The Teammates in a channel, in the order they were added. */
export function channelTeammateIds(
  participants: readonly TeammateChannelParticipant[]
): string[] {
  return participants
    .map((row) => row.teammateId)
    .filter((id): id is string => Boolean(id));
}

/**
 * Whether this Member is in the channel.
 *
 * Membership is the whole visibility rule (#776, story 14): invite-based means
 * a channel a Member is not in does not exist for them, so this is not softened
 * by their organization Role. Owner and Admin oversight is a different read on
 * a different surface, the Inbox, through an operation that declares
 * `manageMembers`; folding it in here would have made every channel visible to
 * an admin in the Teammates roster too, which is not oversight, it is being in
 * everyone's group chats.
 */
export function isChannelMember(
  participants: readonly TeammateChannelParticipant[],
  userId: string
): boolean {
  return Boolean(userId) && channelMemberIds(participants).includes(userId);
}

/**
 * Whether this Member may change the channel: its name, its bound Project, its
 * roster, its existence.
 *
 * The creator and the organization's admins. Everyone in the channel may *add*
 * (see {@link canAddToChannel}), because invite-based group chat where only one
 * person can invite is a queue in front of one person; removing somebody, and
 * renaming the thread they are reading, is the part that belongs to whoever
 * opened it.
 */
export function canManageChannel(
  channel: Pick<TeammateChannel, "createdBy">,
  viewer: TeammateViewer
): boolean {
  return (
    channel.createdBy === viewer.userId ||
    viewer.role === "owner" ||
    viewer.role === "admin"
  );
}

/** Whether this Member may add Members and Teammates: anyone in the channel. */
export function canAddToChannel(
  participants: readonly TeammateChannelParticipant[],
  channel: Pick<TeammateChannel, "createdBy">,
  viewer: TeammateViewer
): boolean {
  return (
    isChannelMember(participants, viewer.userId) ||
    canManageChannel(channel, viewer)
  );
}

/**
 * Whether this Member may put this Teammate in a channel: the org-visible ones,
 * plus their own private ones (#776).
 *
 * Deliberately narrower than `canViewTeammate`, which lets an org admin see
 * anybody's private Teammate. Seeing one and broadcasting it to a channel of
 * colleagues are different acts, and the second is the disclosure: the same
 * reason a referral card only ever names org-visible Teammates (#773). A
 * retired one is out because it answers nothing, so adding it would seat a
 * colleague who cannot speak.
 */
export function canAddTeammateToChannel(
  teammate: Pick<
    Teammate,
    "ownerId" | "editorIds" | "visibility" | "deletedAt"
  >,
  viewer: TeammateViewer
): boolean {
  if (teammate.deletedAt) return false;
  if (teammate.visibility === "org") return true;
  return (
    teammate.ownerId === viewer.userId ||
    teammate.editorIds.includes(viewer.userId)
  );
}

/** What one Member has not read in a channel yet. */
export interface ChannelUnread {
  /** Messages since their read marker that somebody else wrote. */
  count: number;
  /**
   * Whether one of those addressed them by name. The loud signal: agent-to-agent
   * chatter raises the count and never this (#777's default).
   */
  mentionsYou: boolean;
}

/**
 * Unread state for one Member, from the messages the caller already holds.
 *
 * Counted from the messages passed in, so a caller that read the most recent N
 * cannot report more than N; that is a deliberate ceiling rather than a wrong
 * number, and the roster renders it as "N+". Their own messages never count,
 * and neither does a message written before their marker.
 */
export function channelUnread(
  messages: readonly Pick<
    ChannelMessage,
    "authorType" | "authorUserId" | "mentions" | "createdAt"
  >[],
  lastReadAt: string | null,
  userId: string
): ChannelUnread {
  const fresh = messages.filter(
    (message) =>
      (!lastReadAt || message.createdAt > lastReadAt) &&
      !(message.authorType === "member" && message.authorUserId === userId)
  );
  return {
    count: fresh.length,
    mentionsYou: fresh.some((message) => message.mentions.includes(userId)),
  };
}

/**
 * What a Teammate is told about being in a channel rather than in a 1:1 chat.
 *
 * Three facts it cannot work out for itself: this is a group and other people
 * are reading, who is here (which is also the complete list of names `@` can
 * reach), and that pulling a colleague in costs the thread one of a small number
 * of turns. The last one is the prompt half of the cap: the hard rule stops a
 * runaway, this is what stops the model from starting one out of politeness.
 */
export function channelPromptSection(input: {
  channelName: string;
  self: Pick<ChannelRosterEntry, "id" | "name">;
  roster: readonly ChannelRosterEntry[];
  /** Who wrote the message that started this chain, for "they asked, not me". */
  startedByName?: string | null;
}): string {
  const others = input.roster.filter((entry) => entry.id !== input.self.id);
  const members = others.filter((entry) => entry.kind === "member");
  const teammates = others.filter((entry) => entry.kind === "teammate");
  const starter = input.startedByName?.trim();
  return [
    `# You are in the channel "${input.channelName}"`,
    "This is a group thread, not a private chat: everybody below reads every message, so keep your answer short and say who it is for when it is not obvious.",
    starter
      ? `${starter} sent the message that started this exchange. Answer them.`
      : undefined,
    members.length > 0
      ? `People here: ${members.map((entry) => entry.name).join(", ")}.`
      : "You are the only one here besides the colleague writing to you.",
    teammates.length > 0
      ? [
          `Other teammates here: ${teammates.map((entry) => `@${entry.name}`).join(", ")}.`,
          "Write `@Name` to bring one of them in; they will reply on their own, in this thread. Those names are the only ones that work: nobody outside this channel can be reached, and a name that is not on the list is read as ordinary text.",
          `Only mention a colleague when the answer genuinely needs them. One message can set off at most ${CHANNEL_CHAIN_TURN_CAP} teammate replies in total and ${CHANNEL_CHAIN_TEAMMATE_TURN_CAP} from any one of you, after which the thread is cut off; do not mention somebody to thank them, to agree with them, or to hand back a question you can answer.`,
        ].join("\n")
      : "You are the only teammate here, so there is nobody to bring in.",
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n");
}
