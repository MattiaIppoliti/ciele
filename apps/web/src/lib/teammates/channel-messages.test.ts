import { describe, expect, it } from "vitest";
import type { ChannelMessage, StoredTurnTrace } from "@agent-hub/core";
import {
  channelChatMessages,
  channelMessageText,
  teammateAuthor,
  type ChannelCast,
} from "./channel-messages";

const CAST: ChannelCast = {
  roster: [
    { id: "user-1", name: "Dana Ruiz", kind: "member" },
    { id: "tm-1", name: "Inbox Specialist", kind: "teammate" },
  ],
  teammates: [
    {
      id: "tm-1",
      name: "Inbox Specialist",
      title: "Support triage",
      avatarSeed: " seed-1 ",
    },
  ],
  canViewReasoning: false,
};

function message(over: Partial<ChannelMessage>): ChannelMessage {
  return {
    id: "msg-1",
    organizationId: "org-1",
    channelId: "chan-1",
    authorType: "member",
    authorUserId: null,
    authorTeammateId: null,
    content: [{ type: "text", text: "Where are we on the refund flow?" }],
    mentions: [],
    chainId: null,
    trace: null,
    createdAt: "2026-08-24T09:00:00.000Z",
    ...over,
  };
}

const TRACE: StoredTurnTrace = {
  steps: [
    { id: "s1", kind: "thought", label: "The member is asking about refunds", status: "done" },
    { id: "s2", kind: "tool", label: "Searching knowledge for 'refunds'", tool: "searchKnowledge", status: "done" },
  ],
  searchCount: 1,
};

describe("channelChatMessages", () => {
  it("attributes a member message to the roster name, with no timestamp", () => {
    const [msg] = channelChatMessages(
      [message({ authorType: "member", authorUserId: "user-1" })],
      CAST
    );
    expect(msg).toEqual({
      role: "user",
      text: "Where are we on the refund flow?",
      sentAt: null,
      author: { name: "Dana Ruiz", avatarSeed: "user-1" },
    });
  });

  it("falls back to a colleague when the sender has left the roster", () => {
    const [msg] = channelChatMessages(
      [message({ authorType: "member", authorUserId: "user-gone" })],
      CAST
    );
    expect(msg).toMatchObject({
      role: "user",
      author: { name: "A colleague", avatarSeed: "user-gone" },
    });
  });

  it("renders a teammate message as a finished bot turn, seeded by its avatar", () => {
    const parts = [{ type: "text", text: "Two tickets are still open." }];
    const [msg] = channelChatMessages(
      [
        message({
          id: "msg-2",
          authorType: "teammate",
          authorTeammateId: "tm-1",
          content: parts,
        }),
      ],
      CAST
    );
    expect(msg).toMatchObject({
      role: "bot",
      id: "msg-2",
      phase: "done",
      parts,
      streamingText: null,
      feedback: 0,
      // The seed is trimmed: a padded column value must not draw a second face
      // for the same Teammate.
      author: {
        name: "Inbox Specialist",
        title: "Support triage",
        avatarSeed: "seed-1",
      },
    });
  });

  it("names a teammate that is no longer in the roster, keeping its face", () => {
    const [msg] = channelChatMessages(
      [message({ authorType: "teammate", authorTeammateId: "tm-gone" })],
      CAST
    );
    expect(msg).toMatchObject({
      role: "bot",
      author: { name: "A deleted teammate", avatarSeed: "tm-gone" },
    });
    // A deleted Teammate has no title to show, rather than an empty line.
    expect((msg as { author: { title?: string } }).author.title).toBeUndefined();
  });

  it("renders a system message as a notice, with nobody attached", () => {
    const [msg] = channelChatMessages(
      [
        message({
          authorType: "system",
          content: [{ type: "text", text: "The chain stopped here." }],
        }),
      ],
      CAST
    );
    expect(msg).toEqual({ role: "notice", text: "The chain stopped here." });
  });

  it("gates the model's reasoning out of the stored trace for a Member", () => {
    const [msg] = channelChatMessages(
      [message({ authorType: "teammate", authorTeammateId: "tm-1", trace: TRACE })],
      CAST
    );
    expect(msg).toMatchObject({ searchCount: 1 });
    const { steps } = msg as { steps: { kind: string }[] };
    expect(steps.map((step) => step.kind)).toEqual(["tool"]);
  });

  it("keeps the reasoning for a reader whose Role may see it", () => {
    const [msg] = channelChatMessages(
      [message({ authorType: "teammate", authorTeammateId: "tm-1", trace: TRACE })],
      { ...CAST, canViewReasoning: true }
    );
    const { steps } = msg as { steps: { kind: string }[] };
    expect(steps.map((step) => step.kind)).toEqual(["thought", "tool"]);
  });

  it("leaves a traceless turn with an empty Thinking panel rather than a missing one", () => {
    const [msg] = channelChatMessages(
      [message({ authorType: "teammate", authorTeammateId: "tm-1" })],
      CAST
    );
    expect(msg).toMatchObject({ steps: [], searchCount: 0 });
  });

  it("keeps the transcript in order", () => {
    const rendered = channelChatMessages(
      [
        message({ id: "a", authorType: "member", authorUserId: "user-1" }),
        message({ id: "b", authorType: "teammate", authorTeammateId: "tm-1" }),
        message({ id: "c", authorType: "system" }),
      ],
      CAST
    );
    expect(rendered.map((msg) => msg.role)).toEqual(["user", "bot", "notice"]);
  });
});

describe("teammateAuthor", () => {
  it("takes the stream's own name when the client has no such teammate yet", () => {
    expect(teammateAuthor(undefined, "tm-9", "Release Manager")).toEqual({
      name: "Release Manager",
      title: undefined,
      avatarSeed: "tm-9",
    });
  });

  it("seeds a face even with no id to seed it from", () => {
    expect(teammateAuthor(undefined, null).avatarSeed).toBe("unknown");
  });
});

describe("channelMessageText", () => {
  it("joins the text parts and drops everything else", () => {
    expect(
      channelMessageText([
        { type: "text", text: "First" },
        { type: "sources", sources: [] },
        { type: "text", text: "" },
        { type: "text", text: "Second" },
      ])
    ).toBe("First\nSecond");
  });
});
