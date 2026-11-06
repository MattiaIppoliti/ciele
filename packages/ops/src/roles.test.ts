import { describe, expect, it } from "vitest";
import { builtinRoleDefaults, capabilitiesForLadderRole, type Role } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import type { OperationContext } from "./operation";
import { createOrgApiKeyOp, createInviteOp, updateMemberRoleOp } from "./organization";
import { createRoleOp, deleteRoleOp, listRolesOp, resetRoleOp, updateRoleOp } from "./roles";

/**
 * Roles (#1164, ADR-0028) on the demo Db. The demo Member is an Owner;
 * u-marco is an Admin and u-martina an Editor.
 */

const ADMIN = "u-marco";
const EDITOR = "u-martina";

function context(role: Role, userId: string, capabilities?: readonly string[]): OperationContext {
  return {
    organizationId: DEMO_ORG.id,
    userId,
    role,
    capabilities: capabilities ?? capabilitiesForLadderRole(role),
    db: getMockDb(),
    ports: {},
  };
}
const owner = () => context("owner", DEMO_MEMBER.userId);
const admin = (capabilities?: readonly string[]) => context("admin", ADMIN, capabilities);

const roleId = async (key: string) =>
  (await listRolesOp.run(owner(), {})).find((role) => role.key === key)!.id;

describe("the Role operations", () => {
  it("declare their Capabilities: anyone may read Roles, roles:manage edits them", () => {
    expect(listRolesOp.capability).toBe("member");
    for (const op of [createRoleOp, updateRoleOp, resetRoleOp, deleteRoleOp]) {
      expect(op.capability).toBe("roles:manage");
      expect(op.effect).toBe("consequential");
    }
  });

  it("list the built-ins with Owner locked and nothing edited yet", async () => {
    const roles = await listRolesOp.run(owner(), {});
    expect(roles.slice(0, 6).map((role) => role.name)).toEqual([
      "Owner", "Admin", "Editor", "Support Agent", "Viewer", "Data Viewer",
    ]);
    expect(roles[0]).toMatchObject({ builtIn: true, locked: true, edited: false });
    expect(roles.every((role) => !role.edited)).toBe(true);
  });

  it("turn on what a Capability relies on when a Role is created", async () => {
    const role = await createRoleOp.run(owner(), {
      name: "Flow builder",
      description: "",
      capabilities: ["flows:edit"],
      organizationLevel: true,
      assistantLevel: true,
    });
    expect(role.capabilities).toEqual(["assistants:view", "flows:view", "flows:edit"]);
    expect(role).toMatchObject({ builtIn: false, tier: "editor" });
    await expect(
      createRoleOp.run(owner(), { name: "flow BUILDER", description: "", capabilities: [], organizationLevel: true, assistantLevel: false })
    ).rejects.toMatchObject({ code: "conflict" });
    await deleteRoleOp.run(owner(), { id: role.id });
  });

  it("refuse Owner-only and unknown Capabilities before anything is written", () => {
    const parse = (capabilities: string[]) =>
      createRoleOp.input.safeParse({ name: "X", description: "", capabilities, organizationLevel: true, assistantLevel: false }).success;
    expect(parse(["personalSubscriptions:manage"])).toBe(false);
    expect(parse(["flows:teleport"])).toBe(false);
    expect(parse(["flows:view"])).toBe(true);
    expect(
      createRoleOp.input.safeParse({ name: "X", description: "", capabilities: [], organizationLevel: false, assistantLevel: false }).success
    ).toBe(false);
  });

  it("do not let a Member hand on what they lack, or edit the Role they hold", async () => {
    const withoutKeys = builtinRoleDefaults("admin").filter((id) => id !== "apiKeys:manage");
    await expect(
      createRoleOp.run(admin(withoutKeys), { name: "Minter", description: "", capabilities: ["apiKeys:manage"], organizationLevel: true, assistantLevel: false })
    ).rejects.toThrow(/apiKeys:manage/);
    await expect(
      updateRoleOp.run(admin(), { id: await roleId("admin"), description: "mine" })
    ).rejects.toThrow(/Role you hold/);
    await expect(
      updateRoleOp.run(owner(), { id: await roleId("owner"), name: "Boss" })
    ).rejects.toThrow(/cannot be edited/);
  });

  it("mark an edited built-in and reset it to today's defaults", async () => {
    const editor = await roleId("editor");
    const edited = await updateRoleOp.run(admin(), {
      id: editor,
      capabilities: builtinRoleDefaults("editor").filter((id) => id !== "flows:delete"),
    });
    expect(edited.edited).toBe(true);
    expect((await getMockDb().getMemberGrant(DEMO_ORG.id, EDITOR))?.capabilities).not.toContain("flows:delete");

    const reset = await resetRoleOp.run(admin(), { id: editor });
    expect(reset.edited).toBe(false);
    expect(reset.capabilities).toEqual(builtinRoleDefaults("editor"));
    await expect(resetRoleOp.run(owner(), { id: await roleId("owner") })).rejects.toThrow(/cannot be edited/);
  });

  it("assign a custom Role to a Member, and refuse deleting it while held", async () => {
    const triage = await createRoleOp.run(owner(), {
      name: "Triage",
      description: "",
      capabilities: ["inbox:triage"],
      organizationLevel: true,
      assistantLevel: false,
    });
    const member = await updateMemberRoleOp.run(admin(), { userId: EDITOR, roleId: triage.id });
    expect(member).toMatchObject({ roleId: triage.id, roleName: "Triage", role: "viewer" });
    await expect(deleteRoleOp.run(owner(), { id: triage.id })).rejects.toThrow(/held by 1 member/);

    // The old shape, a built-in by name, still works.
    const back = await updateMemberRoleOp.run(admin(), { userId: EDITOR, role: "editor" });
    expect(back).toMatchObject({ role: "editor", roleName: "Editor" });
    await deleteRoleOp.run(owner(), { id: triage.id });
    await expect(deleteRoleOp.run(owner(), { id: await roleId("viewer") })).rejects.toThrow(/built-in/);
  });

  it("refuse giving a Member, an invitation or a key a Role above the caller's", async () => {
    const support = builtinRoleDefaults("support_agent");
    const narrow = admin([...support, "members:manage", "members:view", "apiKeys:manage"]);
    await expect(updateMemberRoleOp.run(narrow, { userId: EDITOR, role: "editor" })).rejects.toThrow(/do not hold/);
    await expect(createInviteOp.run(narrow, { role: "editor", email: "x@example.com" })).rejects.toThrow(/do not hold/);
    await expect(createOrgApiKeyOp.run(narrow, { name: "k", role: "editor" })).rejects.toThrow(/cannot exceed/);
    const viewerInvite = await createInviteOp.run(narrow, { role: "viewer", email: "y@example.com" });
    expect(viewerInvite.roleName).toBe("Viewer");
    await getMockDb().revokeInvite(viewerInvite.id);
  });

  it("mint an API key that carries a custom Role", async () => {
    const reporting = await createRoleOp.run(owner(), {
      name: "Reporting",
      description: "",
      capabilities: ["insights:view"],
      organizationLevel: true,
      assistantLevel: false,
    });
    const { apiKey } = await createOrgApiKeyOp.run(owner(), { name: "BI", roleId: reporting.id });
    expect(apiKey).toMatchObject({ roleId: reporting.id, roleName: "Reporting", role: "viewer" });
    await expect(deleteRoleOp.run(owner(), { id: reporting.id })).rejects.toThrow(/active API key/);
    await getMockDb().revokeApiKey(apiKey.id);
    await deleteRoleOp.run(owner(), { id: reporting.id });
  });
});

describe("Teammate grants under custom Roles", () => {
  it("refuse arming a Teammate with a domain the granter cannot use", async () => {
    const { setTeammateGrantsOp } = await import("./teammate-grants");
    const { createTeammateOp } = await import("./teammates");
    const teammate = await createTeammateOp.run(owner(), { name: "Grant test", title: "Helper", standingRole: "Helps." } as never);
    // May grant, may read knowledge, may not edit it.
    const granter = admin(["teammates:view", "teammates:grants", "knowledge:view", "assistants:view"]);
    await expect(
      setTeammateGrantsOp.run(granter, { id: teammate.id, domains: ["knowledge"], ceiling: "edit" })
    ).rejects.toThrow(/knowledge:edit/);
    // At the member ceiling the knowledge grant only reads, which they may.
    await expect(
      setTeammateGrantsOp.run(granter, { id: teammate.id, domains: ["knowledge"], ceiling: "member" })
    ).resolves.toBeTruthy();
  });
});

describe("default Roles", () => {
  it("moves the invitation and Assistant defaults, and keeps a default from being deleted", async () => {
    const { setRoleDefaultsOp } = await import("./roles");
    const custom = await createRoleOp.run(owner(), {
      name: "Default probe",
      description: "",
      capabilities: ["inbox:view"],
      organizationLevel: true,
      assistantLevel: true,
    });
    const roles = await setRoleDefaultsOp.run(owner(), { memberRoleId: custom.id, assistantRoleId: custom.id });
    expect(roles.filter((role) => role.memberDefault).map((role) => role.name)).toEqual(["Default probe"]);
    await expect(deleteRoleOp.run(owner(), { id: custom.id })).rejects.toThrow(/default role/);
    await expect(setRoleDefaultsOp.run(owner(), { memberRoleId: await roleId("owner") })).rejects.toThrow(/cannot be Owner/);
    await setRoleDefaultsOp.run(owner(), { memberRoleId: await roleId("editor"), assistantRoleId: await roleId("viewer") });
    await deleteRoleOp.run(owner(), { id: custom.id });
  });
});

describe("a Role on one Assistant", () => {
  it("lets an Organization Viewer edit the Flows of the one Assistant their Role there allows", async () => {
    const { setAssistantAccessOp } = await import("./assistant-access");
    const { createAssistantOp } = await import("./assistants");
    const { authorizeOperation } = await import("./operation");
    const { createFlowOp, listFlowsOp } = await import("./flows");
    const flowEditor = await createRoleOp.run(owner(), {
      name: "Flow editor here",
      description: "",
      capabilities: ["flows:edit"],
      organizationLevel: false,
      assistantLevel: true,
    });
    const assistant = await createAssistantOp.run(owner(), { title: "Scoped flows" } as never);
    const other = await createAssistantOp.run(owner(), { title: "Elsewhere" } as never);
    await setAssistantAccessOp.run(owner(), { assistantId: assistant.id, userId: "u-marianna", role: null, roleId: flowEditor.id });
    const viewer = context("viewer", "u-marianna");
    expect((await authorizeOperation(viewer, createFlowOp, { assistantId: assistant.id, input: {} } as never)).allowed).toBe(true);
    expect((await authorizeOperation(viewer, createFlowOp, { assistantId: other.id, input: {} } as never)).allowed).toBe(false);
    expect((await authorizeOperation(viewer, listFlowsOp, { assistantId: assistant.id })).allowed).toBe(true);
    // The Role on the Assistant cannot be one the granter lacks.
    await expect(
      setAssistantAccessOp.run(admin(builtinRoleDefaults("viewer").concat(["assistants:access", "members:view"])), {
        assistantId: other.id,
        userId: "u-marianna",
        role: null,
        roleId: flowEditor.id,
      })
    ).rejects.toThrow(/do not hold/);
    await setAssistantAccessOp.run(owner(), { assistantId: assistant.id, userId: "u-marianna", role: null });
    await deleteRoleOp.run(owner(), { id: flowEditor.id });
  });
});
