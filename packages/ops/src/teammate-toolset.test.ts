import { describe, expect, it } from "vitest";
import type { Role } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, createOrgPinnedDb, getMockDb } from "@agent-hub/db";
import { ensureCieleAiOp } from "./ciele-ai";
import type { OperationContext } from "./operation";
import { setTeammateGrantsOp } from "./teammate-grants";
import { teammateToolset, type TeammateToolsetMember } from "./teammate-toolset";
import { createTeammateOp } from "./teammates";

/**
 * Every tool a Teammate's turn may call, for both kinds of Teammate, on the
 * in-memory Db. The boundary is the point: Ciele AI acts with the chatting
 * Member's Role and waits for them on anything consequential, an ordinary
 * Teammate acts with its own grants.
 */

const member = (role: Role | null, userId = DEMO_MEMBER.userId): TeammateToolsetMember => ({
  organizationId: DEMO_ORG.id,
  userId,
  role,
  db: createOrgPinnedDb(getMockDb(), DEMO_ORG.id),
});

const ownerCtx = (): OperationContext => ({ ...member("owner"), role: "owner" });

async function cieleAiTools(role: Role | null) {
  const teammate = await ensureCieleAiOp.run(ownerCtx(), {});
  const tools = await teammateToolset({ teammate, member: member(role) });
  const byName = (name: string) => {
    const tool = tools.find((candidate) => candidate.operation === name);
    if (!tool) throw new Error(`no ${name} tool`);
    return tool;
  };
  return { tools, byName };
}

describe("Ciele AI's toolset", () => {
  it("is list, describe and run on the platform", async () => {
    const { tools } = await cieleAiTools("owner");
    expect(tools.map((tool) => tool.operation)).toEqual([
      "platform.list",
      "platform.describe",
      "platform.run",
    ]);
    expect(tools.every((tool) => tool.domain === "platform")).toBe(true);
  });

  it("lists domains first, then one domain's operations with what waits", async () => {
    const { byName } = await cieleAiTools("owner");
    const domains = (await byName("platform.list").run({})).result as { domain: string }[];
    expect(domains.map((row) => row.domain)).toContain("assistants");
    const rows = (await byName("platform.list").run({ domain: "assistants" })).result as {
      name: string;
      confirm: boolean;
    }[];
    expect(rows.find((row) => row.name === "assistants.delete")?.confirm).toBe(true);
    expect(rows.find((row) => row.name === "assistants.list")?.confirm).toBe(false);
  });

  it("runs a read for a Viewer, and refuses them a write an Owner may make", async () => {
    const viewer = await cieleAiTools("viewer");
    const read = await viewer.byName("platform.run").run({ name: "assistants.list", input: {} });
    expect(Array.isArray(read.result)).toBe(true);
    await expect(
      viewer.byName("platform.run").run({ name: "assistants.create", input: { title: "No" } })
    ).rejects.toThrow(/role does not allow/);

    const owner = await cieleAiTools("owner");
    const created = await owner
      .byName("platform.run")
      .run({ name: "assistants.create", input: { title: "Made by Ciele AI" } });
    expect(created.entities.length).toBeGreaterThan(0);
  });

  it("marks a consequential call as waiting, and a read as not", async () => {
    const run = (await cieleAiTools("owner")).byName("platform.run");
    expect(run.alwaysConfirm?.({ name: "assistants.delete", input: { id: "a" } })).toBe(true);
    expect(run.alwaysConfirm?.({ name: "inbox.conversations.legalHold", input: {} })).toBe(true);
    expect(run.alwaysConfirm?.({ name: "assistants.list", input: {} })).toBe(false);
  });

  it("refuses to run a consequential call nobody confirmed, whoever calls it", async () => {
    // The turn's gate is one caller; the approval replay is another. The tool
    // itself is what holds the promise, so neither can skip it.
    const run = (await cieleAiTools("owner")).byName("platform.run");
    const created = await run.run({ name: "assistants.create", input: { title: "Doomed" } });
    const id = (created.result as { id: string }).id;
    await expect(run.run({ name: "assistants.delete", input: { id } })).rejects.toThrow(
      /confirm/
    );
    const listed = await run.run({ name: "assistants.list", input: {} });
    expect((listed.result as { id: string }[]).map((row) => row.id)).toContain(id);

    await run.run({ name: "assistants.delete", input: { id } }, { confirmed: true });
    const after = await run.run({ name: "assistants.list", input: {} });
    expect((after.result as { id: string }[]).map((row) => row.id)).not.toContain(id);
  });

  it("gives a turn with no Member, or no Role, no tools at all", async () => {
    const teammate = await ensureCieleAiOp.run(ownerCtx(), {});
    expect(await teammateToolset({ teammate, member: member("owner", "") })).toEqual([]);
    expect(await teammateToolset({ teammate, member: member(null) })).toEqual([]);
  });
});

describe("an ordinary Teammate's toolset", () => {
  it("carries its grants' tools and its memory tools, and a Viewer may use them", async () => {
    const teammate = await createTeammateOp.run(ownerCtx(), {
      name: "Nora",
      roleDescription: "Keeps the board tidy.",
    });
    await setTeammateGrantsOp.run(ownerCtx(), {
      id: teammate.id,
      domains: ["improvements"],
    });
    const tools = await teammateToolset({ teammate, member: member("viewer") });
    const names = tools.map((tool) => tool.operation);
    expect(names).toContain("improvements.list");
    expect(names).toContain("memory.remember");
    expect(names).not.toContain("knowledge.org.faqs.create");
    expect(tools.every((tool) => tool.alwaysConfirm === undefined)).toBe(true);

    const board = tools.find((tool) => tool.operation === "improvements.list")!;
    expect(Array.isArray((await board.run({})).result)).toBe(true);
  });

  it("carries only its memory tools when nobody granted it anything", async () => {
    const teammate = await createTeammateOp.run(ownerCtx(), {
      name: "Quill",
      roleDescription: "Drafts copy.",
    });
    const tools = await teammateToolset({ teammate, member: member("viewer") });
    expect(tools.map((tool) => tool.domain)).toEqual(tools.map(() => "memory"));
  });
});
