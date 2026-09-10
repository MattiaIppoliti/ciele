import { describe, expect, it } from "vitest";
import type { Role } from "@agent-hub/core";
import { visibleTeammates } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { createAssistantOp } from "./assistants";
import { draftFlowOp, proposeFlowOp } from "./flows";
import {
  adoptFlowsAgentThreadOp,
  ensureFlowsAgentOp,
  listFlowsAgentThreadOp,
  readFlowsAgentConversationOp,
} from "./flows-agent";
import { OperationError, type OperationContext } from "./operation";
import { teammateActions } from "./teammate-actions";
import { listTeammatesOp } from "./teammates";

const ctx = (db = getMockDb(), over: Partial<OperationContext> = {}): OperationContext => ({
  organizationId: DEMO_ORG.id,
  userId: DEMO_MEMBER.userId,
  role: "editor" as Role,
  db,
  ...over,
});

describe("the Flows Agent (#838)", () => {
  it("is created once per Assistant with the flows grant, and stays off the roster", async () => {
    const db = getMockDb();
    const assistant = await createAssistantOp.run(ctx(db), { title: "Agent probe" });
    const first = await ensureFlowsAgentOp.run(ctx(db), { assistantId: assistant.id });
    const second = await ensureFlowsAgentOp.run(ctx(db), { assistantId: assistant.id });
    expect(second.id).toBe(first.id);
    expect(first.systemKind).toBe("flows_agent");
    expect(first.assistantId).toBe(assistant.id);

    const grants = await db.table("teammateGrants").list({ teammateId: first.id });
    expect(grants.map((g) => g.domain)).toEqual(["flows"]);

    const roster = await listTeammatesOp.run(ctx(db), {});
    expect(roster.map((t) => t.id)).not.toContain(first.id);
    expect(
      visibleTeammates([first], { userId: DEMO_MEMBER.userId, role: "owner" }).length
    ).toBe(0);
  });

  it("leaves a grant an admin revoked alone: granting is an admin decision (#770)", async () => {
    const db = getMockDb();
    const assistant = await createAssistantOp.run(ctx(db), { title: "Revoked" });
    const agent = await ensureFlowsAgentOp.run(ctx(db), { assistantId: assistant.id });
    for (const grant of await db.table("teammateGrants").list({ teammateId: agent.id })) {
      await db.table("teammateGrants").delete(grant.id);
    }
    await ensureFlowsAgentOp.run(ctx(db), { assistantId: assistant.id });
    expect(await db.table("teammateGrants").list({ teammateId: agent.id })).toEqual([]);
  });

  it("removes the half-made agent when the grant fails, so the next call creates it whole", async () => {
    // A missing grant is also what an admin's revocation looks like, and the
    // lookup cannot tell the two apart; an agent left behind by a failed grant
    // would therefore never act. So it is not left behind.
    const db = getMockDb();
    const assistant = await createAssistantOp.run(ctx(db), { title: "Grant fails" });
    await expect(
      ensureFlowsAgentOp.run(
        ctx(db, {
          ports: {
            grantSystemTeammate: async () => {
              throw new Error("grant table unavailable");
            },
          },
        }),
        { assistantId: assistant.id }
      )
    ).rejects.toMatchObject({ code: "conflict" });
    const leftovers = await db
      .table("teammates")
      .list({ systemKind: "flows_agent", assistantId: assistant.id });
    expect(leftovers).toEqual([]);
    const agent = await ensureFlowsAgentOp.run(ctx(db), { assistantId: assistant.id });
    expect((await db.table("teammateGrants").list({ teammateId: agent.id })).length).toBe(1);
  });

  it("writes the creation grant through the host port when one is wired", async () => {
    const db = getMockDb();
    const assistant = await createAssistantOp.run(ctx(db), { title: "Ported" });
    const seen: unknown[] = [];
    const agent = await ensureFlowsAgentOp.run(
      ctx(db, {
        ports: {
          grantSystemTeammate: async (grant) => {
            seen.push(grant);
          },
        },
      }),
      { assistantId: assistant.id }
    );
    expect(seen).toEqual([
      {
        organizationId: DEMO_ORG.id,
        teammateId: agent.id,
        domain: "flows",
        grantedBy: DEMO_MEMBER.userId,
      },
    ]);
    // Nothing went through the RLS-scoped Db, which is the point of the port.
    expect(await db.table("teammateGrants").list({ teammateId: agent.id })).toEqual([]);
  });

  it("offers exactly the four flows tools to a granted actor, never delete or reorder", () => {
    const names = teammateActions({
      id: "t1",
      name: "Flows Agent",
      ceiling: "edit",
      grants: ["flows"],
      approvalBypass: false,
      projectId: null,
    }).map((spec) => spec.operation.name);
    expect(names).toEqual(["flows.list", "flows.get", "flows.draft", "flows.propose"]);
    expect(names).not.toContain("flows.delete");
    expect(names).not.toContain("flows.reorder");
    expect(names).not.toContain("flows.create");
    expect(names).not.toContain("flows.update");
  });

  it("flows.draft validates and echoes the patch without writing anything", async () => {
    const db = getMockDb();
    const before = JSON.stringify(await db.listAssistants(DEMO_ORG.id));
    const result = await draftFlowOp.run(ctx(db), {
      summary: "Added a Slack read",
      patch: {
        trigger: "message",
        actions: ["custom_message", "connector"],
        actionSettings: { connector: { action: "slack.channel.list" } },
      },
    });
    expect(result).toEqual({
      applied: "draft",
      summary: "Added a Slack read",
      patch: {
        trigger: "message",
        actions: ["custom_message", "connector"],
        actionSettings: { connector: { action: "slack.channel.list" } },
      },
    });
    expect(JSON.stringify(await db.listAssistants(DEMO_ORG.id))).toBe(before);
  });

  it("flows.draft and flows.propose put a Human review before a Connector write (#841)", async () => {
    // The persona asks the model to; this is what happens when it does not.
    const db = getMockDb();
    const drafted = await draftFlowOp.run(ctx(db), {
      summary: "Post to Slack",
      patch: {
        actions: ["custom_message", "connector"],
        actionSettings: { connector: { action: "slack.message.post" } },
      },
    });
    expect(drafted.patch.actions).toEqual(["custom_message", "human_review", "connector"]);
    // An unchosen action is treated as a write.
    const unchosen = await draftFlowOp.run(ctx(db), {
      summary: "x",
      patch: { actions: ["connector"] },
    });
    expect(unchosen.patch.actions).toEqual(["human_review", "connector"]);
    // A patch that does not touch the actions leaves them alone.
    const settingsOnly = await draftFlowOp.run(ctx(db), {
      summary: "x",
      patch: { actionSettings: { connector: { action: "slack.message.post" } } },
    });
    expect(settingsOnly.patch.actions).toBeUndefined();

    const assistant = await createAssistantOp.run(ctx(db), { title: "Gate" });
    const proposed = await proposeFlowOp.run(ctx(db), {
      assistantId: assistant.id,
      rationale: "Escalations belong in their own Flow",
      flow: {
        name: "Escalate",
        actions: ["connector", "custom_message"],
        actionSettings: { connector: { action: "servicenow.incident.create" } },
      },
    });
    expect(proposed.proposal.actions).toEqual(["human_review", "connector", "custom_message"]);
  });

  it("flows.draft knows the inbound trigger, so an On HTTP request canvas can talk to the agent", async () => {
    // The route and this op once listed four triggers; the fifth got a 400 on
    // every message, and a Response action was checked against "message".
    const result = await draftFlowOp.run(ctx(), {
      summary: "Answer the caller",
      currentTrigger: "http_request",
      patch: { actions: ["api_request", "respond"] },
    });
    expect(result.patch.actions).toEqual(["api_request", "respond"]);
    // An inbound Flow cannot hold the gate, so a Connector write there stays ungated.
    const inbound = await draftFlowOp.run(ctx(), {
      summary: "x",
      currentTrigger: "http_request",
      patch: { actions: ["connector", "respond"] },
    });
    expect(inbound.patch.actions).toEqual(["connector", "respond"]);
  });

  it("flows.draft refuses an action its trigger cannot run, like Save does", async () => {
    await expect(
      draftFlowOp.run(ctx(), {
        summary: "x",
        patch: { trigger: "chat_open", actions: ["search_knowledge"] },
      })
    ).rejects.toMatchObject({ code: "invalid_input" });
    // The trigger the actions will run on may be the open flow's, not the patch's.
    await expect(
      draftFlowOp.run(ctx(), {
        summary: "x",
        currentTrigger: "chat_open",
        patch: { actions: ["search_knowledge"] },
      })
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      draftFlowOp.run(ctx(), {
        summary: "x",
        currentTrigger: "chat_open",
        patch: { actions: ["notification"] },
      })
    ).resolves.toMatchObject({ applied: "draft" });
  });

  it("flows.propose validates a whole Flow for the Assistant and echoes it", async () => {
    const db = getMockDb();
    const assistant = await createAssistantOp.run(ctx(db), { title: "Propose" });
    const result = await proposeFlowOp.run(ctx(db), {
      assistantId: assistant.id,
      rationale: "Refunds are a second intent",
      flow: { name: "Refunds", trigger: "message", actions: ["search_knowledge"] },
    });
    expect(result.proposal.name).toBe("Refunds");
    expect(result.rationale).toMatch(/second intent/);
    expect((await db.listFlows(assistant.id)).some((f) => f.name === "Refunds")).toBe(false);
    await expect(
      proposeFlowOp.run(ctx(db, { organizationId: "other" }), {
        assistantId: assistant.id,
        rationale: "x",
        flow: { name: "Nope" },
      })
    ).rejects.toBeInstanceOf(OperationError);
  });

  it("lists this Member's threads for one canvas by the flow tag, and reads one back", async () => {
    const db = getMockDb();
    const assistant = await createAssistantOp.run(ctx(db), { title: "Threads" });
    const agent = await ensureFlowsAgentOp.run(ctx(db), { assistantId: assistant.id });
    const forNew = await db.createConversation({
      teammateId: agent.id,
      subjectType: "member",
      subjectId: DEMO_MEMBER.userId,
      title: "New flow chat",
      metadata: { flowsAgent: { assistantId: assistant.id, flowId: null } },
    });
    await db.createConversation({
      teammateId: agent.id,
      subjectType: "member",
      subjectId: DEMO_MEMBER.userId,
      title: "Flow f1 chat",
      metadata: { flowsAgent: { assistantId: assistant.id, flowId: "f1" } },
    });
    await db.createConversation({
      teammateId: agent.id,
      subjectType: "member",
      subjectId: "someone-else",
      title: "Not mine",
      metadata: { flowsAgent: { assistantId: assistant.id, flowId: null } },
    });

    const fresh = await listFlowsAgentThreadOp.run(ctx(db), { assistantId: assistant.id, flowId: null });
    expect(fresh.map((c) => c.title)).toEqual(["New flow chat"]);
    const saved = await listFlowsAgentThreadOp.run(ctx(db), { assistantId: assistant.id, flowId: "f1" });
    expect(saved.map((c) => c.title)).toEqual(["Flow f1 chat"]);

    const read = await readFlowsAgentConversationOp.run(ctx(db), {
      assistantId: assistant.id,
      conversationId: forNew.id,
    });
    expect(read.conversation.id).toBe(forNew.id);

    // Save turned the new-Flow canvas into a Flow: its thread follows it, and
    // nobody else's does.
    const flow = await db.createFlow(assistant.id, { name: "Became real" });
    const adopted = await adoptFlowsAgentThreadOp.run(ctx(db), {
      assistantId: assistant.id,
      flowId: flow.id,
    });
    expect(adopted).toEqual({ adopted: 1 });
    expect(
      (await listFlowsAgentThreadOp.run(ctx(db), { assistantId: assistant.id, flowId: null })).length
    ).toBe(0);
    expect(
      (await listFlowsAgentThreadOp.run(ctx(db), { assistantId: assistant.id, flowId: flow.id })).map(
        (c) => c.title
      )
    ).toEqual(["New flow chat"]);
    expect(
      (await listFlowsAgentThreadOp.run(ctx(db, { userId: "someone-else" }), {
        assistantId: assistant.id,
        flowId: null,
      })).map((c) => c.title)
    ).toEqual(["Not mine"]);
    await expect(
      readFlowsAgentConversationOp.run(ctx(db, { userId: "someone-else" }), {
        assistantId: assistant.id,
        conversationId: forNew.id,
      })
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
