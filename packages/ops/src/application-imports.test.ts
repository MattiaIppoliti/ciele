import { describe, expect, it, vi } from "vitest";
import type { ApplicationScopeOption, Role } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import {
  createApplicationImportOp,
  deleteApplicationImportOp,
  setApplicationImportAssistantsOp,
  setApplicationImportEnabledOp,
  syncApplicationImportNowOp,
  updateApplicationImportConfigurationOp,
} from "./application-imports";
import { OperationError, type OperationContext, type OperationPorts } from "./operation";

/**
 * The Application Import lifecycle (#3 of the console architecture review):
 * the rules that used to live only in untested server actions. The provider
 * and the job ledger sit behind the `applicationImports` port, so these tests
 * record what the lifecycle asked the host to do.
 */

const channel = (id: string, member = true): ApplicationScopeOption => ({
  id,
  label: `#${id}`,
  kind: "channel",
  parentId: null,
  metadata: { member },
});

function host(scopes: ApplicationScopeOption[] = [channel("C1"), channel("C2")]) {
  const calls = { discovered: [] as string[], enqueued: [] as string[], cancelled: [] as string[] };
  const port: NonNullable<OperationPorts["applicationImports"]> = {
    discoverScopes: async (connectionId) => {
      calls.discovered.push(connectionId);
      return scopes;
    },
    enqueueSync: async ({ importId }) => {
      calls.enqueued.push(importId);
    },
    cancelSync: async (importId, reason) => {
      calls.cancelled.push(`${importId}:${reason}`);
    },
  };
  return { calls, port };
}

const ctx = (ports: OperationPorts, over: Partial<OperationContext> = {}): OperationContext => ({
  organizationId: DEMO_ORG.id,
  userId: DEMO_MEMBER.userId,
  role: "owner" as Role,
  db: getMockDb(),
  ports,
  ...over,
});

async function seed() {
  const db = getMockDb();
  const connection = await db.createApplicationConnection({
    organizationId: DEMO_ORG.id,
    provider: "slack",
    name: "Slack",
    sealedCredentials: "sealed",
    scopes: ["channels:read"],
  });
  const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Import target" });
  return { db, connection, assistant };
}

async function created(channelIds = ["C1"]) {
  const { db, connection, assistant } = await seed();
  const { calls, port } = host();
  const result = await createApplicationImportOp.run(ctx({ applicationImports: port }), {
    connectionId: connection.id,
    name: "  Support channels  ",
    assistantIds: [assistant.id],
    cadence: "daily",
    config: { channelIds },
  });
  return { db, connection, assistant, calls, port, result };
}

describe("createApplicationImportOp", () => {
  it("validates against discovery, stores the Import in the Library and queues its first sync", async () => {
    const { db, connection, assistant, calls, result } = await created();
    const row = await db.getApplicationImport(result.id);
    expect(row).toMatchObject({
      name: "Support channels",
      connectionId: connection.id,
      assistantIds: [assistant.id],
      cadence: "daily",
    });
    expect(row?.config).toMatchObject({ channelIds: ["C1"] });
    expect(calls.discovered).toEqual([connection.id]);
    expect(calls.enqueued).toEqual([result.id]);
  });

  it("refuses a scope discovery did not list, before anything is stored", async () => {
    const { connection, assistant } = await seed();
    const { calls, port } = host([channel("C1")]);
    await expect(
      createApplicationImportOp.run(ctx({ applicationImports: port }), {
        connectionId: connection.id,
        name: "Guessed",
        assistantIds: [assistant.id],
        cadence: "manual",
        config: { channelIds: ["C-guessed"] },
      }),
    ).rejects.toThrow(/not available to this Connection/);
    expect(calls.enqueued).toEqual([]);
    // A bad selection is the caller's input, so every surface reports it as
    // one (a 400 over the API), not as a server failure.
    await expect(
      createApplicationImportOp.run(ctx({ applicationImports: port }), {
        connectionId: connection.id,
        name: "Guessed",
        assistantIds: [assistant.id],
        cadence: "manual",
        config: { channelIds: [] },
      }),
    ).rejects.toMatchObject({ code: "invalid_input", message: "Select at least one Slack channel" });
  });

  it("refuses an Assistant from another Organization", async () => {
    const { connection } = await seed();
    const { port } = host();
    await expect(
      createApplicationImportOp.run(ctx({ applicationImports: port }), {
        connectionId: connection.id,
        name: "X",
        assistantIds: ["as_foreign"],
        cadence: "manual",
        config: { channelIds: ["C1"] },
      }),
    ).rejects.toThrow(/do not belong to this Organization/);
  });

  it("refuses a Connection of another Organization as not found", async () => {
    const { assistant } = await seed();
    const { port } = host();
    await expect(
      createApplicationImportOp.run(ctx({ applicationImports: port }), {
        connectionId: "conn_missing",
        name: "X",
        assistantIds: [assistant.id],
        cadence: "manual",
        config: { channelIds: ["C1"] },
      }),
    ).rejects.toThrowError(OperationError);
  });

  it("revalidates the Library and the Knowledge tab of every target Assistant", async () => {
    const { assistant, result } = await created();
    expect(createApplicationImportOp.entities({} as never, result)).toEqual([
      { kind: "knowledgeHub" },
      { kind: "assistantEditor", assistantId: assistant.id },
    ]);
  });

  it("is refused where the host has no Applications port", async () => {
    const { connection, assistant } = await seed();
    await expect(
      createApplicationImportOp.run(ctx({}), {
        connectionId: connection.id,
        name: "X",
        assistantIds: [assistant.id],
        cadence: "manual",
        config: { channelIds: ["C1"] },
      }),
    ).rejects.toThrowError(OperationError);
  });
});

describe("updateApplicationImportConfigurationOp", () => {
  it("resets the imported Sources only when the scope itself changed", async () => {
    const { db, assistant, port, result } = await created(["C1"]);
    const update = vi.spyOn(db, "updateApplicationImport");
    const edit = (channelIds: string[], name: string) =>
      updateApplicationImportConfigurationOp.run(ctx({ applicationImports: port }), {
        importId: result.id,
        name,
        assistantIds: [assistant.id],
        cadence: "daily",
        config: { channelIds },
      });
    try {
      // A rename keeps the scope: nothing imported becomes wrong.
      await edit(["C1"], "Renamed");
      expect(update.mock.calls.at(-1)?.[1]).toMatchObject({ name: "Renamed", resetSources: false });
      // A different channel is a different corpus: start it over.
      await edit(["C2"], "Renamed");
      expect(update.mock.calls.at(-1)?.[1]).toMatchObject({ resetSources: true, checkpoint: {} });
    } finally {
      update.mockRestore();
    }
  });

  it("refuses to edit an Import that is synchronizing", async () => {
    const { db, assistant, port, result } = await created();
    await db.updateApplicationImport(result.id, { status: "syncing" });
    await expect(
      updateApplicationImportConfigurationOp.run(ctx({ applicationImports: port }), {
        importId: result.id,
        name: "X",
        assistantIds: [assistant.id],
        cadence: "daily",
        config: { channelIds: ["C1"] },
      }),
    ).rejects.toThrow(/Wait for the current synchronization/);
  });

  it("queues a sync after the edit only while the Import is enabled", async () => {
    const { db, assistant, calls, port, result } = await created();
    await db.updateApplicationImport(result.id, { enabled: false });
    calls.enqueued.length = 0;
    await updateApplicationImportConfigurationOp.run(ctx({ applicationImports: port }), {
      importId: result.id,
      name: "Paused edit",
      assistantIds: [assistant.id],
      cadence: "daily",
      config: { channelIds: ["C1"] },
    });
    expect(calls.enqueued).toEqual([]);
  });
});

describe("the rest of the lifecycle", () => {
  it("pausing cancels queued syncs and clears the schedule; resuming a daily Import schedules it now", async () => {
    const { db, calls, port, result } = await created();
    await setApplicationImportEnabledOp.run(ctx({ applicationImports: port }), { importId: result.id, enabled: false });
    expect(calls.cancelled).toEqual([`${result.id}:Application Import paused`]);
    expect(await db.getApplicationImport(result.id)).toMatchObject({ enabled: false, nextSyncAt: null });

    calls.enqueued.length = 0;
    await setApplicationImportEnabledOp.run(ctx({ applicationImports: port }), { importId: result.id, enabled: true });
    const resumed = await db.getApplicationImport(result.id);
    expect(resumed?.enabled).toBe(true);
    expect(resumed?.nextSyncAt).not.toBeNull();
    expect(calls.enqueued).toEqual([result.id]);
  });

  it("refuses a manual sync of a paused Import", async () => {
    const { db, port, result } = await created();
    await db.updateApplicationImport(result.id, { enabled: false });
    await expect(
      syncApplicationImportNowOp.run(ctx({ applicationImports: port }), { importId: result.id }),
    ).rejects.toThrow(/Resume this Application Import/);
  });

  it("replacing the Assistants revalidates the old and the new ones", async () => {
    const { db, assistant, port, result } = await created();
    const other = await db.createAssistant(DEMO_ORG.id, { title: "Second target" });
    const changed = await setApplicationImportAssistantsOp.run(ctx({ applicationImports: port }), {
      importId: result.id,
      assistantIds: [other.id],
    });
    expect((await db.getApplicationImport(result.id))?.assistantIds).toEqual([other.id]);
    expect(setApplicationImportAssistantsOp.entities({} as never, changed)).toEqual([
      { kind: "knowledgeHub" },
      { kind: "assistantEditor", assistantId: assistant.id },
      { kind: "assistantEditor", assistantId: other.id },
    ]);
  });

  it("deleting cancels its syncs first, then removes the Import", async () => {
    const { db, calls, port, result } = await created();
    await deleteApplicationImportOp.run(ctx({ applicationImports: port }), { importId: result.id });
    expect(calls.cancelled).toEqual([`${result.id}:Application Import deleted`]);
    expect(await db.getApplicationImport(result.id)).toBeNull();
  });

  it("treats another Organization's Import as not found", async () => {
    const { port, result } = await created();
    await expect(
      deleteApplicationImportOp.run(ctx({ applicationImports: port }, { organizationId: "org_other" }), {
        importId: result.id,
      }),
    ).rejects.toThrowError(OperationError);
  });
});
