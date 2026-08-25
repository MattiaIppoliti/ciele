import { describe, expect, it } from "vitest";
import { DEMO_MEMBER, DEMO_ORG, createOrgPinnedDb, getMockDb } from "@agent-hub/db";
import type { Db } from "@agent-hub/db";
import type { OperationContext } from "./operation";
import {
  createTeammateOp,
  deleteTeammateOp,
  getTeammateOp,
  listTeammateThreadOp,
  listTeammatesOp,
  readTeammateConversationOp,
  updateTeammateOp,
} from "./teammates";
import {
  addChannelMembersOp,
  addChannelTeammatesOp,
  createChannelOp,
  deleteChannelOp,
  getChannelOp,
  listChannelsOp,
  removeChannelMemberOp,
  removeChannelTeammateOp,
  updateChannelOp,
} from "./channels";

/**
 * The operations /api/v1 exposes, run on the Db /api/v1 actually gives them.
 *
 * A key request has no Supabase session, so it runs on `createOrgPinnedDb`, a
 * fail-closed view where an unexposed method throws rather than answering. The
 * three drift tests in `apps/web` check that a route, a CLI verb and an MCP
 * action agree about a *name*; none of them calls the operation. So the
 * Teammates domain shipped with seven endpoints that every one of those tests
 * passed and that threw `OrgPinnedDbError` the first time anybody called them.
 *
 * This is the gate that was missing. It is deliberately about reachability,
 * not behaviour: behaviour is tested next door against the plain mock. A new
 * endpoint belongs here the moment its route exists.
 */

const pinned = (inner: Db = getMockDb()) => createOrgPinnedDb(inner, DEMO_ORG.id);

const keyContext = (db: Db): OperationContext => ({
  organizationId: DEMO_ORG.id,
  // An API key acts as the Member who minted it (`actorUserId: key.createdBy`).
  userId: DEMO_MEMBER.userId,
  role: "owner",
  db,
});

describe("the Teammates domain over an API key", () => {
  it("runs every endpoint's operation on the pinned Db", async () => {
    const ctx = keyContext(pinned());
    const teammate = await createTeammateOp.run(ctx, { name: "Key Probe" });

    const list = await listTeammatesOp.run(ctx, {});
    expect(list.map((row) => row.id)).toContain(teammate.id);
    expect((await getTeammateOp.run(ctx, { id: teammate.id })).name).toBe(
      "Key Probe"
    );
    const updated = await updateTeammateOp.run(ctx, {
      id: teammate.id,
      patch: { title: "Probe" },
    });
    expect(updated.title).toBe("Probe");
    await deleteTeammateOp.run(ctx, { id: teammate.id });
  });

  it("reads the key holder's own Teammate thread through the pinned view", async () => {
    const inner = getMockDb();
    const ctx = keyContext(pinned(inner));
    const teammate = await createTeammateOp.run(ctx, { name: "Thread Probe" });
    // Seeded on the inner Db: a turn is what creates these, and a key cannot
    // run one. What matters is that the two reads behind the endpoints resolve
    // through the pinned view.
    const conversation = await inner.createConversation({
      teammateId: teammate.id,
      subjectType: "member",
      subjectId: DEMO_MEMBER.userId,
      title: "Earlier",
    });
    await inner.appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: [{ type: "text", text: "hello" }],
    });

    const thread = await listTeammateThreadOp.run(ctx, { id: teammate.id });
    expect(thread.map((row) => row.id)).toEqual([conversation.id]);
    const read = await readTeammateConversationOp.run(ctx, {
      id: teammate.id,
      conversationId: conversation.id,
    });
    expect(read.messages).toHaveLength(1);
    await expect(
      readTeammateConversationOp.run(ctx, {
        id: teammate.id,
        conversationId: "no-such-conversation",
      })
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("still refuses another Organization's Teammate", async () => {
    const inner = getMockDb();
    const foreign = await inner.table("teammates").insert({
      organizationId: "some-other-org",
      ownerId: "someone-else",
      name: "Theirs",
    });
    const ctx = keyContext(pinned(inner));
    // The pinned view resolves the row to its owner and reads it as absent, so
    // the operation's own `not_found` is what the caller sees.
    await expect(
      getTeammateOp.run(ctx, { id: foreign.id })
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("the Channels domain over an API key", () => {
  it("runs every endpoint's operation on the pinned Db", async () => {
    const inner = getMockDb();
    const ctx = keyContext(pinned(inner));
    const teammate = await createTeammateOp.run(ctx, { name: "Channel Probe" });
    const channel = await createChannelOp.run(ctx, {
      name: "Key channel",
      teammateIds: [teammate.id],
    });

    const mine = await listChannelsOp.run(ctx, {});
    expect(mine.map((row) => row.channel.id)).toContain(channel.id);

    const view = await getChannelOp.run(ctx, { id: channel.id });
    expect(view.teammates.map((row) => row.id)).toEqual([teammate.id]);
    expect(view.messages).toEqual([]);

    const renamed = await updateChannelOp.run(ctx, {
      id: channel.id,
      patch: { name: "Renamed" },
    });
    expect(renamed.name).toBe("Renamed");

    await addChannelMembersOp.run(ctx, {
      id: channel.id,
      userIds: ["u-martina"],
    });
    await removeChannelMemberOp.run(ctx, {
      id: channel.id,
      userId: "u-martina",
    });
    await addChannelTeammatesOp.run(ctx, {
      id: channel.id,
      teammateIds: [teammate.id],
    });
    await removeChannelTeammateOp.run(ctx, {
      id: channel.id,
      teammateId: teammate.id,
    });
    await deleteChannelOp.run(ctx, { id: channel.id });
    expect(
      (await listChannelsOp.run(ctx, {})).map((row) => row.channel.id)
    ).not.toContain(channel.id);
  });

  it("refuses another Organization's channel as if it did not exist", async () => {
    const inner = getMockDb();
    const foreign = await inner.table("teammateChannels").insert({
      organizationId: "some-other-org",
      name: "Theirs",
      createdBy: "someone-else",
    });
    await inner.table("teammateChannelParticipants").insert({
      organizationId: "some-other-org",
      channelId: foreign.id,
      userId: DEMO_MEMBER.userId,
    });
    const ctx = keyContext(pinned(inner));
    // Even a seat in it does not make it readable: the pinned view resolves the
    // channel to its Organization first.
    await expect(
      getChannelOp.run(ctx, { id: foreign.id })
    ).rejects.toMatchObject({ code: "not_found" });
    expect(
      (await listChannelsOp.run(ctx, {})).map((row) => row.channel.id)
    ).not.toContain(foreign.id);
  });
});
