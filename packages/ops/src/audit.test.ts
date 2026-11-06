import { expect, it, vi } from "vitest";
import { z } from "zod";
import { createOrgPinnedDb, DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { defineOperation, OperationError, type OperationContext } from "./operation";
import { describeAuditChange } from "./audit";
import { updateOrganizationOp } from "./organization";
it("records only the outer write, keeps actor and entities, and never retains inputs", async () => {
  const db = getMockDb();
  const ctx: OperationContext = { db: createOrgPinnedDb(db, DEMO_ORG.id), organizationId: DEMO_ORG.id, userId: DEMO_MEMBER.userId, role: "admin", apiKeyId: "key-test", surface: "api" };
  const inner = defineOperation({ name: "audit-fixture.inner", capability: "flows:edit", effect: "write", input: z.object({ secret: z.string() }), entities: () => [], run: async () => ({ id: "entity" }) });
  const outer = defineOperation({ ...inner, name: "audit-fixture.outer", entities: (_input, result: { id: string }) => [{ kind: "assistant", id: result.id }], run: (context, input) => inner.run(context, input) });
  await outer.run(ctx, { secret: "never-persist-this-secret" });
  const rows = await db.listAuditEntries(DEMO_ORG.id, {});
  const matches = rows.filter(row => row.operation.startsWith("audit-fixture."));
  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({ operation: outer.name, effect: "write", outcome: "ok", surface: "api", apiKeyId: "key-test", memberId: DEMO_MEMBER.userId, entities: [{ kind: "assistant", id: "entity" }] });
  expect(JSON.stringify(matches)).not.toContain("never-persist");
});
it("records operation failures and preserves success when audit persistence fails", async () => {
  const db = getMockDb();
  const ctx: OperationContext = { db, organizationId: DEMO_ORG.id, userId: DEMO_MEMBER.userId, role: "editor" };
  const op = defineOperation({ name: "audit-fixture.failed", capability: "flows:edit", effect: "write", input: z.object({}), entities: () => [], run: async () => { throw new OperationError("conflict", "private error detail"); } });
  await expect(op.run(ctx, {})).rejects.toMatchObject({ code: "conflict" });
  expect((await db.listAuditEntries(DEMO_ORG.id, {})).find(row => row.operation === op.name)?.outcome).toBe("conflict");
  vi.spyOn(db, "recordAuditEntry").mockRejectedValueOnce(new Error("storage down"));
  const successful = defineOperation({ ...op, run: async () => "done" });
  await expect(successful.run(ctx, {})).resolves.toBe("done");
  vi.restoreAllMocks();
});
it("keeps the description an operation gives of its change, and only when it succeeds", async () => {
  const db = getMockDb();
  const ctx: OperationContext = { db, organizationId: DEMO_ORG.id, userId: DEMO_MEMBER.userId, role: "owner" };
  const described = defineOperation({
    name: "audit-fixture.described", capability: "flows:edit", effect: "write", input: z.object({ fail: z.boolean() }), entities: () => [],
    run: async (_ctx, { fail }) => {
      describeAuditChange({ target: { label: "viewer@example.test", detail: "Viewer role" }, changes: { Role: { before: "Viewer", after: "Editor" } } });
      if (fail) throw new OperationError("conflict", "refused");
      return {};
    },
  });
  await described.run(ctx, { fail: false });
  await expect(described.run(ctx, { fail: true })).rejects.toMatchObject({ code: "conflict" });
  const rows = (await db.listAuditEntries(DEMO_ORG.id, { operations: [described.name] }));
  const ok = rows.find(row => row.outcome === "ok");
  const failed = rows.find(row => row.outcome === "conflict");
  expect(ok).toMatchObject({ targetLabel: "viewer@example.test", targetDetail: "Viewer role", changes: { Role: { before: "Viewer", after: "Editor" } } });
  // A refused change describes nothing: it did not happen.
  expect(failed?.targetLabel ?? null).toBeNull();
  expect(failed?.changes ?? {}).toEqual({});
});
it("describes a retention change as the policy before and after", async () => {
  const db = getMockDb();
  const ctx: OperationContext = { db, organizationId: DEMO_ORG.id, userId: DEMO_MEMBER.userId, role: "owner" };
  await updateOrganizationOp.run(ctx, { messageRetentionDays: 90 });
  const [entry] = await db.listAuditEntries(DEMO_ORG.id, { operations: ["organization.update"] });
  expect(entry?.changes?.["Retention policy"]).toMatchObject({ before: { messages: null }, after: { messages: 90 } });
  await updateOrganizationOp.run(ctx, { messageRetentionDays: null });
});
