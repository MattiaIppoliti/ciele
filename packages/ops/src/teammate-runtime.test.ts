import { describe, expect, it } from "vitest";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import {
  teammateRuntimeConfig,
  type TeammateRuntimeConfig,
} from "@agent-hub/core";
import { configureTeammateRuntimeOp } from "./teammate-runtime";
import { createTeammateOp, updateTeammateOp } from "./teammates";
import type { OperationContext } from "./operation";

const db = getMockDb();
const context = {
  db,
  organizationId: DEMO_ORG.id,
  userId: DEMO_MEMBER.userId,
  role: "admin",
} satisfies OperationContext;
const config = {
  harness: { kind: "ciele" },
  internet: true,
  computer: { browser: true, files: true, terminal: true },
} satisfies TeammateRuntimeConfig;
describe("execution configuration", () => {
  it("leaves old and newly created Teammates on the native harness with no execution grants", async () => {
    const teammate = await createTeammateOp.run(context, {
      name: "Safe defaults",
    });
    expect(teammateRuntimeConfig(teammate)).toEqual({
      harness: { kind: "ciele" },
      internet: false,
      computer: { browser: false, files: false, terminal: false },
    });
  });
  it("requires an admin and keeps execution configuration out of persona edits", async () => {
    const teammate = await createTeammateOp.run(context, {
      name: "Admin controlled",
    });
    expect(configureTeammateRuntimeOp.capability).toBe("manageMembers");
    await expect(
      configureTeammateRuntimeOp.run(
        { ...context, organizationId: "foreign" },
        { id: teammate.id, config },
      ),
    ).rejects.toThrow();
    await configureTeammateRuntimeOp.run(context, { id: teammate.id, config });
    await updateTeammateOp.run(
      context,
      updateTeammateOp.input.parse({
        id: teammate.id,
        patch: { name: "Edited persona", runtimeConfig: { internet: false } },
      }),
    );
    expect(
      (await db.table("teammates").get(teammate.id))?.runtimeConfig,
    ).toEqual(config);
  });
  it("refuses arbitrary harness URLs and impossible combinations of computer permissions", async () => {
    const teammate = await createTeammateOp.run(context, {
      name: "Strict configuration",
    });
    for (const invalid of [
      {
        ...config,
        harness: {
          kind: "ag_ui",
          connectionId: "registered",
          url: "https://attacker.example",
        },
      },
      { ...config, internet: false },
      { ...config, computer: { ...config.computer, files: false } },
      { ...config, supervisorToken: "secret" },
    ])
      expect(() =>
        configureTeammateRuntimeOp.input.parse({
          id: teammate.id,
          config: invalid,
        }),
      ).toThrow();
  });
});
