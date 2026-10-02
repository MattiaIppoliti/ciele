import { describe, expect, it } from "vitest";
import { DEMO_ORG, getMockDb } from "@agent-hub/db";
import { readReactionRecords } from "./reaction-records";

describe("Inbox reaction records", () => {
  it("keeps emoji and authors verbatim without changing quality feedback", async () => {
    const db = getMockDb();
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Reactions" });
    const conversation = await db.createConversation({ assistantId: assistant.id, subjectType: "visitor", subjectId: "reaction-record" });
    const message = await db.appendMessage({ conversationId: conversation.id, role: "assistant", content: [{ type: "text", text: "Hello" }] });
    const reaction = { organizationId: DEMO_ORG.id, messageId: message.id, channelMessageId: null, actorId: "visitor:test", actorName: "Visitor", emoji: "😭" };
    await db.setMessageReaction(reaction, true);
    expect(await readReactionRecords(db, DEMO_ORG.id, [message.id])).toEqual([reaction]);
    expect(await readReactionRecords(db, "other-org", [message.id])).toEqual([]);
    expect(await readReactionRecords(db, DEMO_ORG.id, [])).toEqual([]);
    expect((await db.getMessage(message.id))?.feedback).toBe(0);
    expect((await db.getMessage(message.id))?.feedbackReaction ?? null).toBeNull();
  });
});
