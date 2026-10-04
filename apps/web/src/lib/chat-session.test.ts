import { describe, expect, it } from "vitest";
import { createChatSession, type SidebarConversation } from "./chat-session";

/**
 * Which Conversation the Teammates chat has open, as every surface that can
 * change it sees it: the chat itself, the sidebar's New chat and ⌘O, the
 * address bar, and the sidebar's history.
 */

const row = (id: string, updatedAt: string, title = id): SidebarConversation => ({
  id,
  teammateId: "tm-1",
  title,
  updatedAt,
});

describe("New chat", () => {
  it("clears the open thread at once when nothing is answering", () => {
    const session = createChatSession();
    session.started(row("c1", "2026-09-30T10:00:00Z"));
    const before = session.getSnapshot().resets;
    session.requestNewChat();
    expect(session.getSnapshot().conversationId).toBeNull();
    expect(session.getSnapshot().resets).toBe(before + 1);
  });

  it("waits for the running answer, then applies, so a click during a first message is not lost", () => {
    const session = createChatSession();
    session.setBusy(true);
    session.requestNewChat();
    // The first answer's thread arrives after the click.
    session.started(row("c1", "2026-09-30T10:00:00Z"));
    expect(session.getSnapshot().conversationId).toBe("c1");
    session.setBusy(false);
    expect(session.getSnapshot().conversationId).toBeNull();
  });

  it("applies a queued request once, however many times it was asked", () => {
    const session = createChatSession();
    session.setBusy(true);
    session.requestNewChat();
    session.requestNewChat();
    const before = session.getSnapshot().resets;
    session.setBusy(false);
    expect(session.getSnapshot().resets).toBe(before + 1);
    session.setBusy(true);
    session.setBusy(false);
    expect(session.getSnapshot().resets).toBe(before + 1);
  });

  it("tells subscribers", () => {
    const session = createChatSession();
    let calls = 0;
    const unsubscribe = session.subscribe(() => calls++);
    session.requestNewChat();
    unsubscribe();
    session.requestNewChat();
    expect(calls).toBe(1);
  });
});

describe("the address bar", () => {
  it("asks the chat to open a thread it does not have open", () => {
    const session = createChatSession();
    expect(session.followUrl("c2")).toBe("c2");
  });

  it("asks for nothing when it names the open thread, so the chat's own writes do not echo", () => {
    const session = createChatSession();
    session.opened("c2");
    expect(session.followUrl("c2")).toBeNull();
  });

  it("starts a new chat when the thread leaves the URL", () => {
    const session = createChatSession();
    session.opened("c2");
    expect(session.followUrl(null)).toBeNull();
    expect(session.getSnapshot().conversationId).toBeNull();
  });
});

describe("the sidebar's history", () => {
  it("shows a thread the chat reported before the server knows it, newest first", () => {
    const session = createChatSession();
    session.started(row("new", "2026-09-30T12:00:00Z", "Fresh question"));
    const merged = session.conversations([row("old", "2026-09-29T09:00:00Z")]);
    expect(merged.map((entry) => entry.id)).toEqual(["new", "old"]);
  });

  it("never rolls a thread back to an older report", () => {
    const session = createChatSession();
    session.started(row("c1", "2026-09-30T08:00:00Z", "stale"));
    const merged = session.conversations([row("c1", "2026-09-30T09:00:00Z", "server")]);
    expect(merged).toEqual([row("c1", "2026-09-30T09:00:00Z", "server")]);
  });

  it("forgets what it reported when the chat area closes", () => {
    const session = createChatSession();
    session.started(row("c1", "2026-09-30T08:00:00Z"));
    session.leave();
    expect(session.conversations([])).toEqual([]);
    expect(session.getSnapshot().conversationId).toBeNull();
  });
});

describe("a chat that closes", () => {
  it("leaves nothing open for the next one, and drops a queued request", () => {
    const session = createChatSession();
    session.started(row("c1", "2026-09-30T08:00:00Z"));
    session.setBusy(true);
    session.requestNewChat();
    session.close();
    expect(session.getSnapshot()).toMatchObject({ conversationId: null, busy: false });
    const before = session.getSnapshot().resets;
    session.setBusy(true);
    session.setBusy(false);
    expect(session.getSnapshot().resets).toBe(before);
    // The sidebar still shows the thread until the server reconciles it.
    expect(session.conversations([]).map((entry) => entry.id)).toEqual(["c1"]);
  });
});

describe("deleted conversation history", () => {
  it("does not resurrect a locally reported thread after server history refreshes", () => {
    const session = createChatSession();
    session.started(row("deleted", "2026-10-03T10:00:00Z"));
    session.forget("deleted");
    expect(session.conversations([])).toEqual([]);
    expect(session.getSnapshot().conversationId).toBeNull();
  });
});
