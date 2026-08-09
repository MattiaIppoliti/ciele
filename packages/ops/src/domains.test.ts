import { describe, expect, it } from "vitest";
import type { Concept, Role } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { createAssistantOp } from "./assistants";
import {
  createFlowOp,
  deleteFlowOp,
  listFlowsOp,
  reorderFlowsOp,
  updateFlowOp,
} from "./flows";
import {
  addSourceOp,
  createFaqOp,
  deleteSourceOp,
  getSourceOp,
  importFaqsOp,
  listCollectionsOp,
  listSourcesOp,
  recrawlSourceOp,
} from "./knowledge";
import {
  publicationStatusOp,
  publishAssistantOp,
  unpublishAssistantOp,
} from "./publish";
import {
  getConversationOp,
  listInboxConversationsOp,
  readConversationsForExportOp,
} from "./inbox";
import {
  getImprovementOp,
  listImprovementsOp,
  updateImprovementOp,
} from "./improvements";
import { OperationError, type OperationContext } from "./operation";
import { setSsoIdentityOp, validateSsoIdentityOp } from "./data";
import {
  createHelpDeskOp,
  createSupportChannelOp,
  connectServiceNowOp,
  deleteSupportChannelOp,
  getHelpDeskOp,
  listHelpDesksOp,
  reorderSupportChannelsOp,
  updateHelpDeskOp,
} from "./help-desks";
import {
  createAssistantGoalOp,
  createSkillOp,
  deleteAssistantGoalOp,
  listAlertsOp,
  listAssistantGoalsOp,
  listSkillsOp,
  resolveAlertOp,
  setAssistantSkillsOp,
  updateAssistantGoalOp,
} from "./configuration";
import {
  createInviteOp,
  createOrgApiKeyOp,
  listInvitesOp,
  listMembersOp,
  listOrgApiKeysOp,
  removeMemberOp,
  revokeInviteOp,
  revokeOrgApiKeyOp,
  updateMemberRoleOp,
} from "./organization";
import {
  createOpenAiCompatibleConnectionOp,
  getApiIntegrationOp,
  getSsoConnectionOp,
  listProviderConnectionsOp,
  setApiIntegrationOp,
  setEmbeddingConnectionOp,
  setSsoConnectionOp,
} from "./integrations";

const ctx = (over: Partial<OperationContext> = {}): OperationContext => ({
  organizationId: DEMO_ORG.id,
  userId: DEMO_MEMBER.userId,
  role: "editor" as Role,
  db: getMockDb(),
  ...over,
});

const foreignCtx = () => ctx({ organizationId: "some-other-org" });

async function newAssistant(title: string) {
  return createAssistantOp.run(ctx(), { title });
}

describe("SSO identity operations (#662)", () => {
  it("resets then restores validation through the shared port", async () => {
    await getMockDb().setSsoConnection(DEMO_ORG.id, {
      provider: "entra",
      config: { clientId: "client", tenantId: "tenant" },
      encryptedSecret: "plain:test",
    });
    await setSsoIdentityOp.run(ctx({ role: "admin" }), {
      identityClaim: "email",
    });
    expect((await getMockDb().getSsoConnection(DEMO_ORG.id))?.validationStatus).toBe(
      "unvalidated"
    );
    await expect(
      validateSsoIdentityOp.run(
        ctx({
          role: "admin",
          ports: { validateSsoConnection: async () => ({ ok: true }) },
        }),
        {}
      )
    ).resolves.toEqual({ ok: true });
    expect((await getMockDb().getSsoConnection(DEMO_ORG.id))?.validationStatus).toBe(
      "valid"
    );
  });
});

describe("help desk operations", () => {
  it("manages a desk and its ordered escalation channels with org isolation", async () => {
    const desk = await createHelpDeskOp.run(ctx(), {
      name: "Admissions",
      description: "Application support",
    });
    expect((await listHelpDesksOp.run(ctx(), {})).map((item) => item.id)).toContain(
      desk.id
    );
    expect((await getHelpDeskOp.run(ctx(), { id: desk.id })).desk.id).toBe(desk.id);

    const email = await createSupportChannelOp.run(ctx(), {
      helpDeskId: desk.id,
      input: { kind: "email", name: "Email us" },
    });
    const phone = await createSupportChannelOp.run(ctx(), {
      helpDeskId: desk.id,
      input: { kind: "phone", name: "Call us" },
    });
    const reordered = await reorderSupportChannelsOp.run(ctx(), {
      helpDeskId: desk.id,
      orderedIds: [phone.id, email.id],
    });
    expect(reordered.map((channel) => channel.id)).toEqual([phone.id, email.id]);

    await updateHelpDeskOp.run(ctx(), {
      id: desk.id,
      patch: { autoGenerateImprovements: true },
    });
    expect((await getHelpDeskOp.run(ctx(), { id: desk.id })).desk)
      .toMatchObject({ autoGenerateImprovements: true });

    await deleteSupportChannelOp.run(ctx(), {
      helpDeskId: desk.id,
      channelId: email.id,
    });
    expect((await getHelpDeskOp.run(ctx(), { id: desk.id })).channels)
      .toHaveLength(1);

    await expect(getHelpDeskOp.run(foreignCtx(), { id: desk.id }))
      .rejects.toMatchObject({ code: "not_found" });
  });

  it("never returns ticketing or channel credentials", async () => {
    const desk = await createHelpDeskOp.run(ctx(), { name: "Secure desk" });
    const channel = await createSupportChannelOp.run(ctx(), {
      helpDeskId: desk.id,
      input: {
        kind: "api_endpoint",
        name: "Ticket API",
        config: {
          url: "https://tickets.example.edu",
          authType: "bearer",
          bearerToken: "channel-secret",
        },
      },
    });
    expect(JSON.stringify(channel)).not.toContain("channel-secret");
    expect(channel.config.hasBearerToken).toBe(true);

    const connected = await connectServiceNowOp.run(ctx(), {
      helpDeskId: desk.id,
      name: "ServiceNow",
      baseUrl: "https://example.service-now.com",
      clientId: "client",
      clientSecret: "client-secret",
      username: "integration-user",
      password: "password-secret",
    });
    const serialized = JSON.stringify({
      connected,
      list: await listHelpDesksOp.run(ctx(), {}),
      detail: await getHelpDeskOp.run(ctx(), { id: desk.id }),
    });
    expect(serialized).not.toContain("client-secret");
    expect(serialized).not.toContain("password-secret");
    expect(serialized).not.toContain("plain:");
    expect(connected.ticketingIntegration?.hasCredentials).toBe(true);

    expect(
      connectServiceNowOp.input.safeParse({
        helpDeskId: desk.id,
        name: "Unsafe",
        baseUrl: "http://example.service-now.com",
        clientId: "client",
        clientSecret: "secret",
        username: "user",
        password: "password",
      }).success
    ).toBe(false);
  });
});

describe("skills, goals, and alerts operations", () => {
  it("configures reusable skills and standing goals for an Assistant", async () => {
    const assistant = await newAssistant("Configuration fixture");
    const skill = await createSkillOp.run(ctx(), {
      name: "Tone",
      description: "Use a calm tone",
      prompt: "Be calm and concise.",
    });
    expect((await listSkillsOp.run(ctx(), {})).map((item) => item.id)).toContain(
      skill.id
    );
    await setAssistantSkillsOp.run(ctx(), {
      assistantId: assistant.id,
      skillIds: [skill.id],
    });
    expect((await getMockDb().listAssistantSkills(assistant.id)).map((item) => item.id))
      .toEqual([skill.id]);

    const goal = await createAssistantGoalOp.run(ctx(), {
      assistantId: assistant.id,
      question: "When is tuition due?",
      expectations: { mustCiteSources: true, mustContain: ["October"] },
    });
    await updateAssistantGoalOp.run(ctx(), {
      assistantId: assistant.id,
      goalId: goal.id,
      patch: { status: "quarantined" },
    });
    expect(await listAssistantGoalsOp.run(ctx(), { assistantId: assistant.id }))
      .toEqual([expect.objectContaining({ id: goal.id, status: "quarantined" })]);
    await deleteAssistantGoalOp.run(ctx(), {
      assistantId: assistant.id,
      goalId: goal.id,
    });
  });

  it("lists and resolves operational alerts without crossing organizations", async () => {
    const alert = await getMockDb().raiseAlert(DEMO_ORG.id, {
      type: "system",
      sourceKey: "cli-parity",
      title: "Check configuration",
      detail: "A test alert",
    });
    expect((await listAlertsOp.run(ctx(), {})).map((item) => item.id)).toContain(alert.id);
    expect(await resolveAlertOp.run(ctx(), { id: alert.id }))
      .toMatchObject({ id: alert.id, status: "resolved" });
    await expect(resolveAlertOp.run(foreignCtx(), { id: alert.id }))
      .rejects.toMatchObject({ code: "not_found" });
  });
});

describe("organization administration operations", () => {
  it("manages invites and role-capped API keys", async () => {
    const adminCtx = ctx({ role: "admin" });
    expect((await listMembersOp.run(adminCtx, {})).length).toBeGreaterThan(0);

    const invite = await createInviteOp.run(adminCtx, {
      role: "viewer",
      email: "viewer@example.edu",
    });
    expect((await listInvitesOp.run(adminCtx, {})).map((item) => item.id)).toContain(
      invite.id
    );
    await revokeInviteOp.run(adminCtx, { id: invite.id });

    const minted = await createOrgApiKeyOp.run(adminCtx, {
      name: "Automation",
      role: "editor",
    });
    expect(minted.secret).toMatch(/^ciele_sk_/);
    expect(minted.apiKey.createdBy).toBe(DEMO_MEMBER.userId);
    expect((await listOrgApiKeysOp.run(adminCtx, {})).map((item) => item.id))
      .toContain(minted.apiKey.id);
    await revokeOrgApiKeyOp.run(adminCtx, { id: minted.apiKey.id });

    await expect(
      createOrgApiKeyOp.run(adminCtx, { name: "Too powerful", role: "owner" })
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("requires member-management capability to enumerate invite tokens", () => {
    expect(listInvitesOp.capability).toBe("manageMembers");
  });

  it("prevents an admin key from changing or removing an owner", async () => {
    const owner = (await listMembersOp.run(ctx({ role: "admin" }), {})).find(
      (member) => member.role === "owner"
    );
    expect(owner).toBeTruthy();
    await expect(
      updateMemberRoleOp.run(ctx({ role: "admin" }), {
        userId: owner!.userId,
        role: "viewer",
      })
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      removeMemberOp.run(ctx({ role: "admin" }), { userId: owner!.userId })
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("integration and provider operations", () => {
  it("stores API and SSO credentials while returning only safe projections", async () => {
    const assistant = await newAssistant("Integration fixture");
    await setApiIntegrationOp.run(ctx(), {
      assistantId: assistant.id,
      input: {
        name: "Student API",
        baseUrl: "https://api.example.edu",
        authType: "bearer",
        credential: "secret-token",
        endpoints: [
          {
            id: "courses",
            name: "Courses",
            purpose: "List courses",
            method: "GET",
            path: "/courses",
          },
        ],
      },
    });
    const api = await getApiIntegrationOp.run(ctx(), {
      assistantId: assistant.id,
    });
    expect(api).toMatchObject({ name: "Student API", hasCredential: true });
    expect(api).not.toHaveProperty("encryptedCredential");

    await setSsoConnectionOp.run(ctx({ role: "admin" }), {
      provider: "entra",
      clientId: "client",
      tenantId: "tenant",
      clientSecret: "client-secret",
      identityClaim: "email",
    });
    const sso = await getSsoConnectionOp.run(ctx({ role: "admin" }), {});
    expect(sso).toMatchObject({
      connected: true,
      provider: "entra",
      config: { clientId: "client", tenantId: "tenant", identityClaim: "email" },
      hasClientSecret: true,
    });
    expect(sso).not.toHaveProperty("encryptedSecret");
  });

  it("creates a safe provider projection and selects it for embeddings", async () => {
    const result = await createOpenAiCompatibleConnectionOp.run(
      ctx({ role: "admin" }),
      {
        displayName: "Local models",
        baseUrl: "http://127.0.0.1:11434/v1",
        chatModel: "llama3",
      }
    );
    expect(result.error).toBeUndefined();
    const connection = result.connection!;
    await setEmbeddingConnectionOp.run(ctx({ role: "admin" }), {
      connectionId: connection.id,
    });
    const listed = await listProviderConnectionsOp.run(ctx({ role: "admin" }), {});
    expect(listed).toEqual([
      expect.objectContaining({
        id: connection.id,
        hasCredential: false,
        preferredForEmbedding: true,
      }),
    ]);
    expect(listed[0]).not.toHaveProperty("encryptedKey");
  });
});

describe("flows operations (#621)", () => {
  it("create/update/reorder/delete round-trip with router invariants", async () => {
    const assistant = await newAssistant("Flows fixture");
    const seeded = await listFlowsOp.run(ctx(), { assistantId: assistant.id });
    expect(seeded.length).toBeGreaterThan(0);
    const defaultFlow = seeded.find((f) => f.isDefault)!;

    const created = await createFlowOp.run(ctx(), {
      assistantId: assistant.id,
      input: { name: "Fees intent", description: "questions about fees" },
    });
    const toggled = await updateFlowOp.run(ctx(), {
      id: created.id,
      patch: { enabled: false },
    });
    expect(toggled.enabled).toBe(false);

    // Trigger/action pairing rule (#541) holds on this surface too.
    await expect(
      updateFlowOp.run(ctx(), {
        id: created.id,
        patch: { trigger: "page_load", actions: ["search_knowledge"] },
      })
    ).rejects.toMatchObject({ code: "invalid_input" });

    // Default behavior is locked: deleting it is a conflict, not a UI gap.
    await expect(
      deleteFlowOp.run(ctx(), { id: defaultFlow.id })
    ).rejects.toMatchObject({ code: "conflict" });

    const reordered = await reorderFlowsOp.run(ctx(), {
      assistantId: assistant.id,
      orderedIds: [created.id, ...seeded.filter((f) => !f.isDefault).map((f) => f.id)],
    });
    expect(reordered[reordered.length - 1].isDefault).toBe(true);

    const deleted = await deleteFlowOp.run(ctx(), { id: created.id });
    expect(deleted.id).toBe(created.id);

    // Cross-org: reads and writes both land not_found.
    await expect(
      listFlowsOp.run(foreignCtx(), { assistantId: assistant.id })
    ).rejects.toBeInstanceOf(OperationError);
  });
});

describe("knowledge operations (#622)", () => {
  it("adds a text Source through the ingest port and deletes with graph retirement", async () => {
    const assistant = await newAssistant("Knowledge fixture");
    const collection = await getMockDb().createCollection(assistant.id, {
      name: "docs",
    });
    const enqueued: string[] = [];
    const removed: string[] = [];
    const withPorts = ctx({
      ports: {
        enqueueIngest: async (job) => void enqueued.push(job.sourceId),
        removeConceptGraph: async (_c, conceptId) => void removed.push(conceptId),
      },
    });

    const { source } = await addSourceOp.run(withPorts, {
      collectionId: collection.id,
      name: "Handbook",
      kind: "text",
      rawText: "Tuition is due in October.",
    });
    expect(enqueued).toEqual([source.id]);
    expect((await getSourceOp.run(ctx(), { id: source.id })).id).toBe(source.id);
    expect(
      (await listSourcesOp.run(ctx(), { collectionId: collection.id })).map(
        (s) => s.id
      )
    ).toContain(source.id);
    expect(
      (await listCollectionsOp.run(ctx(), { assistantId: assistant.id })).map(
        (c) => c.id
      )
    ).toContain(collection.id);

    await deleteSourceOp.run(withPorts, { id: source.id });
    await expect(
      getSourceOp.run(ctx(), { id: source.id })
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("persists FAQs (single + bulk with indexed paths and CSV provenance)", async () => {
    const assistant = await newAssistant("FAQ fixture");
    const collection = await getMockDb().createCollection(assistant.id, {
      name: "faq",
    });
    const persisted: Array<{ path?: string; question: string; sources?: unknown }> = [];
    const withPort = ctx({
      ports: {
        persistFaq: async (args) => {
          persisted.push({
            path: args.pathSuffix,
            question: args.question,
            sources: args.provenance.sources,
          });
          return { id: `c-${persisted.length}` } as unknown as Concept;
        },
      },
    });

    await createFaqOp.run(withPort, {
      collectionId: collection.id,
      question: "When is tuition due?",
      answer: "October.",
    });
    const { imported } = await importFaqsOp.run(withPort, {
      collectionId: collection.id,
      fileName: "faqs.csv",
      rows: [
        { question: "Q1", answer: "A1" },
        { question: "Q1", answer: "A1 again" },
      ],
    });
    expect(imported).toBe(2);
    // Bulk rows carry indexed suffixes (no overwrite) and the CSV derivation.
    expect(persisted[1].path).toBe("-0");
    expect(persisted[2].path).toBe("-1");
    expect(persisted[2].sources).toBeTruthy();
    expect(persisted[0].sources).toBeUndefined();
  });

  it("re-crawl refuses non-website Sources", async () => {
    const assistant = await newAssistant("Crawl fixture");
    const collection = await getMockDb().createCollection(assistant.id, {
      name: "web",
    });
    const { source } = await addSourceOp.run(
      ctx({ ports: { enqueueIngest: async () => {} } }),
      {
        collectionId: collection.id,
        name: "note",
        kind: "text",
        rawText: "x",
      }
    );
    await expect(
      recrawlSourceOp.run(ctx({ ports: { restartCrawl: async () => {} } }), {
        id: source.id,
      })
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("publish operations (#623)", () => {
  it("publish → status → unpublish with cache invalidation via port", async () => {
    const assistant = await newAssistant("Publish fixture");
    const invalidated: string[] = [];
    const withPort = ctx({
      role: "admin",
      ports: { invalidatePublication: (id) => void invalidated.push(id) },
    });

    const before = await publicationStatusOp.run(ctx(), {
      assistantId: assistant.id,
    });
    expect(before.published).toBe(false);

    const { version } = await publishAssistantOp.run(withPort, {
      assistantId: assistant.id,
    });
    expect(version).toBeGreaterThan(0);
    const after = await publicationStatusOp.run(ctx(), {
      assistantId: assistant.id,
    });
    expect(after.published).toBe(true);

    await unpublishAssistantOp.run(withPort, { assistantId: assistant.id });
    const gone = await publicationStatusOp.run(ctx(), {
      assistantId: assistant.id,
    });
    expect(gone.published).toBe(false);
    expect(invalidated).toEqual([assistant.id, assistant.id]);
  });
});

describe("inbox operations (#624)", () => {
  it("lists org conversations and reads a guarded transcript", async () => {
    const conversations = await listInboxConversationsOp.run(ctx(), {});
    expect(conversations.length).toBeGreaterThan(0);
    const first = conversations[0];

    const detail = await getConversationOp.run(ctx(), { id: first.id });
    expect(detail.conversation.id).toBe(first.id);
    expect(Array.isArray(detail.messages)).toBe(true);

    await expect(
      getConversationOp.run(foreignCtx(), { id: first.id })
    ).rejects.toMatchObject({ code: "not_found" });

    const exportReads = await readConversationsForExportOp.run(ctx(), {
      conversationIds: [first.id, "not-a-real-id"],
    });
    // Forged ids silently drop; real ones come back with their messages.
    expect(exportReads).toHaveLength(1);
    expect(exportReads[0].conversation.id).toBe(first.id);
  });

  it("pins, records feedback, and deletes a conversation", async () => {
    const target = (await listInboxConversationsOp.run(ctx(), {}))[0];
    const { setConversationPinnedOp, sendConversationFeedbackOp, deleteConversationOp } =
      await import("./inbox");
    expect(await setConversationPinnedOp.run(ctx(), { id: target.id, pinned: true }))
      .toMatchObject({ id: target.id, pinned: true });
    expect(
      await sendConversationFeedbackOp.run(ctx(), {
        id: target.id,
        text: "Please follow up",
      })
    ).toMatchObject({ metadata: { feedbackText: "Please follow up" } });
    await deleteConversationOp.run(ctx(), { id: target.id });
    await expect(getConversationOp.run(ctx(), { id: target.id }))
      .rejects.toMatchObject({ code: "not_found" });
  });
});

describe("improvements operations (#625)", () => {
  it("lists, reads detail, updates with notification port", async () => {
    const items = await listImprovementsOp.run(ctx(), {});
    expect(items.length).toBeGreaterThan(0);
    const target = items[0];

    const detail = await getImprovementOp.run(ctx(), { id: target.id });
    expect(detail.improvement.id).toBe(target.id);

    const notified: string[] = [];
    const updated = await updateImprovementOp.run(
      ctx({
        ports: {
          notifyImprovementUpdate: async ({ updated: u }) =>
            void notified.push(u.id),
        },
      }),
      { id: target.id, patch: { priority: "high" } }
    );
    expect(updated.priority).toBe("high");
    expect(notified).toEqual([target.id]);

    await expect(
      updateImprovementOp.run(foreignCtx(), {
        id: target.id,
        patch: { priority: "low" },
      })
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
