import { describe, expect, it } from "vitest";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { createTeammateOp } from "./teammates";
import { createChannelOp, addChannelMembersOp } from "./channels";
import { createAssistantOp } from "./assistants";
import { deleteThreadOp, listThreadPreferencesOp, setThreadPreferenceOp } from "./thread-preferences";
import type { OperationContext } from "./operation";
const ctx = (over: Partial<OperationContext> = {}): OperationContext => ({ db: getMockDb(), organizationId: DEMO_ORG.id, userId: DEMO_MEMBER.userId, role: "editor", ...over });
describe("personal thread triage", () => {
  it("archives and flags independently, restores without modifying the transcript, and isolates Members", async () => {
    const owner = ctx(); const channel = await createChannelOp.run(owner, { name: "Swipe triage" });
    await addChannelMembersOp.run(owner, { id: channel.id, userIds: ["u-martina"] });
    const target = { kind: "channel", id: channel.id } as const;
    await setThreadPreferenceOp.run(owner, { target, action: "archive", enabled: true });
    await setThreadPreferenceOp.run(owner, { target, action: "archive", enabled: true });
    await setThreadPreferenceOp.run(owner, { target, action: "flag", enabled: true });
    const own = (await listThreadPreferencesOp.run(owner, {})).filter(row => row.channelId === channel.id);
    expect(own.map(row => row.action).sort()).toEqual(["archive", "flag"]);
    expect((await listThreadPreferencesOp.run(ctx({ userId: "u-martina" }), {})).some(row => row.channelId === channel.id)).toBe(false);
    await setThreadPreferenceOp.run(owner, { target, action: "archive", enabled: false });
    expect((await listThreadPreferencesOp.run(owner, {})).filter(row => row.channelId === channel.id).map(row => row.action)).toEqual(["flag"]);
    expect(await owner.db.table("teammateChannels").get(channel.id)).not.toBeNull();
    await deleteThreadOp.run(owner, target);
    expect((await listThreadPreferencesOp.run(owner, {})).some(row => row.channelId === channel.id)).toBe(false);
  });
  it("refuses inaccessible groups, foreign organizations and colleagues' private conversations", async () => {
    const owner = ctx(); const teammate = await createTeammateOp.run(owner, { name: "Triage" });
    const conversation = await owner.db.createConversation({ teammateId: teammate.id, subjectType: "member", subjectId: owner.userId });
    const target = { kind: "conversation", id: conversation.id } as const;
    for (const actor of [ctx({ userId: "u-martina" }), ctx({ organizationId: "foreign" })]) {
      await expect(setThreadPreferenceOp.run(actor, { target, action: "flag", enabled: true })).rejects.toMatchObject({ code: "not_found" });
      await expect(deleteThreadOp.run(actor, target)).rejects.toMatchObject({ code: "not_found" });
    }
    await expect(setThreadPreferenceOp.run(owner, { target: { kind: "inbox", id: conversation.id }, action: "archive", enabled: true })).rejects.toMatchObject({ code: "not_found" });
    const channel = await createChannelOp.run(owner, { name: "Private room" });
    await expect(setThreadPreferenceOp.run(ctx({ userId: "u-andrea" }), { target: { kind: "channel", id: channel.id }, action: "flag", enabled: true })).rejects.toMatchObject({ code: "not_found" });
    await addChannelMembersOp.run(owner, { id: channel.id, userIds: ["u-martina"] });
    await expect(deleteThreadOp.run(ctx({ userId: "u-martina" }), { kind: "channel", id: channel.id })).rejects.toMatchObject({ code: "invalid_input" });
  });
  it("deletes only the Member's own Teammate conversation and preserves legal holds", async () => {
    const owner=ctx(); const teammate=await createTeammateOp.run(owner, { name: "History" });
    const conversation=await owner.db.createConversation({ teammateId:teammate.id, subjectType:"member",subjectId:owner.userId });
    await setThreadPreferenceOp.run(owner, { target: { kind:"conversation",id:conversation.id }, action:"flag",enabled:true });
    await deleteThreadOp.run(owner, { kind:"conversation",id:conversation.id });
    expect(await owner.db.getConversation(conversation.id)).toBeNull();
    expect((await listThreadPreferencesOp.run(owner,{})).some(row=>row.conversationId===conversation.id)).toBe(false);
    const assistant=await createAssistantOp.run(owner,{title:"Held inbox"});
    const held=await owner.db.createConversation({assistantId:assistant.id,subjectType:"visitor",subjectId:"held-visitor"});
    await owner.db.setConversationLegalHold(held.id,true);
    await expect(deleteThreadOp.run(owner,{kind:"inbox",id:held.id})).rejects.toThrow(/legal hold/);
    expect(await owner.db.getConversation(held.id)).not.toBeNull();
  });
});
