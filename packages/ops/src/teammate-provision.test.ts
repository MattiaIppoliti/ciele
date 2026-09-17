import { describe, expect, it } from "vitest";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import type { OperationContext } from "./operation";
import { provisionTeammateOp } from "./teammate-provision";
import { listTeammateGrantsOp } from "./teammate-grants";
import { listRoutinesOp } from "./routines";

/**
 * The one workflow operation. Its value is the order it runs in, so that is
 * what these assert: every partial outcome has to be a safe one, and the caller
 * has to be able to read how far it got without diffing.
 */

const ctx = (role: OperationContext["role"] = "owner"): OperationContext => ({
  organizationId: DEMO_ORG.id,
  userId: DEMO_MEMBER.userId,
  role,
  db: getMockDb(),
});

describe("provisioning a Teammate", () => {
  it("creates, grants and schedules in one call", async () => {
    const context = ctx();
    const result = await provisionTeammateOp.run(context, {
      name: "Triage",
      title: "Feedback triage",
      grants: ["improvements"],
      ceiling: "edit",
      routines: [{ instruction: "Triage new feedback", cadence: "daily", hour: 8 }],
    });

    expect(result.partial).toBeNull();
    expect(result.governance?.domains).toEqual(["improvements"]);
    expect(result.routines).toHaveLength(1);

    // Not just the returned shape: the rows the separate endpoints read.
    expect(
      (await listTeammateGrantsOp.run(context, { id: result.teammate.id })).domains
    ).toEqual(["improvements"]);
    expect(
      await listRoutinesOp.run(context, { teammateId: result.teammate.id })
    ).toHaveLength(1);
  });

  it("leaves a Teammate that answers and cannot act when nothing is granted", async () => {
    const context = ctx();
    const result = await provisionTeammateOp.run(context, { name: "Plain" });
    expect(result.partial).toBeNull();
    expect(result.governance).toBeNull();
    expect(
      (await listTeammateGrantsOp.run(context, { id: result.teammate.id })).domains
    ).toEqual([]);
  });

  // `ceiling` fails *open*: the column's default is `edit`, the permissive end,
  // so a ceiling that is quietly dropped arms the Teammate one rung above what
  // the caller asked for, and a later set-grants call inherits it. Governance
  // is therefore applied whenever it is asked for, grants or no grants.
  it("applies a ceiling asked for without grants", async () => {
    const context = ctx();
    const result = await provisionTeammateOp.run(context, {
      name: "Capped",
      ceiling: "member",
    });

    expect(result.partial).toBeNull();
    expect(result.governance?.ceiling).toBe("member");
    expect(result.governance?.domains).toEqual([]);

    const read = await listTeammateGrantsOp.run(context, { id: result.teammate.id });
    expect(read.ceiling).toBe("member");
    expect(read.domains).toEqual([]);
  });

  it("says so when a ceiling without grants is refused", async () => {
    // Governance is admin-tier whatever it carries, so an Editor asking for one
    // has to read a refusal rather than a success that did not happen.
    const context = ctx("editor");
    const result = await provisionTeammateOp.run(context, {
      name: "Capped by an editor",
      approvalBypass: true,
    });

    expect(result.partial).toBe("grants");
    expect(result.reason).toContain("manageMembers");
    expect(result.governance).toBeNull();
  });

  it("reports a refused grant instead of throwing away the Teammate", async () => {
    // An Editor may create a colleague and may not arm one. Throwing here would
    // hand back a 403 and lose the id of the Teammate that now exists.
    const context = ctx("editor");
    const result = await provisionTeammateOp.run(context, {
      name: "Half armed",
      grants: ["improvements"],
      routines: [{ instruction: "Triage", cadence: "daily" }],
    });

    expect(result.teammate.id).toBeTruthy();
    expect(result.partial).toBe("grants");
    expect(result.reason).toBeTruthy();
    // The order is the guarantee: routines must not have run, or an unarmed
    // Teammate would be doing unattended work nobody approved.
    expect(result.routines).toEqual([]);
    expect(
      await listRoutinesOp.run(context, { teammateId: result.teammate.id })
    ).toEqual([]);
  });

  it("stops at the routine cap and says so, keeping what already landed", async () => {
    const context = ctx();
    const result = await provisionTeammateOp.run(context, {
      name: "Over-scheduled",
      routines: Array.from({ length: 5 }, (_, index) => ({
        instruction: `Job ${index}`,
        cadence: "daily" as const,
      })),
    });
    expect(result.partial).toBeNull();
    expect(result.routines).toHaveLength(5);

    // The sixth is refused by the cap; the schema refuses it earlier still.
    expect(
      provisionTeammateOp.input.safeParse({
        name: "Too many",
        routines: Array.from({ length: 6 }, () => ({
          instruction: "Job",
          cadence: "daily",
        })),
      }).success
    ).toBe(false);
  });

  it("declares create's capability, not granting's", async () => {
    // Declaring `manageMembers` here would refuse an Editor the
    // create-plus-routines call they are entitled to make; granting re-checks
    // its own capability inside `setTeammateGrantsOp`.
    expect(provisionTeammateOp.capability).toBe("edit");
    const result = await provisionTeammateOp.run(ctx("editor"), {
      name: "Editor made me",
      routines: [{ instruction: "Daily sweep", cadence: "daily" }],
    });
    expect(result.partial).toBeNull();
    expect(result.routines).toHaveLength(1);
  });
});
