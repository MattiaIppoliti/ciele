import { createSupabaseContractContext } from "@agent-hub/db/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealSecret } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb, type Db } from "@agent-hub/db";
import type { OperationContext } from "./operation";
import { assistantBundleSchema, exportAssistantBundleOp, importAssistantBundleOp } from "./assistant-bundles";
const db = getMockDb();
beforeEach(() => vi.stubEnv("APP_ENCRYPTION_KEY", "bundle-test-key"));
afterEach(() => vi.unstubAllEnvs());
const context = (db: Db, organizationId: string, userId: string): OperationContext => ({ db, organizationId, userId, role: "owner" });
describe("portable Assistant bundles", () => {
  async function roundTrip(db: Db, sourceOrg: string, targetOrg: string, userId: string) {
    const source = await db.createAssistant(sourceOrg, { title: "Portable Assistant" });
    const targetAnchor = await db.createAssistant(targetOrg, { title: "Target anchor" });
    const sourceDesk = await db.createHelpDesk(sourceOrg, { name: "Portable desk" });
    await db.createHelpDesk(targetOrg, { name: "Portable desk" });
    const sourceConnection = await db.createApplicationConnection({ organizationId: sourceOrg, name: "Source Salesforce", provider: "salesforce", sealedCredentials: sealSecret("connection-never-export") });
    await db.createApplicationConnection({ organizationId: targetOrg, name: "Target Salesforce", provider: "salesforce", sealedCredentials: sealSecret("target-credential") });
    for (const assistant of [source, targetAnchor]) {
      const collection = await db.createCollection(assistant.id, { name: "Portable Library" });
      const file = await db.createSource({ collectionId: collection.id, name: "Existing knowledge", kind: "file" });
      await db.setSourceAssistantLinks(file.id, [assistant.id]);
    }
    await db.updateAssistant(source.id, { helpDeskSettings: { selectedIds: [sourceDesk.id] }, guardrails: [], quickReplies: [{ id: "starter", label: "Hello", type: "send_text", text: "Hello" }], style: { brandColor: "#123456", position: "right" } });
    const skill = await db.table("skills").insert({ organizationId: sourceOrg, name: "Portable Skill", description: "Instructions", prompt: "Answer clearly", starter: "Start here" });
    await db.setAssistantSkills(source.id, [skill.id]);
    await db.createFlow(source.id, { name: "Portable action", actions: ["api_request", "connector"], actionSettings: {
      api_request: { method: "POST", url: "https://example.test/action", auth: { type: "bearer", token: "inline-token-never-export" }, headers: [{ id: "header", name: "X-Key", value: "header-never-export" }], queryParams: [{ id: "query", name: "key", value: "query-never-export" }] },
      connector: { provider: "salesforce", connectionId: sourceConnection.id, action: "salesforce.case.create", params: { subject: "Support" } },
    } });
    await db.setApiIntegration({ assistantId: source.id, organizationId: sourceOrg, name: "Portable API", baseUrl: "https://example.test", authType: "bearer", encryptedCredential: sealSecret("integration-never-export"), endpoints: [{ id: "case", name: "Case", path: "/case", method: "GET", purpose: "Read a case" }] });
    const conversation = await db.createConversation({ assistantId: source.id, subjectType: "visitor", subjectId: "visitor-never-export" });
    await db.appendMessage({ conversationId: conversation.id, role: "user", content: [{ type: "text", text: "visitor-text-never-export" }] });
    const first = await exportAssistantBundleOp.run(context(db, sourceOrg, userId), { assistantId: source.id });
    const text = JSON.stringify(first);
    for (const secret of ["connection-never-export", "inline-token-never-export", "header-never-export", "query-never-export", "integration-never-export", "visitor-never-export", "visitor-text-never-export"]) expect(text).not.toContain(secret);
    expect(text).not.toContain((await db.getApiIntegration(source.id))!.encryptedCredential!);
    const imported = await importAssistantBundleOp.run(context(db, targetOrg, userId), { bundle: first });
    expect(imported.assistantId).not.toBe(source.id);
    expect(imported.report).toContain('API Integration "Portable API" needs credentials. Needs setup.');
    const second = await exportAssistantBundleOp.run(context(db, targetOrg, userId), { assistantId: imported.assistantId });
    expect(second).toEqual(first);
    expect((await db.getAssistant(source.id))?.organizationId).toBe(sourceOrg);
  }
  it("round-trips named links and the Publication configuration across Organizations without secrets or Visitor data", async () => {
    await roundTrip(db, DEMO_ORG.id, "00000000-0000-0000-0000-00000000b004", DEMO_MEMBER.userId);
  });
  it("round-trips the same bundle through real Postgres in a second Organization", async () => {
    const real = await createSupabaseContractContext();
    try { const target = await real.db.createOrganization("Bundle target"); await roundTrip(real.db, real.organizationId, target, real.userId); }
    finally { await real.teardown?.(); }
  }, 120_000);
  it("disables a Flow whose named business-hours calendar is absent in the destination", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Missing calendar" });
    const bundle = await exportAssistantBundleOp.run(context(db, DEMO_ORG.id, DEMO_MEMBER.userId), { assistantId: assistant.id });
    bundle.flows.push({ name: "Closed office", enabled: true, builtIn: false, isDefault: false, trigger: "message", actions: ["custom_message"], conditions: [{ id: "hours", kind: "schedule", mode: "business_hours", businessHoursId: "Absent calendar", direction: "during" }] });
    const result = await importAssistantBundleOp.run(context(db, DEMO_ORG.id, DEMO_MEMBER.userId), { bundle });
    expect((await db.listFlows(result.assistantId)).find(flow => flow.name === "Closed office")?.enabled).toBe(false);
    expect(result.report).toContain('Flow "Closed office" is disabled until its references are configured.');
  });
  it("reports and removes a missing remote MCP selection while creating the new Assistant", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Remote tool bundle" });
    const bundle = await exportAssistantBundleOp.run(context(db, DEMO_ORG.id, DEMO_MEMBER.userId), { assistantId: assistant.id });
    bundle.assistant.tools = { ...bundle.assistant.tools, remoteMcp: [{ serverId: "Missing external server", tools: [{ name: "lookup", definitionHash: "hash" }] }] };
    const result = await importAssistantBundleOp.run(context(db, DEMO_ORG.id, DEMO_MEMBER.userId), { bundle });
    expect(result.report).toContain('mcp "Missing external server": not found. Needs setup.');
    expect((await db.getAssistant(result.assistantId))?.tools?.remoteMcp).toEqual([]);
  });
  it("maps Human review sender mailboxes by provider and reports absent mailboxes", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Mailbox portability" });
    const mailbox = await db.createApplicationConnection({ organizationId: DEMO_ORG.id, name: "Mailbox", provider: "microsoft_mail", ownerMemberId: DEMO_MEMBER.userId, sealedCredentials: sealSecret("mail-secret") });
    await db.createFlow(assistant.id, { name: "Mailbox review", actions: ["human_review"], actionSettings: { human_review: { senderConnectionId: mailbox.id, channel: "email", assignees: ["reviewer@example.test"] } } });
    const bundle = await exportAssistantBundleOp.run(context(db, DEMO_ORG.id, DEMO_MEMBER.userId), { assistantId: assistant.id });
    expect(bundle.flows.find(flow => flow.name === "Mailbox review")?.actionSettings?.human_review?.senderConnectionId).toBe("microsoft_mail");
    const imported = await importAssistantBundleOp.run(context(db, "00000000-0000-0000-0000-00000000b005", DEMO_MEMBER.userId), { bundle });
    expect(imported.report).toContain('connection "microsoft_mail": not found. Needs setup.');
    expect((await db.listFlows(imported.assistantId)).find(flow => flow.name === "Mailbox review")).toMatchObject({ enabled: false });
  });
  it("refuses unknown versions before creating anything", () => {
    const parsed = assistantBundleSchema.safeParse({ bundleVersion: 99 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.message).toContain("Unsupported bundleVersion");
  });
});
