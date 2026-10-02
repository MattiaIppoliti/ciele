import { describe, expect, it } from "vitest";
import type { ChatMsg } from "@/components/chat/chat-thread";
import { groupMessageThreads } from "./group-threads";

const message = (id: string, threadParentId: string | null = null): ChatMsg => ({ role: "user", id, threadParentId, text: id, sentAt: null });

describe("groupMessageThreads", () => {
  it("keeps human continuations and their AI chains under the original message", () => {
    const rows = [message("root"), message("ai-1", "root"), message("other"), message("reply", "ai-1"), message("ai-2", "reply")];
    const threads = groupMessageThreads(rows);
    expect(threads.map((thread) => [thread.key, thread.replies.map((reply) => reply.id)])).toEqual([
      ["root", ["ai-1", "reply", "ai-2"]], ["other", []],
    ]);
  });
  it("keeps replies visible when the parent fell outside the history window", () => {
    expect(groupMessageThreads([message("reply", "missing"), message("continuation", "reply")])[0].replies.map((row) => row.id)).toEqual(["continuation"]);
  });
  it("preserves every message and terminates when old links contain a cycle", () => {
    const threads = groupMessageThreads([message("a", "b"), message("b", "a")]);
    expect(threads.flatMap((thread) => [thread.root, ...thread.replies])).toHaveLength(2);
  });
  it("attaches a streaming response before its persisted id is known", () => {
    const threads = groupMessageThreads([message("root"), {role:"notice",threadParentId:"root",text:"Streaming"}]);
    expect(threads).toHaveLength(1);
    expect(threads[0].replies).toHaveLength(1);
  });
});
