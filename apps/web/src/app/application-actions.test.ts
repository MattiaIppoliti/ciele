import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_ORG, getMockDb, type Db } from "@agent-hub/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  requireMember: vi.fn(),
  requireSession: vi.fn(),
}));
vi.mock("@/lib/widget-db", () => ({ getWidgetDb: vi.fn() }));
vi.mock("@agent-hub/agent", async (importOriginal) => {
  const original = await importOriginal<typeof import("@agent-hub/agent")>();
  return {
    ...original,
    discoverApplicationConnectionScopes: vi.fn(),
    enqueueApplicationSyncJob: vi.fn().mockResolvedValue(true),
    revokeApplicationConnectionCredentials: vi.fn().mockResolvedValue(undefined),
  };
});

import {
  discoverApplicationConnectionScopes,
  enqueueApplicationSyncJob,
  revokeApplicationConnectionCredentials,
} from "@agent-hub/agent";
import { requireMember } from "@/lib/authz";
import { getWidgetDb } from "@/lib/widget-db";
import {
  createApplicationImportAction,
  deleteApplicationConnectionAction,
  getApplicationConnectionDeleteImpactAction,
  setApplicationImportEnabledAction,
  updateApplicationImportConfigurationAction,
} from "./actions";

describe("Application knowledge actions", () => {
  const requireMemberMock = vi.mocked(requireMember);
  const getWidgetDbMock = vi.mocked(getWidgetDb);
  const enqueueMock = vi.mocked(enqueueApplicationSyncJob);
  const discoverMock = vi.mocked(discoverApplicationConnectionScopes);
  const revokeMock = vi.mocked(revokeApplicationConnectionCredentials);
  let db: Db;

  beforeEach(() => {
    db = getMockDb();
    requireMemberMock.mockReset();
    requireMemberMock.mockResolvedValue({
      db,
      organizationId: DEMO_ORG.id,
      session: {
        userId: "demo-owner",
        role: "owner",
        organization: DEMO_ORG,
      },
    } as never);
    getWidgetDbMock.mockReset();
    getWidgetDbMock.mockReturnValue(db);
    enqueueMock.mockClear();
    discoverMock.mockReset().mockResolvedValue({
      scopes: [
        { id: "C01", label: "#support", kind: "channel", parentId: null, metadata: {} },
      ],
    });
    revokeMock.mockReset();
    revokeMock.mockResolvedValue(undefined);
  });

  async function seedConnection() {
    return db.createApplicationConnection({
      organizationId: DEMO_ORG.id,
      provider: "slack",
      name: "Support Slack",
      sealedCredentials: "sealed-test-secret",
    });
  }

  it("creates an org-owned Import and queues its initial sync", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Help" });
    const connection = await seedConnection();

    const created = await createApplicationImportAction({
      connectionId: connection.id,
      name: "Support channel",
      assistantIds: [assistant.id],
      cadence: "daily",
      config: { channelIds: ["C01"], historyDays: 90 },
    });

    expect(await db.getApplicationImport(created.id)).toMatchObject({
      organizationId: DEMO_ORG.id,
      assistantIds: [assistant.id],
      config: { channelIds: ["C01"], historyDays: 90, allHistory: false },
    });
    expect(enqueueMock).toHaveBeenCalledWith(
      { importId: created.id, organizationId: DEMO_ORG.id },
      { db }
    );
  });

  it("rejects a mixed valid and foreign Assistant scope", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Help" });
    const connection = await seedConnection();
    await expect(
      createApplicationImportAction({
        connectionId: connection.id,
        name: "Support channel",
        assistantIds: [assistant.id, "foreign-assistant"],
        cadence: "manual",
        config: { channelIds: ["C01"] },
      })
    ).rejects.toThrow("do not belong to this Organization");
  });

  it("rejects a provider scope not returned by server-side discovery", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Help" });
    const connection = await seedConnection();
    await expect(
      createApplicationImportAction({
        connectionId: connection.id,
        name: "Guessed channel",
        assistantIds: [assistant.id],
        cadence: "manual",
        config: { channelIds: ["C-GUESSED"] },
      })
    ).rejects.toThrow("not available to this Connection");
  });

  it("refuses a Connection owned by another Organization", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Help" });
    const connection = await db.createApplicationConnection({
      organizationId: "other-organization",
      provider: "slack",
      name: "Other Slack",
      sealedCredentials: "sealed-test-secret",
    });

    await expect(
      createApplicationImportAction({
        connectionId: connection.id,
        name: "Foreign",
        assistantIds: [assistant.id],
        cadence: "manual",
        config: { channelIds: ["C01"] },
      })
    ).rejects.toThrow("Application Connection not found");
  });

  it("propagates edited Assistant links to every materialized Source", async () => {
    const first = await db.createAssistant(DEMO_ORG.id, { title: "First" });
    const second = await db.createAssistant(DEMO_ORG.id, { title: "Second" });
    const connection = await seedConnection();
    const collection = await db.getOrCreateOrgLibraryCollection(DEMO_ORG.id);
    const applicationImport = await db.createApplicationImport({
      organizationId: DEMO_ORG.id,
      connectionId: connection.id,
      collectionId: collection.id,
      name: "Support channel",
      config: { channelIds: ["C01"] },
      cadence: "manual",
      assistantIds: [first.id],
    });
    const source = await db.createSource({
      collectionId: collection.id,
      name: "Thread",
      kind: "application",
      config: { applicationImportId: applicationImport.id },
    });
    await db.setSourceAssistantLinks(source.id, [first.id]);
    await db.upsertApplicationSource({
      importId: applicationImport.id,
      sourceId: source.id,
      remoteId: "C01:1",
      contentHash: "hash",
      lastSeenAt: new Date().toISOString(),
    });

    await updateApplicationImportConfigurationAction({
      importId: applicationImport.id,
      name: "Renamed channel",
      assistantIds: [second.id],
      cadence: "daily",
      config: { channelIds: ["C01"], allHistory: true },
    });

    expect(await db.listSourceAssistantLinks(source.id)).toEqual([
      expect.objectContaining({ assistantId: second.id }),
    ]);
    expect(await db.getApplicationImport(applicationImport.id)).toMatchObject({
      name: "Renamed channel",
      assistantIds: [second.id],
      checkpoint: {},
    });
    expect(enqueueMock).toHaveBeenCalledOnce();
  });

  it("tombstones the old Source set when the selected provider scope changes", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Help" });
    const connection = await seedConnection();
    const collection = await db.getOrCreateOrgLibraryCollection(DEMO_ORG.id);
    const applicationImport = await db.createApplicationImport({
      organizationId: DEMO_ORG.id,
      connectionId: connection.id,
      collectionId: collection.id,
      name: "Old channel",
      config: { channelIds: ["C01"] },
      cadence: "manual",
      assistantIds: [assistant.id],
    });
    const source = await db.createSource({
      collectionId: collection.id,
      name: "Private thread",
      kind: "application",
    });
    await db.upsertApplicationSource({
      importId: applicationImport.id,
      sourceId: source.id,
      remoteId: "C01:private",
      contentHash: "hash",
      lastSeenAt: new Date().toISOString(),
    });
    discoverMock.mockResolvedValueOnce({
      scopes: [
        { id: "C02", label: "#public", kind: "channel", parentId: null, metadata: {} },
      ],
    });

    await updateApplicationImportConfigurationAction({
      importId: applicationImport.id,
      name: "Public channel",
      assistantIds: [assistant.id],
      cadence: "manual",
      config: { channelIds: ["C02"] },
    });

    expect(await db.getSource(source.id)).toBeNull();
    expect(await db.listApplicationSources(applicationImport.id)).toEqual([
      expect.objectContaining({ sourceId: null, removedAt: expect.any(String) }),
    ]);
  });

  it("rejects configuration edits while synchronization is running", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Help" });
    const connection = await seedConnection();
    const collection = await db.getOrCreateOrgLibraryCollection(DEMO_ORG.id);
    const applicationImport = await db.createApplicationImport({
      organizationId: DEMO_ORG.id,
      connectionId: connection.id,
      collectionId: collection.id,
      name: "Running",
      config: { channelIds: ["C01"] },
      cadence: "manual",
      assistantIds: [assistant.id],
    });
    await db.updateApplicationImport(applicationImport.id, { status: "syncing" });

    await expect(
      updateApplicationImportConfigurationAction({
        importId: applicationImport.id,
        name: "Changed",
        assistantIds: [assistant.id],
        cadence: "manual",
        config: { channelIds: ["C01"] },
      })
    ).rejects.toThrow("Wait for the current synchronization");
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("queues a fresh sync when a paused Import resumes", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Help" });
    const connection = await seedConnection();
    const collection = await db.getOrCreateOrgLibraryCollection(DEMO_ORG.id);
    const applicationImport = await db.createApplicationImport({
      organizationId: DEMO_ORG.id,
      connectionId: connection.id,
      collectionId: collection.id,
      name: "Support channel",
      config: { channelIds: ["C01"] },
      cadence: "daily",
      enabled: false,
      assistantIds: [assistant.id],
    });

    await setApplicationImportEnabledAction(applicationImport.id, true);

    expect(await db.getApplicationImport(applicationImport.id)).toMatchObject({
      enabled: true,
    });
    expect(enqueueMock).toHaveBeenCalledWith(
      { importId: applicationImport.id, organizationId: DEMO_ORG.id },
      { db }
    );
  });

  it("reports active deletion impact and still deletes when remote revocation fails", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Help" });
    const connection = await seedConnection();
    const collection = await db.getOrCreateOrgLibraryCollection(DEMO_ORG.id);
    const applicationImport = await db.createApplicationImport({
      organizationId: DEMO_ORG.id,
      connectionId: connection.id,
      collectionId: collection.id,
      name: "Support channel",
      assistantIds: [assistant.id],
    });
    const source = await db.createSource({
      collectionId: collection.id,
      name: "Thread",
      kind: "application",
      config: {},
    });
    await db.setSourceAssistantLinks(source.id, [assistant.id]);
    await db.upsertApplicationSource({
      importId: applicationImport.id,
      sourceId: source.id,
      remoteId: "active",
      contentHash: "hash",
      lastSeenAt: new Date().toISOString(),
    });
    const removed = await db.createSource({
      collectionId: collection.id,
      name: "Removed thread",
      kind: "application",
      config: {},
    });
    await db.upsertApplicationSource({
      importId: applicationImport.id,
      sourceId: removed.id,
      remoteId: "removed",
      contentHash: "old-hash",
      lastSeenAt: new Date().toISOString(),
    });
    await db.markApplicationSourceRemoved(
      applicationImport.id,
      "removed",
      new Date().toISOString()
    );
    await db.deleteSource(removed.id);

    expect(await getApplicationConnectionDeleteImpactAction(connection.id)).toEqual({
      imports: 1,
      sources: 1,
      assistantLinks: 1,
    });
    expect(requireMemberMock).toHaveBeenLastCalledWith("edit");

    revokeMock.mockRejectedValueOnce(new Error("provider unavailable"));
    await deleteApplicationConnectionAction(connection.id);

    expect(await db.getApplicationConnection(connection.id)).toBeNull();
    expect(await db.getSource(source.id)).toBeNull();
    expect(requireMemberMock).toHaveBeenLastCalledWith("edit");
  });
});
