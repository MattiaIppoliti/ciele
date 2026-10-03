import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { defineOperation, OperationError, type OperationContext } from "./operation";

const ctx: OperationContext = {
  organizationId: DEMO_ORG.id, userId: DEMO_MEMBER.userId, role: "viewer", db: getMockDb(),
};

afterEach(() => vi.restoreAllMocks());

describe("observed operations", () => {
  it("preserves declarations and relies on the caller's authorization", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = { privateBody: "student private text" };
    const schema = z.object({ privateInput: z.string() });
    const entities = () => [];
    const op = defineOperation({
      name: "assistants.probe", capability: "edit", effect: "read", input: schema,
      entities, run: async () => result,
    });
    // A granted Teammate can run an edit for a Viewer. Observation must never
    // replace the caller's permission policy with a second Role check.
    await expect(op.run(ctx, { privateInput: "secret" })).resolves.toBe(result);
    expect(op.capability).toBe("edit");
    expect(op.input).toBe(schema);
    expect(op.entities).toBe(entities);
    expect(log).toHaveBeenCalledTimes(2);
    expect(JSON.parse(log.mock.calls[1]![0])).toMatchObject({
      event: "operation", status: "succeeded", operation: "assistants.probe", organizationId: DEMO_ORG.id,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private text");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });

  it("keeps results and OperationError identity when runtime logging fails", async () => {
    vi.spyOn(console, "log").mockImplementation(() => { throw new Error("sink down"); });
    vi.spyOn(console, "error").mockImplementation(() => { throw new Error("sink down"); });
    vi.spyOn(console, "warn").mockImplementation(() => { throw new Error("sink down"); });
    const result = { id: "returned" };
    const op = defineOperation({
      name: "assistants.probe", capability: "member", effect: "read", input: z.object({}),
      entities: () => [], run: async () => result,
    });
    await expect(op.run(ctx, {})).resolves.toBe(result);
    const error = new OperationError("conflict", "Keep the original failure");
    const failing = defineOperation({ ...op, run: async () => { throw error; } });
    await expect(failing.run(ctx, {})).rejects.toBe(error);
  });

  it("reports caller-attributable failures as rejections rather than server faults", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = new OperationError("not_found", "private entity name");
    const op = defineOperation({
      name: "assistants.probe", capability: "member", effect: "read", input: z.object({}),
      entities: () => [], run: async () => { throw error; },
    });
    await expect(op.run(ctx, {})).rejects.toBe(error);
    expect(JSON.parse(warnings.mock.calls[0]![0])).toMatchObject({ status: "rejected", errorClass: "OperationError", errorCode: "not_found" });
    expect(JSON.stringify(warnings.mock.calls)).not.toContain("private entity name");
  });
});
