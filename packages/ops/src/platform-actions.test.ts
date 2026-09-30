import { describe, expect, it } from "vitest";
import { DEMO_MEMBER, DEMO_ORG, createOrgPinnedDb, getMockDb, type Db } from "@agent-hub/db";
import type { Role } from "@agent-hub/core";
import { ensureCieleAiOp } from "./ciele-ai";
import * as barrel from "./index";
import type { OperationContext } from "./operation";
import {
  credentialIn,
  describePlatformOperation,
  everyOperationName,
  listPlatformOperations,
  operationsByName,
  platformOperationPolicy,
  platformOperations,
  runPlatformOperation,
} from "./platform-actions";
import { deleteTeammateOp, hideTeammateOp, getTeammateOp, teammatePatchSchema, updateTeammateOp } from "./teammates";

/**
 * Ciele AI's catalogue (the platform layer). The derivation is the point, so
 * the tests are about what it may never do: offer something excluded, offer a
 * Role more than it has, or run something it did not offer.
 */

const names = () => platformOperations().map((op) => op.name);

describe("the platform catalogue", () => {
  it("is derived from the modules, not listed by hand", () => {
    // A sample across domains; the full count moves with every new operation.
    expect(names()).toEqual(
      expect.arrayContaining([
        "assistants.create",
        "helpDesks.list",
        "improvements.update",
        "inbox.conversations.list",
        "knowledge.search",
        "publish.status",
        "usage.meters.read",
      ])
    );
    expect(names().length).toBeGreaterThan(150);
  });

  it("never offers deciding a gate, taking a credential, or a Teammate's own internals", () => {
    for (const name of [
      "approvals.decide",
      "reviews.decide",
      "apiKeys.create",
      "apiKeys.delete",
      "providers.createApiKey",
      "providers.createOpenAiCompatible",
      "providers.createFederated",
      "sso.connection.set",
      "helpDesks.ticketing.connectServiceNow",
      "apiIntegrations.set",
      "crawlers.set",
      "memory.remember",
      "memory.project.record",
      "teammates.memory.write",
      "teammates.referral.start",
      "flows.agent.ensure",
      "channels.messages.post",
      "members.leave",
      // A revoked key's row is its audit trail, and deleting it is a console
      // act only (#1007): no API, CLI or MCP route, and no agent either.
      "apiKeys.delete",
    ]) {
      // A name that matches no real operation would pass on the prefix alone.
      expect(everyOperationName(), name).toContain(name);
      expect(platformOperationPolicy(name)).toBe("excluded");
      expect(names()).not.toContain(name);
    }
  });

  it("stops every destructive or outward-facing operation for confirmation", () => {
    for (const name of [
      "assistants.delete",
      "inbox.conversations.delete",
      "knowledge.sources.delete",
      "knowledge.sources.unlinkMany",
      "members.remove",
      "invites.revoke",
      "publish.unpublish",
      "publish.publish",
      "members.updateRole",
      "invites.create",
      "teammates.grants.set",
      "sso.identity.set",
      "sso.connection.disconnect",
      "eval.runs.start",
      "memories.subject.wipe",
      // Retention and legal hold decide what the nightly sweep deletes for
      // good, so shortening one or lifting the other is a delete by schedule.
      "organization.update",
      "inbox.conversations.legalHold",
    ]) {
      expect(everyOperationName(), name).toContain(name);
      expect(platformOperationPolicy(name)).toBe("confirm");
    }
    for (const name of [
      "assistants.update",
      "knowledge.search",
      "assistants.ask",
      "memory.me.write",
    ]) {
      expect(everyOperationName(), name).toContain(name);
      expect(platformOperationPolicy(name)).toBe("run");
    }
  });

  it("reaches every operation the package exports, so a new module is never silently absent", () => {
    // Exported operations that are deliberately not platform operations. A
    // name here needs a reason; a new module missing from `MODULES` fails.
    const notPlatform = new Set([
      // Ciele AI's own row: it exists whenever it is the one chatting.
      "cieleAi.ensure",
    ]);
    const exported = (Object.values(barrel) as unknown[])
      .filter(
        (value): value is { name: string } =>
          !!value &&
          typeof value === "object" &&
          typeof (value as { name?: unknown }).name === "string" &&
          typeof (value as { run?: unknown }).run === "function" &&
          typeof (value as { capability?: unknown }).capability === "string"
      )
      .map((op) => op.name)
      .filter((name) => !notPlatform.has(name));
    const known = new Set(everyOperationName());
    expect(exported.filter((name) => !known.has(name))).toEqual([]);
  });

  it("stops what lifts a protection, shortens retention, spends or reaches Visitors", () => {
    // None of these has a delete verb, which is why a name rule ran them.
    for (const name of [
      "inbox.conversations.legalHold",
      "organization.update",
      "organization.budget.set",
      "providers.setEmbedding",
      "knowledge.sources.direct_access.set",
    ]) {
      expect(everyOperationName(), name).toContain(name);
      expect(platformOperationPolicy(name), name).toBe("confirm");
    }
  });

  it("finds every operation named like a removal declared consequential", () => {
    // The verb rule that used to be the policy is now a check on the
    // declarations: a `.delete` that says it is a plain write is a mistake.
    const removal =
      /\.(delete|deleteMany|remove|revoke|unlink|unlinkMany|unpublish|wipe|disconnect|forget)$/;
    const misdeclared = operationsByName()
      .filter((op) => removal.test(op.name) && op.effect !== "consequential")
      .map((op) => op.name);
    expect(misdeclared).toEqual([]);
  });

  it("finds no operation declared a read that reports a mutated entity", () => {
    const misdeclared = operationsByName()
      .filter((op) => op.effect === "read")
      .filter((op) => op.entities({}, undefined).length > 0)
      .map((op) => op.name);
    expect(misdeclared).toEqual([]);
  });

  it("describes every operation it offers, so none is unusable", () => {
    for (const name of names()) {
      expect(() => describePlatformOperation("owner", name), name).not.toThrow();
    }
  });
});

describe("what a call carries", () => {
  const ctx = (): OperationContext => ({
    organizationId: DEMO_ORG.id,
    userId: DEMO_MEMBER.userId,
    role: "owner",
    db: createOrgPinnedDb(getMockDb(), DEMO_ORG.id),
  });

  it("finds a credential wherever an operation takes one", () => {
    expect(credentialIn({ input: { config: { bearerToken: "sk-1" } } })).toBe(
      "input.config.bearerToken"
    );
    expect(credentialIn({ patch: { config: { basicPassword: "hunter2" } } })).toBe(
      "patch.config.basicPassword"
    );
    expect(
      credentialIn({
        patch: { actionSettings: { api_request: { auth: { type: "bearer", token: "t" } } } },
      })
    ).toBe("patch.actionSettings.api_request.auth.token");
    expect(credentialIn({ auth: { type: "api_key", header: "X-Key", key: "k" } })).toBe(
      "auth.key"
    );
    expect(
      credentialIn({ headers: [{ id: "h", name: "Authorization", value: "Bearer x" }] })
    ).toBe("headers.0.value");
  });

  it("does not mistake an empty or ordinary field for a credential", () => {
    expect(credentialIn({ input: { config: { bearerToken: "" } } })).toBeNull();
    expect(credentialIn({ auth: { type: "bearer", hasToken: true } })).toBeNull();
    expect(credentialIn({ maxTokens: 400, key: "faq-1", title: "Password reset" })).toBeNull();
    expect(
      credentialIn({ headers: [{ id: "h", name: "Content-Type", value: "application/json" }] })
    ).toBeNull();
  });

  it("refuses a credential before the operation runs, whatever its policy", async () => {
    const db = getMockDb();
    const desk = (await db.listHelpDesks(DEMO_ORG.id))[0];
    const before = desk ? (await db.listSupportChannels(desk.id)).length : 0;
    await expect(
      runPlatformOperation(ctx(), "helpDesks.channels.create", {
        helpDeskId: desk?.id ?? "desk",
        input: { kind: "api", name: "Ticket API", config: { bearerToken: "sk-live-1" } },
      })
    ).rejects.toThrow(/credential/);
    if (desk) expect((await db.listSupportChannels(desk.id)).length).toBe(before);
  });

  it("confirms any change to the organization, retention windows included", () => {
    // `organization.update` also carries both retention windows, which decide
    // what the nightly sweep deletes for good, so the operation declares itself
    // consequential rather than the policy inspecting the input.
    expect(platformOperationPolicy("organization.update")).toBe("confirm");
    expect(platformOperationPolicy("assistants.delete")).toBe("confirm");
    expect(platformOperationPolicy("apiKeys.delete")).toBe("excluded");
  });
});

describe("authorship", () => {
  async function improvementWithFlaggedAnswer(db: Db) {
    const assistant = (await db.listAssistants(DEMO_ORG.id))[0];
    const collection = await db.createCollection(assistant.id, { name: "Account help" });
    const conversation = await db.createConversation({
      assistantId: assistant.id,
      subjectType: "visitor",
      subjectId: "visitor-platform-fix",
      collectionId: collection.id,
      title: "password reset",
    });
    const answer = await db.appendMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: [{ type: "text", text: "I could not find that." }],
    });
    return db.createImprovement(DEMO_ORG.id, {
      title: "Password reset answer is wrong",
      createdBy: DEMO_MEMBER.userId,
      messageId: answer.id,
    });
  }

  it("signs a fix Ciele AI accepts as an agent, never as the Member who asked", async () => {
    const db = getMockDb();
    const improvement = await improvementWithFlaggedAnswer(db);
    const verified: unknown[] = [];
    const context: OperationContext = {
      organizationId: DEMO_ORG.id,
      userId: DEMO_MEMBER.userId,
      role: "owner",
      agentAuthor: "Ciele AI",
      db: createOrgPinnedDb(db, DEMO_ORG.id),
      ports: {
        persistFaq: async (args) => {
          verified.push(args.provenance.verified);
          return { id: "concept-ciele-ai" } as never;
        },
      },
    };
    await runPlatformOperation(context, "improvements.fix.propose", {
      improvementId: improvement.id,
      question: "How do I reset my password?",
      answer: "Open Settings, choose Security, then Reset password.",
      rationale: "",
    });
    await runPlatformOperation(context, "improvements.fix.accept", {
      improvementId: improvement.id,
    });
    expect(verified).toEqual([[{ by: "teammate/Ciele AI", at: expect.any(String) }]]);
  });
});

describe("the Member's Role is the boundary", () => {
  const ctx = (role: Role): OperationContext => ({
    organizationId: DEMO_ORG.id,
    userId: DEMO_MEMBER.userId,
    role,
    db: createOrgPinnedDb(getMockDb(), DEMO_ORG.id),
  });

  it("lists a Viewer only what a Viewer may do", () => {
    const viewer = listPlatformOperations("viewer").map((op) => op.name);
    expect(viewer).toContain("assistants.list");
    expect(viewer).not.toContain("assistants.create");
    expect(viewer).not.toContain("members.updateRole");
    expect(listPlatformOperations("owner").length).toBeGreaterThan(viewer.length);
  });

  it("refuses to run what the Role does not allow, even when named directly", async () => {
    await expect(
      runPlatformOperation(ctx("viewer"), "assistants.create", { title: "Nope" })
    ).rejects.toThrow(/role does not allow/);
  });

  it("refuses a name that is not in the catalogue", async () => {
    await expect(runPlatformOperation(ctx("owner"), "approvals.decide", {})).rejects.toThrow(
      /no platform operation/
    );
  });

  it("runs a read as the Member", async () => {
    const run = await runPlatformOperation(ctx("viewer"), "assistants.list", {});
    expect(run.entities).toEqual([]);
    expect(Array.isArray(run.result)).toBe(true);
  });
});

describe("Ciele AI's lifecycle", () => {
  const ctx = (role: Role = "viewer"): OperationContext => ({
    organizationId: DEMO_ORG.id,
    userId: DEMO_MEMBER.userId,
    role,
    db: createOrgPinnedDb(getMockDb(), DEMO_ORG.id),
  });

  it("exists once per Organization, whoever opens Chat first", async () => {
    const first = await ensureCieleAiOp.run(ctx("viewer"), {});
    const second = await ensureCieleAiOp.run(ctx("owner"), {});
    expect(second.id).toBe(first.id);
    expect(first.name).toBe("Ciele AI");
    expect(first.systemKind).toBe("ciele_ai");
    expect(first.roleDescription).toBe("");
  });

  it("saves and reads its default model without changing the allowlist or grants", async () => {
    const context = ctx("owner");
    const before = await ensureCieleAiOp.run(context, {});
    const patch = teammatePatchSchema.parse({ modelProvider: "google", modelId: "gemini-3.5-flash-lite" });
    const updated = await updateTeammateOp.run(context, { id: before.id, patch });
    const reread = await getTeammateOp.run(context, { id: before.id });
    expect(reread).toEqual(updated);
    expect(reread.modelProvider).toBe("google");
    expect(reread.modelId).toBe("gemini-3.5-flash-lite");
    expect(reread.allowedModels).toEqual(before.allowedModels);
    expect(reread.modelSource).toEqual(before.modelSource);
    expect(reread.collectionIds).toEqual(before.collectionIds);
    expect(reread.editorIds).toEqual(before.editorIds);
    expect(reread.systemKind).toBe("ciele_ai");
    await expect(updateTeammateOp.run({ ...context, organizationId: "another-org" }, { id: before.id, patch: { modelProvider: "openai", modelId: "gpt-5.4-mini" } })).rejects.toThrow(/not found/i);
    expect((await getTeammateOp.run(context, { id: before.id })).modelProvider).toBe("google");
  });

  it("validates provider and bounded model IDs at the supported settings boundary", () => {
    for (const patch of [{ modelProvider: "unknown" }, { modelId: "" }, { modelId: "bad model" }, { modelId: "a".repeat(201) }]) {
      expect(teammatePatchSchema.safeParse(patch).success).toBe(false);
    }
    expect(teammatePatchSchema.parse({ modelProvider: "google", modelId: "gemini-3.5-flash-lite" })).toEqual({ modelProvider: "google", modelId: "gemini-3.5-flash-lite" });
  });

  it("can be renamed, and not deleted or hidden", async () => {
    const cieleAi = await ensureCieleAiOp.run(ctx(), {});
    const renamed = await updateTeammateOp.run(ctx("owner"), {
      id: cieleAi.id,
      patch: { name: "Atlas" },
    });
    expect(renamed.name).toBe("Atlas");
    expect((await ensureCieleAiOp.run(ctx(), {})).name).toBe("Atlas");
    await expect(deleteTeammateOp.run(ctx("owner"), { id: cieleAi.id })).rejects.toThrow(
      /cannot be deleted/
    );
    await expect(hideTeammateOp.run(ctx("owner"), { id: cieleAi.id })).rejects.toThrow(
      /cannot be hidden/
    );
  });

  it("stays visible to the whole Organization", async () => {
    // Every Member's Chat opens on it, so a private one would open on a
    // Teammate most of them are refused.
    const cieleAi = await ensureCieleAiOp.run(ctx(), {});
    await expect(
      updateTeammateOp.run(ctx("owner"), { id: cieleAi.id, patch: { visibility: "private" } })
    ).rejects.toThrow(/whole Organization/);
    const kept = await updateTeammateOp.run(ctx("owner"), {
      id: cieleAi.id,
      patch: { visibility: "org", name: "Ciele AI" },
    });
    expect(kept.visibility).toBe("org");
  });

  it("brings back a row made private before the guard, on the next visit", async () => {
    // Before the guard an API call could set it, and Configure resends the
    // stored value, so such a row could never be saved again.
    const db = createOrgPinnedDb(getMockDb(), DEMO_ORG.id);
    const cieleAi = await ensureCieleAiOp.run(ctx(), {});
    await db.table("teammates").update(cieleAi.id, { visibility: "private" });
    expect((await ensureCieleAiOp.run(ctx(), {})).visibility).toBe("org");
  });
});
