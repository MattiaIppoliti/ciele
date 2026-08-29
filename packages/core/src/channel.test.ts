import { describe, expect, it } from "vitest";
import type {
  Teammate,
  TeammateChannel,
  TeammateChannelParticipant,
} from "./types";
import {
  CHANNEL_CHAIN_TEAMMATE_TURN_CAP,
  CHANNEL_CHAIN_TURN_CAP,
  type ChannelRosterEntry,
  canAddToChannel,
  canAddTeammateToChannel,
  canManageChannel,
  chainCapMarker,
  chainTurnVerdict,
  channelMemberIds,
  channelPromptSection,
  channelTeammateIds,
  channelUnread,
  isChannelMember,
  mentionedTeammateIds,
  parseChannelMentions,
} from "./channel";

const ROSTER: ChannelRosterEntry[] = [
  { id: "m-ada", name: "Ada", kind: "member" },
  { id: "t-inbox", name: "Inbox Specialist", kind: "teammate" },
  { id: "t-in", name: "Inbox", kind: "teammate" },
  { id: "t-sam", name: "Sam", kind: "teammate" },
];

function participant(
  over: Partial<TeammateChannelParticipant> = {}
): TeammateChannelParticipant {
  return {
    id: "p-1",
    organizationId: "org-1",
    channelId: "c-1",
    userId: null,
    teammateId: null,
    addedBy: null,
    lastReadAt: null,
    createdAt: "2026-08-24T09:00:00.000Z",
    ...over,
  };
}

function teammate(over: Partial<Teammate> = {}): Teammate {
  return {
    id: "t-sam",
    organizationId: "org-1",
    ownerId: "m-ada",
    name: "Sam",
    title: "",
    roleDescription: "",
    avatarSeed: "",
    editorIds: [],
    visibility: "org",
    collectionIds: [],
    sourceIds: [],
    modelProvider: "anthropic",
    modelId: "claude-opus-4-8",
    capabilityCeiling: "edit",
    approvalBypass: false,
    projectId: null,
    deletedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

const channel: Pick<TeammateChannel, "createdBy"> = { createdBy: "m-ada" };

describe("channel mentions", () => {
  it("resolves the roster names a message addressed, in order", () => {
    expect(
      parseChannelMentions("@Sam can you check with @Ada first?", ROSTER)
    ).toEqual(["t-sam", "m-ada"]);
  });

  it("prefers the longest matching name, so a prefix is not a mention", () => {
    // "Inbox" is also a teammate here; the longer name has to win or every
    // mention of the specialist would also poke the other one.
    expect(parseChannelMentions("@Inbox Specialist please", ROSTER)).toEqual([
      "t-inbox",
    ]);
    expect(parseChannelMentions("@Inbox please", ROSTER)).toEqual(["t-in"]);
  });

  it("never matches a longer word that starts with a roster name", () => {
    expect(parseChannelMentions("@Sammy is not here", ROSTER)).toEqual([]);
  });

  it("mentions the same colleague once however often it is written", () => {
    expect(parseChannelMentions("@Sam @Sam @sam", ROSTER)).toEqual(["t-sam"]);
  });

  it("tolerates punctuation and case", () => {
    expect(parseChannelMentions("thanks @sam, and @ADA!", ROSTER)).toEqual([
      "t-sam",
      "m-ada",
    ]);
  });

  it("is the channel perimeter: a name that is not here resolves to nobody", () => {
    // The whole refusal, and it needs no refusal: the runtime has nothing to
    // run, so a Teammate cannot reach outside the channel by writing a name.
    expect(
      parseChannelMentions("@Scheduler take this @assistants too", ROSTER)
    ).toEqual([]);
  });

  it("keeps only the Teammates out of a mixed mention list", () => {
    const mentions = parseChannelMentions("@Ada @Sam", ROSTER);
    expect(mentionedTeammateIds(mentions, ROSTER)).toEqual(["t-sam"]);
  });
});

describe("chain accounting", () => {
  it("runs a fan-out of three from one message", () => {
    const taken: string[] = [];
    for (const id of ["t-sam", "t-inbox", "t-in"]) {
      expect(chainTurnVerdict(taken, id)).toEqual({ run: true });
      taken.push(id);
    }
    expect(taken).toHaveLength(3);
  });

  it("stops the eleventh turn of a chain", () => {
    const taken = Array.from({ length: CHANNEL_CHAIN_TURN_CAP }, (_, i) =>
      i % 2 === 0 ? "t-sam" : "t-inbox"
    );
    // Ten turns spread over five teammates, so the per-teammate rule is not
    // what refuses here.
    const spread = Array.from(
      { length: CHANNEL_CHAIN_TURN_CAP },
      (_, i) => `t-${i % 5}`
    );
    expect(chainTurnVerdict(spread, "t-new")).toEqual({
      run: false,
      reason: "chain_cap",
    });
    expect(taken).toHaveLength(CHANNEL_CHAIN_TURN_CAP);
  });

  it("stops one teammate's third turn while the chain still has room", () => {
    const taken = Array.from(
      { length: CHANNEL_CHAIN_TEAMMATE_TURN_CAP },
      () => "t-sam"
    );
    expect(chainTurnVerdict(taken, "t-sam")).toEqual({
      run: false,
      reason: "teammate_cap",
    });
    // Somebody else still may: the chain is nowhere near its own cap.
    expect(chainTurnVerdict(taken, "t-inbox")).toEqual({ run: true });
  });

  it("names the reason in the marker the transcript keeps", () => {
    expect(chainCapMarker("chain_cap")).toContain(`${CHANNEL_CHAIN_TURN_CAP}`);
    expect(chainCapMarker("teammate_cap", "Sam")).toMatch(/^Sam already/);
    expect(chainCapMarker("teammate_cap")).toMatch(/^That teammate/);
  });
});

describe("channel membership", () => {
  const roster = [
    participant({ id: "p-1", userId: "m-ada" }),
    participant({ id: "p-2", teammateId: "t-sam" }),
  ];

  it("splits the roster by kind, keeping the order it was built in", () => {
    expect(channelMemberIds(roster)).toEqual(["m-ada"]);
    expect(channelTeammateIds(roster)).toEqual(["t-sam"]);
  });

  it("makes membership the visibility rule, Role included", () => {
    expect(isChannelMember(roster, "m-ada")).toBe(true);
    // An owner who is not in the channel does not see it in the roster; their
    // oversight is the Inbox read, which is its own operation.
    expect(isChannelMember(roster, "m-owner")).toBe(false);
    expect(isChannelMember(roster, "")).toBe(false);
  });

  it("lets the creator and the org's admins manage it, and nobody else", () => {
    expect(canManageChannel(channel, { userId: "m-ada", role: "editor" })).toBe(
      true
    );
    expect(canManageChannel(channel, { userId: "m-bob", role: "admin" })).toBe(
      true
    );
    expect(canManageChannel(channel, { userId: "m-bob", role: "editor" })).toBe(
      false
    );
  });

  it("lets anybody in the channel add, because invites are the point", () => {
    expect(canAddToChannel(roster, channel, { userId: "m-ada", role: "viewer" })).toBe(
      true
    );
    expect(canAddToChannel(roster, channel, { userId: "m-bob", role: "editor" })).toBe(
      false
    );
    // An admin can seat themselves: oversight has to be able to join a thread.
    expect(canAddToChannel(roster, channel, { userId: "m-bob", role: "admin" })).toBe(
      true
    );
  });

  it("adds org-visible teammates, and private ones only to their own people", () => {
    const viewer = { userId: "m-bob", role: "editor" as const };
    expect(canAddTeammateToChannel(teammate(), viewer)).toBe(true);
    expect(
      canAddTeammateToChannel(teammate({ visibility: "private" }), viewer)
    ).toBe(false);
    expect(
      canAddTeammateToChannel(
        teammate({ visibility: "private", ownerId: "m-bob" }),
        viewer
      )
    ).toBe(true);
    expect(
      canAddTeammateToChannel(
        teammate({ visibility: "private", editorIds: ["m-bob"] }),
        viewer
      )
    ).toBe(true);
    // An admin may *see* somebody else's private Teammate and still may not
    // seat it in a channel of colleagues.
    expect(
      canAddTeammateToChannel(teammate({ visibility: "private" }), {
        userId: "m-boss",
        role: "owner",
      })
    ).toBe(false);
    // Retired answers nothing, so seating it would seat a mute colleague.
    expect(
      canAddTeammateToChannel(
        teammate({ deletedAt: "2026-08-20T00:00:00.000Z" }),
        viewer
      )
    ).toBe(false);
  });
});

describe("unread", () => {
  const messages = [
    {
      authorType: "member" as const,
      authorUserId: "m-ada",
      mentions: ["t-sam"],
      createdAt: "2026-08-24T10:00:00.000Z",
    },
    {
      authorType: "teammate" as const,
      authorUserId: null,
      mentions: ["t-inbox"],
      createdAt: "2026-08-24T10:00:01.000Z",
    },
    {
      authorType: "teammate" as const,
      authorUserId: null,
      mentions: ["m-bob"],
      createdAt: "2026-08-24T10:00:02.000Z",
    },
  ];

  it("counts what somebody else wrote since the read marker", () => {
    expect(
      channelUnread(messages, "2026-08-24T10:00:00.000Z", "m-ada")
    ).toEqual({ count: 2, mentionsYou: false });
  });

  it("never counts your own messages", () => {
    expect(channelUnread(messages, null, "m-ada")).toEqual({
      count: 2,
      mentionsYou: false,
    });
  });

  it("raises the loud signal only when a fresh message names you", () => {
    expect(channelUnread(messages, null, "m-bob")).toEqual({
      count: 3,
      mentionsYou: true,
    });
    // Read past it and the mention stops shouting.
    expect(
      channelUnread(messages, "2026-08-24T10:00:02.000Z", "m-bob")
    ).toEqual({ count: 0, mentionsYou: false });
  });
});

describe("the channel prompt section", () => {
  it("names who is here and how to reach them", () => {
    const section = channelPromptSection({
      channelName: "Launch week",
      self: { id: "t-sam", name: "Sam" },
      roster: ROSTER,
      startedByName: "Ada",
    });
    expect(section).toContain('"Launch week"');
    expect(section).toContain("Ada sent the message");
    expect(section).toContain("@Inbox Specialist");
    // Never itself: a teammate that mentions itself burns a chain turn to talk
    // to nobody.
    expect(section).not.toContain("@Sam");
    expect(section).toContain(`${CHANNEL_CHAIN_TURN_CAP} teammate replies`);
  });

  it("says plainly when there is nobody to bring in", () => {
    const section = channelPromptSection({
      channelName: "Solo",
      self: { id: "t-sam", name: "Sam" },
      roster: [
        { id: "m-ada", name: "Ada", kind: "member" },
        { id: "t-sam", name: "Sam", kind: "teammate" },
      ],
    });
    expect(section).toContain("only teammate here");
    expect(section).not.toContain("@");
  });
});
