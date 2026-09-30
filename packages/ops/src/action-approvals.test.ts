import { describe, expect, it, vi } from "vitest";
import type { Role } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb, type Db } from "@agent-hub/db";
import { createAssistantOp } from "./assistants";
import { decideActionApprovalOp } from "./action-approvals";
import type { OperationContext, OperationPorts } from "./operation";

const ctx = (db: Db, ports: OperationPorts, over: Partial<OperationContext> = {}): OperationContext => ({
  organizationId: DEMO_ORG.id,
  userId: DEMO_MEMBER.userId,
  role: "editor" as Role,
  actorName: "Demo Member",
  db,
  ports,
  ...over,
});

async function seedApproval(db: Db) {
  const assistant = await createAssistantOp.run(ctx(db, {}, { role: "owner" }), { title: "Gate" });
  const conversation = await db.createConversation({
    assistantId: assistant.id,
    subjectType: "member",
    subjectId: DEMO_MEMBER.userId,
    title: "Delete it",
  });
  return db.table("actionApprovals").insert({
    organizationId: DEMO_ORG.id,
    conversationId: conversation.id,
    teammateId: "tm-ciele",
    requestedBy: DEMO_MEMBER.userId,
    operation: "platform.run",
    input: { name: "assistants.delete", input: { id: assistant.id } },
    label: "Run assistants.delete",
    reversibility: "irreversible",
    reason: "irreversible",
    backend: null,
    calibrated: null,
    confidence: {},
    mapVersion: 1,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
}

describe("approvals.decide", () => {
  it("runs the approved action once and stamps it", async () => {
    const db = getMockDb();
    const approval = await seedApproval(db);
    const run = vi.fn(async () => {});

    const result = await decideActionApprovalOp.run(ctx(db, { runApprovedTeammateAction: run }), {
      id: approval.id,
      decision: "approved",
    });

    expect(result).toEqual({ status: "approved", ran: true });
    expect(run).toHaveBeenCalledExactlyOnceWith({
      teammateId: "tm-ciele",
      operation: "platform.run",
      input: approval.input,
      requestedBy: DEMO_MEMBER.userId,
    });
    expect((await db.table("actionApprovals").get(approval.id))?.executedAt).toEqual(
      expect.any(String)
    );
    // Approving again finds nothing left to run.
    await expect(
      decideActionApprovalOp.run(ctx(db, { runApprovedTeammateAction: run }), {
        id: approval.id,
        decision: "approved",
      })
    ).rejects.toMatchObject({ code: "conflict" });
    expect(run).toHaveBeenCalledOnce();
  });

  it("lets the Member approve again after the run failed, and runs it then", async () => {
    const db = getMockDb();
    const approval = await seedApproval(db);
    const run = vi
      .fn<NonNullable<OperationPorts["runApprovedTeammateAction"]>>()
      .mockRejectedValueOnce(new Error("upstream timed out"))
      .mockResolvedValueOnce(undefined);
    const ports = { runApprovedTeammateAction: run };

    await expect(
      decideActionApprovalOp.run(ctx(db, ports), { id: approval.id, decision: "approved" })
    ).rejects.toThrow("upstream timed out");
    const afterFailure = await db.table("actionApprovals").get(approval.id);
    expect(afterFailure).toMatchObject({ status: "approved", executedAt: null });

    const retried = await decideActionApprovalOp.run(ctx(db, ports), {
      id: approval.id,
      decision: "approved",
    });
    expect(retried).toEqual({ status: "approved", ran: true });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("refuses a second click while the first run is still going", async () => {
    const db = getMockDb();
    const approval = await seedApproval(db);
    let finish!: () => void;
    const run = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const ports = { runApprovedTeammateAction: run };

    const first = decideActionApprovalOp.run(ctx(db, ports), { id: approval.id, decision: "approved" });
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    await expect(
      decideActionApprovalOp.run(ctx(db, ports), { id: approval.id, decision: "approved" })
    ).rejects.toMatchObject({ code: "conflict" });
    finish();
    await expect(first).resolves.toEqual({ status: "approved", ran: true });
    expect(run).toHaveBeenCalledOnce();
  });

  it("does not turn a rejection into a retry of an approved row", async () => {
    const db = getMockDb();
    const approval = await seedApproval(db);
    const run = vi
      .fn<NonNullable<OperationPorts["runApprovedTeammateAction"]>>()
      .mockRejectedValueOnce(new Error("boom"));
    const ports = { runApprovedTeammateAction: run };
    await expect(
      decideActionApprovalOp.run(ctx(db, ports), { id: approval.id, decision: "approved" })
    ).rejects.toThrow("boom");

    await expect(
      decideActionApprovalOp.run(ctx(db, ports), { id: approval.id, decision: "rejected" })
    ).rejects.toMatchObject({ code: "conflict" });
    expect(run).toHaveBeenCalledOnce();
  });

  it("writes through the host's approval port, not the Member's own Db", async () => {
    // In production the Member's Db is their RLS session, and the table has no
    // member write policy: a write there matches no row and reads as "already
    // decided". The host hands the system Db's writes in instead.
    const db = getMockDb();
    const approval = await seedApproval(db);
    const writes = {
      decideActionApproval: vi.fn(db.decideActionApproval.bind(db)),
      claimActionApprovalRun: vi.fn(db.claimActionApprovalRun.bind(db)),
      settleActionApprovalRun: vi.fn(db.settleActionApprovalRun.bind(db)),
    };
    const refusing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "decideActionApproval" || prop === "claimActionApprovalRun" || prop === "settleActionApprovalRun") {
          return async () => {
            throw new Error(`wrote ${String(prop)} on the Member's Db`);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    await decideActionApprovalOp.run(
      ctx(refusing, { runApprovedTeammateAction: async () => {}, actionApprovalWrites: writes }),
      { id: approval.id, decision: "approved" }
    );
    expect(writes.decideActionApproval).toHaveBeenCalledOnce();
    expect(writes.claimActionApprovalRun).toHaveBeenCalledOnce();
    expect(writes.settleActionApprovalRun).toHaveBeenCalledExactlyOnceWith(
      approval.id,
      "ran",
      expect.any(String)
    );
  });

  it("refuses a Member who is neither an admin nor the one who asked", async () => {
    const db = getMockDb();
    const approval = await seedApproval(db);
    const run = vi.fn(async () => {});
    await expect(
      decideActionApprovalOp.run(
        ctx(db, { runApprovedTeammateAction: run }, { userId: "u-someone-else", role: "editor" }),
        { id: approval.id, decision: "approved" }
      )
    ).rejects.toMatchObject({ code: "conflict" });
    expect(run).not.toHaveBeenCalled();
  });
});
