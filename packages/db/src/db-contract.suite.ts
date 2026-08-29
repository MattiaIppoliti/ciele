import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiUsageStage, FlowCondition } from "@agent-hub/core";
import {
  ASSISTANT_GOAL_CAP,
  MEMORIES_PER_SUBJECT_CAP,
  apiKeySecretHint,
  buildPublicationConfig,
  generateApiKeySecret,
  hashApiKeySecret,
  shortId,
} from "@agent-hub/core";
import { OrgPinnedDbError, createOrgPinnedDb } from "./org-pinned";
import type { Db } from "./types";

/**
 * Db contract tests: interface-level behavior every Db adapter must share.
 * The suite is written against a context factory so the same expectations can
 * run over the Supabase adapter (with a test database); that is what makes it
 * a contract and what catches mockâ†”supabase drift. Semantics pinned here are
 * the drift-prone ones: creation defaults, patch semantics, cascades,
 * per-org counters, Publication versioning, metadata merge, lexical search.
 */

/**
 * Everything adapter-specific the suite needs. Ids must be well-formed for the
 * adapter's key types (the mock uses opaque strings; Supabase org/user keys
 * are uuids), so no case may hardcode a literal id.
 */
export interface DbContractContext {
  db: Db;
  /** Privileged runtime adapter for internal claim/lease/budget RPCs. */
  systemDb?: Db;
  /** The organization every org-scoped call runs against; the caller is an owner-role member of it. */
  organizationId: string;
  /** The organization's name at setup time (asserted untouched by partial patches). */
  organizationName: string;
  /** The caller's user id (stamped into createdBy-style fields). */
  userId: string;
  /** Well-formed for the adapter's org key type, but matching no organization. */
  missingOrganizationId: string;
  /**
   * A different organization whose rows must never surface in
   * `organizationId`-scoped reads. Adapters with referential integrity should
   * seed it for real; the mock only needs a non-matching id.
   */
  foreignOrganizationId: string;
  /** Existing Assistant owned by `foreignOrganizationId`. */
  foreignAssistantId: string;
  /** Optional cleanup after the suite (drop seeded org, close clients). */
  teardown?: () => Promise<void> | void;
}

export type DbContractContextFactory = () =>
  | Promise<DbContractContext>
  | DbContractContext;

export function describeDbContract(
  adapter: string,
  makeContext: DbContractContextFactory
) {
  describe(`Db contract (${adapter})`, () => {
    let ctx: DbContractContext;
    let db: Db;
    let systemDb: Db;

    // Generous timeout: the PGlite context boots Postgres and applies every
    // migration in this hook.
    beforeAll(async () => {
      ctx = await makeContext();
      db = ctx.db;
      systemDb = ctx.systemDb ?? db;
    }, 120_000);

    afterAll(async () => {
      await ctx.teardown?.();
    });

    const newAssistant = () =>
      db.createAssistant(ctx.organizationId, { title: "Contract Fixture" });
    describe("profile & organization branding", () => {
      it("patches the caller's own profile partially", async () => {
        const before = await db.getProfile();
        const updated = await db.updateProfile({ firstName: "Ada", lastName: "Lovelace" });
        expect(updated.firstName).toBe("Ada");
        expect(updated.lastName).toBe("Lovelace");
        // Untouched fields survive the partial patch.
        expect(updated.username).toBe(before?.username ?? "");
        expect(updated.email).toBe(before?.email ?? "");

        const again = await db.updateProfile({ username: "ada" });
        expect(again.username).toBe("ada");
        expect(again.firstName).toBe("Ada"); // still set from the previous patch

        expect(await db.getProfile()).toMatchObject({ username: "ada", firstName: "Ada" });
      });

      it("patches org name and logo partially, admin+ only in RLS", async () => {
        const updated = await db.updateOrganization(ctx.organizationId, { logoUrl: "data:image/png;base64,x" });
        expect(updated.logoUrl).toBe("data:image/png;base64,x");
        expect(updated.name).toBe(ctx.organizationName); // untouched by the logo-only patch

        const renamed = await db.updateOrganization(ctx.organizationId, { name: "Renamed Org" });
        expect(renamed.name).toBe("Renamed Org");
        expect(renamed.logoUrl).toBe("data:image/png;base64,x"); // survives the name-only patch

        const current = await db.getCurrentOrg();
        expect(current?.organization.name).toBe("Renamed Org");
      });
    });

    describe("organization API keys", () => {
      const newKeyInput = (name: string, role: "viewer" | "editor" | "admin") => {
        const secret = generateApiKeySecret();
        return {
          name,
          role,
          secretHash: hashApiKeySecret(secret),
          secretHint: apiKeySecretHint(secret),
          createdBy: ctx.userId,
        };
      };

      it("create → list → revoke round-trips, org-scoped, hash never exposed", async () => {
        const created = await db.createApiKey(
          ctx.organizationId,
          newKeyInput("CI deploy key", "editor")
        );
        expect(created).toMatchObject({
          organizationId: ctx.organizationId,
          name: "CI deploy key",
          role: "editor",
          createdBy: ctx.userId,
          lastUsedAt: null,
          revokedAt: null,
        });
        expect(created.secretHint.startsWith("ciele_sk_")).toBe(true);
        // The stored hash never crosses the seam back out.
        expect("secretHash" in created).toBe(false);

        const second = await db.createApiKey(
          ctx.organizationId,
          newKeyInput("Reporting key", "viewer")
        );

        const listed = await db.listApiKeys(ctx.organizationId);
        const ids = listed.map((k) => k.id);
        expect(ids).toContain(created.id);
        expect(ids).toContain(second.id);
        for (const key of listed) expect("secretHash" in key).toBe(false);

        // Foreign-org reads never surface these keys.
        const foreign = await db.listApiKeys(ctx.foreignOrganizationId);
        expect(foreign.map((k) => k.id)).not.toContain(created.id);

        // Revocation keeps the row (audit) and stamps revokedAt; idempotent.
        await db.revokeApiKey(created.id);
        await db.revokeApiKey(created.id);
        const after = await db.listApiKeys(ctx.organizationId);
        const revoked = after.find((k) => k.id === created.id);
        expect(revoked?.revokedAt).toBeTruthy();
        expect(after.find((k) => k.id === second.id)?.revokedAt).toBeNull();
      });
      it("looks a key up by hash for auth and stamps last-used (#619)", async () => {
        const input = newKeyInput("Lookup key", "viewer");
        const created = await db.createApiKey(ctx.organizationId, input);

        const found = await db.getApiKeyByHash(input.secretHash);
        expect(found?.id).toBe(created.id);
        expect(found?.role).toBe("viewer");
        // A wrong hash finds nothing: there is no fuzzy path to a key.
        expect(await db.getApiKeyByHash(hashApiKeySecret("nope"))).toBeNull();

        expect(found?.lastUsedAt).toBeNull();
        await db.touchApiKeyLastUsed(created.id);
        const touched = await db.getApiKeyByHash(input.secretHash);
        expect(touched?.lastUsedAt).toBeTruthy();

        // Revoked keys still resolve: the auth seam owns the 401 decision.
        await db.revokeApiKey(created.id);
        const revoked = await db.getApiKeyByHash(input.secretHash);
        expect(revoked?.revokedAt).toBeTruthy();
      });

      it("org-pinned wrapper pins allow-listed reads and fails closed (#619)", async () => {
        const assistant = await newAssistant();
        const pinned = createOrgPinnedDb(db, ctx.organizationId);

        // The caller's organizationId argument is replaced, not trusted: even
        // asking for the foreign org yields the pinned org's rows.
        const hijacked = await pinned.listAssistants(ctx.foreignOrganizationId);
        expect(hijacked.map((a) => a.id)).toContain(assistant.id);
        for (const a of hijacked) {
          expect(a.organizationId).toBe(ctx.organizationId);
        }

        // Anything outside the allow-lists throws, new routes must extend them.
        expect(() => pinned.createOrganization("outside pinned scope")).toThrowError(
          OrgPinnedDbError
        );
      });

      it("org-pinned wrapper resolves id-addressed rows before trusting them (#620)", async () => {
        const assistant = await newAssistant();
        const pinned = createOrgPinnedDb(db, ctx.organizationId);
        // A wrapper pinned to a DIFFERENT org must treat this org's rows as
        // foreign: reads come back absent, mutations refuse before executing.
        const foreignPinned = createOrgPinnedDb(db, ctx.foreignOrganizationId);

        // getAssistant: post-checked, a foreign row reads as null, not an error.
        expect((await pinned.getAssistant(assistant.id))?.id).toBe(assistant.id);
        expect(await foreignPinned.getAssistant(assistant.id)).toBeNull();

        // Assistant-id mutations and assistant-scoped children: guarded up front.
        const renamed = await pinned.updateAssistant(assistant.id, {
          title: "Pinned rename",
        });
        expect(renamed.title).toBe("Pinned rename");
        await expect(
          foreignPinned.updateAssistant(assistant.id, { title: "hijack" })
        ).rejects.toThrowError(OrgPinnedDbError);
        await expect(
          foreignPinned.listFlows(assistant.id)
        ).rejects.toThrowError(OrgPinnedDbError);

        // Flow-id methods resolve flow → assistant → org before delegating.
        const flows = await pinned.listFlows(assistant.id);
        expect(flows.length).toBeGreaterThan(0);
        const flow = flows.find((f) => !f.isDefault) ?? flows[0];
        expect((await db.getFlow(flow.id))?.id).toBe(flow.id);
        const toggled = await pinned.updateFlow(flow.id, { enabled: false });
        expect(toggled.enabled).toBe(false);
        await expect(
          foreignPinned.updateFlow(flow.id, { enabled: true })
        ).rejects.toThrowError(OrgPinnedDbError);

        // The mutation the guard blocked really did not run.
        expect((await db.getFlow(flow.id))?.enabled).toBe(false);
      });

      it("org-pins assistant-source link mutations (PRD #726)", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Pinned Link Collection",
        });
        const source = await db.createSource({
          collectionId: collection.id,
          name: "Pinned link source",
          kind: "text",
        });
        const pinned = createOrgPinnedDb(db, ctx.organizationId);
        const foreignPinned = createOrgPinnedDb(db, ctx.foreignOrganizationId);

        await pinned.setSourceAssistantLinks(source.id, [assistant.id]);
        expect(
          (await pinned.listSourceAssistantLinks(source.id)).map(
            (l) => l.assistantId
          )
        ).toEqual([assistant.id]);

        // Both sides are resolved: a foreign key can neither read the links nor
        // hand this Source to an Assistant it does not own.
        await expect(
          foreignPinned.listSourceAssistantLinks(source.id)
        ).rejects.toThrowError(OrgPinnedDbError);
        await expect(
          foreignPinned.setSourceAssistantLinks(source.id, [assistant.id])
        ).rejects.toThrowError(OrgPinnedDbError);
        await expect(
          foreignPinned.setSourceDirectAccess(source.id, assistant.id, true)
        ).rejects.toThrowError(OrgPinnedDbError);

        // The refusals really did not run.
        expect(await db.listSourceAssistantLinks(source.id)).toHaveLength(1);
      });

      it("org-pins Entity Records and Memory erasure for API-key callers (#663–#667)", async () => {
        const pinned = createOrgPinnedDb(db, ctx.organizationId);
        const foreignPinned = createOrgPinnedDb(db, ctx.foreignOrganizationId);
        const entity = await pinned.table("entities").insert({
          organizationId: ctx.foreignOrganizationId,
          name: "Pinned records",
          attributes: [{ key: "id", label: "ID", type: "text" }],
          keyAttribute: "id",
          scope: "shared",
        });
        expect(entity.organizationId).toBe(ctx.organizationId);
        await pinned.upsertEntityRecords(entity.id, [
          { key: "one", values: { id: "one" } },
        ]);
        expect(await pinned.countEntityRecords(entity.id)).toBe(1);
        expect(await foreignPinned.table("entities").get(entity.id)).toBeNull();
        await expect(foreignPinned.listEntityRecords(entity.id)).rejects.toThrowError(
          OrgPinnedDbError
        );

        await pinned.setMemoryEnabled(ctx.foreignOrganizationId, true);
        expect(await pinned.getMemoryEnabled(ctx.foreignOrganizationId)).toBe(true);
        await db.upsertMemories(
          { organizationId: ctx.organizationId, subjectId: "subject-pinned" },
          [{ text: "Prefers concise answers", embedding: null }]
        );
        const [memory] = await pinned.listMemories({
          organizationId: ctx.foreignOrganizationId,
          subjectId: "subject-pinned",
        });
        await expect(foreignPinned.deleteMemory(memory.id)).rejects.toThrowError(
          OrgPinnedDbError
        );
        await pinned.deleteMemory(memory.id);
        expect(
          await db.listMemories({
            organizationId: ctx.organizationId,
            subjectId: "subject-pinned",
          })
        ).toEqual([]);
        await pinned.setMemoryEnabled(ctx.organizationId, false);
      });
    });

    describe("assistants", () => {
      it("applies creation defaults and seeds the default flows", async () => {
        const assistant = await newAssistant();
        expect(assistant).toMatchObject({
          organizationId: ctx.organizationId,
          nickname: "Contract Fixture", // falls back to title
          chatLauncherEnabled: true,
        });
        expect(assistant.modelProvider).toBeTruthy();
        expect(assistant.modelId).toBeTruthy();
        expect(assistant.welcomeMessage.length).toBeGreaterThan(0);
        // SSO is off by default: a fresh assistant never gates chat.
        expect(assistant.requireSignIn).toBe(false);

        const flows = await db.listFlows(assistant.id);
        expect(flows.length).toBeGreaterThan(0);
        // Exactly one Default behavior, sorted last (context.md invariant).
        expect(flows.filter((f) => f.isDefault)).toHaveLength(1);
        expect(flows.at(-1)?.isDefault).toBe(true);
        // Basic Interaction (#565) is the one built-in that ships configured:
        // its behaviour IS its action, and an empty built-in would fall through
        // to generative search, the opposite of a courtesy fast path.
        const courtesy = flows.filter((f) => f.actions.includes("basic_reply"));
        expect(courtesy).toHaveLength(1);
        expect(courtesy[0]).toMatchObject({ builtIn: true, enabled: true });
        expect(courtesy[0].actions).toEqual(["basic_reply"]);
        // It sorts first: recognising courtesy late means paying retrieval to
        // answer "hello".
        expect(flows[0]?.id).toBe(courtesy[0].id);
        // Every other shipped flow starts unconfigured.
        expect(
          flows
            .filter((f) => f.id !== courtesy[0].id)
            .every((flow) => flow.actions.length === 0)
        ).toBe(true);
        expect(flows.every((flow) => flow.customMessage === "")).toBe(true);
      });

      it("patches partially, preserving untouched fields", async () => {
        const assistant = await newAssistant();
        const updated = await db.updateAssistant(assistant.id, {
          nickname: "Patched",
        });
        expect(updated.nickname).toBe("Patched");
        expect(updated.title).toBe(assistant.title);
        expect(updated.welcomeMessage).toBe(assistant.welcomeMessage);
      });

      it("round-trips assistant avatar storage references", async () => {
        const assistant = await newAssistant();
        const avatarUrl =
          "https://example.supabase.co/storage/v1/object/public/public-assets/org/org_123/avatars/assistant/as_123.png";
        const updated = await db.updateAssistant(assistant.id, { avatarUrl });

        expect(updated.avatarUrl).toBe(avatarUrl);
        expect((await db.getAssistant(assistant.id))?.avatarUrl).toBe(avatarUrl);
      });

      it("toggles the per-assistant require-sign-in flag", async () => {
        const assistant = await newAssistant();
        const on = await db.updateAssistant(assistant.id, { requireSignIn: true });
        expect(on.requireSignIn).toBe(true);
        expect((await db.getAssistant(assistant.id))?.requireSignIn).toBe(true);
        const off = await db.updateAssistant(assistant.id, {
          requireSignIn: false,
        });
        expect(off.requireSignIn).toBe(false);
      });

      it("defaults the Knowledge Engine to graph and round-trips a switch to vector", async () => {
        const assistant = await newAssistant();
        expect(assistant.knowledgeEngine).toBe("graph");
        const toVector = await db.updateAssistant(assistant.id, {
          knowledgeEngine: "vector",
        });
        expect(toVector.knowledgeEngine).toBe("vector");
        expect((await db.getAssistant(assistant.id))?.knowledgeEngine).toBe("vector");
        const back = await db.updateAssistant(assistant.id, {
          knowledgeEngine: "graph",
        });
        expect(back.knowledgeEngine).toBe("graph");
      });

      it("defaults Simplified thinking off and round-trips the toggle", async () => {
        // Off is load-bearing: turning it on changes what a Visitor sees, so an
        // assistant created before the toggle existed must read as off (#560).
        const assistant = await newAssistant();
        expect(assistant.simplifiedThinking).toBe(false);
        const on = await db.updateAssistant(assistant.id, {
          simplifiedThinking: true,
        });
        expect(on.simplifiedThinking).toBe(true);
        expect((await db.getAssistant(assistant.id))?.simplifiedThinking).toBe(true);
        const off = await db.updateAssistant(assistant.id, {
          simplifiedThinking: false,
        });
        expect(off.simplifiedThinking).toBe(false);
      });

      it("scopes listAssistants to the organization", async () => {
        const assistant = await newAssistant();
        const listed = await db.listAssistants(ctx.organizationId);
        expect(listed.some((a) => a.id === assistant.id)).toBe(true);
        expect(await db.listAssistants(ctx.missingOrganizationId)).toEqual([]);
      });

      it("pages Assistants without materializing the whole organization", async () => {
        await newAssistant();
        await newAssistant();
        const first = await db.listAssistantsPage(ctx.organizationId, { limit: 1 });
        expect(first.items).toHaveLength(1);
        expect(first.nextCursor).toBe(first.items[0]?.id);
        const second = await db.listAssistantsPage(ctx.organizationId, {
          limit: 1,
          cursor: first.nextCursor,
        });
        expect(second.items).toHaveLength(1);
        expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
        await db.deleteAssistant(first.items[0]!.id);
        const afterDeletion = await db.listAssistantsPage(ctx.organizationId, {
          limit: 1,
          cursor: first.nextCursor,
        });
        expect(afterDeletion.items[0]?.id).toBe(second.items[0]?.id);
      });

      it("projects only the fields global navigation needs", async () => {
        const assistant = await newAssistant();
        await db.updateAssistant(assistant.id, {
          style: { brandColor: "#123456" },
        });
        const summary = (await db.listAssistantShellSummaries(ctx.organizationId))
          .find((row) => row.id === assistant.id);
        expect(summary).toEqual({
          id: assistant.id,
          title: assistant.title,
          nickname: assistant.nickname,
          brandColor: "#123456",
          avatarUrl: null,
        });
      });

      it("deleting an assistant removes its flows", async () => {
        const assistant = await newAssistant();
        await db.deleteAssistant(assistant.id);
        expect(await db.getAssistant(assistant.id)).toBeNull();
        expect(await db.listFlows(assistant.id)).toEqual([]);
      });
    });

    describe("flows", () => {
      it("reorders non-default flows and keeps the Default behavior last", async () => {
        const assistant = await newAssistant();
        const a = await db.createFlow(assistant.id, {
          name: "A",
          description: "flow a",
          actions: ["custom_message"],
        });
        const b = await db.createFlow(assistant.id, {
          name: "B",
          description: "flow b",
          actions: ["custom_message"],
        });
        const remainingIds = (await db.listFlows(assistant.id))
          .filter((flow) => !flow.isDefault && flow.id !== a.id && flow.id !== b.id)
          .map((flow) => flow.id);
        await db.reorderFlows(assistant.id, [b.id, a.id, ...remainingIds]);
        const names = (await db.listFlows(assistant.id)).map((f) => f.name);
        expect(names.indexOf("B")).toBeLessThan(names.indexOf("A"));
        expect((await db.listFlows(assistant.id)).at(-1)?.isDefault).toBe(true);
      });

      it("round-trips a proactive trigger with its trigger-scoped settings", async () => {
        const assistant = await newAssistant();
        const created = await db.createFlow(assistant.id, {
          name: "Dwell nudge",
          trigger: "time_on_page",
          triggerSettings: { timeOnPage: { minutes: 1, seconds: 30 } },
          actions: ["notification"],
          actionSettings: { notification: { content: "Still browsing?" } },
        });
        expect(created).toMatchObject({
          trigger: "time_on_page",
          triggerSettings: { timeOnPage: { minutes: 1, seconds: 30 } },
        });

        const patched = await db.updateFlow(created.id, {
          triggerSettings: { timeOnPage: { seconds: 45 } },
        });
        expect(patched.triggerSettings).toEqual({ timeOnPage: { seconds: 45 } });
        const reread = (await db.listFlows(assistant.id)).find(
          (flow) => flow.id === created.id
        );
        expect(reread?.triggerSettings).toEqual({ timeOnPage: { seconds: 45 } });
      });

      it("defaults trigger settings to an empty object for a flow that has none", async () => {
        const assistant = await newAssistant();
        const flow = await db.createFlow(assistant.id, {
          name: "Plain",
          actions: ["custom_message"],
        });
        expect(flow.triggerSettings).toEqual({});
      });

      // Conditions are one unconstrained JSONB column, which is why the
      // objective kinds (spec #550) needed no migration. This is the proof, for
      // both implementations at once.
      it("round-trips every Flow Condition kind through create, read and patch", async () => {
        const assistant = await newAssistant();
        const conditions: FlowCondition[] = [
          {
            id: "c1",
            kind: "conversation_context",
            description: "asks about a course",
            examples: [
              { message: "which courses run in autumn?", note: "", shouldTrigger: true },
            ],
          },
          { id: "c2", kind: "url", operator: "contains", value: "/courses" },
          {
            id: "c3",
            kind: "schedule",
            startAt: "2026-08-01T09:00",
            endAt: "2026-08-31T18:00",
            timezone: "Europe/Rome",
          },
        ];

        const created = await db.createFlow(assistant.id, {
          name: "Course help",
          description: "asks about a course",
          actions: ["custom_message"],
          conditionLogic: "all",
          conditions,
        });
        expect(created.conditions).toEqual(conditions);
        expect(created.conditionLogic).toBe("all");

        const read = (await db.listFlows(assistant.id)).find(
          (flow) => flow.id === created.id
        );
        expect(read?.conditions).toEqual(conditions);
        expect(read?.conditionLogic).toBe("all");

        const patched = await db.updateFlow(created.id, {
          conditionLogic: "any",
          conditions: [
            { id: "c4", kind: "url", operator: "regex", value: ".*/courses/.*" },
          ],
        });
        expect(patched.conditionLogic).toBe("any");
        expect(patched.conditions).toEqual([
          { id: "c4", kind: "url", operator: "regex", value: ".*/courses/.*" },
        ]);
      });
    });

    describe("processing crawl claims", () => {
      it("round-trips configured and resolved Website Source crawler providers", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Crawler provider state",
        });
        const source = await db.createSource({
          collectionId: collection.id,
          name: "Explicit local crawl",
          kind: "website",
          config: {
            url: "https://x.edu",
            crawlerProvider: "local",
            resolvedCrawlerProvider: "local",
            crawlRunId: "local",
            crawlDatasetId: "local",
          },
        });

        expect((await db.getSource(source.id))?.config).toMatchObject({
          crawlerProvider: "local",
          resolvedCrawlerProvider: "local",
          crawlRunId: "local",
        });
        await db.updateSource(source.id, { status: "ready" });
      });

      it("links and clears a stored original-file reference on a Source", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Uploaded files",
        });

        // Default: no original retained (pasted text, legacy files).
        const legacy = await db.createSource({
          collectionId: collection.id,
          name: "legacy.pdf",
          kind: "file",
        });
        expect((await db.getSource(legacy.id))?.originalObjectPath).toBeNull();

        // A newly uploaded file keeps its storage key so it can re-process.
        const path = "org/org_x/knowledge/abc.pdf";
        const stored = await db.createSource({
          collectionId: collection.id,
          name: "syllabus.pdf",
          kind: "file",
          originalObjectPath: path,
        });
        expect((await db.getSource(stored.id))?.originalObjectPath).toBe(path);

        await db.updateSource(stored.id, { originalObjectPath: null });
        expect((await db.getSource(stored.id))?.originalObjectPath).toBeNull();
      });

      it("round-trips the Crawl4AI provider and its remote task id", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Crawl4AI provider state",
        });
        const source = await db.createSource({
          collectionId: collection.id,
          name: "Crawl4AI crawl",
          kind: "website",
          config: {
            url: "https://x.edu",
            crawlerProvider: "crawl4ai",
            resolvedCrawlerProvider: "crawl4ai",
            crawlRunId: "task-abc",
            crawlDatasetId: "task-abc",
          },
        });

        expect((await db.getSource(source.id))?.config).toMatchObject({
          crawlerProvider: "crawl4ai",
          resolvedCrawlerProvider: "crawl4ai",
          crawlRunId: "task-abc",
          crawlDatasetId: "task-abc",
        });
        // Move out of `processing` so it doesn't join the crawl-claim batch below.
        await db.updateSource(source.id, { status: "ready" });
      });

      it("claims an oldest-first bounded batch and skips already leased Sources", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, { name: "Crawl queue" });
        const first = await db.createSource({
          collectionId: collection.id,
          name: "First crawl",
          kind: "website",
          config: { crawlRunId: "run-1", crawlDatasetId: "dataset-1" },
        });
        const later = await db.createSource({
          collectionId: collection.id,
          name: "Later crawl",
          kind: "website",
          config: { crawlRunId: "run-2", crawlDatasetId: "dataset-2" },
        });

        const claim = {
          workerId: "worker-1",
          now: "2026-07-09T10:00:00.000Z",
          staleBefore: "2026-07-09T08:00:00.000Z",
          limit: 1,
        };
        const [firstClaim] = await db.claimProcessingCrawlSources(claim);
        const [secondClaim] = await db.claimProcessingCrawlSources({
          ...claim,
          workerId: "worker-2",
        });
        expect(new Set([firstClaim.sourceId, secondClaim.sourceId])).toEqual(
          new Set([first.id, later.id])
        );
      });

      // A leased Source without a crawlRunId never joins the batch claim above,
      // so these single-lease fixtures cannot interfere with it.
      const leasedSource = async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Lease Collection",
        });
        // createSource defaults to `processing`, the leasable state.
        return db.createSource({
          collectionId: collection.id,
          name: "Leased crawl",
          kind: "website",
          config: { url: "https://lease.edu" },
        });
      };

      it("renews a lease for the owning worker only, and renewal extends it", async () => {
        const source = await leasedSource();
        // Renewing a lease that was never claimed proves nothing, refuse.
        expect(
          await db.renewProcessingCrawlSourceClaim({
            sourceId: source.id,
            workerId: "worker-1",
            now: "2026-07-12T10:00:00.000Z",
          })
        ).toBe(false);

        expect(
          await db.claimProcessingCrawlSource({
            sourceId: source.id,
            workerId: "worker-1",
            now: "2026-07-12T10:00:00.000Z",
            staleBefore: "2026-07-12T08:00:00.000Z",
          })
        ).toBe(true);

        // Only the claiming worker renews; a foreign worker's renew fails.
        expect(
          await db.renewProcessingCrawlSourceClaim({
            sourceId: source.id,
            workerId: "worker-2",
            now: "2026-07-12T11:00:00.000Z",
          })
        ).toBe(false);
        expect(
          await db.renewProcessingCrawlSourceClaim({
            sourceId: source.id,
            workerId: "worker-1",
            now: "2026-07-12T12:00:00.000Z",
          })
        ).toBe(true);

        // The renewal moved the lease timestamp: a takeover that would have
        // succeeded against the original claim time now sees a fresh lease.
        expect(
          await db.claimProcessingCrawlSource({
            sourceId: source.id,
            workerId: "worker-2",
            now: "2026-07-12T12:30:00.000Z",
            staleBefore: "2026-07-12T11:00:00.000Z",
          })
        ).toBe(false);

        // Once the lease IS stale, another worker takes over and the previous
        // owner's renew stops succeeding.
        expect(
          await db.claimProcessingCrawlSource({
            sourceId: source.id,
            workerId: "worker-2",
            now: "2026-07-12T14:00:00.000Z",
            staleBefore: "2026-07-12T13:00:00.000Z",
          })
        ).toBe(true);
        expect(
          await db.renewProcessingCrawlSourceClaim({
            sourceId: source.id,
            workerId: "worker-1",
            now: "2026-07-12T14:01:00.000Z",
          })
        ).toBe(false);
      });

      it("stops renewing once the Source leaves processing", async () => {
        const source = await leasedSource();
        await db.claimProcessingCrawlSource({
          sourceId: source.id,
          workerId: "worker-1",
          now: "2026-07-12T10:00:00.000Z",
          staleBefore: "2026-07-12T08:00:00.000Z",
        });
        await db.updateSource(source.id, { status: "ready" });
        expect(
          await db.renewProcessingCrawlSourceClaim({
            sourceId: source.id,
            workerId: "worker-1",
            now: "2026-07-12T10:30:00.000Z",
          })
        ).toBe(false);
      });

      it("releases a lease only for the owning worker, freeing it for the next claim", async () => {
        const source = await leasedSource();
        await db.claimProcessingCrawlSource({
          sourceId: source.id,
          workerId: "worker-1",
          now: "2026-07-12T10:00:00.000Z",
          staleBefore: "2026-07-12T08:00:00.000Z",
        });

        // A foreign worker's release is a no-op: the owner still holds it.
        await db.releaseProcessingCrawlSourceClaim({
          sourceId: source.id,
          workerId: "worker-2",
        });
        expect(
          await db.renewProcessingCrawlSourceClaim({
            sourceId: source.id,
            workerId: "worker-1",
            now: "2026-07-12T10:10:00.000Z",
          })
        ).toBe(true);

        // The owner's release clears the lease…
        await db.releaseProcessingCrawlSourceClaim({
          sourceId: source.id,
          workerId: "worker-1",
        });
        expect(
          await db.renewProcessingCrawlSourceClaim({
            sourceId: source.id,
            workerId: "worker-1",
            now: "2026-07-12T10:20:00.000Z",
          })
        ).toBe(false);

        // …so another worker claims it immediately, no staleness required.
        expect(
          await db.claimProcessingCrawlSource({
            sourceId: source.id,
            workerId: "worker-2",
            now: "2026-07-12T10:30:00.000Z",
            staleBefore: "2026-07-12T08:00:00.000Z",
          })
        ).toBe(true);
      });
    });

    describe("publications", () => {
      it("versions monotonically and serves the latest snapshot", async () => {
        const assistant = await newAssistant();
        const flows = await db.listFlows(assistant.id);
        const config = buildPublicationConfig(assistant, flows, []);
        const v1 = await db.createPublication(assistant.id, config);
        const v2 = await db.createPublication(assistant.id, {
          ...config,
          assistant: { ...config.assistant, nickname: "Second" },
        });
        expect(v1.version).toBe(1);
        expect(v2.version).toBe(2);
        const latest = await db.getLatestPublication(assistant.id);
        expect(latest?.version).toBe(2);
        expect(latest?.config.assistant.nickname).toBe("Second");
      });
    });

    describe("provider connections", () => {
      it("keeps personal AI subscriptions disabled until the Organization opts in", async () => {
        expect(
          await db.getPersonalAiSubscriptionsAllowed(ctx.organizationId)
        ).toBe(false);
        await db.setPersonalAiSubscriptionsAllowed(ctx.organizationId, true);
        expect(
          await db.getPersonalAiSubscriptionsAllowed(ctx.organizationId)
        ).toBe(true);
        await db.setPersonalAiSubscriptionsAllowed(ctx.organizationId, false);
        expect(
          await db.getPersonalAiSubscriptionsAllowed(ctx.organizationId)
        ).toBe(false);
      });

      it("carries the Organization's embedding choice on every connection (#437)", async () => {
        const openai = await db.createProviderConnection(ctx.organizationId, {
          type: "api_key",
          provider: "openai",
          displayName: "OpenAI",
          encryptedKey: "sealed-openai",
          keyHint: "...ai",
        });
        const local = await db.createProviderConnection(ctx.organizationId, {
          type: "api_key",
          provider: "openai_compatible",
          displayName: "Local Ollama",
          encryptedKey: null,
          keyHint: "",
          config: {
            kind: "openai_compatible",
            baseUrl: "http://localhost:11434/v1",
            chatModel: "llama3.1:8b",
            embeddingModel: "nomic-embed-text",
          },
        });

        // Default: no choice, so the runtime keeps its automatic order.
        expect(await db.getEmbeddingConnectionId(ctx.organizationId)).toBeNull();
        const before = await db.listProviderConnections(ctx.organizationId);
        expect(before.every((c) => !c.preferredForEmbedding)).toBe(true);

        // Choosing one marks exactly that connection, for every reader.
        await db.setEmbeddingConnectionId(ctx.organizationId, local.id);
        expect(await db.getEmbeddingConnectionId(ctx.organizationId)).toBe(
          local.id
        );
        const chosen = await db.listProviderConnections(ctx.organizationId);
        expect(
          chosen.filter((c) => c.preferredForEmbedding).map((c) => c.id)
        ).toEqual([local.id]);

        // Re-choosing moves the flag rather than adding a second one.
        await db.setEmbeddingConnectionId(ctx.organizationId, openai.id);
        const moved = await db.listProviderConnections(ctx.organizationId);
        expect(
          moved.filter((c) => c.preferredForEmbedding).map((c) => c.id)
        ).toEqual([openai.id]);

        // Deleting the chosen connection returns the org to the automatic
        // order instead of leaving a dangling reference.
        await db.deleteProviderConnection(openai.id);
        expect(await db.getEmbeddingConnectionId(ctx.organizationId)).toBeNull();

        // Clearing the choice explicitly is the other way back.
        await db.setEmbeddingConnectionId(ctx.organizationId, local.id);
        await db.setEmbeddingConnectionId(ctx.organizationId, null);
        expect(await db.getEmbeddingConnectionId(ctx.organizationId)).toBeNull();
        const cleared = await db.listProviderConnections(ctx.organizationId);
        expect(cleared.every((c) => !c.preferredForEmbedding)).toBe(true);

        await db.deleteProviderConnection(local.id);
      });

      it("stores API-key connections with encrypted secrets and empty config", async () => {
        const connection = await db.createProviderConnection(ctx.organizationId, {
          type: "api_key",
          provider: "anthropic",
          displayName: "Production key",
          encryptedKey: "sealed-secret",
          keyHint: "...cret",
          createdBy: ctx.userId,
        });

        expect(connection).toMatchObject({
          organizationId: ctx.organizationId,
          type: "api_key",
          provider: "anthropic",
          displayName: "Production key",
          encryptedKey: "sealed-secret",
          keyHint: "...cret",
          createdBy: ctx.userId,
          config: {},
        });
        expect(
          (await db.listProviderConnections(ctx.organizationId)).some(
            (c) => c.id === connection.id && c.encryptedKey === "sealed-secret"
          )
        ).toBe(true);
      });

      it("stores federated connections with non-secret config and no encrypted key", async () => {
        const connection = await db.createProviderConnection(ctx.organizationId, {
          type: "federated",
          provider: "google",
          displayName: "Demo Vertex",
          encryptedKey: null,
          keyHint: "",
          createdBy: ctx.userId,
          config: {
            kind: "google_vertex",
            projectId: "demo-project",
            location: "europe-west4",
            workloadIdentityAudience:
              "//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/ciele/providers/vercel",
            serviceAccountEmail: "ciele-runtime@demo-project.iam.gserviceaccount.com",
          },
        });

        expect(connection).toMatchObject({
          organizationId: ctx.organizationId,
          type: "federated",
          provider: "google",
          displayName: "Demo Vertex",
          encryptedKey: null,
          keyHint: "",
          createdBy: ctx.userId,
          config: {
            kind: "google_vertex",
            projectId: "demo-project",
            location: "europe-west4",
            serviceAccountEmail: "ciele-runtime@demo-project.iam.gserviceaccount.com",
          },
        });
      });

      it("round-trips Anthropic WIF federated config without a secret", async () => {
        const connection = await db.createProviderConnection(ctx.organizationId, {
          type: "federated",
          provider: "anthropic",
          displayName: "Anthropic WIF",
          encryptedKey: null,
          keyHint: "",
          createdBy: ctx.userId,
          config: {
            kind: "anthropic_wif",
            workloadIdentityAudience: "anthropic-audience",
            organizationId: "org_123",
            workspaceId: "wrkspc_123",
          },
        });

        expect(connection).toMatchObject({
          organizationId: ctx.organizationId,
          type: "federated",
          provider: "anthropic",
          encryptedKey: null,
          keyHint: "",
          config: {
            kind: "anthropic_wif",
            workloadIdentityAudience: "anthropic-audience",
            organizationId: "org_123",
            workspaceId: "wrkspc_123",
          },
        });
      });

      it("round-trips Azure OpenAI as a distinct federated provider without a secret", async () => {
        const connection = await db.createProviderConnection(ctx.organizationId, {
          type: "federated",
          provider: "azure_openai",
          displayName: "Azure OpenAI",
          encryptedKey: null,
          keyHint: "",
          createdBy: ctx.userId,
          config: {
            kind: "azure_openai",
            tenantId: "tenant-1",
            endpoint: "https://example.openai.azure.com",
            deployment: "gpt-4.1",
            clientId: "client-1",
            audience: "https://cognitiveservices.azure.com/.default",
          },
        });

        expect(connection).toMatchObject({
          organizationId: ctx.organizationId,
          type: "federated",
          provider: "azure_openai",
          encryptedKey: null,
          keyHint: "",
          config: {
            kind: "azure_openai",
            tenantId: "tenant-1",
            endpoint: "https://example.openai.azure.com",
            deployment: "gpt-4.1",
            clientId: "client-1",
            audience: "https://cognitiveservices.azure.com/.default",
          },
        });
      });
    });

    describe("improvement proposals (Suggested Fix)", () => {
      it("drafts, replaces, accepts, and dismisses a proposal", async () => {
        const improvement = await db.createImprovement(ctx.organizationId, {
          title: "Bad answer about resets",
        });
        expect(await db.getImprovementProposal(improvement.id)).toBeNull();

        const drafted = await db.createImprovementProposal({
          improvementId: improvement.id,
          organizationId: ctx.organizationId,
          payload: {
            draftQuestion: "How do I reset my password?",
            draftAnswer: "Use the Identity Portal.",
            rationale: "The answer missed the portal step.",
            sources: [{ conceptId: "c1", conceptTitle: "Reset", sourceName: "kb.pdf" }],
            model: "test-model",
            targetAssistantId: "a1",
            targetCollectionId: null,
          },
        });
        expect(drafted.status).toBe("draft");
        expect(drafted.payload.draftQuestion).toBe("How do I reset my password?");

        // Re-drafting replaces (at most one live proposal per improvement).
        const redrafted = await db.createImprovementProposal({
          improvementId: improvement.id,
          organizationId: ctx.organizationId,
          payload: { ...drafted.payload, draftAnswer: "Updated." },
        });
        const fetched = await db.getImprovementProposal(improvement.id);
        expect(fetched?.id).toBe(redrafted.id);
        expect(fetched?.payload.draftAnswer).toBe("Updated.");

        // Addressed by its own id too (#770): the org-pinned view has to
        // answer "whose is this proposal?" before it lets an update through,
        // and it holds the proposal id, not the Improvement's.
        const byId = await db.getImprovementProposalById(redrafted.id);
        expect(byId?.id).toBe(redrafted.id);
        expect(byId?.organizationId).toBe(ctx.organizationId);
        expect(await db.getImprovementProposalById("no-such-proposal")).toBeNull();

        const accepted = await db.updateImprovementProposal(redrafted.id, {
          status: "accepted",
          acceptedConceptId: "concept-99",
        });
        expect(accepted.status).toBe("accepted");
        expect(accepted.acceptedConceptId).toBe("concept-99");

        const dismissed = await db.updateImprovementProposal(redrafted.id, {
          status: "dismissed",
          dismissReason: "Not a real gap",
        });
        expect(dismissed.status).toBe("dismissed");
        expect(dismissed.dismissReason).toBe("Not a real gap");
      });
    });

    describe("memory documents & Projects (#771)", () => {
      const projects = () => db.table("projects");
      const newProject = (over: Record<string, unknown> = {}) =>
        projects().insert({
          organizationId: ctx.organizationId,
          name: "Atlas",
          ...over,
        });

      it("creates a Project from a name alone, live and unarchived", async () => {
        const project = await newProject();
        expect(project.organizationId).toBe(ctx.organizationId);
        expect(project.description).toBe("");
        expect(project.archived).toBe(false);
      });

      it("archives without deleting: the row and its decisions stay", async () => {
        const project = await newProject();
        await db.writeMemoryDocument({
          organizationId: ctx.organizationId,
          owner: { scope: "project", projectId: project.id },
          body: "We ship on Thursdays.",
        });
        const archived = await projects().update(project.id, { archived: true });
        expect(archived.archived).toBe(true);
        // Whether an archived Project reaches a prompt is the runtime's rule
        // (`projectInjects`); the document itself is still readable here.
        const doc = await db.getMemoryDocument(ctx.organizationId, {
          scope: "project",
          projectId: project.id,
        });
        expect(doc?.body).toBe("We ship on Thursdays.");
      });

      it("has no document until something writes one", async () => {
        // The state every Member and every Teammate starts in, and it injects
        // nothing. Absent is a real answer, not an error.
        expect(
          await db.getMemoryDocument(ctx.organizationId, {
            scope: "user",
            memberId: ctx.userId,
          })
        ).toBeNull();
      });

      it("writes each layer against its own owner, and keeps them apart", async () => {
        const teammate = await db.table("teammates").insert({
          organizationId: ctx.organizationId,
          ownerId: ctx.userId,
          name: "Nora",
        });
        const project = await newProject({ name: "Beacon" });

        await db.writeMemoryDocument({
          organizationId: ctx.organizationId,
          owner: { scope: "user", memberId: ctx.userId },
          body: "Prefers short answers.",
        });
        await db.writeMemoryDocument({
          organizationId: ctx.organizationId,
          owner: { scope: "agent", teammateId: teammate.id },
          body: "- 2026-08-01: the docs call it a Collection, not a folder",
        });
        await db.writeMemoryDocument({
          organizationId: ctx.organizationId,
          owner: { scope: "project", projectId: project.id },
          body: "We ship on Thursdays.",
        });

        const user = await db.getMemoryDocument(ctx.organizationId, {
          scope: "user",
          memberId: ctx.userId,
        });
        const agent = await db.getMemoryDocument(ctx.organizationId, {
          scope: "agent",
          teammateId: teammate.id,
        });
        const projectDoc = await db.getMemoryDocument(ctx.organizationId, {
          scope: "project",
          projectId: project.id,
        });
        expect(user?.scope).toBe("user");
        expect(user?.body).toBe("Prefers short answers.");
        expect(agent?.scope).toBe("agent");
        expect(projectDoc?.scope).toBe("project");
        // Exactly one owner column set on each, the exclusive-or check's whole
        // point: the scope cannot disagree with the ids.
        expect([user!.memberId, user!.teammateId, user!.projectId].filter(Boolean))
          .toHaveLength(1);
      });

      it("rewrites in place rather than accumulating documents", async () => {
        const owner = { scope: "user" as const, memberId: ctx.userId };
        const first = await db.writeMemoryDocument({
          organizationId: ctx.organizationId,
          owner,
          body: "First.",
        });
        const second = await db.writeMemoryDocument({
          organizationId: ctx.organizationId,
          owner,
          body: "Second.",
        });
        expect(second.id).toBe(first.id);
        expect(second.body).toBe("Second.");
      });

      it("records who wrote what, and keeps the body it replaced", async () => {
        // An Agent-layer document, so the case owns its own history: the User
        // layer is keyed on the one member this suite runs as, and every test
        // that writes it appends to the same list.
        const nora = await db.table("teammates").insert({
          organizationId: ctx.organizationId,
          ownerId: ctx.userId,
          name: "Nora",
        });
        const owner = { scope: "agent" as const, teammateId: nora.id };
        await db.writeMemoryDocument({
          organizationId: ctx.organizationId,
          owner,
          body: "Prefers short answers.",
          authorId: ctx.userId,
        });
        const doc = await db.writeMemoryDocument({
          organizationId: ctx.organizationId,
          owner,
          body: "Prefers short answers. Works in CET.",
          note: "Added their timezone",
          teammateId: nora.id,
          authorId: ctx.userId,
        });

        const entries = await db.listMemoryDocumentEntries(doc.id);
        expect(entries).toHaveLength(2);
        // Newest first, and the newest carries who/when/what plus the body it
        // replaced, which is what makes the next test a restore.
        expect(entries[0].note).toBe("Added their timezone");
        expect(entries[0].teammateId).toBe(nora.id);
        expect(entries[0].authorId).toBe(ctx.userId);
        expect(entries[0].bodyBefore).toBe("Prefers short answers.");
        // The first write replaced nothing.
        expect(entries[1].bodyBefore).toBe("");
      });

      it("reverts to the body an entry replaced, and records the revert too", async () => {
        const reverter = await db.table("teammates").insert({
          organizationId: ctx.organizationId,
          ownerId: ctx.userId,
          name: "Reverter",
        });
        const owner = { scope: "agent" as const, teammateId: reverter.id };
        await db.writeMemoryDocument({
          organizationId: ctx.organizationId,
          owner,
          body: "Trustworthy.",
        });
        const doc = await db.writeMemoryDocument({
          organizationId: ctx.organizationId,
          owner,
          body: "Something the teammate got wrong.",
          note: "A bad write",
        });

        const [latest] = await db.listMemoryDocumentEntries(doc.id);
        const reverted = await db.revertMemoryDocument({
          entryId: latest.id,
          authorId: ctx.userId,
        });
        expect(reverted.body).toBe("Trustworthy.");

        // Append-only: undoing a write is another write, so the history shows
        // both rather than a hole where the bad one used to be.
        const entries = await db.listMemoryDocumentEntries(doc.id);
        expect(entries).toHaveLength(3);
        expect(entries[0].note).toContain("Revert");
        expect(entries[0].bodyBefore).toBe("Something the teammate got wrong.");
      });

      it("caps a write at the injection limit, so stored is what is injected", async () => {
        const doc = await db.writeMemoryDocument({
          organizationId: ctx.organizationId,
          owner: { scope: "user", memberId: ctx.userId },
          body: "x".repeat(20_000),
        });
        expect(doc.body.length).toBeLessThanOrEqual(4_000);
      });

      it("deleting a Project takes its decisions with it", async () => {
        const project = await newProject({ name: "Doomed" });
        await db.writeMemoryDocument({
          organizationId: ctx.organizationId,
          owner: { scope: "project", projectId: project.id },
          body: "Decisions nobody will need.",
        });
        await projects().delete(project.id);
        expect(
          await db.getMemoryDocument(ctx.organizationId, {
            scope: "project",
            projectId: project.id,
          })
        ).toBeNull();
      });

      it("attaches a Teammate to at most one Project, and detaches on delete", async () => {
        const project = await newProject({ name: "Attached" });
        const teammate = await db.table("teammates").insert({
          organizationId: ctx.organizationId,
          ownerId: ctx.userId,
          name: "Nora",
        });
        expect(teammate.projectId).toBeNull();

        const attached = await db
          .table("teammates")
          .update(teammate.id, { projectId: project.id });
        expect(attached.projectId).toBe(project.id);

        // Deleting the Project detaches rather than cascading: losing a project
        // must not take the Teammate that read it.
        await projects().delete(project.id);
        expect((await db.table("teammates").get(teammate.id))?.projectId).toBeNull();
      });
    });

    describe("Routines (#772)", () => {
      const routines = () => db.table("teammateRoutines");
      const newRoutine = async (over: Record<string, unknown> = {}) => {
        const teammate = await db.table("teammates").insert({
          organizationId: ctx.organizationId,
          ownerId: ctx.userId,
          name: "Nora",
        });
        return routines().insert({
          organizationId: ctx.organizationId,
          teammateId: teammate.id,
          instruction: "Triage yesterday's visitor feedback.",
          cadence: "daily",
          createdBy: ctx.userId,
          ...over,
        });
      };

      it("creates one enabled, at the default hour, never run", async () => {
        const routine = await newRoutine();
        expect(routine.cadence).toBe("daily");
        expect(routine.hour).toBe(8);
        expect(routine.enabled).toBe(true);
        expect(routine.lastRunAt).toBeNull();
        expect(routine.lastStatus).toBeNull();
      });

      it("over-fetches only enabled routines whose last run is old enough", async () => {
        const fresh = await newRoutine();
        const ran = await newRoutine({ instruction: "Recently run." });
        const off = await newRoutine({ instruction: "Disabled.", enabled: false });
        await routines().update(off.id, { enabled: false });
        await db.claimTeammateRoutine(ran.id, null, "2026-08-20T08:00:00.000Z");

        const due = await db.listDueRoutineCandidates({
          before: "2026-08-20T00:00:00.000Z",
          limit: 50,
        });
        const ids = due.map((routine) => routine.id);
        // Never run: a candidate, because the exact rule is the caller's.
        expect(ids).toContain(fresh.id);
        // Ran after the cutoff, and disabled: neither is a candidate.
        expect(ids).not.toContain(ran.id);
        expect(ids).not.toContain(off.id);
      });

      it("claims once: a second tick on the same lease gets nothing", async () => {
        const routine = await newRoutine();
        const first = await db.claimTeammateRoutine(
          routine.id,
          null,
          "2026-08-20T08:00:00.000Z"
        );
        expect(first?.lastRunAt).toBe("2026-08-20T08:00:00.000Z");

        // The losing tick read the same `null` and gets refused, which is what
        // keeps two overlapping cron runs from running one routine twice.
        const second = await db.claimTeammateRoutine(
          routine.id,
          null,
          "2026-08-20T08:00:01.000Z"
        );
        expect(second).toBeNull();
        expect((await routines().get(routine.id))?.lastRunAt).toBe(
          "2026-08-20T08:00:00.000Z"
        );
      });

      it("claims again on the next window, from the value it now holds", async () => {
        const routine = await newRoutine();
        await db.claimTeammateRoutine(routine.id, null, "2026-08-20T08:00:00.000Z");
        const next = await db.claimTeammateRoutine(
          routine.id,
          "2026-08-20T08:00:00.000Z",
          "2026-08-21T08:00:00.000Z"
        );
        expect(next?.lastRunAt).toBe("2026-08-21T08:00:00.000Z");
      });

      it("records an outcome without touching what somebody edited mid-run", async () => {
        const routine = await newRoutine();
        await db.claimTeammateRoutine(routine.id, null, "2026-08-20T08:00:00.000Z");
        // The author rewrote the instruction while the run was in flight.
        await routines().update(routine.id, { instruction: "Rewritten." });
        await db.recordTeammateRoutineRun(routine.id, {
          status: "failed",
          detail: "No provider credential",
        });

        const after = await routines().get(routine.id);
        expect(after?.lastStatus).toBe("failed");
        expect(after?.lastDetail).toBe("No provider credential");
        // The run record wrote outcome columns only; it did not put the old
        // instruction back.
        expect(after?.instruction).toBe("Rewritten.");
        expect(after?.lastRunAt).toBe("2026-08-20T08:00:00.000Z");
      });

      it("goes with the Teammate it belongs to", async () => {
        const routine = await newRoutine();
        await db.table("teammates").delete(routine.teammateId);
        expect(await routines().get(routine.id)).toBeNull();
      });
    });

    describe("entities & records (#663)", () => {
      const orderEntity = () =>
        db.table("entities").insert({
          organizationId: ctx.organizationId,
          name: "Orders",
          description: "Customer orders",
          attributes: [
            { key: "order_id", label: "Order ID", type: "text" },
            { key: "status", label: "Status", type: "text" },
            { key: "total", label: "Total", type: "number" },
          ],
          keyAttribute: "order_id",
          scope: "user",
          identityAttribute: "order_id",
        });

      it("round-trips an Entity and scopes lists to the organization", async () => {
        const entity = await orderEntity();
        expect(entity.scope).toBe("user");
        expect(entity.identityAttribute).toBe("order_id");
        expect(entity.attributes).toHaveLength(3);

        const listed = await db.table("entities").list({
          organizationId: ctx.organizationId,
        });
        expect(listed.some((e) => e.id === entity.id)).toBe(true);
        // Another organization's scope never surfaces this entity.
        expect(
          (await db.table("entities").list({
            organizationId: ctx.foreignOrganizationId,
          })).some(
            (e) => e.id === entity.id
          )
        ).toBe(false);

        const renamed = await db.table("entities").update(entity.id, {
          name: "Sales",
        });
        expect(renamed.name).toBe("Sales");
        expect(renamed.keyAttribute).toBe("order_id");
      });

      it("pages Entities with a durable database cursor", async () => {
        await orderEntity();
        await orderEntity();
        const first = await db.listEntitiesPage(ctx.organizationId, { limit: 1 });
        const second = await db.listEntitiesPage(ctx.organizationId, {
          limit: 1,
          cursor: first.nextCursor,
        });
        expect(first.items).toHaveLength(1);
        expect(second.items).toHaveLength(1);
        expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
        await db.table("entities").delete(first.items[0]!.id);
        const afterDeletion = await db.listEntitiesPage(ctx.organizationId, {
          limit: 1,
          cursor: first.nextCursor,
        });
        expect(afterDeletion.items[0]?.id).toBe(second.items[0]?.id);
      });

      it("upserts records idempotently by key and pages them", async () => {
        const entity = await orderEntity();
        const first = await db.upsertEntityRecords(entity.id, [
          { key: "A-1", values: { order_id: "A-1", status: "shipped", total: 10 } },
          { key: "A-2", values: { order_id: "A-2", status: "delayed", total: 25 } },
        ]);
        expect(first).toBe(2);
        expect(await db.countEntityRecords(entity.id)).toBe(2);
        const originalIds = (await db.listEntityRecords(entity.id)).map((r) => r.id);

        // Re-import: same keys, one changed value, no duplicates, stable ids.
        const changed = await db.upsertEntityRecords(entity.id, [
          { key: "A-1", values: { order_id: "A-1", status: "refunded", total: 10 } },
          { key: "A-2", values: { order_id: "A-2", status: "delayed", total: 25 } },
        ]);
        expect(changed).toBe(1);
        const after = await db.listEntityRecords(entity.id);
        expect(after).toHaveLength(2);
        expect(after.map((r) => r.id).sort()).toEqual([...originalIds].sort());
        expect(after.find((r) => r.key === "A-1")?.values.status).toBe("refunded");

        const unchanged = await db.upsertEntityRecords(entity.id, [
          { key: "A-1", values: { order_id: "A-1", status: "refunded", total: 10 } },
          { key: "A-2", values: { order_id: "A-2", status: "delayed", total: 25 } },
        ]);
        expect(unchanged).toBe(0);

        // Paging is key-ordered.
        const page = await db.listEntityRecords(entity.id, { limit: 1, offset: 1 });
        expect(page.map((r) => r.key)).toEqual(["A-2"]);
      });

      it("queries records by typed equality filters and keyword search (#665)", async () => {
        const entity = await orderEntity();
        await db.upsertEntityRecords(entity.id, [
          { key: "Q-1", values: { order_id: "Q-1", status: "shipped", total: 10 } },
          { key: "Q-2", values: { order_id: "Q-2", status: "delayed", total: 25 } },
          { key: "Q-3", values: { order_id: "Q-3", status: "shipped", total: 25 } },
        ]);

        // Equality filter on a text attribute.
        const shipped = await db.queryEntityRecords(entity.id, {
          filters: { status: "shipped" },
        });
        expect(shipped.map((r) => r.key)).toEqual(["Q-1", "Q-3"]);

        // Typed (number) equality composes with the text filter.
        const shipped25 = await db.queryEntityRecords(entity.id, {
          filters: { status: "shipped", total: 25 },
        });
        expect(shipped25.map((r) => r.key)).toEqual(["Q-3"]);

        // Case-insensitive keyword search over the record's values.
        const delayed = await db.queryEntityRecords(entity.id, {
          search: "DELAY",
        });
        expect(delayed.map((r) => r.key)).toEqual(["Q-2"]);

        // Search is deliberately limited to attributes declared as text.
        expect(
          await db.queryEntityRecords(entity.id, { search: "25" })
        ).toHaveLength(0);

        // No match → empty, never an error.
        expect(
          await db.queryEntityRecords(entity.id, { filters: { status: "lost" } })
        ).toHaveLength(0);

        // Limit caps the key-ordered result.
        const capped = await db.queryEntityRecords(entity.id, { limit: 2 });
        expect(capped.map((r) => r.key)).toEqual(["Q-1", "Q-2"]);
      });

      it("scopes a user-scoped query to one identity value alongside other filters (#667)", async () => {
        // The runtime binds the Entity's identity attribute to the turn's
        // verified claim; this is the query path that binding rides on,
        // combined identity + attribute filters, and identity + search.
        const entity = await db.table("entities").insert({
          organizationId: ctx.organizationId,
          name: "User orders",
          description: "Orders owned by a signed-in user",
          attributes: [
            { key: "order_id", label: "Order ID", type: "text" },
            { key: "status", label: "Status", type: "text" },
            { key: "customer_email", label: "Customer email", type: "text" },
          ],
          keyAttribute: "order_id",
          scope: "user",
          identityAttribute: "customer_email",
        });
        await db.upsertEntityRecords(entity.id, [
          { key: "U-1", values: { order_id: "U-1", status: "delayed", customer_email: "me@example.com" } },
          { key: "U-2", values: { order_id: "U-2", status: "delayed", customer_email: "other@example.com" } },
          { key: "U-3", values: { order_id: "U-3", status: "shipped", customer_email: "me@example.com" } },
        ]);

        const mine = await db.queryEntityRecords(entity.id, {
          filters: { customer_email: "me@example.com", status: "delayed" },
        });
        expect(mine.map((r) => r.key)).toEqual(["U-1"]);

        // Keyword search composes with the identity filter: the other
        // subject's delayed order stays unreachable.
        const searched = await db.queryEntityRecords(entity.id, {
          search: "delayed",
          filters: { customer_email: "me@example.com" },
        });
        expect(searched.map((r) => r.key)).toEqual(["U-1"]);
      });

      it("round-trips a sync source config and stamps runs (#670)", async () => {
        const entity = await orderEntity();
        expect(await db.getEntitySyncConfig(entity.id)).toBeNull();

        const config = await db.upsertEntitySyncConfig(entity.id, {
          url: "https://api.example.com/orders",
          sealedHeaders: "sealed-blob",
          cadenceHours: 6,
          prune: true,
          mapping: { orderNumber: "order_id" },
        });
        expect(config).toMatchObject({
          entityId: entity.id,
          url: "https://api.example.com/orders",
          sealedHeaders: "sealed-blob",
          cadenceHours: 6,
          prune: true,
          mapping: { orderNumber: "order_id" },
          lastSyncedAt: null,
        });

        // Re-upsert replaces fields but keeps the cadence anchor.
        await db.markEntitySynced(entity.id, "2026-08-08T10:00:00.000Z");
        const updated = await db.upsertEntitySyncConfig(entity.id, {
          url: "https://api.example.com/v2/orders",
          sealedHeaders: null,
          cadenceHours: 24,
          prune: false,
          mapping: {},
        });
        expect(updated.url).toBe("https://api.example.com/v2/orders");
        expect(updated.lastSyncedAt).toBe("2026-08-08T10:00:00.000Z");

        const run = await db.recordEntitySyncRun(entity.id, {
          status: "succeeded",
          upserted: 3,
          pruned: 1,
          rejected: ["row 2: total is not a number"],
          error: null,
        });
        expect(run.entityId).toBe(entity.id);
        expect(run.finishedAt).toBeTruthy();
        await db.recordEntitySyncRun(entity.id, {
          status: "failed",
          upserted: 0,
          pruned: 0,
          rejected: [],
          error: "HTTP 500",
        });
        const runs = await db.listEntitySyncRuns(entity.id);
        expect(runs).toHaveLength(2);
        expect(runs[0].status).toBe("failed"); // newest first

        await db.deleteEntitySyncConfig(entity.id);
        expect(await db.getEntitySyncConfig(entity.id)).toBeNull();
      });

      it("commits a complete sync snapshot once per observed config version", async () => {
        const entity = await orderEntity();
        await db.upsertEntitySyncConfig(entity.id, {
          url: "https://api.example.com/orders",
          sealedHeaders: null,
          cadenceHours: 24,
          prune: true,
          mapping: {},
        });
        await db.upsertEntityRecords(entity.id, [
          { key: "old", values: { order_id: "old", status: "stale", total: 1 } },
        ]);

        const committed = await db.commitEntitySync({
          entityId: entity.id,
          expectedLastSyncedAt: null,
          rows: [
            { key: "new", values: { order_id: "new", status: "fresh", total: 2 } },
          ],
          prune: true,
          rejected: [],
          at: "2026-08-29T12:00:00.000Z",
        });
        expect(committed).toMatchObject({
          status: "succeeded",
          upserted: 1,
          pruned: 1,
        });
        expect((await db.listEntityRecords(entity.id)).map((row) => row.key)).toEqual([
          "new",
        ]);

        const staleWriter = await db.commitEntitySync({
          entityId: entity.id,
          expectedLastSyncedAt: null,
          rows: [
            { key: "old", values: { order_id: "old", status: "stale", total: 1 } },
          ],
          prune: true,
          rejected: [],
          at: "2026-08-29T12:00:01.000Z",
        });
        expect(staleWriter).toMatchObject({
          status: "failed",
          error: "Superseded by a newer sync",
          upserted: 0,
          pruned: 0,
        });
        expect((await db.listEntityRecords(entity.id)).map((row) => row.key)).toEqual([
          "new",
        ]);
      });

      it("lists due syncs across cadence windows (#670)", async () => {
        const fresh = await orderEntity();
        const stale = await orderEntity();
        const never = await orderEntity();
        const input = {
          url: "https://api.example.com/x",
          sealedHeaders: null,
          cadenceHours: 12,
          prune: false,
          mapping: {},
        };
        await db.upsertEntitySyncConfig(fresh.id, input);
        await db.upsertEntitySyncConfig(stale.id, input);
        await db.upsertEntitySyncConfig(never.id, input);
        await db.markEntitySynced(fresh.id, "2026-08-08T09:00:00.000Z");
        await db.markEntitySynced(stale.id, "2026-08-07T00:00:00.000Z");

        const due = await db.listDueEntitySyncConfigs("2026-08-08T12:00:00.000Z");
        const ids = due.map((d) => d.entityId);
        expect(ids).toContain(stale.id); // cadence elapsed
        expect(ids).toContain(never.id); // never ran
        expect(ids).not.toContain(fresh.id); // within its window
        const staleDue = due.find((d) => d.entityId === stale.id);
        expect(staleDue?.organizationId).toBe(ctx.organizationId);
      });

      it("prunes Records unseen in the latest run, and only those (#670)", async () => {
        const entity = await orderEntity();
        await db.upsertEntityRecords(entity.id, [
          { key: "P-1", values: { order_id: "P-1", status: "open", total: 1 } },
          { key: "P-2", values: { order_id: "P-2", status: "open", total: 2 } },
          { key: "P-3", values: { order_id: "P-3", status: "open", total: 3 } },
        ]);
        const removed = await db.pruneEntityRecords(entity.id, ["P-1", "P-3"]);
        expect(removed).toBe(1);
        const kept = (await db.listEntityRecords(entity.id)).map((r) => r.key);
        expect(kept.sort()).toEqual(["P-1", "P-3"]);
      });

      it("deleting an Entity removes its Records", async () => {
        const entity = await orderEntity();
        await db.upsertEntityRecords(entity.id, [
          { key: "B-1", values: { order_id: "B-1", status: "open", total: 5 } },
        ]);
        await db.table("entities").delete(entity.id);
        expect(await db.table("entities").get(entity.id)).toBeNull();
        expect(await db.countEntityRecords(entity.id)).toBe(0);
      });
    });

    describe("long-term memories (#664)", () => {
      const subject = () => `entra-sub-${shortId()}`;
      const memorySubject = (
        subjectId: string,
        organizationId = ctx.organizationId
      ) => ({ organizationId, subjectId });

      it("defaults the org toggle off and round-trips it", async () => {
        expect(await db.getMemoryEnabled(ctx.organizationId)).toBe(false);
        await db.setMemoryEnabled(ctx.organizationId, true);
        expect(await db.getMemoryEnabled(ctx.organizationId)).toBe(true);
        await db.setMemoryEnabled(ctx.organizationId, false);
        expect(await db.getMemoryEnabled(ctx.organizationId)).toBe(false);
      });

      it("upserts memories with provenance, deduplicates on write, lists newest first", async () => {
        const assistant = await newAssistant();
        const conversation = await db.createConversation({
          assistantId: assistant.id,
          subjectType: "sso",
          subjectId: "entra-sub-mem",
        });
        const subjectId = subject();
        const first = await db.upsertMemories(memorySubject(subjectId), [
          { text: "Prefers email over phone", embedding: null, conversationId: conversation.id },
          { text: "Runs the Milan branch", embedding: null, conversationId: conversation.id },
        ]);
        expect(first).toBe(2);

        // Exact-text dedupe: re-promoting the same fact writes nothing new,
        // whether the duplicate is pre-existing or inside the same batch.
        const second = await db.upsertMemories(memorySubject(subjectId), [
          { text: "Prefers email over phone", embedding: null },
          { text: "Speaks Italian", embedding: null },
          { text: "Speaks Italian", embedding: null },
        ]);
        expect(second).toBe(1);

        const listed = await db.listMemories(memorySubject(subjectId));
        expect(listed).toHaveLength(3);
        expect(listed[0].text).toBe("Speaks Italian"); // newest first
        const withProvenance = listed.find((m) => m.text === "Runs the Milan branch");
        expect(withProvenance?.conversationId).toBe(conversation.id);
        expect(withProvenance?.subjectId).toBe(subjectId);
        expect(withProvenance?.createdAt).toBeTruthy();
        expect((await db.getMemory(listed[0].id))?.id).toBe(listed[0].id);
        expect(await db.getMemory(`missing-${shortId()}`)).toBeNull();
      });

      it("caps memories per subject by dropping the oldest", async () => {
        const subjectId = subject();
        const batch = (from: number, count: number) =>
          Array.from({ length: count }, (_, i) => ({
            text: `fact number ${from + i}`,
            embedding: null,
          }));
        await db.upsertMemories(memorySubject(subjectId), batch(0, MEMORIES_PER_SUBJECT_CAP));
        await db.upsertMemories(memorySubject(subjectId), batch(MEMORIES_PER_SUBJECT_CAP, 2));
        const listed = await db.listMemories(memorySubject(subjectId));
        expect(listed).toHaveLength(MEMORIES_PER_SUBJECT_CAP);
        const texts = listed.map((m) => m.text);
        expect(texts).toContain(`fact number ${MEMORIES_PER_SUBJECT_CAP + 1}`);
        expect(texts).not.toContain("fact number 0");
        expect(texts).not.toContain("fact number 1");
      });

      it("recalls semantically when embeddings are present (match path on both impls)", async () => {
        // Orthogonal unit vectors in the platform's 1536-dim convention: the
        // query leans toward axis 0, so the color memory must rank first,
        // on the vector path (Supabase match_memories) and the lexical
        // fallback (mock) alike, since the query keywords agree.
        const axis = (i: number) => {
          const v = new Array(1536).fill(0);
          v[i] = 1;
          return v;
        };
        const query = new Array(1536).fill(0);
        query[0] = 0.9;
        query[1] = 0.1;

        const subjectId = subject();
        await db.upsertMemories(memorySubject(subjectId), [
          { text: "Favorite color is blue", embedding: axis(0) },
          { text: "Allergic to peanuts", embedding: axis(1) },
        ]);
        const results = await db.searchMemories(memorySubject(subjectId), {
          embedding: query,
          text: "favorite color",
          limit: 1,
        });
        expect(results).toHaveLength(1);
        expect(results[0].text).toBe("Favorite color is blue");
        expect(results[0].similarity).toBeGreaterThan(0);
      });

      it("scopes memories to organization and subject, searches lexically, deletes and wipes", async () => {
        const mine = subject();
        const other = subject();
        const assistant = await newAssistant();
        const sourceConversation = await db.createConversation({
          assistantId: assistant.id,
          subjectType: "sso",
          subjectId: mine,
        });
        await db.upsertMemories(memorySubject(mine), [
          {
            text: "Always ships orders to the Berlin warehouse",
            embedding: null,
            conversationId: sourceConversation.id,
          },
          { text: "Has a premium plan subscription", embedding: null },
        ]);
        await db.upsertMemories(memorySubject(other), [
          { text: "Berlin warehouse is their favorite topic too", embedding: null },
        ]);

        // Another subject's memories never surface in list or search.
        const results = await db.searchMemories(memorySubject(mine), {
          embedding: null,
          text: "berlin warehouse shipping",
        });
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].text).toBe("Always ships orders to the Berlin warehouse");
        expect(
          (await db.listMemories(memorySubject(other))).some((m) =>
            m.text.startsWith("Always ships")
          )
        ).toBe(false);
        // A foreign organization's scope sees nothing for the same subject key.
        expect(
          await db.listMemories(memorySubject(mine, ctx.foreignOrganizationId))
        ).toHaveLength(0);

        // Per-memory delete (erasure, one item).
        const listed = await db.listMemories(memorySubject(mine));
        await db.deleteMemory(listed[0].id);
        expect(await db.listMemories(memorySubject(mine))).toHaveLength(1);

        // Full wipe (erasure, whole subject) touches only that subject.
        await db.deleteSubjectMemories(memorySubject(mine));
        expect(await db.listMemories(memorySubject(mine))).toHaveLength(0);
        expect(await db.listMemories(memorySubject(other))).toHaveLength(1);

        // A queued extraction from a pre-erasure Conversation cannot
        // recreate the deleted subject data after the wipe returns.
        expect(
          await db.upsertMemories(memorySubject(mine), [
            {
              text: "Always ships orders to the Berlin warehouse",
              embedding: null,
              conversationId: sourceConversation.id,
            },
          ])
        ).toBe(0);
        expect(await db.listMemories(memorySubject(mine))).toHaveLength(0);
      });

      it("lists memory subjects with counts and the latest SSO claim value (#666)", async () => {
        const first = subject();
        const second = subject();
        await db.upsertMemories(memorySubject(first), [
          { text: "Prefers pickup over delivery", embedding: null },
          { text: "Contact hours are afternoons", embedding: null },
        ]);
        await db.upsertMemories(memorySubject(second), [
          { text: "Renewed the annual plan", embedding: null },
        ]);

        // The claim value rides the subject's latest SSO conversation.
        const assistant = await newAssistant();
        await db.createConversation({
          assistantId: assistant.id,
          subjectType: "sso",
          subjectId: first,
          metadata: { ssoClaimName: "email", ssoClaimValue: "person@example.com" },
        });

        const subjects = await db.listMemorySubjects(ctx.organizationId);
        const mine = subjects.find((s) => s.subjectId === first);
        const theirs = subjects.find((s) => s.subjectId === second);
        expect(mine).toMatchObject({
          memoryCount: 2,
          claimValue: "person@example.com",
        });
        expect(mine?.lastMemoryAt).toBeTruthy();
        expect(theirs).toMatchObject({ memoryCount: 1, claimValue: null });

        const firstPage = await systemDb.listMemorySubjectsPage(
          ctx.organizationId,
          { limit: 1 }
        );
        expect(firstPage.items).toHaveLength(1);
        expect(firstPage.nextCursor).toBeTruthy();
        const deletedAnchor = firstPage.items[0]!.subjectId;
        await db.deleteSubjectMemories(memorySubject(deletedAnchor));
        const secondPage = await systemDb.listMemorySubjectsPage(
          ctx.organizationId,
          { limit: 1, cursor: firstPage.nextCursor }
        );
        expect(secondPage.items).toHaveLength(1);
        expect(secondPage.items[0]?.subjectId).not.toBe(
          deletedAnchor
        );
        await expect(
          systemDb.listMemorySubjectsPage(ctx.organizationId, {
            limit: 1,
            cursor: "[]",
          })
        ).rejects.toThrow("Invalid memory subject cursor");

        // Foreign organizations never see these subjects.
        const foreign = await db.listMemorySubjects(ctx.foreignOrganizationId);
        expect(foreign.some((s) => s.subjectId === first)).toBe(false);

        // Wiping the subject removes its row entirely.
        await db.deleteSubjectMemories(memorySubject(first));
        const after = await db.listMemorySubjects(ctx.organizationId);
        expect(after.some((s) => s.subjectId === first)).toBe(false);
      });

      it("serializes a whole-subject wipe against concurrent promotion writes", async () => {
        const subjectId = subject();
        const assistant = await newAssistant();
        const conversation = await db.createConversation({
          assistantId: assistant.id,
          subjectType: "sso",
          subjectId,
        });
        const ref = memorySubject(subjectId);

        await Promise.all([
          db.upsertMemories(ref, [
            {
              text: "A promotion racing with erasure",
              embedding: null,
              conversationId: conversation.id,
            },
          ]),
          db.deleteSubjectMemories(ref),
        ]);

        expect(await db.listMemories(ref)).toHaveLength(0);
      });
    });

    describe("graph learning support", () => {
      it("resolves the conversation a message belongs to", async () => {
        const assistant = await newAssistant();
        const conversation = await db.createConversation({
          assistantId: assistant.id,
          subjectType: "visitor",
          subjectId: "visitor-graph",
        });
        const message = await db.appendMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: [{ type: "text", text: "graph answer" }],
        });
        const resolved = await db.getConversationForMessage(message.id);
        expect(resolved?.id).toBe(conversation.id);
        expect(await db.getConversationForMessage("missing")).toBeNull();
      });

      it("lists graph-engine collections and excludes vector-engine ones", async () => {
        // Post-contract (#733) a Collection has no owning assistant: a
        // Collection is an active graph dataset when any Assistant LINKED to
        // one of its Sources runs the graph engine.
        const seed = async (name: string) => {
          const assistant = await newAssistant();
          const collection = await db.createCollection(assistant.id, { name });
          const source = await db.createSource({
            collectionId: collection.id,
            name: `${name} Source`,
            kind: "text",
          });
          await db.setSourceAssistantLinks(source.id, [assistant.id]);
          return { assistant, collection };
        };
        const graph = await seed("Graph KB");
        const vector = await seed("Vector KB");
        await db.updateAssistant(vector.assistant.id, {
          knowledgeEngine: "vector",
        });

        const datasets = await db.listActiveGraphDatasets();
        expect(
          datasets.some(
            (d) =>
              d.collectionId === graph.collection.id &&
              d.organizationId === ctx.organizationId
          )
        ).toBe(true);
        expect(
          datasets.some((d) => d.collectionId === vector.collection.id)
        ).toBe(false);
        const claimed = await systemDb.claimActiveGraphDatasets(1);
        expect(claimed).toHaveLength(1);
        expect(datasets).toContainEqual(claimed[0]);
        expect(claimed[0]?.collectionId).not.toBe(vector.collection.id);
      });
    });

    describe("conversations & messages", () => {
      it("leases one idempotent conversation turn to one worker", async () => {
        const assistant = await newAssistant();
        const conversation = await newConversation(assistant.id);
        const input = {
          conversationId: conversation.id,
          requestId: "00000000-0000-4000-8000-000000000201",
          workerId: "turn-worker-a",
          now: "2026-08-27T00:00:00.000Z",
          staleBefore: "2026-08-26T23:50:00.000Z",
        };
        const [a, b] = await Promise.all([
          systemDb.claimConversationTurn(input),
          systemDb.claimConversationTurn({ ...input, workerId: "turn-worker-b" }),
        ]);
        const winner = [a, b].find((claim) => claim.status === "claimed");
        const duplicate = [a, b].find((claim) => claim.status === "running");
        expect(winner?.leaseToken).toBeTruthy();
        expect(duplicate).toBeTruthy();

        expect(
          await systemDb.completeConversationTurn({
            conversationId: conversation.id,
            requestId: input.requestId,
            leaseToken: winner!.leaseToken!,
            assistantMessageId: "answer-1",
            now: "2026-08-27T00:00:10.000Z",
          })
        ).toBe(true);
        await expect(
          systemDb.claimConversationTurn({
            ...input,
            workerId: "replay-worker",
            now: "2026-08-27T00:00:20.000Z",
          })
        ).resolves.toMatchObject({
          status: "completed",
          assistantMessageId: "answer-1",
        });
      });

      it("atomically rejects a stale turn before message and effects persist", async () => {
        const assistant = await newAssistant();
        const conversation = await newConversation(assistant.id);
        const requestId = `stale-${crypto.randomUUID()}`;
        const first = await systemDb.claimConversationTurn({
          conversationId: conversation.id,
          requestId,
          workerId: "turn-worker-a",
          now: "2026-08-27T00:00:00.000Z",
          staleBefore: "2026-08-26T23:50:00.000Z",
        });
        const replacement = await systemDb.claimConversationTurn({
          conversationId: conversation.id,
          requestId,
          workerId: "turn-worker-b",
          now: "2026-08-27T00:20:00.000Z",
          staleBefore: "2026-08-27T00:10:00.000Z",
        });
        expect(first.status).toBe("claimed");
        expect(replacement.status).toBe("claimed");
        await expect(
          systemDb.commitConversationTurn({
            conversationId: conversation.id,
            requestId,
            leaseToken: first.leaseToken!,
            content: [{ type: "text", text: "stale" }],
            deferredEffects: [{ kind: "send_email", to: "x@example.com" }],
            now: "2026-08-27T00:20:01.000Z",
          })
        ).resolves.toBeNull();
        expect(
          (await db.listMessages(conversation.id)).filter(
            (message) => message.role === "assistant"
          )
        ).toEqual([]);
      });

      it("reuses a caller-stable conversation and each turn role message", async () => {
        const assistant = await newAssistant();
        const stableId = "turn-conversation-stable";
        const input = {
          id: stableId,
          assistantId: assistant.id,
          subjectType: "visitor" as const,
          subjectId: "stable-visitor",
          title: "first",
        };
        const [first, retry] = await Promise.all([
          db.createConversation(input),
          db.createConversation(input),
        ]);
        expect(first.id).toBe(stableId);
        expect(retry.id).toBe(stableId);

        const requestId = "00000000-0000-4000-8000-000000000202";
        const original = await db.appendMessage({
          conversationId: stableId,
          requestId,
          role: "user",
          content: [{ type: "text", text: "original" }],
        });
        const replay = await db.appendMessage({
          conversationId: stableId,
          requestId,
          role: "user",
          content: [{ type: "text", text: "changed retry" }],
        });
        expect(replay.id).toBe(original.id);
        expect(replay.content).toEqual([{ type: "text", text: "original" }]);
      });

      it("atomically enqueues, leases, and fences deferred turn effects", async () => {
        const assistant = await newAssistant();
        const conversation = await newConversation(assistant.id);
        const message = await systemDb.appendMessage({
          conversationId: conversation.id,
          requestId: "00000000-0000-4000-8000-000000000203",
          role: "assistant",
          content: [{ type: "text", text: "queued" }],
          deferredEffects: [
            { kind: "create_improvement", title: "Durable effect" },
          ],
        });
        const claimNow = new Date(Date.now() + 60_000);
        const claimInput = {
          messageId: message.id,
          workerId: "effect-a",
          now: claimNow.toISOString(),
          staleBefore: new Date(claimNow.getTime() - 10 * 60_000).toISOString(),
          limit: 10,
        };
        const [a, b] = await Promise.all([
          systemDb.claimTurnEffects(claimInput),
          systemDb.claimTurnEffects({ ...claimInput, workerId: "effect-b" }),
        ]);
        expect(a.length + b.length).toBe(1);
        const effect = (a[0] ?? b[0])!;
        expect(effect.payload).toMatchObject({ title: "Durable effect" });
        expect(
          await systemDb.settleTurnEffect({
            id: effect.id,
            leaseToken: "00000000-0000-4000-8000-000000000204",
            now: "2026-08-27T00:01:01.000Z",
            succeeded: true,
          })
        ).toBe(false);
        expect(
          await systemDb.settleTurnEffect({
            id: effect.id,
            leaseToken: effect.leaseToken,
            now: "2026-08-27T00:01:02.000Z",
            succeeded: true,
          })
        ).toBe(true);
        expect(await systemDb.claimTurnEffects(claimInput)).toEqual([]);
      });

      const newConversation = async (assistantId: string) =>
        db.createConversation({
          assistantId,
          subjectType: "visitor",
          subjectId: "visitor-contract",
          title: "contract",
          metadata: { browser: "Firefox", os: "macOS" },
        });

      it("accepts SSO-signed subjects and keeps them apart from visitors (#662)", async () => {
        const assistant = await newAssistant();
        const ssoConversation = await db.createConversation({
          assistantId: assistant.id,
          subjectType: "sso",
          subjectId: "entra-sub-1",
          title: "signed in",
          metadata: { ssoClaimName: "email", ssoClaimValue: "person@example.com" },
        });
        expect(ssoConversation.subjectType).toBe("sso");

        const stored = await db.getConversation(ssoConversation.id);
        expect(stored?.subjectType).toBe("sso");
        expect(stored?.metadata.ssoClaimName).toBe("email");
        expect(stored?.metadata.ssoClaimValue).toBe("person@example.com");

        // The same id under a different subject type is a different subject:
        // history queries never mix the two.
        await newConversation(assistant.id);
        const ssoList = await db.listConversations(
          assistant.id,
          "sso",
          "entra-sub-1"
        );
        expect(ssoList.map((c) => c.id)).toEqual([ssoConversation.id]);
        expect(
          await db.listConversations(assistant.id, "visitor", "entra-sub-1")
        ).toEqual([]);
      });

      it("shallow-merges metadata patches", async () => {
        const assistant = await newAssistant();
        const conversation = await newConversation(assistant.id);
        await db.updateConversationMetadata(conversation.id, {
          escalated: true,
        });
        const after = await db.getConversation(conversation.id);
        expect(after?.metadata).toMatchObject({
          browser: "Firefox",
          os: "macOS",
          escalated: true,
        });
      });

      it("preserves concurrent conversation metadata patches", async () => {
        const assistant = await newAssistant();
        const conversation = await db.createConversation({
          assistantId: assistant.id,
          subjectType: "visitor",
          subjectId: `metadata-race-${shortId()}`,
          metadata: { browser: "Safari" },
        });

        await Promise.all([
          db.updateConversationMetadata(conversation.id, { escalated: true }),
          db.updateConversationMetadata(conversation.id, { feedbackText: "Helpful" }),
        ]);

        expect((await db.getConversation(conversation.id))?.metadata).toMatchObject({
          browser: "Safari",
          escalated: true,
          feedbackText: "Helpful",
        });
      });

      it("appends concurrent referral links without dropping either", async () => {
        const assistant = await newAssistant();
        const conversation = await db.createConversation({
          assistantId: assistant.id,
          subjectType: "member",
          subjectId: `referral-race-${shortId()}`,
        });
        const first = {
          conversationId: "referral-1",
          teammateId: "teammate-1",
          teammateName: "Ada",
        };
        const second = {
          conversationId: "referral-2",
          teammateId: "teammate-2",
          teammateName: "Grace",
        };

        await Promise.all([
          db.appendConversationReferral(conversation.id, first),
          db.appendConversationReferral(conversation.id, second),
        ]);

        expect((await db.getConversation(conversation.id))?.metadata.referredTo).toEqual(
          expect.arrayContaining([first, second])
        );
      });

      it("fences concurrent session-state writers and preserves retried patches", async () => {
        const assistant = await newAssistant();
        const conversation = await newConversation(assistant.id);
        expect(conversation.sessionVersion).toBe(0);

        const firstWave = await Promise.all([
          db.mergeConversationSessionState({
            id: conversation.id,
            expectedVersion: 0,
            patch: { proactive: { welcome: 1 } },
          }),
          db.mergeConversationSessionState({
            id: conversation.id,
            expectedVersion: 0,
            patch: { graphQa: { answerA: "qa-a" } },
          }),
        ]);
        expect(firstWave.filter(Boolean)).toHaveLength(1);

        const afterFirst = (await db.getConversation(conversation.id))!;
        const missingPatch = firstWave[0]
          ? { graphQa: { answerA: "qa-a" } }
          : { proactive: { welcome: 1 } };
        await expect(
          db.mergeConversationSessionState({
            id: conversation.id,
            expectedVersion: afterFirst.sessionVersion,
            patch: missingPatch,
          })
        ).resolves.toBe(true);

        const settled = (await db.getConversation(conversation.id))!;
        expect(settled.sessionVersion).toBe(2);
        expect(settled.sessionState).toMatchObject({
          proactive: { welcome: 1 },
          graphQa: { answerA: "qa-a" },
        });
      });

      it("keeps only the newest 20 distinct session-memory facts", async () => {
        const assistant = await newAssistant();
        const conversation = await newConversation(assistant.id);
        const facts = Array.from({ length: 25 }, (_, index) => `fact-${index}`);
        await expect(
          db.mergeConversationSessionState({
            id: conversation.id,
            expectedVersion: 0,
            patch: { memory: [...facts, "fact-24"] },
          })
        ).resolves.toBe(true);
        expect((await db.getConversation(conversation.id))?.sessionState.memory).toEqual(
          facts.slice(-20)
        );
      });

      it("lists messages in append order and cascades on delete", async () => {
        const assistant = await newAssistant();
        const conversation = await newConversation(assistant.id);
        await db.appendMessage({
          conversationId: conversation.id,
          role: "user",
          content: [{ type: "text", text: "first" }],
        });
        const saved = await db.appendMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: [{ type: "text", text: "second" }],
          flowName: "Default behavior",
        });
        const messages = await db.listMessages(conversation.id);
        expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
        expect(messages[1].id).toBe(saved.id);
        expect(messages[1].flowName).toBe("Default behavior");

        await db.deleteConversation(conversation.id);
        expect(await db.listMessages(conversation.id)).toEqual([]);
      });

      it("lists recent messages oldest-first without loading the full transcript", async () => {
        const assistant = await newAssistant();
        const conversation = await newConversation(assistant.id);
        for (let i = 0; i < 5; i++) {
          await db.appendMessage({
            conversationId: conversation.id,
            role: i % 2 === 0 ? "user" : "assistant",
            content: [{ type: "text", text: `message ${i}` }],
          });
        }

        const recent = await db.listRecentMessages(conversation.id, 3);
        expect(
          recent.map((m) => {
            const part = m.content[0] as { text?: string };
            return part.text;
          })
        ).toEqual(["message 2", "message 3", "message 4"]);
      });

      it("pages the Inbox at the data seam and continues from an opaque cursor", async () => {
        const assistant = await newAssistant();
        const created = [];
        for (let i = 0; i < 3; i++) {
          created.push(
            await db.createConversation({
              assistantId: assistant.id,
              subjectType: "visitor",
              subjectId: `paged-visitor-${i}`,
              title: `Paged conversation ${i}`,
            })
          );
        }

        const first = await db.getInboxPage(ctx.organizationId, {
          assistantId: assistant.id,
          limit: 2,
        });
        expect(first.conversations).toHaveLength(2);
        expect(first.nextCursor).toEqual(expect.any(String));

        const second = await db.getInboxPage(ctx.organizationId, {
          assistantId: assistant.id,
          limit: 2,
          cursor: first.nextCursor,
        });
        expect(second.conversations).toHaveLength(1);
        expect(second.nextCursor).toBeNull();
        expect(
          new Set([...first.conversations, ...second.conversations].map((c) => c.id))
        ).toEqual(new Set(created.map((c) => c.id)));
        for (const conversation of first.conversations) {
          expect("sessionState" in conversation).toBe(false);
        }
      });

      it("keeps Inbox facets independent from the current page", async () => {
        const assistant = await newAssistant();
        const conversation = await db.createConversation({
          assistantId: assistant.id,
          subjectType: "visitor",
          subjectId: "facet-visitor",
          title: "Facet conversation",
          metadata: {
            location: "Italy",
            city: "Rome",
            userRole: "Student",
            language: "it",
          },
        });
        await db.appendMessage({
          conversationId: conversation.id,
          role: "assistant",
          flowName: "Admissions",
          content: [{ type: "text", text: "Welcome" }],
        });

        await expect(db.getInboxFacets(ctx.organizationId)).resolves.toMatchObject({
          locations: expect.arrayContaining(["Italy"]),
          cities: expect.arrayContaining(["Rome"]),
          roles: expect.arrayContaining(["Student"]),
          languages: expect.arrayContaining(["it"]),
          workflows: expect.arrayContaining(["Admissions"]),
        });
      });

      it("preserves derived subject search and treats SQL wildcard characters literally", async () => {
        const assistant = await newAssistant();
        const visitor = await db.createConversation({
          assistantId: assistant.id,
          subjectType: "visitor",
          subjectId: "anonymous-search-subject",
          title: "Ordinary title",
        });
        const literal = await db.createConversation({
          assistantId: assistant.id,
          subjectType: "visitor",
          subjectId: "literal-search-subject",
          title: "100% ready",
        });

        const bySubject = await db.getInboxPage(ctx.organizationId, {
          search: "Visitor",
          limit: 100,
        });
        expect(bySubject.conversations.map((row) => row.id)).toContain(visitor.id);

        const byLiteral = await db.getInboxPage(ctx.organizationId, {
          search: "%",
          limit: 100,
        });
        expect(byLiteral.conversations.map((row) => row.id)).toContain(literal.id);
        expect(byLiteral.conversations.map((row) => row.id)).not.toContain(visitor.id);
      });

      it("applies Inbox filters in both database adapters", async () => {
        const assistant = await newAssistant();
        const match = await db.createConversation({
          assistantId: assistant.id,
          subjectType: "visitor",
          subjectId: "unique-filter-subject",
          title: "Filter target",
          metadata: {
            location: "Filterland",
            city: "Filter City",
            userRole: "filter-role",
            language: "filter-language",
            escalated: true,
          },
        });
        const answer = await db.appendMessage({
          conversationId: match.id,
          role: "assistant",
          flowName: "Filter workflow",
          content: [{ type: "text", text: "Matched" }],
        });
        await db.setMessageFeedback(answer.id, 1);
        const staff = await db.createConversation({
          assistantId: assistant.id,
          subjectType: "member",
          subjectId: "staff-filter-subject",
          title: "Staff target",
        });

        const filtered = await db.getInboxPage(ctx.organizationId, {
          assistantId: assistant.id,
          userInfo: "unique-filter",
          location: "Filterland",
          city: "Filter City",
          role: "filter-role",
          language: "filter-language",
          workflow: "Filter workflow",
          conversationIds: [match.id],
          feedback: "up",
          escalation: "escalated",
          staff: "include",
          limit: 100,
        });
        expect(filtered.conversations.map((row) => row.id)).toEqual([match.id]);

        const defaultPopulation = await db.getInboxPage(ctx.organizationId, {
          conversationIds: [staff.id],
          limit: 100,
        });
        expect(defaultPopulation.conversations).toEqual([]);
        const staffOnly = await db.getInboxPage(ctx.organizationId, {
          conversationIds: [staff.id],
          staff: "only",
          limit: 100,
        });
        expect(staffOnly.conversations.map((row) => row.id)).toEqual([staff.id]);
      });

      it("loads one Inbox review through one behavioural interface", async () => {
        const assistant = await newAssistant();
        const conversation = await newConversation(assistant.id);
        const answer = await db.appendMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: [{ type: "text", text: "answer under review" }],
        });
        const improvement = await db.createImprovement(ctx.organizationId, {
          title: "Review the answer",
          messageId: answer.id,
        });
        await db.recordAnswerVerdict({
          messageId: answer.id,
          organizationId: ctx.organizationId,
          assistantId: assistant.id,
          flowId: null,
          verdict: "fail",
          reason: "Unsupported",
          modelId: "contract-test",
        });

        const review = await db.getInboxConversationReview(conversation.id);
        expect(review.messages.map((m) => m.id)).toContain(answer.id);
        expect(review.improvementLinks).toContainEqual(
          expect.objectContaining({
            messageId: answer.id,
            improvementId: improvement.id,
          })
        );
        expect(review.answerVerdicts).toContainEqual(
          expect.objectContaining({ messageId: answer.id, verdict: "fail" })
        );
      });

      it("round-trips a turn trace and defaults it to null", async () => {
        const assistant = await newAssistant();
        const conversation = await newConversation(assistant.id);
        const withTrace = await db.appendMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: [{ type: "text", text: "traced answer" }],
          flowName: "Default behavior",
          trace: {
            searchCount: 2,
            truncated: true,
            steps: [
              {
                id: "step-1",
                kind: "step",
                label: "Classifying intent",
                stage: "classify",
                status: "done",
                detail: "Matched flow “Default behavior”",
              },
              {
                id: "call-1",
                kind: "tool",
                tool: "searchKnowledge",
                label: "Searching knowledge",
                input: { query: "opening hours" },
                status: "done",
                detail: "3 concepts found",
                durationMs: 120,
              },
            ],
          },
        });
        // A turn that did no agentic work stores nothing rather than an empty
        // trace, so the Inbox renders no panel for it.
        const withoutTrace = await db.appendMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: [{ type: "text", text: "verbatim answer" }],
        });

        expect(withTrace.trace?.searchCount).toBe(2);
        expect(withTrace.trace?.truncated).toBe(true);
        expect(withoutTrace.trace).toBeNull();

        // The transcript read is what the Inbox actually renders from.
        const messages = await db.listMessages(conversation.id);
        const reread = messages.find((m) => m.id === withTrace.id);
        expect(reread?.trace?.steps).toHaveLength(2);
        expect(reread?.trace?.steps[1]).toMatchObject({
          id: "call-1",
          kind: "tool",
          tool: "searchKnowledge",
          input: { query: "opening hours" },
          durationMs: 120,
        });
        expect(
          messages.find((m) => m.id === withoutTrace.id)?.trace
        ).toBeNull();
      });

      it("toggles pinned", async () => {
        const assistant = await newAssistant();
        const conversation = await newConversation(assistant.id);
        expect(conversation.pinned).toBe(false);
        await db.setConversationPinned(conversation.id, true);
        expect((await db.getConversation(conversation.id))?.pinned).toBe(true);
      });

      it("sweeps expired traces per organization, keeping the message (#573)", async () => {
        const assistant = await newAssistant();
        const conversation = await newConversation(assistant.id);
        const traced = await db.appendMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: [{ type: "text", text: "traced answer" }],
          trace: {
            searchCount: 1,
            steps: [
              {
                id: "call-1",
                kind: "tool",
                tool: "searchKnowledge",
                label: "Searching knowledge",
                status: "done",
              },
            ],
          },
        });
        const futureCutoff = new Date(Date.now() + 86_400_000).toISOString();
        try {
          // Opting in surfaces the org to the cron sweep; keep-forever orgs
          // are never returned.
          await db.updateOrganization(ctx.organizationId, {
            traceRetentionDays: 30,
          });
          expect(await db.listTraceRetentionPolicies()).toContainEqual({
            organizationId: ctx.organizationId,
            retentionDays: 30,
          });

          // One org's sweep never touches another's traces.
          expect(
            await db.clearExpiredTraces(ctx.foreignOrganizationId, futureCutoff)
          ).toBe(0);
          expect(
            (await db.listMessages(conversation.id)).find(
              (m) => m.id === traced.id
            )?.trace
          ).not.toBeNull();

          const cleared = await db.clearExpiredTraces(
            ctx.organizationId,
            futureCutoff
          );
          expect(cleared).toBeGreaterThanOrEqual(1);
          const reread = (await db.listMessages(conversation.id)).find(
            (m) => m.id === traced.id
          );
          // Only the trace payload goes; the bubble survives the sweep.
          expect(reread?.trace).toBeNull();
          expect(reread?.content).toEqual([
            { type: "text", text: "traced answer" },
          ]);
          expect(reread?.createdAt).toBe(traced.createdAt);

          // Idempotent: a cleared trace never matches again.
          expect(
            await db.clearExpiredTraces(ctx.organizationId, futureCutoff)
          ).toBe(0);
        } finally {
          await db.updateOrganization(ctx.organizationId, {
            traceRetentionDays: null,
          });
        }
        expect(await db.listTraceRetentionPolicies()).toEqual([]);
      });
    });

    describe("improvements", () => {
      it("assigns a monotonic per-org seq and links the flagged message", async () => {
        const assistant = await newAssistant();
        const conversation = await db.createConversation({
          assistantId: assistant.id,
          subjectType: "visitor",
          subjectId: "visitor-contract",
        });
        const message = await db.appendMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: [{ type: "text", text: "flagged answer" }],
        });

        const first = await db.createImprovement(ctx.organizationId, {
          title: "First item",
          messageId: message.id,
        });
        const second = await db.createImprovement(ctx.organizationId, {
          title: "Second item",
        });
        expect(second.seq).toBe(first.seq + 1);
        expect(first.status).toBe("to_do");

        const links = await db.listImprovementMessages(first.id);
        expect(links.some((l) => l.messageId === message.id)).toBe(true);

        await db.unlinkImprovementMessage(first.id, message.id);
        expect(await db.listImprovementMessages(first.id)).toEqual([]);
      });

      it("pages Improvements by their monotonic sequence", async () => {
        await db.createImprovement(ctx.organizationId, { title: "Page one" });
        await db.createImprovement(ctx.organizationId, { title: "Page two" });
        const first = await db.listImprovementsPage(ctx.organizationId, {
          limit: 1,
        });
        const second = await db.listImprovementsPage(ctx.organizationId, {
          limit: 1,
          cursor: first.nextCursor,
        });
        expect(first.items).toHaveLength(1);
        expect(second.items).toHaveLength(1);
        expect(second.items[0]?.seq).toBeLessThan(first.items[0]!.seq);
      });

      it("patches status/priority and bumps updatedAt semantics", async () => {
        const improvement = await db.createImprovement(ctx.organizationId, {
          title: "Patch me",
        });
        const updated = await db.updateImprovement(improvement.id, {
          status: "done",
          priority: "high",
        });
        expect(updated).toMatchObject({
          status: "done",
          priority: "high",
          title: "Patch me",
        });
      });

      it("files an improvement under a project, and detaches on delete", async () => {
        const project = await db.table("projects").insert({
          organizationId: ctx.organizationId,
          name: "Atlas",
          description: "",
          createdBy: null,
        });
        const improvement = await db.createImprovement(ctx.organizationId, {
          title: "Belongs to Atlas",
        });
        // Most Improvements are org-wide work, so the column starts empty.
        expect(improvement.projectId).toBeNull();

        const filed = await db.updateImprovement(improvement.id, {
          projectId: project.id,
        });
        expect(filed.projectId).toBe(project.id);

        // `on delete set null`: what was wrong with an answer outlives the
        // project it was filed under.
        await db.table("projects").delete(project.id);
        expect((await db.getImprovement(improvement.id))?.projectId).toBeNull();
      });

      it("loads Improvement associations progressively", async () => {
        const assistant = await newAssistant();
        const conversation = await db.createConversation({
          assistantId: assistant.id,
          subjectType: "visitor",
          subjectId: "paged-associations",
        });
        const messages = await Promise.all(
          ["first", "second"].map((text) =>
            db.appendMessage({
              conversationId: conversation.id,
              role: "assistant",
              content: [{ type: "text", text }],
            })
          )
        );
        const improvement = await db.createImprovement(ctx.organizationId, {
          title: "Paged associations",
          messageId: messages[0].id,
        });
        await db.linkImprovementMessage(improvement.id, messages[1].id);

        const first = await db.getImprovementAssociationPage(improvement.id, {
          limit: 1,
        });
        const second = await db.getImprovementAssociationPage(improvement.id, {
          offset: first.nextOffset ?? 0,
          limit: 1,
        });
        expect(first.total).toBe(2);
        expect(first.associations).toHaveLength(1);
        expect(first.nextOffset).toBe(1);
        expect(second.associations).toHaveLength(1);
        expect(second.nextOffset).toBeNull();
        expect(second.associations[0]?.messageId).not.toBe(
          first.associations[0]?.messageId
        );
      });
    });

    describe("website source re-crawl schedule", () => {
      it("defaults schedule to never / lastCrawledAt to null, patches each independently", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Schedule Collection",
        });
        const source = await db.createSource({
          collectionId: collection.id,
          name: "Uni site",
          kind: "website",
          config: { url: "https://uni.edu" },
        });
        // Creation defaults.
        expect(source.recrawlSchedule).toBe("never");
        expect(source.lastCrawledAt).toBeNull();

        // Schedule patch does not invent a last-crawl timestamp.
        await db.updateSource(source.id, { recrawlSchedule: "weekly" });
        let read = await db.getSource(source.id);
        expect(read?.recrawlSchedule).toBe("weekly");
        expect(read?.lastCrawledAt).toBeNull();

        // last-crawl patch is independent and survives an unrelated patch.
        const at = "2026-07-01T09:00:00.000Z";
        await db.updateSource(source.id, { lastCrawledAt: at });
        await db.updateSource(source.id, { name: "Renamed site" });
        read = await db.getSource(source.id);
        expect(read?.name).toBe("Renamed site");
        expect(read?.recrawlSchedule).toBe("weekly"); // untouched
        expect(read?.lastCrawledAt).toBe(at); // untouched by rename
      });
    });

    describe("due re-crawl claims", () => {
      const NOW = "2026-07-11T12:00:00.000Z";

      const readySource = async (
        recrawlSchedule: "daily" | "weekly" | "monthly" | "never",
        lastCrawledAt: string | null,
        status: "ready" | "processing" = "ready"
      ) => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Due sweep",
        });
        const source = await db.createSource({
          collectionId: collection.id,
          name: "Scheduled site",
          kind: "website",
          config: {
            url: "https://sweep.edu",
            crawlRunId: "prev-run",
            crawlDatasetId: "prev-dataset",
            resolvedCrawlerProvider: "local",
          },
          recrawlSchedule,
        });
        // The claim's routing assistant derives from the earliest link (#733).
        await db.setSourceAssistantLinks(source.id, [assistant.id]);
        await db.updateSource(source.id, { status, lastCrawledAt });
        return { assistant, collection, source };
      };

      it("selects exactly the due Sources, honoring cadence and excluding never/uncrawled", async () => {
        const daily = await readySource("daily", "2026-07-09T12:00:00.000Z"); // 2d ago â†’ due
        const weekly = await readySource("weekly", "2026-07-08T12:00:00.000Z"); // 3d ago â†’ not due
        const monthly = await readySource("monthly", "2026-06-01T12:00:00.000Z"); // 40d ago â†’ due
        const never = await readySource("never", "2026-01-01T12:00:00.000Z"); // opted out
        const uncrawled = await readySource("daily", null); // never crawled â†’ excluded
        const processing = await readySource(
          "daily",
          "2026-07-01T12:00:00.000Z",
          "processing"
        ); // already crawling â†’ skipped

        const claimed = await db.claimDueRecrawlSources({ now: NOW, limit: 100 });
        const ids = new Set(claimed.map((row) => row.sourceId));

        expect(ids.has(daily.source.id)).toBe(true);
        expect(ids.has(monthly.source.id)).toBe(true);
        expect(ids.has(weekly.source.id)).toBe(false);
        expect(ids.has(never.source.id)).toBe(false);
        expect(ids.has(uncrawled.source.id)).toBe(false);
        expect(ids.has(processing.source.id)).toBe(false);

        // The claim carries the routing keys the sweep hands to the pipeline.
        const dailyClaim = claimed.find((row) => row.sourceId === daily.source.id);
        expect(dailyClaim).toMatchObject({
          collectionId: daily.collection.id,
          assistantId: daily.assistant.id,
        });
      });

      it("flips a claimed Source to processing and clears the prior run, so a re-run does not double-crawl", async () => {
        const { source } = await readySource("daily", "2026-07-09T12:00:00.000Z");

        const first = await db.claimDueRecrawlSources({ now: NOW, limit: 100 });
        expect(first.some((row) => row.sourceId === source.id)).toBe(true);

        const afterClaim = await db.getSource(source.id);
        expect(afterClaim?.status).toBe("processing");
        expect(afterClaim?.config.crawlRunId).toBeUndefined();
        expect(afterClaim?.config.crawlDatasetId).toBeUndefined();
        // last_crawled_at stays put until the fresh crawl finalizes.
        expect(afterClaim?.lastCrawledAt).toBe("2026-07-09T12:00:00.000Z");

        const second = await db.claimDueRecrawlSources({ now: NOW, limit: 100 });
        expect(second.some((row) => row.sourceId === source.id)).toBe(false);
      });
    });

    describe("per-page re-crawl override", () => {
      it("defaults concept schedule to null (inherit) and toggles it", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Page Schedule Collection",
        });
        const concept = await db.createConcept({
          collectionId: collection.id,
          sourceId: null,
          path: "web/page.md",
          frontmatter: { type: "Web Page", title: "A page" },
          body: "content",
        });
        expect(concept.recrawlSchedule).toBeNull(); // inherit by default

        await db.setConceptRecrawlSchedule(concept.id, "daily");
        expect((await db.getConcept(concept.id))?.recrawlSchedule).toBe("daily");

        // null clears the override back to inheriting the site schedule.
        await db.setConceptRecrawlSchedule(concept.id, null);
        expect((await db.getConcept(concept.id))?.recrawlSchedule).toBeNull();
      });
    });

    describe("targeted Concept deletion (atomic crawl replacement)", () => {
      it("deletes exactly the given Concepts and their chunks, leaving the rest", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Targeted Delete Collection",
        });
        const source = await db.createSource({
          collectionId: collection.id,
          name: "Targeted Delete Source",
          kind: "website",
          config: { url: "https://x.edu" },
        });
        const make = async (path: string) => {
          const concept = await db.createConcept({
            collectionId: collection.id,
            sourceId: source.id,
            path,
            frontmatter: { type: "Web Page", title: path },
            body: "content",
          });
          await db.saveChunks([
            {
              conceptId: concept.id,
              collectionId: collection.id,
              content: `chunk for ${path}`,
              embedding: null,
            },
          ]);
          return concept;
        };
        const keep = await make("web/keep.md");
        const dropA = await make("web/drop-a.md");
        const dropB = await make("web/drop-b.md");

        await db.deleteConceptsByIds([dropA.id, dropB.id]);

        const remaining = await db.listConcepts(collection.id);
        expect(remaining.map((c) => c.id)).toEqual([keep.id]);
        // Chunks of the deleted Concepts are gone; the survivor's are retained.
        expect(await db.getConcept(dropA.id)).toBeNull();
        const results = await db.searchChunks(assistant.id, collection.id, {
          embedding: null,
          text: "chunk",
        });
        expect(results.every((r) => r.conceptId === keep.id)).toBe(true);
      });

      it("ignores unknown ids and treats an empty list as a no-op", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "No-op Delete Collection",
        });
        const concept = await db.createConcept({
          collectionId: collection.id,
          sourceId: null,
          path: "web/survivor.md",
          frontmatter: { type: "Web Page", title: "Survivor" },
          body: "content",
        });

        await db.deleteConceptsByIds([]);
        await db.deleteConceptsByIds(["missing-1", "missing-2"]);

        expect((await db.listConcepts(collection.id)).map((c) => c.id)).toEqual([
          concept.id,
        ]);
      });
    });

    describe("org-level knowledge hub (PRD #726)", () => {
      /** Org-owned fixture: assistant + collection + one source of a kind. */
      const newKnowledgeFixture = async (
        kind: "website" | "file" | "faq",
        name: string
      ) => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: `${name} Collection`,
        });
        const source = await db.createSource({
          collectionId: collection.id,
          name,
          kind,
          config: kind === "website" ? { url: "https://hub.example" } : {},
        });
        // Post-contract there is no implicit link (createSource stopped
        // auto-linking): the fixture links explicitly, like the ops layer.
        await db.setSourceAssistantLinks(source.id, [assistant.id]);
        return { assistant, collection, source };
      };

      it("lists every Collection the Organization owns, linked or not (#768)", async () => {
        // `listCollections` answers "what does this Assistant search"; the
        // Library as a whole is a different question, and the Teammate scope
        // picker asks that one.
        const { collection } = await newKnowledgeFixture("file", "Hub Listing");
        const assistant = await newAssistant();
        const unlinked = await db.createCollection(assistant.id, {
          name: "Nothing links here",
        });

        const all = await db.listOrgCollections(ctx.organizationId);
        expect(all.map((c) => c.id)).toEqual(
          expect.arrayContaining([collection.id, unlinked.id])
        );
        expect(await db.listCollections(assistant.id)).toEqual([]);
        expect(
          await db.listOrgCollections(ctx.missingOrganizationId)
        ).toEqual([]);
      });

      it("gets-or-creates the per-org Knowledge Library exactly once", async () => {
        const first = await db.getOrCreateOrgLibraryCollection(
          ctx.organizationId
        );
        expect(first.organizationId).toBe(ctx.organizationId);
        expect(first.name).toBe("Knowledge Library");
        const second = await db.getOrCreateOrgLibraryCollection(
          ctx.organizationId
        );
        expect(second.id).toBe(first.id);
      });

      it("stamps the Organization onto new Collections", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Org Stamp Collection",
        });
        expect(collection.organizationId).toBe(ctx.organizationId);
        expect((await db.getCollection(collection.id))?.organizationId).toBe(
          ctx.organizationId
        );
      });

      it("lists per-kind tabs with search, status filter, and pagination", async () => {
        const site = await newKnowledgeFixture("website", "Hub Site Alpha");
        const file = await newKnowledgeFixture("file", "Hub File Beta");
        await db.updateSource(file.source.id, { status: "ready" });

        const websites = await db.listOrgKnowledgeSources(ctx.organizationId, {
          kinds: ["website", "url"],
          query: "hub site",
        });
        expect(websites.items.map((i) => i.id)).toContain(site.source.id);
        expect(websites.items.map((i) => i.id)).not.toContain(file.source.id);

        const readyFiles = await db.listOrgKnowledgeSources(
          ctx.organizationId,
          { kinds: ["file", "text"], status: "ready", query: "hub file" }
        );
        expect(readyFiles.items.map((i) => i.id)).toEqual([file.source.id]);
        // Status tallies cover every matching row (the tab health dot).
        expect(readyFiles.statusCounts).toEqual({
          processing: 0,
          ready: 1,
          error: 0,
        });
        const processingFiles = await db.listOrgKnowledgeSources(
          ctx.organizationId,
          { kinds: ["file", "text"], status: "processing", query: "hub file" }
        );
        expect(processingFiles.items).toEqual([]);

        const pageOne = await db.listOrgKnowledgeSources(ctx.organizationId, {
          kinds: ["website", "url", "file", "text", "faq"],
          query: "hub",
          page: 1,
          pageSize: 1,
        });
        expect(pageOne.items).toHaveLength(1);
        expect(pageOne.total).toBeGreaterThanOrEqual(2);
      });

      it("filters by linked assistant and counts Concepts", async () => {
        const { assistant, collection, source } = await newKnowledgeFixture(
          "website",
          "Hub Linked Site"
        );
        const other = await newAssistant();
        await db.setSourceAssistantLinks(source.id, [assistant.id]);
        await db.createConcept({
          collectionId: collection.id,
          sourceId: source.id,
          path: "hub/page.md",
          frontmatter: { type: "Web Page", title: "Page" },
          body: "content",
        });

        const linked = await db.listOrgKnowledgeSources(ctx.organizationId, {
          kinds: ["website", "url"],
          assistantId: assistant.id,
          query: "hub linked site",
        });
        expect(linked.items.map((i) => i.id)).toEqual([source.id]);
        expect(linked.items[0].conceptCount).toBe(1);
        expect(linked.items[0].linkedAssistants.map((l) => l.assistantId)).toEqual(
          [assistant.id]
        );
        expect(linked.items[0].linkedAssistants[0].assistantName).toBe(
          assistant.title
        );

        const unlinked = await db.listOrgKnowledgeSources(ctx.organizationId, {
          kinds: ["website", "url"],
          assistantId: other.id,
          query: "hub linked site",
        });
        expect(unlinked.items).toEqual([]);
      });

      it("never surfaces another organization's rows", async () => {
        await newKnowledgeFixture("website", "Hub Tenancy Site");
        const foreign = await db.listOrgKnowledgeSources(
          ctx.foreignOrganizationId,
          { kinds: ["website", "url", "file", "text", "faq"] }
        );
        expect(
          foreign.items.filter((i) => i.name === "Hub Tenancy Site")
        ).toEqual([]);
      });

      it("creates Sources without implicit links (the ops layer links explicitly)", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Hub No-Autolink Collection",
        });
        const source = await db.createSource({
          collectionId: collection.id,
          name: "Hub No-Autolink Site",
          kind: "website",
          config: { url: "https://hub.example" },
        });
        expect(await db.listSourceAssistantLinks(source.id)).toEqual([]);
      });

      it("lists an assistant's linked Source ids, never its Collection's", async () => {
        const { assistant, collection, source } = await newKnowledgeFixture(
          "file",
          "Reach File"
        );
        // A second Source in the SAME org-owned Collection, linked to nobody:
        // collection membership must not put it in this assistant's corpus.
        const unlinked = await db.createSource({
          collectionId: collection.id,
          name: "Someone else's file",
          kind: "file",
        });
        expect(await db.listAssistantSourceIds(assistant.id)).toEqual([
          source.id,
        ]);

        await db.setSourceAssistantLinks(unlinked.id, [assistant.id]);
        expect(
          (await db.listAssistantSourceIds(assistant.id)).sort()
        ).toEqual([source.id, unlinked.id].sort());

        await db.setSourceAssistantLinks(source.id, []);
        expect(await db.listAssistantSourceIds(assistant.id)).toEqual([
          unlinked.id,
        ]);
      });

      it("replaces the linked-assistant set, preserving Direct access on kept links", async () => {
        const { assistant, source } = await newKnowledgeFixture(
          "file",
          "Hub Direct File"
        );
        const second = await newAssistant();
        await db.setSourceAssistantLinks(source.id, [assistant.id, second.id]);

        let links = await db.listSourceAssistantLinks(source.id);
        expect(links.map((l) => l.assistantId).sort()).toEqual(
          [assistant.id, second.id].sort()
        );
        // Direct access defaults off on every new link.
        expect(links.every((l) => l.directAccess === false)).toBe(true);

        await db.setSourceDirectAccess(source.id, assistant.id, true);
        await db.setSourceAssistantLinks(source.id, [assistant.id]);
        links = await db.listSourceAssistantLinks(source.id);
        expect(links).toHaveLength(1);
        // The kept link survived the replace with its flag intact.
        expect(links[0].assistantId).toBe(assistant.id);
        expect(links[0].directAccess).toBe(true);

        // Re-adding a dropped link starts it clean again.
        await db.setSourceAssistantLinks(source.id, [assistant.id, second.id]);
        links = await db.listSourceAssistantLinks(source.id);
        expect(
          links.find((l) => l.assistantId === second.id)?.directAccess
        ).toBe(false);
      });

      it("serializes concurrent linked-assistant set replacements", async () => {
        const { assistant, source } = await newKnowledgeFixture(
          "file",
          "Concurrent Link File"
        );
        const second = await newAssistant();
        await db.setSourceAssistantLinks(source.id, []);

        await Promise.all([
          db.setSourceAssistantLinks(source.id, [assistant.id]),
          db.setSourceAssistantLinks(source.id, [second.id]),
        ]);
        const ids = (await db.listSourceAssistantLinks(source.id)).map(
          (link) => link.assistantId
        );
        expect([[assistant.id], [second.id]]).toContainEqual(ids);
      });

      it("answers for every linked assistant and stops on unlink", async () => {
        const { assistant, collection, source } = await newKnowledgeFixture(
          "file",
          "Hub Shared File"
        );
        const second = await newAssistant();
        const concept = await db.createConcept({
          collectionId: collection.id,
          sourceId: source.id,
          path: "hub/shared.md",
          frontmatter: { type: "Note", title: "Shared" },
          body: "zebra migration corridors",
        });
        await db.saveChunks([
          {
            conceptId: concept.id,
            collectionId: collection.id,
            sourceId: source.id,
            content: "zebra migration corridors cross the plain",
            embedding: null,
          },
        ]);
        await db.setSourceAssistantLinks(source.id, [assistant.id, second.id]);

        const query = { embedding: null, text: "zebra corridors" };
        const forOwner = await db.searchChunks(assistant.id, null, query);
        expect(forOwner.map((r) => r.conceptId)).toContain(concept.id);
        const forSecond = await db.searchChunks(second.id, null, query);
        expect(forSecond.map((r) => r.conceptId)).toContain(concept.id);

        await db.setSourceAssistantLinks(source.id, [assistant.id]);
        const afterUnlink = await db.searchChunks(second.id, null, query);
        expect(afterUnlink.map((r) => r.conceptId)).not.toContain(concept.id);
      });

      it("keeps source-less chunks out of retrieval (link-only contract)", async () => {
        const { assistant, collection, source } = await newKnowledgeFixture(
          "file",
          "Hub Legacy File"
        );
        const concept = await db.createConcept({
          collectionId: collection.id,
          sourceId: source.id,
          path: "hub/legacy.md",
          frontmatter: { type: "Note", title: "Legacy" },
          body: "quokka habitat notes",
        });
        // A source-less chunk cannot ride a link, so post-contract it is
        // unreachable by design (the contract migration re-keys real rows).
        await db.saveChunks([
          {
            conceptId: concept.id,
            collectionId: collection.id,
            content: "quokka habitat notes for rangers",
            embedding: null,
          },
        ]);
        const query = { embedding: null, text: "quokka habitat" };
        const orphaned = await db.searchChunks(assistant.id, null, query);
        expect(orphaned.map((r) => r.conceptId)).not.toContain(concept.id);

        // Re-keyed onto its Source (what the migration does), it answers.
        await db.saveChunks([
          {
            conceptId: concept.id,
            collectionId: collection.id,
            sourceId: source.id,
            content: "quokka habitat notes for rangers",
            embedding: null,
          },
        ]);
        const rekeyed = await db.searchChunks(assistant.id, null, query);
        expect(rekeyed.map((r) => r.conceptId)).toContain(concept.id);
      });

      it("marks search results direct-access only for flagged file links", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Hub Access Collection",
        });
        const source = await db.createSource({
          collectionId: collection.id,
          name: "Hub Access File",
          kind: "file",
          originalObjectPath: "org/x/access.pdf",
        });
        await db.setSourceAssistantLinks(source.id, [assistant.id]);
        const concept = await db.createConcept({
          collectionId: collection.id,
          sourceId: source.id,
          path: "files/access.md",
          frontmatter: { type: "Document", title: "Access" },
          body: "wombat burrow depths",
        });
        await db.saveChunks([
          {
            conceptId: concept.id,
            collectionId: collection.id,
            sourceId: source.id,
            content: "wombat burrow depths measured",
            embedding: null,
          },
        ]);

        const query = { embedding: null, text: "wombat burrow" };
        const before = await db.searchChunks(assistant.id, null, query);
        const hitBefore = before.find((r) => r.conceptId === concept.id);
        expect(hitBefore?.sourceId).toBe(source.id);
        expect(hitBefore?.directAccess).toBe(false);

        await db.setSourceDirectAccess(source.id, assistant.id, true);
        const after = await db.searchChunks(assistant.id, null, query);
        const hitAfter = after.find((r) => r.conceptId === concept.id);
        expect(hitAfter?.directAccess).toBe(true);
      });

      it("round-trips the faq kind: Source + Concept, findFaqConcept unchanged", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Hub FAQ Collection",
        });
        const question = "How do I reset my hub password?";
        const source = await db.createSource({
          collectionId: collection.id,
          name: question,
          kind: "faq",
        });
        await db.setSourceAssistantLinks(source.id, [assistant.id]);
        await db.createConcept({
          collectionId: collection.id,
          sourceId: source.id,
          path: "faq/reset-password.md",
          frontmatter: { type: "FAQ", title: question },
          body: "Use the reset link on the sign-in page.",
        });

        const found = await db.findFaqConcept(assistant.id, question);
        expect(found?.concept.frontmatter.title).toBe(question);
        expect(found?.collectionName).toBe("Hub FAQ Collection");

        const faqs = await db.listOrgKnowledgeSources(ctx.organizationId, {
          kinds: ["faq"],
          query: "hub password",
        });
        expect(faqs.items.map((i) => i.id)).toEqual([source.id]);
        expect(faqs.items[0].answerPreview).toContain("reset link");

        // The org-wide export sees the FULL answer, not the table preview.
        const entries = await db.listOrgFaqs(ctx.organizationId);
        const entry = entries.find((e) => e.sourceId === source.id);
        expect(entry?.question).toBe(question);
        expect(entry?.answer).toBe("Use the reset link on the sign-in page.");
      });

      it("lists a Source's Concepts path-ordered and bounded", async () => {
        const { collection, source } = await newKnowledgeFixture(
          "website",
          "Hub Pages Site"
        );
        for (const path of ["web/b.md", "web/a.md", "web/c.md"]) {
          await db.createConcept({
            collectionId: collection.id,
            sourceId: source.id,
            path,
            frontmatter: { type: "Web Page", title: path },
            body: "content",
          });
        }
        const all = await db.listConceptsBySource(source.id);
        expect(all.map((c) => c.path)).toEqual([
          "web/a.md",
          "web/b.md",
          "web/c.md",
        ]);
        const bounded = await db.listConceptsBySource(source.id, 2);
        expect(bounded.map((c) => c.path)).toEqual(["web/a.md", "web/b.md"]);
      });

      it("pages active Concepts by a stable id cursor", async () => {
        const { collection, source } = await newKnowledgeFixture(
          "file",
          "Paged graph inventory",
        );
        const created = await Promise.all(
          ["one", "two", "three"].map((name) => db.createConcept({
            collectionId: collection.id,
            sourceId: source.id,
            path: `paged/${name}.md`,
            frontmatter: { type: "Document", title: name },
            body: name,
          })),
        );
        const expected = created.map((concept) => concept.id).sort();
        const first = await db.listConceptPage(collection.id, { limit: 2 });
        const second = await db.listConceptPage(collection.id, {
          afterId: first.at(-1)!.id,
          limit: 2,
        });
        expect([...first, ...second].map((concept) => concept.id)).toEqual(expected);
      });
    });

    describe("knowledge search (lexical fallback)", () => {
      it("ranks by term hits, scopes by assistant + collection, respects limit", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Contract Collection",
        });
        const source = await db.createSource({
          collectionId: collection.id,
          name: "Contract Topic",
          kind: "text",
        });
        await db.setSourceAssistantLinks(source.id, [assistant.id]);
        const concept = await db.createConcept({
          collectionId: collection.id,
          sourceId: source.id,
          path: "contract/topic.md",
          frontmatter: { type: "Note", title: "Enrollment deadlines" },
          body: "Enrollment closes in September.",
        });
        await db.saveChunks([
          {
            conceptId: concept.id,
            collectionId: collection.id,
            sourceId: source.id,
            content: "Enrollment closes in September for all programs.",
            embedding: null,
          },
          {
            conceptId: concept.id,
            collectionId: collection.id,
            sourceId: source.id,
            content: "Cafeteria menu changes weekly.",
            embedding: null,
          },
        ]);

        const results = await db.searchChunks(assistant.id, collection.id, {
          embedding: null,
          text: "when does enrollment close",
          limit: 5,
        });
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].content).toContain("Enrollment");
        expect(results[0].conceptTitle).toBe("Enrollment deadlines");

        const otherAssistant = await newAssistant();
        expect(
          await db.searchChunks(otherAssistant.id, null, {
            embedding: null,
            text: "enrollment",
          })
        ).toEqual([]);
      });

      it("lists concepts with null-embedding chunks for the re-embed backfill (#312)", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Backfill Collection",
        });
        const make = async (path: string, embedding: number[] | null) => {
          const source = await db.createSource({
            collectionId: collection.id,
            name: path,
            kind: "text",
          });
          await db.setSourceAssistantLinks(source.id, [assistant.id]);
          const concept = await db.createConcept({
            collectionId: collection.id,
            sourceId: source.id,
            path,
            frontmatter: { type: "Note", title: path },
            body: "content",
          });
          await db.saveChunks([
            {
              conceptId: concept.id,
              collectionId: collection.id,
              sourceId: source.id,
              content: `chunk for ${path}`,
              embedding,
            },
          ]);
          return concept;
        };
        const missing = await make("backfill/missing.md", null);
        await make(
          "backfill/indexed.md",
          new Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0))
        );
        expect(await db.listNullEmbeddingConceptIds(assistant.id)).toEqual([
          missing.id,
        ]);
      });

      it("finds an FAQ Concept by question, case-insensitively (#313)", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "FAQ Collection",
        });
        const faqSource = await db.createSource({
          collectionId: collection.id,
          name: "What are the opening hours?",
          kind: "faq",
        });
        await db.setSourceAssistantLinks(faqSource.id, [assistant.id]);
        const faq = await db.createConcept({
          collectionId: collection.id,
          sourceId: faqSource.id,
          path: "faq/opening-hours.md",
          frontmatter: { type: "FAQ", title: "What are the opening hours?" },
          body: "We are open 9–17, Monday to Friday.",
        });
        const match = await db.findFaqConcept(
          assistant.id,
          "  what are the OPENING hours?  "
        );
        expect(match?.concept.id).toBe(faq.id);
        expect(match?.collectionName).toBe("FAQ Collection");
        // Another assistant never sees it; non-FAQ titles don't match.
        const other = await newAssistant();
        expect(await db.findFaqConcept(other.id, "What are the opening hours?")).toBeNull();
        expect(await db.findFaqConcept(assistant.id, "unrelated question")).toBeNull();
        // Excluded FAQs stop matching.
        await db.setConceptExcluded(faq.id, true);
        expect(
          await db.findFaqConcept(assistant.id, "What are the opening hours?")
        ).toBeNull();
      });

      it("never surfaces chunks of an excluded Concept (#311)", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Exclusion Collection",
        });
        const source = await db.createSource({
          collectionId: collection.id,
          name: "Old tuition page",
          kind: "text",
        });
        await db.setSourceAssistantLinks(source.id, [assistant.id]);
        const concept = await db.createConcept({
          collectionId: collection.id,
          sourceId: source.id,
          path: "contract/excluded.md",
          frontmatter: { type: "Web Page", title: "Old tuition page" },
          body: "Tuition fees for 2019.",
        });
        await db.saveChunks([
          {
            conceptId: concept.id,
            collectionId: collection.id,
            sourceId: source.id,
            content: "Tuition fees for 2019 were outdated.",
            embedding: null,
          },
        ]);
        await db.setConceptExcluded(concept.id, true);
        expect(
          await db.searchChunks(assistant.id, collection.id, {
            embedding: null,
            text: "tuition fees",
          })
        ).toEqual([]);
        // Restoring the page brings it back.
        await db.setConceptExcluded(concept.id, false);
        expect(
          (
            await db.searchChunks(assistant.id, collection.id, {
              embedding: null,
              text: "tuition fees",
            })
          ).length
        ).toBeGreaterThan(0);
      });
    });

    describe("knowledge search (embedding retrieval)", () => {
      // 1536-dim unit vector along one axis: axis 0 vs axis 1 are orthogonal,
      // so cosine similarity is exactly 1 (same axis) or 0 (different axis).
      const axisEmbedding = (axis: number) => {
        const v = new Array<number>(1536).fill(0);
        v[axis] = 1;
        return v;
      };

      // Post-contract, retrieval is purely link-based: every Concept rides a
      // Source, linked explicitly to its assistant (reach is link-only).
      const seedChunk = async (
        assistantId: string,
        collectionId: string,
        path: string,
        content: string,
        embedding: number[] | null
      ) => {
        const source = await db.createSource({
          collectionId,
          name: path,
          kind: "text",
        });
        await db.setSourceAssistantLinks(source.id, [assistantId]);
        const concept = await db.createConcept({
          collectionId,
          sourceId: source.id,
          path,
          frontmatter: { type: "Web Page", title: path },
          body: content,
        });
        await db.saveChunks([
          {
            conceptId: concept.id,
            collectionId,
            sourceId: source.id,
            content,
            embedding,
          },
        ]);
        return concept;
      };

      it("ranks the closest embedded chunk first and respects the limit", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Vector Collection",
        });
        const near = await seedChunk(
          assistant.id,
          collection.id,
          "vector/near.md",
          "Alpha tuition rates for autumn.",
          axisEmbedding(0)
        );
        const far = await seedChunk(
          assistant.id,
          collection.id,
          "vector/far.md",
          "Beta tuition brochure.",
          axisEmbedding(1)
        );

        const results = await db.searchChunks(assistant.id, collection.id, {
          embedding: axisEmbedding(0),
          text: "alpha tuition rates",
        });
        expect(results.map((r) => r.conceptId)).toEqual([near.id, far.id]);

        const top = await db.searchChunks(assistant.id, collection.id, {
          embedding: axisEmbedding(0),
          text: "alpha tuition rates",
          limit: 1,
        });
        expect(top.map((r) => r.conceptId)).toEqual([near.id]);
      });

      it("scopes embedding retrieval by assistant and collection", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Vector Scope A",
        });
        const sibling = await db.createCollection(assistant.id, {
          name: "Vector Scope B",
        });
        const otherAssistant = await newAssistant();
        const otherCollection = await db.createCollection(otherAssistant.id, {
          name: "Vector Scope Foreign",
        });

        const mine = await seedChunk(
          assistant.id,
          collection.id,
          "scope/mine.md",
          "Alpha campus parking permits.",
          axisEmbedding(0)
        );
        const siblingConcept = await seedChunk(
          assistant.id,
          sibling.id,
          "scope/sibling.md",
          "Alpha campus parking rules.",
          axisEmbedding(0)
        );
        const foreign = await seedChunk(
          otherAssistant.id,
          otherCollection.id,
          "scope/foreign.md",
          "Alpha campus parking permits.",
          axisEmbedding(0)
        );

        // Collection-scoped: only that collection's chunks, however close
        // another collection's embedding is.
        const scoped = await db.searchChunks(assistant.id, collection.id, {
          embedding: axisEmbedding(0),
          text: "alpha campus parking",
        });
        expect(scoped.map((r) => r.conceptId)).toEqual([mine.id]);

        // Unscoped (null collection): the assistant's collections, never
        // another assistant's, even with an identical embedding and content.
        const unscoped = await db.searchChunks(assistant.id, null, {
          embedding: axisEmbedding(0),
          text: "alpha campus parking",
        });
        const ids = new Set(unscoped.map((r) => r.conceptId));
        expect(ids).toEqual(new Set([mine.id, siblingConcept.id]));
        expect(ids.has(foreign.id)).toBe(false);
      });

      it("keeps null-embedding chunks reachable when querying by embedding", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Vector Fallback Collection",
        });
        const unembedded = await seedChunk(
          assistant.id,
          collection.id,
          "fallback/unembedded.md",
          "Scholarship deadlines in March.",
          null
        );

        // Ingested while no embedding provider was available: invisible to
        // vector match, but the lexical safety net still surfaces it.
        const results = await db.searchChunks(assistant.id, collection.id, {
          embedding: axisEmbedding(0),
          text: "scholarship deadlines",
        });
        expect(results.map((r) => r.conceptId)).toEqual([unembedded.id]);
      });

      it("never surfaces an excluded Concept via embedding retrieval", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Vector Exclusion Collection",
        });
        const concept = await seedChunk(
          assistant.id,
          collection.id,
          "excluded/page.md",
          "Alumni donation records.",
          axisEmbedding(0)
        );
        await db.setConceptExcluded(concept.id, true);
        expect(
          await db.searchChunks(assistant.id, collection.id, {
            embedding: axisEmbedding(0),
            text: "alumni donation records",
          })
        ).toEqual([]);
      });
    });

    describe("source knowledge generations", () => {
      it("hides a staged generation until one compare-and-swap commits it", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Generation Collection",
        });
        const source = await db.createSource({
          collectionId: collection.id,
          name: "Versioned source",
          kind: "text",
        });
        const prior = await db.createConcept({
          collectionId: collection.id,
          sourceId: source.id,
          path: "active.md",
          frontmatter: { type: "Document", title: "Active" },
          body: "active",
        });
        const generationId = "00000000-0000-4000-8000-000000000099";
        const staged = await db.createConcept({
          collectionId: collection.id,
          sourceId: source.id,
          generationId,
          path: "staged.md",
          frontmatter: { type: "Document", title: "Staged" },
          body: "staged",
        });
        const retriedStage = await db.createConcept({
          collectionId: collection.id,
          sourceId: source.id,
          generationId,
          path: "staged.md",
          frontmatter: { type: "Document", title: "Staged retry" },
          body: "staged retry",
        });
        expect(retriedStage.id).toBe(staged.id);

        expect((await db.listConcepts(collection.id)).map((c) => c.id)).toEqual([
          prior.id,
        ]);
        await expect(
          db.commitSourceKnowledgeGeneration({
            sourceId: source.id,
            expectedActiveGenerationId: source.activeGenerationId,
            generationId,
          })
        ).resolves.toBe(true);
        expect((await db.listConcepts(collection.id)).map((c) => c.id)).toEqual([
          staged.id,
        ]);
        expect((await db.getConcept(staged.id))?.body).toBe("staged retry");
        const competingGenerationId = "00000000-0000-4000-8000-000000000100";
        const competing = await db.createConcept({
          collectionId: collection.id,
          sourceId: source.id,
          generationId: competingGenerationId,
          path: "competing.md",
          frontmatter: { type: "Document", title: "Competing" },
          body: "competing",
        });
        await expect(
          db.commitSourceKnowledgeGeneration({
            sourceId: source.id,
            expectedActiveGenerationId: source.activeGenerationId,
            generationId: competingGenerationId,
          })
        ).resolves.toBe(false);
        await expect(
          db.deleteSourceKnowledgeGeneration(source.id, competingGenerationId)
        ).resolves.toEqual([competing.id]);
        await expect(
          db.deleteSourceKnowledgeGeneration(source.id, source.activeGenerationId)
        ).resolves.toEqual([prior.id]);
      });

      it("reaps stale inactive generations but preserves resumable work", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Generation Reaper Collection",
        });
        const orphanSource = await db.createSource({
          collectionId: collection.id,
          name: "Orphan generation source",
          kind: "text",
        });
        const orphanGeneration = "00000000-0000-4000-8000-000000000101";
        await db.createConcept({
          collectionId: collection.id,
          sourceId: orphanSource.id,
          generationId: orphanGeneration,
          path: "orphan.md",
          frontmatter: { type: "Document", title: "Orphan" },
          body: "orphan",
        });

        const resumableSource = await db.createSource({
          collectionId: collection.id,
          name: "Resumable generation source",
          kind: "text",
        });
        const resumableGeneration = "00000000-0000-4000-8000-000000000102";
        await db.updateSource(resumableSource.id, {
          config: {
            ...resumableSource.config,
            crawlIngestGenerationId: resumableGeneration,
          },
        });
        await systemDb.createConcept({
          collectionId: collection.id,
          sourceId: resumableSource.id,
          generationId: resumableGeneration,
          path: "resumable.md",
          frontmatter: { type: "Document", title: "Resumable" },
          body: "resumable",
        });

        const report = await systemDb.sweepRuntimeLedgers(
          "2030-01-01T00:00:00.000Z",
          10,
        );
        expect(report.sourceGenerations).toBe(1);
        await expect(
          systemDb.deleteSourceKnowledgeGeneration(
            orphanSource.id,
            orphanGeneration,
          ),
        ).resolves.toEqual([]);
        await expect(
          systemDb.deleteSourceKnowledgeGeneration(
            resumableSource.id,
            resumableGeneration,
          ),
        ).resolves.toHaveLength(1);
      });
    });

    describe("background jobs", () => {
      it("returns the existing ledger row for a repeated stable job id", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Idempotent Job Collection",
        });
        const input = {
          id: `reconcile-${shortId()}`,
          kind: "graph_sync_concept" as const,
          payload: {
            kind: "graph_sync_concept",
            op: "purge",
            collectionId: collection.id,
          },
        };

        const first = await db.createBackgroundJob(input);
        const retry = await db.createBackgroundJob(input);

        expect(retry).toEqual(first);
      });

      it("assigns source-less jobs directly to their organization", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Source-less Job Collection",
        });
        const job = await db.createBackgroundJob({
          kind: "graph_sync_concept",
          payload: {
            kind: "graph_sync_concept",
            op: "purge",
            collectionId: collection.id,
          },
        });

        expect(job.organizationId).toBe(ctx.organizationId);
      });

      it("rejects an explicit tenant that conflicts with a job's domain reference", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Tenant-checked Job Collection",
        });

        await expect(
          db.createBackgroundJob({
            organizationId: ctx.foreignOrganizationId,
            kind: "graph_sync_concept",
            payload: {
              kind: "graph_sync_concept",
              op: "purge",
              collectionId: collection.id,
            },
          })
        ).rejects.toThrow();
      });

      it("rejects a secondary payload reference from another tenant", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Secondary-reference Job Collection",
        });

        await expect(
          db.createBackgroundJob({
            organizationId: ctx.organizationId,
            kind: "ingest_source",
            payload: {
              kind: "ingest_source",
              assistantId: ctx.foreignAssistantId,
              collectionId: collection.id,
            },
          })
        ).rejects.toThrow();
      });

      it("rejects a Concept paired with a different Collection", async () => {
        const assistant = await newAssistant();
        const first = await db.createCollection(assistant.id, {
          name: "Concept Parent A",
        });
        const second = await db.createCollection(assistant.id, {
          name: "Concept Parent B",
        });
        const concept = await db.createConcept({
          collectionId: first.id,
          sourceId: null,
          path: "parent.md",
          frontmatter: { type: "Document", title: "Parent" },
          body: "Parent",
        });

        await expect(db.createBackgroundJob({
          organizationId: ctx.organizationId,
          kind: "graph_sync_concept",
          payload: {
            kind: "graph_sync_concept",
            op: "ingest",
            collectionId: second.id,
            conceptId: concept.id,
          },
        })).rejects.toThrow();
      });

      it("never leases one due job to two concurrent workers", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Concurrent Job Collection",
        });
        const source = await db.createSource({
          collectionId: collection.id,
          name: "Concurrent job source",
          kind: "text",
        });
        const job = await db.createBackgroundJob({
          kind: "sync_entity_records",
          sourceId: source.id,
          payload: {
            kind: "sync_entity_records",
            assistantId: assistant.id,
            collectionId: collection.id,
            sourceId: source.id,
            rawText: "hello",
          },
          nextRunAt: "2026-07-09T10:00:00.000Z",
        });

        const claim = (workerId: string) =>
          systemDb.claimBackgroundJobs({
            kind: "sync_entity_records",
            workerId,
            now: "2026-07-09T10:01:00.000Z",
            staleBefore: "2026-07-09T09:45:00.000Z",
            limit: 1,
          });
        const [first, second] = await Promise.all([
          claim("concurrent-worker-1"),
          claim("concurrent-worker-2"),
        ]);

        expect([...first, ...second].map((claimed) => claimed.id)).toEqual([
          job.id,
        ]);
        const [lease] = [...first, ...second];
        await systemDb.settleBackgroundJob({
          id: job.id,
          leaseToken: lease!.leaseToken!,
          now: "2026-07-09T10:01:30.000Z",
          outcome: { status: "succeeded" },
        });
      });

      it("rejects settlement from a worker whose lease was reclaimed", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Fenced Job Collection",
        });
        const source = await db.createSource({
          collectionId: collection.id,
          name: "Fenced job source",
          kind: "text",
        });
        const job = await db.createBackgroundJob({
          kind: "graph_sync_concept",
          sourceId: source.id,
          payload: { kind: "graph_sync_concept" },
          nextRunAt: "2026-07-09T10:00:00.000Z",
        });
        const [expiredLease] = await systemDb.claimBackgroundJobs({
          kind: "graph_sync_concept",
          workerId: "expired-worker",
          now: "2026-07-09T10:01:00.000Z",
          staleBefore: "2026-07-09T09:45:00.000Z",
          limit: 1,
        });
        expect(expiredLease?.leaseToken).toBeTruthy();
        const reclaimed = await systemDb.claimBackgroundJobs({
          kind: "graph_sync_concept",
          workerId: "current-worker",
          now: "2026-07-09T10:20:00.000Z",
          staleBefore: "2026-07-09T10:05:00.000Z",
          limit: 1,
        });
        expect(reclaimed.map((claimed) => claimed.id)).toEqual([job.id]);

        expect(
          await systemDb.settleBackgroundJob({
            id: job.id,
            leaseToken: expiredLease!.leaseToken!,
            now: "2026-07-09T10:21:00.000Z",
            outcome: { status: "succeeded" },
          })
        ).toBe(false);
        expect(
          await systemDb.settleBackgroundJob({
            id: job.id,
            leaseToken: reclaimed[0]!.leaseToken!,
            now: "2026-07-09T10:22:00.000Z",
            outcome: { status: "succeeded" },
          })
        ).toBe(true);
        expect(await db.listBackgroundJobsForSource(source.id)).toEqual([
          expect.objectContaining({
            id: job.id,
            status: "succeeded",
            lockedAt: null,
            lockedBy: null,
          }),
        ]);
      });

      it("leases terminal cleanup and settles it only after cleanup succeeds", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Terminal Lease Collection",
        });
        const source = await db.createSource({
          collectionId: collection.id,
          name: "Terminal lease source",
          kind: "text",
        });
        const job = await db.createBackgroundJob({
          kind: "graph_sync_concept",
          sourceId: source.id,
          payload: { kind: "graph_sync_concept" },
          maxAttempts: 3,
          nextRunAt: "2026-07-09T10:00:00.000Z",
        });
        for (const [workerId, now, staleBefore] of [
          ["worker-1", "2026-07-09T10:01:00.000Z", "2026-07-09T09:45:00.000Z"],
          ["worker-2", "2026-07-09T10:20:00.000Z", "2026-07-09T10:05:00.000Z"],
          ["worker-3", "2026-07-09T10:40:00.000Z", "2026-07-09T10:25:00.000Z"],
        ]) {
          await expect(systemDb.claimBackgroundJobs({
            kind: "graph_sync_concept",
            workerId: workerId!,
            now: now!,
            staleBefore: staleBefore!,
            limit: 1,
          })).resolves.toHaveLength(1);
        }

        const terminal = await systemDb.claimTerminalBackgroundJobs({
          kind: "graph_sync_concept",
          workerId: "worker-4",
          now: "2026-07-09T11:00:00.000Z",
          staleBefore: "2026-07-09T10:45:00.000Z",
          limit: 1,
        });
        expect(terminal).toEqual([
          expect.objectContaining({
            id: job.id,
            status: "running",
            attempts: 3,
            error: "Worker lease expired after final attempt",
            lockedAt: "2026-07-09T11:00:00.000Z",
            lockedBy: "worker-4",
          }),
        ]);
        await expect(systemDb.settleBackgroundJob({
          id: job.id,
          leaseToken: terminal[0]!.leaseToken!,
          now: "2026-07-09T11:00:01.000Z",
          outcome: {
            status: "failed",
            error: "Worker lease expired after final attempt",
          },
        })).resolves.toBe(true);
        await expect(db.listBackgroundJobsForSource(source.id)).resolves.toEqual([
          expect.objectContaining({
            id: job.id,
            status: "failed",
            attempts: 3,
            error: "Worker lease expired after final attempt",
            lockedAt: null,
            lockedBy: null,
          }),
        ]);
      });

      it("claims due ingestion jobs once and records lock metadata", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Job Collection",
        });
        const source = await db.createSource({
          collectionId: collection.id,
          name: "Job source",
          kind: "text",
        });
        await db.setSourceAssistantLinks(source.id, [assistant.id]);
        const rawText = "large payload ".repeat(100_000);
        const payloadVersion = await db.stageSourceIngestJob({
          assistantId: assistant.id,
          collectionId: collection.id,
          sourceId: source.id,
          rawText,
        });
        const [job] = await db.listBackgroundJobsForSource(source.id, "ingest_source");
        expect(job?.payload).toMatchObject({ payloadVersion });
        expect(job?.payload).not.toHaveProperty("rawText");
        expect(await db.getSourceIngestPayload(source.id, payloadVersion)).toEqual({
          version: payloadVersion,
          rawText,
          drafts: null,
        });
        const drafts = [
          {
            path: "frozen.md",
            frontmatter: { type: "Document", title: "Frozen" },
            body: "The retry must reuse this exact draft.",
          },
        ];
        const jobClaimNow = new Date(Date.now() + 60_000);

        const claimed = await systemDb.claimBackgroundJobs({
          kind: "ingest_source",
          workerId: "worker-1",
          now: jobClaimNow.toISOString(),
          staleBefore: new Date(jobClaimNow.getTime() - 15 * 60_000).toISOString(),
          limit: 5,
        });
        expect(claimed).toHaveLength(1);
        expect(claimed[0]).toMatchObject({
          id: job!.id,
          status: "running",
          attempts: 1,
          lockedBy: "worker-1",
        });
        const reclaimedAt = new Date(jobClaimNow.getTime() + 20 * 60_000);
        const reclaimed = await systemDb.claimBackgroundJobs({
          kind: "ingest_source",
          workerId: "worker-2",
          now: reclaimedAt.toISOString(),
          staleBefore: new Date(jobClaimNow.getTime() + 15 * 60_000).toISOString(),
          limit: 1,
        });
        expect(reclaimed).toHaveLength(1);
        expect(reclaimed[0]!.leaseToken).not.toBe(claimed[0]!.leaseToken);
        const frozen = await systemDb.initializeSourceIngestAttempt({
          jobId: job!.id,
          leaseToken: reclaimed[0]!.leaseToken!,
          sourceId: source.id,
          version: payloadVersion,
          drafts,
        });
        expect(frozen).toMatchObject({ drafts, cursor: 0 });
        const losingDrafts = [
          {
            path: "late.md",
            frontmatter: { type: "Document", title: "Late" },
            body: "A late enrichment result must never replace the winner.",
          },
        ];
        await expect(
          systemDb.initializeSourceIngestAttempt({
            jobId: job!.id,
            leaseToken: claimed[0]!.leaseToken!,
            sourceId: source.id,
            version: payloadVersion,
            drafts: losingDrafts,
          })
        ).resolves.toBeNull();
        await expect(
          systemDb.initializeSourceIngestAttempt({
            jobId: job!.id,
            leaseToken: reclaimed[0]!.leaseToken!,
            sourceId: source.id,
            version: payloadVersion,
            drafts: losingDrafts,
          })
        ).resolves.toEqual(frozen);
        await expect(
          systemDb.checkpointSourceIngestCursor({
            jobId: job!.id,
            leaseToken: reclaimed[0]!.leaseToken!,
            sourceId: source.id,
            version: payloadVersion,
            generationId: frozen!.generationId,
            cursor: 1,
          })
        ).resolves.toBe(true);
        await expect(
          systemDb.getSourceIngestPayload(source.id, payloadVersion)
        ).resolves.toEqual({ version: payloadVersion, rawText, drafts });
        await expect(
          systemDb.renewBackgroundJobLease({
            id: job.id,
            leaseToken: reclaimed[0]!.leaseToken!,
            now: new Date(reclaimedAt.getTime() + 30_000).toISOString(),
          })
        ).resolves.toBe(true);
        await expect(
          systemDb.renewBackgroundJobLease({
            id: job.id,
            leaseToken: "00000000-0000-4000-8000-000000000999",
            now: "2026-07-09T10:01:45.000Z",
          })
        ).resolves.toBe(false);

        await systemDb.settleBackgroundJob({
          id: job!.id,
          leaseToken: reclaimed[0]!.leaseToken!,
          now: new Date(reclaimedAt.getTime() + 60_000).toISOString(),
          outcome: { status: "succeeded" },
        });
        const secondClaim = await systemDb.claimBackgroundJobs({
          kind: "ingest_source",
          workerId: "worker-2",
          now: new Date(reclaimedAt.getTime() + 2 * 60_000).toISOString(),
          staleBefore: new Date(reclaimedAt.getTime() - 15 * 60_000).toISOString(),
          limit: 5,
        });
        expect(secondClaim).toEqual([]);
        expect(await db.listBackgroundJobsForSource(source.id, "ingest_source")).toHaveLength(1);
      });

      it("supersedes an older Source revision before its generation can commit", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Ordered Source revisions",
        });
        const source = await db.createSource({
          collectionId: collection.id,
          name: "Application article",
          kind: "application",
        });
        await db.setSourceAssistantLinks(source.id, [assistant.id]);
        const firstVersion = await db.stageSourceIngestJob({
          assistantId: assistant.id,
          collectionId: collection.id,
          sourceId: source.id,
          rawText: "revision one",
        });
        const firstClaimAt = new Date(Date.now() + 60_000);
        const firstClaim = await systemDb.claimBackgroundJobs({
          kind: "ingest_source",
          workerId: "old-revision",
          now: firstClaimAt.toISOString(),
          staleBefore: new Date(
            firstClaimAt.getTime() - 15 * 60_000
          ).toISOString(),
          limit: 1,
        });
        const firstAttempt = await systemDb.initializeSourceIngestAttempt({
          jobId: firstClaim[0]!.id,
          leaseToken: firstClaim[0]!.leaseToken!,
          sourceId: source.id,
          version: firstVersion,
          drafts: [{
            path: "article.md",
            frontmatter: { type: "Document", title: "Revision one" },
            body: "revision one",
          }],
        });
        const firstConcept = await systemDb.createConcept({
          collectionId: collection.id,
          sourceId: source.id,
          generationId: firstAttempt!.generationId,
          path: "article.md",
          frontmatter: { type: "Document", title: "Revision one" },
          body: "revision one",
        });

        const secondVersion = await db.stageSourceIngestJob({
          assistantId: assistant.id,
          collectionId: collection.id,
          sourceId: source.id,
          rawText: "revision two",
        });
        await expect(
          systemDb.commitSourceIngestGeneration({
            jobId: firstClaim[0]!.id,
            leaseToken: firstClaim[0]!.leaseToken!,
            sourceId: source.id,
            version: firstVersion,
            expectedActiveGenerationId: firstAttempt!.expectedActiveGenerationId,
            generationId: firstAttempt!.generationId,
          })
        ).resolves.toBe(false);

        const secondClaim = await systemDb.claimBackgroundJobs({
          kind: "ingest_source",
          workerId: "new-revision",
          now: new Date(firstClaimAt.getTime() + 60_000).toISOString(),
          staleBefore: new Date(
            firstClaimAt.getTime() - 14 * 60_000
          ).toISOString(),
          limit: 1,
        });
        const secondAttempt = await systemDb.initializeSourceIngestAttempt({
          jobId: secondClaim[0]!.id,
          leaseToken: secondClaim[0]!.leaseToken!,
          sourceId: source.id,
          version: secondVersion,
          drafts: [{
            path: "article.md",
            frontmatter: { type: "Document", title: "Revision two" },
            body: "revision two",
          }],
        });
        await systemDb.createConcept({
          collectionId: collection.id,
          sourceId: source.id,
          generationId: secondAttempt!.generationId,
          path: "article.md",
          frontmatter: { type: "Document", title: "Revision two" },
          body: "revision two",
        });
        await expect(
          systemDb.commitSourceIngestGeneration({
            jobId: secondClaim[0]!.id,
            leaseToken: secondClaim[0]!.leaseToken!,
            sourceId: source.id,
            version: secondVersion,
            expectedActiveGenerationId: secondAttempt!.expectedActiveGenerationId,
            generationId: secondAttempt!.generationId,
          })
        ).resolves.toBe(true);
        expect((await db.listConcepts(collection.id)).map((item) => item.body)).toEqual([
          "revision two",
        ]);
        await expect(
          systemDb.deleteSourceKnowledgeGeneration(
            source.id,
            firstAttempt!.generationId,
          ),
        ).resolves.toEqual([firstConcept.id]);
      });
    });

    describe("API idempotency", () => {
      it("claims once, fences completion, replays, and rejects payload conflicts", async () => {
        const input = {
          scope: `${ctx.organizationId}:POST /things`,
          key: `contract-${crypto.randomUUID()}`,
          requestHash: "hash-a",
          now: "2026-08-27T01:00:00.000Z",
          staleBefore: "2026-08-27T00:50:00.000Z",
          expiresAt: "2026-08-28T01:00:00.000Z",
        };
        const [first, concurrent] = await Promise.all([
          db.claimApiIdempotency(input),
          db.claimApiIdempotency(input),
        ]);
        const claimed = [first, concurrent].find((claim) => claim.status === "claimed");
        expect(claimed?.status).toBe("claimed");
        expect([first.status, concurrent.status].sort()).toEqual(["claimed", "running"]);
        if (!claimed || claimed.status !== "claimed") throw new Error("claim missing");
        expect(
          await db.completeApiIdempotency({
            scope: input.scope,
            key: input.key,
            leaseToken: claimed.leaseToken,
            responseStatus: 201,
            responseBody: '{"id":"one"}',
            contentType: "application/json",
            now: "2026-08-27T01:00:01.000Z",
          })
        ).toBe(true);
        await expect(db.claimApiIdempotency(input)).resolves.toMatchObject({
          status: "completed",
          responseStatus: 201,
          responseBody: '{"id":"one"}',
        });
        await expect(
          db.claimApiIdempotency({ ...input, requestHash: "hash-b" })
        ).resolves.toEqual({ status: "conflict" });
      });

    });

    describe("runtime ledger retention", () => {
      it("deletes only old terminal rows and caps every ledger independently", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Retention Collection",
        });
        const source = await db.createSource({
          collectionId: collection.id,
          name: "Retention Source",
          kind: "text",
        });
        const oldJob = await db.createBackgroundJob({
          kind: "graph_sync_concept",
          sourceId: source.id,
          payload: {
            kind: "graph_sync_concept",
            op: "purge",
            collectionId: collection.id,
          },
          nextRunAt: "1990-01-01T00:00:00.000Z",
        });
        const activeJob = await db.createBackgroundJob({
          kind: "graph_sync_concept",
          sourceId: source.id,
          payload: {
            kind: "graph_sync_concept",
            op: "purge",
            collectionId: collection.id,
          },
          nextRunAt: "1991-01-01T00:00:00.000Z",
        });
        const [claimedJob] = await systemDb.claimBackgroundJobs({
          kind: "graph_sync_concept",
          workerId: "retention-job",
          now: "2000-01-01T00:00:00.000Z",
          staleBefore: "1999-01-01T00:00:00.000Z",
          limit: 1,
        });
        expect(claimedJob?.id).toBe(oldJob.id);
        await systemDb.settleBackgroundJob({
          id: oldJob.id,
          leaseToken: claimedJob!.leaseToken!,
          now: "2000-01-01T00:00:01.000Z",
          outcome: { status: "succeeded" },
        });

        const conversation = await db.createConversation({
          assistantId: assistant.id,
          subjectType: "visitor",
          subjectId: `retention-${crypto.randomUUID()}`,
          title: "Retention",
        });
        const oldTurnRequest = crypto.randomUUID();
        const turn = await systemDb.claimConversationTurn({
          conversationId: conversation.id,
          requestId: oldTurnRequest,
          workerId: "retention-turn",
          now: "2000-01-01T00:00:00.000Z",
          staleBefore: "1999-01-01T00:00:00.000Z",
        });
        await systemDb.failConversationTurn({
          conversationId: conversation.id,
          requestId: oldTurnRequest,
          leaseToken: turn.leaseToken!,
          error: "terminal fixture",
          now: "2000-01-01T00:00:01.000Z",
        });

        const oldEffectMessage = await systemDb.appendMessage({
          conversationId: conversation.id,
          requestId: crypto.randomUUID(),
          role: "assistant",
          content: [{ type: "text", text: "old effect" }],
          deferredEffects: [{ kind: "create_improvement", title: "old" }],
        });
        const pendingEffectMessage = await systemDb.appendMessage({
          conversationId: conversation.id,
          requestId: crypto.randomUUID(),
          role: "assistant",
          content: [{ type: "text", text: "pending effect" }],
          deferredEffects: [{ kind: "create_improvement", title: "pending" }],
        });
        const [oldEffect] = await systemDb.claimTurnEffects({
          messageId: oldEffectMessage.id,
          workerId: "retention-effect",
          now: "2030-01-01T00:00:00.000Z",
          staleBefore: "2029-01-01T00:00:00.000Z",
          limit: 1,
        });
        await systemDb.settleTurnEffect({
          id: oldEffect!.id,
          leaseToken: oldEffect!.leaseToken,
          now: "2000-01-01T00:00:01.000Z",
          succeeded: true,
        });

        const scope = `${ctx.organizationId}:retention`;
        const oldKey = `old-${crypto.randomUUID()}`;
        await systemDb.claimApiIdempotency({
          scope,
          key: oldKey,
          requestHash: "old",
          now: "1999-01-01T00:00:00.000Z",
          staleBefore: "1998-01-01T00:00:00.000Z",
          expiresAt: "2000-01-01T00:00:00.000Z",
        });

        const report = await systemDb.sweepRuntimeLedgers(
          "2030-01-01T00:00:00.000Z",
          1
        );
        expect(report).toEqual({
          backgroundJobs: 1,
          conversationTurns: 1,
          turnEffects: 1,
          apiIdempotencyKeys: 1,
          sourceGenerations: 0,
        });
        const jobs = await db.listBackgroundJobsForSource(source.id);
        expect(jobs.some((job) => job.id === oldJob.id)).toBe(false);
        expect(jobs.some((job) => job.id === activeJob.id)).toBe(true);
        await expect(
          systemDb.claimConversationTurn({
            conversationId: conversation.id,
            requestId: oldTurnRequest,
            workerId: "retention-replay",
            now: "2030-01-01T00:00:01.000Z",
            staleBefore: "2029-01-01T00:00:00.000Z",
          })
        ).resolves.toMatchObject({ status: "claimed" });
        await expect(systemDb.claimTurnEffects({
          messageId: pendingEffectMessage.id,
          workerId: "retention-pending",
          now: "2030-01-01T00:00:01.000Z",
          staleBefore: "2029-01-01T00:00:00.000Z",
          limit: 1,
        })).resolves.toHaveLength(1);
        await expect(systemDb.claimApiIdempotency({
          scope,
          key: oldKey,
          requestHash: "old",
          now: "2030-01-01T00:00:01.000Z",
          staleBefore: "2029-01-01T00:00:00.000Z",
          expiresAt: "2031-01-01T00:00:00.000Z",
        })).resolves.toMatchObject({ status: "claimed" });
      });
    });

    describe("budget reservations", () => {
      it("settles usage and releases its reservation exactly once", async () => {
        const usedBefore = await db.getOrgTokensUsedToday(ctx.organizationId);
        await db.setOrgBudget(ctx.organizationId, {
          dailyTokenLimit: usedBefore + 100,
          dailyEuroLimit: null,
          enforcement: "block",
        });
        const now = new Date();
        const reservationId = await db.reserveOrgBudget({
          organizationId: ctx.organizationId,
          maxTokens: 10,
          maxEur: 0.25,
          observedCostEur: 0,
          now: now.toISOString(),
          expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
        });
        expect(reservationId).toBeTruthy();

        const usage = [{
          organizationId: ctx.organizationId,
          assistantId: null,
          stage: "generate" as const,
          provider: "openai" as const,
          modelId: "contract-model",
          credentialKind: "platform" as const,
          inputTokens: 4,
          outputTokens: 6,
        }];
        await expect(
          db.settleOrgBudgetReservation(reservationId!, usage)
        ).resolves.toBe(true);
        await expect(
          db.settleOrgBudgetReservation(reservationId!, usage)
        ).resolves.toBe(false);
        await expect(db.getOrgTokensUsedToday(ctx.organizationId)).resolves.toBe(
          usedBefore + 10
        );
        const finalReservation = await db.reserveOrgBudget({
          organizationId: ctx.organizationId,
          maxTokens: 90,
          maxEur: 0.25,
          observedCostEur: 0,
          now: now.toISOString(),
          expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
        });
        expect(finalReservation).toBeTruthy();
        await db.releaseOrgBudgetReservation(finalReservation!);
      });

      it("rejects a turn when the full worst-case reservation does not fit", async () => {
        const usedBefore = await db.getOrgTokensUsedToday(ctx.organizationId);
        await db.setOrgBudget(ctx.organizationId, {
          dailyTokenLimit: usedBefore + 9,
          dailyEuroLimit: null,
          enforcement: "block",
        });

        const now = new Date();
        await expect(
          db.reserveOrgBudget({
            organizationId: ctx.organizationId,
            maxTokens: 10,
            maxEur: 0.25,
            observedCostEur: 0,
            now: now.toISOString(),
            expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
          })
        ).resolves.toBeNull();
      });

      it("admits only one concurrent turn into the remaining hard budget", async () => {
        const usedBefore = await db.getOrgTokensUsedToday(ctx.organizationId);
        await db.setOrgBudget(ctx.organizationId, {
          dailyTokenLimit: usedBefore + 10,
          dailyEuroLimit: null,
          enforcement: "block",
        });
        const now = new Date();
        const input = {
          organizationId: ctx.organizationId,
          maxTokens: 10,
          maxEur: 0.25,
          observedCostEur: 0,
          now: now.toISOString(),
          expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
        };
        const reservations = await Promise.all([
          systemDb.reserveOrgBudget(input),
          systemDb.reserveOrgBudget(input),
        ]);
        const admitted = reservations.filter(
          (reservation): reservation is string => reservation !== null
        );
        expect(admitted).toHaveLength(1);
        await db.releaseOrgBudgetReservation(admitted[0]!);
        const retried = await db.reserveOrgBudget(input);
        expect(retried).toBeTruthy();
        await db.releaseOrgBudgetReservation(retried!);
      });

      it("does not re-admit euro spend from a stale pre-settlement observation", async () => {
        const observedBefore = await db.getOrgCostUsedToday(ctx.organizationId);
        await db.setOrgBudget(ctx.organizationId, {
          dailyTokenLimit: null,
          dailyEuroLimit: observedBefore + 1,
          enforcement: "block",
        });
        const now = new Date();
        const staleInput = {
          organizationId: ctx.organizationId,
          maxTokens: 1,
          maxEur: 0.6,
          observedCostEur: observedBefore,
          now: now.toISOString(),
          expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
        };
        const first = await db.reserveOrgBudget(staleInput);
        expect(first).toBeTruthy();
        await db.settleOrgBudgetReservation(first!, [{
          organizationId: ctx.organizationId,
          assistantId: null,
          stage: "generate",
          provider: "openai",
          modelId: "contract-model",
          credentialKind: "platform",
          inputTokens: 0,
          outputTokens: 0,
        }]);

        // This is the observation a waiter could have read before the first
        // settlement. The serialized budget state must still reject it.
        await expect(db.reserveOrgBudget(staleInput)).resolves.toBeNull();
      });

      it("does not let an old-day settlement release a new-day reservation", async () => {
        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        const yesterday = new Date(`${today}T00:00:00.000Z`);
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        const usedBefore = await db.getOrgTokensUsedToday(ctx.organizationId);
        await db.setOrgBudget(ctx.organizationId, {
          dailyTokenLimit: usedBefore + 20,
          dailyEuroLimit: null,
          enforcement: "block",
        });
        const oldReservation = await db.reserveOrgBudget({
          organizationId: ctx.organizationId,
          maxTokens: 10,
          maxEur: 0,
          observedCostEur: 0,
          now: yesterday.toISOString(),
          expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
        });
        const newReservation = await db.reserveOrgBudget({
          organizationId: ctx.organizationId,
          maxTokens: 10,
          maxEur: 0,
          observedCostEur: 0,
          now: now.toISOString(),
          expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
        });
        expect(oldReservation).toBeTruthy();
        expect(newReservation).toBeTruthy();
        await db.settleOrgBudgetReservation(oldReservation!, [{
          organizationId: ctx.organizationId,
          assistantId: null,
          stage: "generate",
          provider: "openai",
          modelId: "contract-model",
          credentialKind: "platform",
          inputTokens: 5,
          outputTokens: 5,
        }]);
        await expect(db.reserveOrgBudget({
          organizationId: ctx.organizationId,
          maxTokens: 1,
          maxEur: 0,
          observedCostEur: 0,
          now: now.toISOString(),
          expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
        })).resolves.toBeNull();
        await db.releaseOrgBudgetReservation(newReservation!);
      });

      it("charges an old-day euro reservation to the settlement day", async () => {
        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        const yesterday = new Date(`${today}T00:00:00.000Z`);
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        const observedBefore = await db.getOrgCostUsedToday(ctx.organizationId);
        await db.setOrgBudget(ctx.organizationId, {
          dailyTokenLimit: null,
          dailyEuroLimit: observedBefore + 1,
          enforcement: "block",
        });
        const oldReservation = await db.reserveOrgBudget({
          organizationId: ctx.organizationId,
          maxTokens: 1,
          maxEur: 0.6,
          observedCostEur: observedBefore,
          now: yesterday.toISOString(),
          expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
        });
        const newReservation = await db.reserveOrgBudget({
          organizationId: ctx.organizationId,
          maxTokens: 1,
          maxEur: 0.4,
          observedCostEur: observedBefore,
          now: now.toISOString(),
          expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
        });
        expect(oldReservation).toBeTruthy();
        expect(newReservation).toBeTruthy();

        await db.settleOrgBudgetReservation(oldReservation!, [{
          organizationId: ctx.organizationId,
          assistantId: null,
          stage: "generate",
          provider: "openai",
          modelId: "contract-model",
          credentialKind: "platform",
          inputTokens: 0,
          outputTokens: 0,
        }]);

        await expect(db.reserveOrgBudget({
          organizationId: ctx.organizationId,
          maxTokens: 1,
          maxEur: 0.01,
          observedCostEur: observedBefore,
          now: now.toISOString(),
          expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
        })).resolves.toBeNull();
        await db.releaseOrgBudgetReservation(newReservation!);
      });

      it("keeps a settle-first old-day euro charge after midnight rollover", async () => {
        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        const yesterday = new Date(`${today}T00:00:00.000Z`);
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        await db.setOrgBudget(ctx.organizationId, {
          dailyTokenLimit: null,
          dailyEuroLimit: 0.5,
          enforcement: "block",
        });
        const oldReservation = await db.reserveOrgBudget({
          organizationId: ctx.organizationId,
          maxTokens: 1,
          maxEur: 0.5,
          observedCostEur: 0,
          now: yesterday.toISOString(),
          expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
        });
        expect(oldReservation).toBeTruthy();
        await db.settleOrgBudgetReservation(oldReservation!, []);

        await expect(db.reserveOrgBudget({
          organizationId: ctx.organizationId,
          maxTokens: 1,
          maxEur: 0.01,
          observedCostEur: 0,
          now: now.toISOString(),
          expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
        })).resolves.toBeNull();
      });
    });

    describe("export jobs", () => {
      it("creates queued, claims due jobs once, and completes them", async () => {
        const created = await db.createExportJob(ctx.organizationId, {
          kind: "insights_overview",
          format: "csv",
          params: { from: "2026-06-01", to: "2026-07-01" },
        });
        expect(created).toMatchObject({
          organizationId: ctx.organizationId,
          kind: "insights_overview",
          status: "queued",
          attempts: 0,
          storagePath: null,
        });

        const claimed = await db.claimDueExportJobs({
          workerId: "worker-1",
          now: "2026-07-11T10:00:00.000Z",
          staleBefore: "2026-07-11T09:45:00.000Z",
          limit: 5,
        });
        const mine = claimed.find((job) => job.id === created.id);
        expect(mine).toMatchObject({
          status: "running",
          attempts: 1,
          lockedBy: "worker-1",
        });

        // A second immediate claim must not re-lease the running job.
        const second = await db.claimDueExportJobs({
          workerId: "worker-2",
          now: "2026-07-11T10:01:00.000Z",
          staleBefore: "2026-07-11T09:45:00.000Z",
          limit: 5,
        });
        expect(second.some((job) => job.id === created.id)).toBe(false);

        await db.updateExportJob(created.id, {
          status: "done",
          storagePath: `org/${ctx.organizationId}/exports/${created.id}.csv`,
          lockedAt: null,
          lockedBy: null,
        });
        const listed = await db.listExportJobs(ctx.organizationId);
        const done = listed.find((job) => job.id === created.id);
        expect(done).toMatchObject({ status: "done" });
        expect(done?.storagePath).toContain(created.id);
      });

      it("re-queues a failed job for another run, clearing lock and attempts", async () => {
        const created = await db.createExportJob(ctx.organizationId, {
          kind: "insights_overview",
          format: "csv",
          params: {},
        });
        await db.updateExportJob(created.id, {
          status: "error",
          error: "boom",
        });

        await db.requeueExportJob(created.id);
        const reloaded = await db.getExportJob(created.id);
        expect(reloaded).toMatchObject({
          status: "queued",
          attempts: 0,
          error: "",
          storagePath: null,
          lockedAt: null,
          lockedBy: null,
        });
      });
    });

    describe("standing goals", () => {
      it("creates with defaults, patches partially, and enforces the cap", async () => {
        expect("listAssistantGoals" in db).toBe(false);
        expect("updateAssistantGoal" in db).toBe(false);
        expect("deleteAssistantGoal" in db).toBe(false);
        const assistant = await newAssistant();
        const goal = await db.createAssistantGoal(assistant.id, {
          question: "What does shipping cost?",
          expectations: { mustContain: ["free"], mustCiteSources: true },
        });
        expect(goal).toMatchObject({
          assistantId: assistant.id,
          organizationId: ctx.organizationId,
          status: "active",
          lastResult: null,
          expectations: { mustContain: ["free"], mustCiteSources: true },
        });

        const quarantined = await db.table("assistantGoals").update(goal.id, {
          status: "quarantined",
        });
        // Partial patch: question and expectations survive.
        expect(quarantined.question).toBe("What does shipping cost?");
        expect(quarantined.expectations.mustCiteSources).toBe(true);
        expect(quarantined.status).toBe("quarantined");

        for (let i = 1; i < ASSISTANT_GOAL_CAP; i++) {
          await db.createAssistantGoal(assistant.id, {
            question: `filler ${i}`,
            expectations: {},
          });
        }
        await expect(
          db.createAssistantGoal(assistant.id, {
            question: "one too many",
            expectations: {},
          })
        ).rejects.toThrow(String(ASSISTANT_GOAL_CAP));

        await db.table("assistantGoals").delete(goal.id);
        const remaining = await db
          .table("assistantGoals")
          .list({ assistantId: assistant.id });
        expect(remaining.some((g) => g.id === goal.id)).toBe(false);
      });
    });

    describe("AI usage ledger", () => {
      it("records usage rows and sums today's org tokens", async () => {
        const assistant = await newAssistant();
        const before = await db.getOrgTokensUsedToday(ctx.organizationId);

        await db.recordAiUsage([
          {
            organizationId: ctx.organizationId,
            assistantId: assistant.id,
            conversationId: "conv-usage-1",
            messageId: "msg-usage-1",
            stage: "classify",
            provider: "anthropic",
            modelId: "claude-haiku-4-5",
            inputTokens: 100,
            outputTokens: 10,
          },
          {
            organizationId: ctx.organizationId,
            assistantId: assistant.id,
            conversationId: "conv-usage-1",
            messageId: "msg-usage-1",
            stage: "generate",
            provider: "anthropic",
            modelId: "claude-opus-4-8",
            inputTokens: 900,
            outputTokens: 200,
          },
        ]);

        const after = await db.getOrgTokensUsedToday(ctx.organizationId);
        expect(after - before).toBe(100 + 10 + 900 + 200);
      });

      it("accepts every AiUsageStage value (type ↔ constraint drift guard)", async () => {
        // Each stage in the type must be insertable, a stage added to the
        // union but not to the ai_usage check constraint is silently dropped
        // in production (meterUsage isolates the failure), which is exactly
        // how improvement_proposal rows went missing before 20260720100000.
        // Record<AiUsageStage, true> forces a compile error the moment the
        // union grows, so a new stage cannot ship without landing here (and
        // therefore without a migration that lets this insert pass).
        const allStages: Record<AiUsageStage, true> = {
          classify: true,
          generate: true,
          embed: true,
          enrich: true,
          verify: true,
          goal_eval: true,
          compost: true,
          improvement_proposal: true,
          graph_search: true,
          graph_cognify: true,
          memory_extract: true,
          agent_memory: true,
        };
        const stages = Object.keys(allStages) as AiUsageStage[];
        await db.recordAiUsage(
          stages.map((stage) => ({
            organizationId: ctx.organizationId,
            assistantId: null,
            stage,
            provider: "google" as const,
            modelId: "stage-drift-guard",
            inputTokens: 1,
            outputTokens: 0,
          }))
        );
      });

      it("upserts and reads the org budget", async () => {
        expect(await db.getOrgBudget(ctx.missingOrganizationId)).toBeNull();

        const created = await db.setOrgBudget(ctx.organizationId, {
          dailyTokenLimit: 5000,
          dailyEuroLimit: 12.5,
          enforcement: "notify",
        });
        expect(created).toMatchObject({
          organizationId: ctx.organizationId,
          dailyTokenLimit: 5000,
          dailyEuroLimit: 12.5,
          enforcement: "notify",
        });

        const updated = await db.setOrgBudget(ctx.organizationId, {
          dailyTokenLimit: null,
          dailyEuroLimit: null,
          enforcement: "block",
        });
        expect(updated).toMatchObject({
          dailyTokenLimit: null,
          dailyEuroLimit: null,
          enforcement: "block",
        });
        expect(await db.getOrgBudget(ctx.organizationId)).toMatchObject({
          dailyTokenLimit: null,
          dailyEuroLimit: null,
          enforcement: "block",
        });
      });

      it("estimates today's euro cost from usage tokens", async () => {
        const before = await db.getOrgCostUsedToday(ctx.organizationId);
        await db.recordAiUsage([
          {
            organizationId: ctx.organizationId,
            assistantId: null,
            stage: "generate",
            provider: "anthropic",
            modelId: "claude-sonnet-5",
            inputTokens: 1_000_000,
            outputTokens: 0,
          },
        ]);
        const after = await db.getOrgCostUsedToday(ctx.organizationId);
        expect(after - before).toBeCloseTo(2.8, 5);
      });

      it("prices an embedding batch from its own rate, not the chat fallback", async () => {
        const before = await db.getOrgCostUsedToday(ctx.organizationId);
        await db.recordAiUsage([
          {
            organizationId: ctx.organizationId,
            assistantId: null,
            stage: "embed",
            provider: "openai",
            modelId: "text-embedding-3-small",
            inputTokens: 40_000_000,
            outputTokens: 0,
          },
        ]);
        const after = await db.getOrgCostUsedToday(ctx.organizationId);
        // 40M embedding tokens at €0.019/1M is €0.76. Until embedding models
        // were priced, the same batch fell through to the €3/1M chat fallback
        // and was reported as €120, enough to trip a euro budget on
        // indexing that cost cents.
        expect(after - before).toBeCloseTo(0.76, 5);
      });

      it("ignores other organizations and empty batches", async () => {
        const before = await db.getOrgTokensUsedToday(ctx.organizationId);
        await db.recordAiUsage([]);
        await db.recordAiUsage([
          {
            organizationId: ctx.foreignOrganizationId,
            assistantId: null,
            stage: "generate",
            provider: "openai",
            modelId: "gpt-5.1-mini",
            inputTokens: 50,
            outputTokens: 5,
          },
        ]);
        expect(await db.getOrgTokensUsedToday(ctx.organizationId)).toBe(before);
      });
    });

    describe("usage rollup & reporting (usage_daily)", () => {
      // The shared context accumulates ledger rows across the suite, so every
      // assertion here is a before/after delta keyed by (day, kind,
      // credentialKind), never an absolute read.
      type UsageKey = string;
      const keyOf = (r: {
        day: string;
        kind: string;
        credentialKind: string;
      }): UsageKey => `${r.day}|${r.kind}|${r.credentialKind}`;
      // The rollup's grain includes the provider and model that ran, so more
      // than one row can share a (day, kind, credential) key, fold them.
      const indexRows = async (): Promise<
        Map<UsageKey, { calls: number; inputTokens: number; outputTokens: number }>
      > => {
        const rows = await db.getOrgUsageDaily(ctx.organizationId, 30);
        const index = new Map<
          UsageKey,
          { calls: number; inputTokens: number; outputTokens: number }
        >();
        for (const r of rows) {
          const at = index.get(keyOf(r)) ?? {
            calls: 0,
            inputTokens: 0,
            outputTokens: 0,
          };
          at.calls += r.calls;
          at.inputTokens += r.inputTokens;
          at.outputTokens += r.outputTokens;
          index.set(keyOf(r), at);
        }
        return index;
      };
      const today = () => new Date().toISOString().slice(0, 10);

      it("reports today's usage live, split by kind and credential kind", async () => {
        const before = await indexRows();
        await db.recordAiUsage([
          {
            organizationId: ctx.organizationId,
            assistantId: null,
            stage: "classify",
            provider: "anthropic",
            modelId: "claude-haiku-4-5",
            credentialKind: "platform",
            inputTokens: 100,
            outputTokens: 10,
          },
          {
            organizationId: ctx.organizationId,
            assistantId: null,
            stage: "generate",
            provider: "anthropic",
            modelId: "claude-opus-4-8",
            credentialKind: "platform",
            inputTokens: 900,
            outputTokens: 200,
          },
          {
            organizationId: ctx.organizationId,
            assistantId: null,
            stage: "embed",
            provider: "openai",
            modelId: "text-embedding-3-small",
            credentialKind: "api_key",
            inputTokens: 42,
            outputTokens: 0,
          },
        ]);
        const after = await indexRows();

        const chatKey = `${today()}|chat|platform`;
        const embedKey = `${today()}|embedding|api_key`;
        const beforeChat = before.get(chatKey) ?? {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
        };
        const beforeEmbed = before.get(embedKey) ?? {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
        };
        expect(after.get(chatKey)).toEqual({
          calls: beforeChat.calls + 2,
          inputTokens: beforeChat.inputTokens + 1000,
          outputTokens: beforeChat.outputTokens + 210,
        });
        expect(after.get(embedKey)).toEqual({
          calls: beforeEmbed.calls + 1,
          inputTokens: beforeEmbed.inputTokens + 42,
          outputTokens: beforeEmbed.outputTokens + 0,
        });
      });

      it("buckets rows without a credential kind as 'unknown'", async () => {
        const before = await indexRows();
        await db.recordAiUsage([
          {
            organizationId: ctx.organizationId,
            assistantId: null,
            stage: "enrich",
            provider: "google",
            modelId: "gemini-3.1-flash-lite",
            inputTokens: 7,
            outputTokens: 3,
          },
        ]);
        const after = await indexRows();
        const key = `${today()}|chat|unknown`;
        const prior = before.get(key) ?? {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
        };
        expect(after.get(key)).toEqual({
          calls: prior.calls + 1,
          inputTokens: prior.inputTokens + 7,
          outputTokens: prior.outputTokens + 3,
        });
      });

      it("rollup is idempotent and never double-counts today", async () => {
        await db.recordAiUsage([
          {
            organizationId: ctx.organizationId,
            assistantId: null,
            stage: "generate",
            provider: "anthropic",
            modelId: "claude-sonnet-5",
            credentialKind: "api_key",
            inputTokens: 11,
            outputTokens: 5,
          },
        ]);
        const beforeRollup = await indexRows();
        expect(await db.rollupUsageDaily(2)).toBeGreaterThanOrEqual(1);
        expect(await db.rollupUsageDaily(2)).toBeGreaterThanOrEqual(1);
        // Today is served live from the raw ledger, so a rollup that already
        // covered part of today must not surface a second time.
        expect(await indexRows()).toEqual(beforeRollup);
      });

      it("scopes the report to the requested organization", async () => {
        const before = await indexRows();
        await db.recordAiUsage([
          {
            organizationId: ctx.foreignOrganizationId,
            assistantId: null,
            stage: "generate",
            provider: "openai",
            modelId: "gpt-5.1-mini",
            credentialKind: "platform",
            inputTokens: 999,
            outputTokens: 999,
          },
        ]);
        expect(await indexRows()).toEqual(before);
      });

      it("keeps the provider and model that ran, so a day can be priced", async () => {
        // Two models, same day/kind/credential: without the finer grain the two
        // collapse and the cost of the day becomes unknowable.
        await db.recordAiUsage([
          {
            organizationId: ctx.organizationId,
            assistantId: null,
            stage: "generate",
            provider: "google",
            modelId: "gemini-3.5-flash",
            credentialKind: "platform",
            inputTokens: 5_000,
            outputTokens: 100,
          },
          {
            organizationId: ctx.organizationId,
            assistantId: null,
            stage: "generate",
            provider: "anthropic",
            modelId: "claude-opus-4-8",
            credentialKind: "platform",
            inputTokens: 5_000,
            outputTokens: 100,
          },
        ]);
        const rows = await db.getOrgUsageDaily(ctx.organizationId, 1);
        const flash = rows.find((r) => r.modelId === "gemini-3.5-flash");
        const opus = rows.find((r) => r.modelId === "claude-opus-4-8");
        expect(flash).toMatchObject({ provider: "google", units: 0 });
        expect(opus).toMatchObject({ provider: "anthropic", units: 0 });
      });

      it("accepts a Teammate turn as its own surface (#768)", async () => {
        // The column carries a check constraint, so a surface the migration
        // did not widen is rejected by the database, not by a type.
        await expect(
          db.recordRuntimeEvent({
            organizationId: ctx.organizationId,
            assistantId: null,
            kind: "chat_turn",
            status: "succeeded",
            surface: "teammate",
          })
        ).resolves.toBeUndefined();
      });

      it("reports a completed crawl as pages, attributed to the crawler", async () => {
        const apifyPages = async () =>
          (await db.getOrgUsageDaily(ctx.organizationId, 1))
            .filter((r) => r.kind === "crawl" && r.provider === "apify")
            .reduce((sum, r) => sum + r.units, 0);
        const before = await apifyPages();
        await db.recordRuntimeEvent({
          organizationId: ctx.organizationId,
          assistantId: null,
          kind: "crawl",
          status: "succeeded",
          crawlerProvider: "apify",
          pageCount: 12,
        });
        expect(await apifyPages()).toBe(before + 12);
        const apify = (await db.getOrgUsageDaily(ctx.organizationId, 1)).find(
          (r) => r.kind === "crawl" && r.provider === "apify"
        );
        expect(apify).toMatchObject({
          credentialKind: "platform",
          inputTokens: 0,
          outputTokens: 0,
          modelId: "",
        });
      });

      it("reports nothing for a crawl that failed or returned no pages", async () => {
        const pagesOf = async () =>
          (await db.getOrgUsageDaily(ctx.organizationId, 1))
            .filter((r) => r.kind === "crawl")
            .reduce((sum, r) => sum + r.units, 0);
        const before = await pagesOf();
        await db.recordRuntimeEvent({
          organizationId: ctx.organizationId,
          assistantId: null,
          kind: "crawl",
          status: "failed",
          crawlerProvider: "apify",
          pageCount: 9,
        });
        await db.recordRuntimeEvent({
          organizationId: ctx.organizationId,
          assistantId: null,
          kind: "crawl",
          status: "succeeded",
          crawlerProvider: "local",
          pageCount: 0,
        });
        expect(await pagesOf()).toBe(before);
      });
    });

    describe("usage meters over an arbitrary window", () => {
      // The seam can only ever record rows at `now()`, so every window here
      // lands inside today and exercises the LIVE branch. The closed-day and
      // partial-day arithmetic, including UTC pinning, is driven against real
      // SQL with backdated rows in src/testing/usage-rollup.test.ts; the case
      // below is the most this seam can say about the boundary itself.
      const wideWindow = (): [string, string] => [
        new Date(Date.now() - 3_600_000).toISOString(),
        new Date(Date.now() + 3_600_000).toISOString(),
      ];
      const sumOf = (
        rows: Awaited<ReturnType<Db["getOrgUsageMeters"]>>,
        resource: string
      ) =>
        rows
          .filter((r) => r.resource === resource)
          .reduce(
            (acc, r) => ({
              tokens: acc.tokens + r.inputTokens + r.outputTokens,
              units: acc.units + r.units,
            }),
            { tokens: 0, units: 0 }
          );

      it("groups model calls by resource, provider and model", async () => {
        const [from, to] = wideWindow();
        const before = await db.getOrgUsageMeters(ctx.organizationId, from, to);
        await db.recordAiUsage([
          {
            organizationId: ctx.organizationId,
            assistantId: null,
            stage: "generate",
            provider: "google",
            modelId: "gemini-3.5-flash",
            credentialKind: "platform",
            inputTokens: 1_000,
            outputTokens: 100,
          },
          {
            organizationId: ctx.organizationId,
            assistantId: null,
            stage: "embed",
            provider: "openai",
            modelId: "text-embedding-3-small",
            credentialKind: "platform",
            inputTokens: 2_000,
            outputTokens: 0,
          },
        ]);
        const after = await db.getOrgUsageMeters(ctx.organizationId, from, to);
        expect(sumOf(after, "ai").tokens - sumOf(before, "ai").tokens).toBe(1_100);
        expect(
          sumOf(after, "embedding").tokens - sumOf(before, "embedding").tokens
        ).toBe(2_000);
        const flash = after.find(
          (r) => r.resource === "ai" && r.modelId === "gemini-3.5-flash"
        );
        expect(flash).toMatchObject({ provider: "google", credentialKind: "platform" });
      });

      it("counts crawled pages as the scraping resource", async () => {
        const [from, to] = wideWindow();
        const before = await db.getOrgUsageMeters(ctx.organizationId, from, to);
        await db.recordRuntimeEvent({
          organizationId: ctx.organizationId,
          assistantId: null,
          kind: "crawl",
          status: "succeeded",
          crawlerProvider: "crawl4ai",
          pageCount: 30,
        });
        const after = await db.getOrgUsageMeters(ctx.organizationId, from, to);
        expect(
          sumOf(after, "scraping").units - sumOf(before, "scraping").units
        ).toBe(30);
        expect(
          after.some((r) => r.resource === "scraping" && r.provider === "crawl4ai")
        ).toBe(true);
      });

      it("excludes usage outside the window at both ends", async () => {
        await db.recordAiUsage([
          {
            organizationId: ctx.organizationId,
            assistantId: null,
            stage: "generate",
            provider: "google",
            modelId: "gemini-3.5-flash",
            credentialKind: "platform",
            inputTokens: 500,
            outputTokens: 50,
          },
        ]);
        const past = await db.getOrgUsageMeters(
          ctx.organizationId,
          new Date(Date.now() - 7_200_000).toISOString(),
          new Date(Date.now() - 3_600_000).toISOString()
        );
        const future = await db.getOrgUsageMeters(
          ctx.organizationId,
          new Date(Date.now() + 3_600_000).toISOString(),
          new Date(Date.now() + 7_200_000).toISOString()
        );
        expect(sumOf(past, "ai").tokens).toBe(0);
        expect(sumOf(future, "ai").tokens).toBe(0);
      });

      it("does not double-count once the rollup has run", async () => {
        const [from, to] = wideWindow();
        await db.recordAiUsage([
          {
            organizationId: ctx.organizationId,
            assistantId: null,
            stage: "generate",
            provider: "google",
            modelId: "gemini-3.1-flash-lite",
            credentialKind: "platform",
            inputTokens: 300,
            outputTokens: 30,
          },
        ]);
        const beforeRollup = sumOf(
          await db.getOrgUsageMeters(ctx.organizationId, from, to),
          "ai"
        );
        await db.rollupUsageDaily(2);
        await db.rollupUsageDaily(2);
        expect(
          sumOf(await db.getOrgUsageMeters(ctx.organizationId, from, to), "ai")
        ).toEqual(beforeRollup);
      });

      it("reads nothing from a window that closes before today began", async () => {
        // Rows recorded now belong to today, which is served live; a window that
        // ends at today's start must therefore see none of them, whether or not
        // the rollup has run. This is the boundary where the read switches from
        // the rollup to the raw sources.
        await db.recordAiUsage([
          {
            organizationId: ctx.organizationId,
            assistantId: null,
            stage: "generate",
            provider: "google",
            modelId: "gemini-3.5-flash",
            credentialKind: "platform",
            inputTokens: 900,
            outputTokens: 90,
          },
        ]);
        await db.rollupUsageDaily(2);
        const startOfToday = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
        const closed = await db.getOrgUsageMeters(
          ctx.organizationId,
          new Date(Date.parse(startOfToday) - 7 * 86_400_000).toISOString(),
          startOfToday
        );
        const today = await db.getOrgUsageMeters(
          ctx.organizationId,
          startOfToday,
          new Date(Date.now() + 3_600_000).toISOString()
        );
        expect(sumOf(closed, "ai").tokens).toBe(0);
        expect(sumOf(today, "ai").tokens).toBeGreaterThanOrEqual(990);
      });

      it("reads the same window whether the instant is spelled with Z or an offset", async () => {
        // Two legal spellings of one instant must not compare differently, a
        // string comparison would put them in different windows.
        const [from, to] = wideWindow();
        const withOffset = (iso: string) => iso.replace("Z", "+00:00");
        expect(
          await db.getOrgUsageMeters(ctx.organizationId, withOffset(from), withOffset(to))
        ).toEqual(await db.getOrgUsageMeters(ctx.organizationId, from, to));
      });

      it("scopes the window read to the requested organization", async () => {
        const [from, to] = wideWindow();
        const before = await db.getOrgUsageMeters(ctx.organizationId, from, to);
        await db.recordAiUsage([
          {
            organizationId: ctx.foreignOrganizationId,
            assistantId: null,
            stage: "generate",
            provider: "openai",
            modelId: "gpt-5.1",
            credentialKind: "platform",
            inputTokens: 4_000,
            outputTokens: 400,
          },
        ]);
        await db.recordRuntimeEvent({
          organizationId: ctx.foreignOrganizationId,
          assistantId: null,
          kind: "crawl",
          status: "succeeded",
          crawlerProvider: "apify",
          pageCount: 77,
        });
        const after = await db.getOrgUsageMeters(ctx.organizationId, from, to);
        expect(sumOf(after, "ai")).toEqual(sumOf(before, "ai"));
        expect(sumOf(after, "scraping")).toEqual(sumOf(before, "scraping"));
      });
    });

    describe("alerts (dedup by sourceKey)", () => {
      it("accepts the knowledge type a dangling Teammate scope raises (#769)", async () => {
        // The column carries a check constraint, so an Alert type the migration
        // did not widen is refused by the database, not by the type system.
        const raised = await db.raiseAlert(ctx.organizationId, {
          type: "knowledge",
          title: "Deleted collection still in a teammate's knowledge",
          detail: "Nora searches a collection that no longer exists.",
          sourceKey: `teammate-scope:${shortId()}`,
        });
        expect(raised.type).toBe("knowledge");
      });

      it("refreshes the active alert with the same sourceKey instead of duplicating", async () => {
        const sourceKey = `contract-alert:${shortId()}`;
        const activeBefore = await db.countActiveAlerts(ctx.organizationId);

        const first = await db.raiseAlert(ctx.organizationId, {
          type: "crawl",
          title: "Crawl failing",
          detail: "boom",
          sourceKey,
        });
        expect(first).toMatchObject({
          organizationId: ctx.organizationId,
          type: "crawl",
          status: "active",
          sourceKey,
          resolvedAt: null,
          resolvedBy: null,
        });
        expect(first.detectedAt).toBeTruthy();

        // Same sourceKey while active: the SAME alert is refreshed in place.
        const again = await db.raiseAlert(ctx.organizationId, {
          type: "crawl",
          title: "Crawl still failing",
          detail: "boom again",
          sourceKey,
        });
        expect(again.id).toBe(first.id);
        expect(again).toMatchObject({
          title: "Crawl still failing",
          detail: "boom again",
          status: "active",
        });
        expect(again.detectedAt >= first.detectedAt).toBe(true);

        const listed = (await db.listAlerts(ctx.organizationId)).filter(
          (a) => a.sourceKey === sourceKey
        );
        expect(listed).toHaveLength(1);
        expect(await db.countActiveAlerts(ctx.organizationId)).toBe(activeBefore + 1);

        // Auto-resolve by key clears it (resolvedBy stays null = auto)…
        await db.resolveAlertsByKey(ctx.organizationId, sourceKey);
        const resolved = (await db.listAlerts(ctx.organizationId)).find(
          (a) => a.id === first.id
        );
        expect(resolved).toMatchObject({ status: "resolved", resolvedBy: null });
        expect(resolved?.resolvedAt).toBeTruthy();
        expect(await db.countActiveAlerts(ctx.organizationId)).toBe(activeBefore);

        // …and only ACTIVE alerts dedup: re-raising after resolve starts a
        // fresh alert instead of reviving the resolved one.
        const reRaised = await db.raiseAlert(ctx.organizationId, {
          type: "crawl",
          title: "Crawl failing anew",
          detail: "boom 3",
          sourceKey,
        });
        expect(reRaised.id).not.toBe(first.id);
        expect(reRaised.status).toBe("active");
        await db.resolveAlertsByKey(ctx.organizationId, sourceKey);
      });

      it("never dedups alerts without a sourceKey, and resolve-by-key is org-scoped", async () => {
        const a = await db.raiseAlert(ctx.organizationId, {
          type: "system",
          title: "Keyless one",
          detail: "d1",
        });
        const b = await db.raiseAlert(ctx.organizationId, {
          type: "system",
          title: "Keyless two",
          detail: "d2",
        });
        expect(a.sourceKey).toBeNull();
        expect(b.id).not.toBe(a.id);

        // Another organization resolving the same key never touches ours.
        const sourceKey = `contract-alert:${shortId()}`;
        const mine = await db.raiseAlert(ctx.organizationId, {
          type: "integration",
          title: "Foreign-resolve probe",
          detail: "d",
          sourceKey,
        });
        await db.resolveAlertsByKey(ctx.foreignOrganizationId, sourceKey);
        expect(
          (await db.listAlerts(ctx.organizationId)).find((x) => x.id === mine.id)
            ?.status
        ).toBe("active");
        // Clean up the active fixtures for later count-based assertions.
        await db.resolveAlert(a.id, ctx.userId);
        await db.resolveAlert(b.id, ctx.userId);
        await db.resolveAlertsByKey(ctx.organizationId, sourceKey);
      });

      it("lists only active alerts, newest first, capped at the limit", async () => {
        const raised = [];
        for (const title of ["Stack one", "Stack two", "Stack three"]) {
          raised.push(
            await db.raiseAlert(ctx.organizationId, {
              type: "system",
              title,
              detail: "d",
              sourceKey: `contract-alert:${shortId()}`,
            })
          );
        }
        const [oldest, , newest] = raised;

        const capped = await db.listActiveAlerts(ctx.organizationId, 2);
        expect(capped).toHaveLength(2);
        expect(capped.every((alert) => alert.status === "active")).toBe(true);
        // Newest first (raises inside one millisecond can tie, so compare
        // timestamps rather than pinning an id).
        expect(capped[0].detectedAt >= capped[1].detectedAt).toBe(true);

        // Resolved alerts drop out of the list.
        await db.resolveAlert(newest.id, ctx.userId);
        const afterResolve = await db.listActiveAlerts(ctx.organizationId, 100);
        expect(afterResolve.map((alert) => alert.id)).not.toContain(newest.id);
        expect(afterResolve.map((alert) => alert.id)).toContain(oldest.id);

        for (const alert of raised) {
          if (alert.id !== newest.id) await db.resolveAlert(alert.id, ctx.userId);
        }
      });
    });

    describe("help desk ticketing integration (sealed credentials)", () => {
      it("writes the sealed config verbatim and reads it back, replaces, and clears", async () => {
        const desk = await db.createHelpDesk(ctx.organizationId, {
          name: "Contract Desk",
        });
        expect(desk.ticketingIntegration).toBeNull();

        const config = {
          baseUrl: "https://contract.service-now.com",
          clientId: "client-1",
          clientSecret: "sealed:client-secret", // pre-sealed by the caller
          username: "svc-user",
          password: "sealed:password",
        };
        const connected = await db.setTicketingIntegration(desk.id, {
          platform: "servicenow",
          name: "Production ServiceNow",
          config,
        });
        // The write returns the full HelpDesk with the integration attached;
        // sealed values round-trip verbatim (the Db never unseals).
        expect(connected.id).toBe(desk.id);
        expect(connected.ticketingIntegration).toMatchObject({
          platform: "servicenow",
          name: "Production ServiceNow",
          config,
        });
        expect(connected.ticketingIntegration?.id).toBeTruthy();
        expect(connected.ticketingIntegration?.connectedAt).toBeTruthy();
        expect((await db.getHelpDesk(desk.id))?.ticketingIntegration).toMatchObject({
          platform: "servicenow",
          config,
        });

        // Setting again replaces the whole integration, not merges it.
        const replaced = await db.setTicketingIntegration(desk.id, {
          platform: "servicenow",
          name: "Secondary ServiceNow",
          config: { ...config, clientSecret: "sealed:rotated" },
        });
        expect(replaced.ticketingIntegration).toMatchObject({
          platform: "servicenow",
          name: "Secondary ServiceNow",
          config: { ...config, clientSecret: "sealed:rotated" },
        });

        const cleared = await db.clearTicketingIntegration(desk.id);
        expect(cleared.ticketingIntegration).toBeNull();
        expect((await db.getHelpDesk(desk.id))?.ticketingIntegration).toBeNull();
      });
    });

    describe("widget SSO connection (sealed secret, one per org)", () => {
      it("upserts, reads back, validates, redacts to public, and clears", async () => {
        expect(await db.getSsoConnection(ctx.organizationId)).toBeNull();
        expect(await db.getSsoConnectionPublic(ctx.organizationId)).toBeNull();

        const connected = await db.setSsoConnection(ctx.organizationId, {
          provider: "entra",
          config: { clientId: "client-abc", tenantId: "tenant-123" },
          encryptedSecret: "sealed:entra-secret", // pre-sealed by the caller
        });
        expect(connected).toMatchObject({
          organizationId: ctx.organizationId,
          provider: "entra",
          config: { clientId: "client-abc", tenantId: "tenant-123" },
          encryptedSecret: "sealed:entra-secret", // stored verbatim; Db never seals
          validationStatus: "unvalidated",
          validatedAt: null,
        });
        expect(connected.id).toBeTruthy();

        const read = await db.getSsoConnection(ctx.organizationId);
        expect(read?.config.clientId).toBe("client-abc");
        expect(read?.encryptedSecret).toBe("sealed:entra-secret");

        // The public projection never carries config or secrets.
        const pub = await db.getSsoConnectionPublic(ctx.organizationId);
        expect(pub).toEqual({ provider: "entra" });

        // Scoped per org: another org sees nothing.
        expect(await db.getSsoConnection(ctx.missingOrganizationId)).toBeNull();
        expect(
          await db.getSsoConnectionPublic(ctx.missingOrganizationId)
        ).toBeNull();

        // Validation status transitions and stamps validatedAt.
        const valid = await db.setSsoConnectionValidation(
          ctx.organizationId,
          "valid"
        );
        expect(valid.validationStatus).toBe("valid");
        expect(valid.validatedAt).toBeTruthy();

        // Re-setting replaces wholesale and resets validation.
        const rotated = await db.setSsoConnection(ctx.organizationId, {
          provider: "entra",
          config: { clientId: "client-xyz", tenantId: "tenant-123" },
          encryptedSecret: "sealed:rotated",
        });
        expect(rotated.config.clientId).toBe("client-xyz");
        expect(rotated.validationStatus).toBe("unvalidated");
        expect(rotated.validatedAt).toBeNull();
        // Rotation preserves the original first-connected timestamp.
        expect(rotated.connectedAt).toBe(connected.connectedAt);

        await db.clearSsoConnection(ctx.organizationId);
        expect(await db.getSsoConnection(ctx.organizationId)).toBeNull();
      });
    });

    describe("API integration (sealed credential, one per assistant)", () => {
      it("upserts, reads back, keeps the credential across a catalogue edit, and deletes", async () => {
        const assistant = await newAssistant();
        expect(await db.getApiIntegration(assistant.id)).toBeNull();

        const endpoints = [
          {
            id: "e1",
            name: "Ticket comments",
            path: "/tickets/{ticketId}/comments",
            method: "GET" as const,
            purpose: "The comments on one ticket.",
            params: [{ name: "ticketId", in: "path" as const, type: "string" as const }],
            responseKeys: ["items"],
          },
        ];
        const saved = await db.setApiIntegration({
          assistantId: assistant.id,
          organizationId: ctx.organizationId,
          name: "Service desk API",
          baseUrl: "https://api.example.com/v1",
          authType: "bearer",
          encryptedCredential: "sealed:desk-token", // pre-sealed by the caller
          endpoints,
        });
        expect(saved).toMatchObject({
          assistantId: assistant.id,
          organizationId: ctx.organizationId,
          name: "Service desk API",
          baseUrl: "https://api.example.com/v1",
          authType: "bearer",
          // Stored verbatim: this seam never seals and never unseals.
          encryptedCredential: "sealed:desk-token",
          authHeaderName: "",
          authUsername: "",
        });
        expect(saved.endpoints).toEqual(endpoints);

        const read = await db.getApiIntegration(assistant.id);
        expect(read?.encryptedCredential).toBe("sealed:desk-token");
        expect(read?.endpoints[0].path).toBe("/tickets/{ticketId}/comments");

        // Editing the catalogue with no credential field keeps the stored one,
        // so an admin never has to re-enter a secret to add an endpoint.
        const edited = await db.setApiIntegration({
          assistantId: assistant.id,
          organizationId: ctx.organizationId,
          name: "Service desk API",
          baseUrl: "https://api.example.com/v1",
          authType: "bearer",
          endpoints: [
            ...endpoints,
            {
              id: "e2",
              name: "Ticket attachments",
              path: "/tickets/{ticketId}/attachments",
              method: "GET" as const,
              purpose: "The files attached to one ticket.",
            },
          ],
        });
        expect(edited.encryptedCredential).toBe("sealed:desk-token");
        expect(edited.endpoints).toHaveLength(2);
        // One integration per assistant: the upsert replaced, never duplicated.
        expect((await db.getApiIntegration(assistant.id))?.endpoints).toHaveLength(2);

        // An explicit null clears the credential.
        const cleared = await db.setApiIntegration({
          assistantId: assistant.id,
          organizationId: ctx.organizationId,
          name: "Service desk API",
          baseUrl: "https://api.example.com/v1",
          authType: "none",
          encryptedCredential: null,
          endpoints,
        });
        expect(cleared.encryptedCredential).toBeNull();

        await db.deleteApiIntegration(assistant.id);
        expect(await db.getApiIntegration(assistant.id)).toBeNull();
      });
    });

    describe("due goal claims", () => {
      it("claims due active goals once, stamping the lease, and respects the due time", async () => {
        const assistant = await newAssistant();
        const goal = await db.createAssistantGoal(assistant.id, {
          question: "Is the library open on Sundays?",
          expectations: { mustContain: ["Sunday"] },
        });
        const quarantined = await db.createAssistantGoal(assistant.id, {
          question: "Quarantined question",
          expectations: {},
        });
        await db
          .table("assistantGoals")
          .update(quarantined.id, { status: "quarantined" });

        // The claim is cross-org; other fixtures may be due too, filter by id.
        const dueBefore = new Date().toISOString();
        const first = await db.claimDueAssistantGoals({ dueBefore, limit: 1000 });
        const mine = first.find((g) => g.id === goal.id);
        expect(mine).toBeTruthy();
        // Claiming stamps last_run_at (the lease) but keeps the prior result.
        expect(mine?.lastRunAt).toBeTruthy();
        expect(mine?.lastResult).toBeNull();
        expect(mine?.question).toBe("Is the library open on Sundays?");
        // Quarantined goals are never claimed.
        expect(first.some((g) => g.id === quarantined.id)).toBe(false);

        // The stamped lease makes it not-due for the same window: a second
        // tick with the same dueBefore never double-claims.
        const second = await db.claimDueAssistantGoals({ dueBefore, limit: 1000 });
        expect(second.some((g) => g.id === goal.id)).toBe(false);

        // Once the cadence window moves past the lease, it is due again.
        const futureDue = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const third = await db.claimDueAssistantGoals({
          dueBefore: futureDue,
          limit: 1000,
        });
        expect(third.some((g) => g.id === goal.id)).toBe(true);
        expect(third.some((g) => g.id === quarantined.id)).toBe(false);
      });
    });

    describe("answer verifier claims", () => {
      const pastStale = () => new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const futureStale = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
      // Guarantees distinct message timestamps for the question lookup.
      const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

      const seedGenerativeAnswer = async () => {
        const assistant = await newAssistant();
        const conversation = await db.createConversation({
          assistantId: assistant.id,
          subjectType: "visitor",
          subjectId: "visitor-verifier",
        });
        await db.appendMessage({
          conversationId: conversation.id,
          role: "user",
          content: [{ type: "text", text: "What does parking cost?" }],
        });
        await tick();
        const answer = await db.appendMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: [
            { type: "text", text: "Parking costs 3â‚¬/day.", action: "search_knowledge" },
          ],
        });
        return { assistant, conversation, answer };
      };

      it("claims a generative answer once, releases, and re-claims stale claims", async () => {
        const { assistant, conversation, answer } = await seedGenerativeAnswer();
        // A verbatim (non-generative) answer is never a candidate.
        const verbatim = await db.appendMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: [{ type: "text", text: "Fixed greeting." }],
        });
        // Nor is a Basic Interaction courtesy reply (#565): it is generated, but
        // it cites nothing, so there is nothing to grade it against. This
        // exclusion is load-bearing for that feature, not incidental.
        const courtesy = await db.appendMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: [
            { type: "text", text: "Hi! What would you like to know?", action: "basic_reply" },
          ],
        });

        const first = await db.claimUnverifiedAnswers({
          limit: 1000,
          staleBefore: pastStale(),
        });
        const mine = first.find((c) => c.messageId === answer.id);
        expect(mine).toMatchObject({
          conversationId: conversation.id,
          assistantId: assistant.id,
          organizationId: ctx.organizationId,
          question: "What does parking cost?",
        });
        expect(first.some((c) => c.messageId === verbatim.id)).toBe(false);
        expect(first.some((c) => c.messageId === courtesy.id)).toBe(false);

        // The fresh claim blocks a second tick from double-grading.
        const second = await db.claimUnverifiedAnswers({
          limit: 1000,
          staleBefore: pastStale(),
        });
        expect(second.some((c) => c.messageId === answer.id)).toBe(false);

        // Releasing (graded nothing) makes it immediately claimable again.
        await db.releaseAnswerVerifierClaim(answer.id);
        const third = await db.claimUnverifiedAnswers({
          limit: 1000,
          staleBefore: pastStale(),
        });
        expect(third.some((c) => c.messageId === answer.id)).toBe(true);

        // A stale claim (older than staleBefore) is re-claimable, a crashed
        // run retries on the next tick without manual cleanup.
        const fourth = await db.claimUnverifiedAnswers({
          limit: 1000,
          staleBefore: futureStale(),
        });
        expect(fourth.some((c) => c.messageId === answer.id)).toBe(true);
      });

      it("stops returning an answer once its verdict is recorded, even to stale re-claims", async () => {
        const { assistant, answer } = await seedGenerativeAnswer();
        expect(
          await db.recordAnswerVerdict({
            messageId: answer.id,
            organizationId: ctx.organizationId,
            assistantId: assistant.id,
            flowId: null,
            verdict: "pass",
            reason: "grounded",
            modelId: "claude-haiku-4-5",
          })
        ).toBe(true);
        const claimed = await db.claimUnverifiedAnswers({
          limit: 1000,
          staleBefore: futureStale(),
        });
        expect(claimed.some((c) => c.messageId === answer.id)).toBe(false);
      });
    });

    describe("compost claims", () => {
      const pastStale = () => new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const future = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

      const publishedAssistant = async () => {
        const assistant = await newAssistant();
        const flows = await db.listFlows(assistant.id);
        await db.createPublication(
          assistant.id,
          buildPublicationConfig(assistant, flows, [])
        );
        return assistant;
      };

      it("claims a due published assistant once per window; a stale claim is re-claimable", async () => {
        const assistant = await publishedAssistant();
        const unpublished = await newAssistant();

        const dueBefore = new Date().toISOString();
        const first = await db.claimDueCompostAssistants({
          dueBefore,
          staleBefore: pastStale(),
          limit: 1000,
        });
        const mine = first.find((d) => d.assistantId === assistant.id);
        expect(mine).toMatchObject({
          assistantId: assistant.id,
          organizationId: ctx.organizationId,
          lastRunAt: null, // never composted before
        });

        // Second tick in the same window: the fresh claim hides it before any
        // digest or model call.
        const second = await db.claimDueCompostAssistants({
          dueBefore,
          staleBefore: pastStale(),
          limit: 1000,
        });
        expect(second.some((d) => d.assistantId === assistant.id)).toBe(false);

        // A stale claim (crashed run) is re-claimable next window; assistants
        // without a Publication are never claimed at all.
        const third = await db.claimDueCompostAssistants({
          dueBefore: future(),
          staleBefore: future(),
          limit: 1000,
        });
        expect(third.some((d) => d.assistantId === assistant.id)).toBe(true);
        expect(third.some((d) => d.assistantId === unpublished.id)).toBe(false);
      });

      it("treats a recorded run as the window marker and honors the org opt-out", async () => {
        const assistant = await publishedAssistant();
        const beforeRun = new Date().toISOString();
        await db.recordCompostRun({
          assistantId: assistant.id,
          organizationId: ctx.organizationId,
          windowStart: "2026-07-04T00:00:00.000Z",
          windowEnd: "2026-07-11T00:00:00.000Z",
          proposals: 0,
          clean: true,
        });

        // The run postdates dueBefore â†’ not due this window (stale claims
        // ruled out via a future staleBefore, so the run is what gates it).
        const gated = await db.claimDueCompostAssistants({
          dueBefore: beforeRun,
          staleBefore: future(),
          limit: 1000,
        });
        expect(gated.some((d) => d.assistantId === assistant.id)).toBe(false);

        // Once dueBefore passes the run, it is due again and the claim
        // carries the last run timestamp.
        const nextWindow = await db.claimDueCompostAssistants({
          dueBefore: future(),
          staleBefore: future(),
          limit: 1000,
        });
        const due = nextWindow.find((d) => d.assistantId === assistant.id);
        expect(due?.lastRunAt).toBeTruthy();

        // Opted-out organizations are excluded entirely.
        await db.setCompostOptOut(ctx.organizationId, true);
        const optedOut = await db.claimDueCompostAssistants({
          dueBefore: future(),
          staleBefore: future(),
          limit: 1000,
        });
        expect(optedOut.some((d) => d.assistantId === assistant.id)).toBe(false);
        await db.setCompostOptOut(ctx.organizationId, false);
        const optedBackIn = await db.claimDueCompostAssistants({
          dueBefore: future(),
          staleBefore: future(),
          limit: 1000,
        });
        expect(optedBackIn.some((d) => d.assistantId === assistant.id)).toBe(true);
      });
    });

    describe("AI Teammates (#768)", () => {
      const teammates = () => db.table("teammates");
      const newTeammate = (over: Record<string, unknown> = {}) =>
        teammates().insert({
          organizationId: ctx.organizationId,
          ownerId: ctx.userId,
          name: "Nora",
          ...over,
        });

      it("creates one from a name alone, with the shipped defaults", async () => {
        const teammate = await newTeammate();
        expect(teammate.organizationId).toBe(ctx.organizationId);
        expect(teammate.ownerId).toBe(ctx.userId);
        expect(teammate.title).toBe("");
        expect(teammate.roleDescription).toBe("");
        // Visible to the team and searching nothing: the two defaults a Member
        // is most likely to leave alone.
        expect(teammate.visibility).toBe("org");
        expect(teammate.collectionIds).toEqual([]);
        expect(teammate.editorIds).toEqual([]);
        expect(teammate.modelProvider).toBe("anthropic");
        expect(teammate.deletedAt).toBeNull();
      });

      it("keeps the persona, the scope and the editors through a patch", async () => {
        const teammate = await newTeammate({ name: "Draft" });
        const updated = await teammates().update(teammate.id, {
          name: "Nora",
          title: "Support Copywriter",
          roleDescription: "You draft replies from our docs.",
          visibility: "private",
          collectionIds: ["col-a", "col-b"],
          editorIds: ["member-2"],
        });
        expect(updated.name).toBe("Nora");
        expect(updated.collectionIds).toEqual(["col-a", "col-b"]);
        expect(updated.editorIds).toEqual(["member-2"]);
        expect(updated.visibility).toBe("private");
        // A patch that names no scope leaves the stored one alone.
        const again = await teammates().update(teammate.id, { title: "Editor" });
        expect(again.collectionIds).toEqual(["col-a", "col-b"]);
      });

      it("soft-deletes: the row stays, and so do its Conversations", async () => {
        const teammate = await newTeammate();
        const conversation = await db.createConversation({
          teammateId: teammate.id,
          subjectType: "member",
          subjectId: ctx.userId,
          title: "before the tombstone",
        });
        await db.appendMessage({
          conversationId: conversation.id,
          role: "user",
          content: [{ type: "text", text: "hello" }],
        });

        const tombstoned = await teammates().update(teammate.id, {
          deletedAt: new Date().toISOString(),
        });
        expect(tombstoned.deletedAt).toBeTruthy();
        expect(await teammates().get(teammate.id)).not.toBeNull();
        const stored = await db.getConversation(conversation.id);
        expect(stored?.title).toBe("before the tombstone");
        expect(
          (await db.listMessages(conversation.id)).map((m) => m.role)
        ).toEqual(["user"]);
      });

      it("ships with the shipped governance: edit ceiling, no bypass", async () => {
        const teammate = await newTeammate();
        // The two defaults that decide what a brand-new Teammate may do. Both
        // are deliberately the conservative half: it may write inside a domain
        // somebody granted it, and it may not approve its own knowledge edits.
        expect(teammate.capabilityCeiling).toBe("edit");
        expect(teammate.approvalBypass).toBe(false);
      });

      it("carries the ceiling and the bypass through a governance patch", async () => {
        const teammate = await newTeammate();
        const lowered = await teammates().update(teammate.id, {
          capabilityCeiling: "member",
        });
        expect(lowered.capabilityCeiling).toBe("member");
        // Untouched by a patch that does not name it: the bypass is a separate
        // decision from the ceiling, and lowering one must not clear the other.
        expect(lowered.approvalBypass).toBe(false);

        const trusted = await teammates().update(teammate.id, {
          approvalBypass: true,
        });
        expect(trusted.approvalBypass).toBe(true);
        expect(trusted.capabilityCeiling).toBe("member");
      });

      it("grants: the row is the grant, and revoking deletes it", async () => {
        const grants = () => db.table("teammateGrants");
        const teammate = await newTeammate();
        const granted = await grants().insert({
          organizationId: ctx.organizationId,
          teammateId: teammate.id,
          domain: "improvements",
          grantedBy: ctx.userId,
        });
        expect(granted.domain).toBe("improvements");
        expect(granted.grantedBy).toBe(ctx.userId);

        const held = await grants().list({ teammateId: teammate.id });
        expect(held.map((g) => g.domain)).toEqual(["improvements"]);

        await grants().delete(granted.id);
        expect(await grants().list({ teammateId: teammate.id })).toEqual([]);
      });

      it("grants: a second Teammate's rows are not this one's", async () => {
        const grants = () => db.table("teammateGrants");
        const [mine, theirs] = await Promise.all([
          newTeammate({ name: "Mine" }),
          newTeammate({ name: "Theirs" }),
        ]);
        await grants().insert({
          organizationId: ctx.organizationId,
          teammateId: mine.id,
          domain: "knowledge",
        });
        await grants().insert({
          organizationId: ctx.organizationId,
          teammateId: theirs.id,
          domain: "inbox",
        });
        expect(
          (await grants().list({ teammateId: mine.id })).map((g) => g.domain)
        ).toEqual(["knowledge"]);
        expect(
          (await grants().list({ teammateId: theirs.id })).map((g) => g.domain)
        ).toEqual(["inbox"]);
      });

      it("hiding: one Member's roster, and nobody else's", async () => {
        const hidden = () => db.table("teammateRosterHidden");
        const teammate = await newTeammate();
        const row = await hidden().insert({
          organizationId: ctx.organizationId,
          teammateId: teammate.id,
          userId: ctx.userId,
        });
        expect(row.teammateId).toBe(teammate.id);
        expect(row.userId).toBe(ctx.userId);

        expect(
          (await hidden().list({ userId: ctx.userId })).map((r) => r.teammateId)
        ).toEqual([teammate.id]);
        // The Teammate itself is untouched: hiding is a fact about a list.
        expect((await teammates().get(teammate.id))?.deletedAt).toBeNull();

        // Unhiding is a delete, because the row is the whole fact.
        await hidden().delete(row.id);
        expect(await hidden().list({ userId: ctx.userId })).toEqual([]);
      });

      it("hiding: deleting the Teammate takes the hidden rows with it", async () => {
        const hidden = () => db.table("teammateRosterHidden");
        const teammate = await newTeammate();
        await hidden().insert({
          organizationId: ctx.organizationId,
          teammateId: teammate.id,
          userId: ctx.userId,
        });
        await teammates().delete(teammate.id);
        expect(await hidden().list({ teammateId: teammate.id })).toEqual([]);
      });

      it("grants: deleting the Teammate takes its grants with it", async () => {
        const grants = () => db.table("teammateGrants");
        const teammate = await newTeammate();
        await grants().insert({
          organizationId: ctx.organizationId,
          teammateId: teammate.id,
          domain: "improvements",
        });
        // A hard delete, not the soft-delete tombstone: a Teammate row that is
        // gone must not leave capabilities pointing at nothing.
        await teammates().delete(teammate.id);
        expect(await grants().list({ teammateId: teammate.id })).toEqual([]);
      });

      it("owns its Conversations, and they stay out of the Inbox", async () => {
        const assistant = await newAssistant();
        const teammate = await newTeammate();
        const internal = await db.createConversation({
          teammateId: teammate.id,
          subjectType: "member",
          subjectId: ctx.userId,
          title: "internal",
        });
        const customerFacing = await db.createConversation({
          assistantId: assistant.id,
          subjectType: "visitor",
          subjectId: "visitor-teammate-case",
          title: "customer",
        });

        expect(internal.assistantId).toBeNull();
        expect(internal.teammateId).toBe(teammate.id);
        expect(customerFacing.teammateId).toBeNull();

        const thread = await db.listTeammateConversations(
          teammate.id,
          ctx.userId
        );
        expect(thread.map((c) => c.id)).toEqual([internal.id]);
        // Another Member's thread with the same Teammate is not this one.
        expect(
          await db.listTeammateConversations(teammate.id, "someone-else")
        ).toEqual([]);

        // The Inbox is the customer queue: internal chat never joins it.
        const inbox = (
          await db.getInboxPage(ctx.organizationId, { limit: 100 })
        ).conversations;
        expect(inbox.map((c) => c.id)).toContain(customerFacing.id);
        expect(inbox.map((c) => c.id)).not.toContain(internal.id);
        expect("listInboxConversations" in db).toBe(false);
      });

      it("searches exactly the Collections in the Knowledge Scope", async () => {
        const assistant = await newAssistant();
        const seedCollection = async (name: string, content: string) => {
          const collection = await db.createCollection(assistant.id, { name });
          const source = await db.createSource({
            collectionId: collection.id,
            name: `${name} source`,
            kind: "text",
          });
          const concept = await db.createConcept({
            collectionId: collection.id,
            sourceId: source.id,
            path: `${name}/topic.md`,
            frontmatter: { type: "Note", title: name },
            body: content,
          });
          await db.saveChunks([
            {
              conceptId: concept.id,
              collectionId: collection.id,
              sourceId: source.id,
              content,
              embedding: null,
            },
          ]);
          return collection;
        };
        const inScope = await seedCollection(
          "Scoped",
          "Refunds are processed within five working days."
        );
        const outOfScope = await seedCollection(
          "Unscoped",
          "Refunds require a manager signature."
        );

        const hits = await db.searchCollectionChunks(
          ctx.organizationId,
          [inScope.id],
          { embedding: null, text: "how long do refunds take" }
        );
        expect(hits.length).toBeGreaterThan(0);
        expect(hits.every((h) => h.collectionId === inScope.id)).toBe(true);
        expect(hits[0].conceptTitle).toBe("Scoped");
        // The citation resolves to a Concept and its Source, exactly like an
        // Assistant search (ADR-0002).
        expect(hits[0].sourceName).toBe("Scoped source");

        // An empty scope is "nothing", never "everything".
        expect(
          await db.searchCollectionChunks(ctx.organizationId, [], {
            embedding: null,
            text: "refunds",
          })
        ).toEqual([]);
        // Another Organization asking for this Collection gets nothing.
        expect(
          await db.searchCollectionChunks(
            ctx.missingOrganizationId,
            [inScope.id, outOfScope.id],
            { embedding: null, text: "refunds" }
          )
        ).toEqual([]);
      });

      it("searches exactly the Library items in the Knowledge Scope", async () => {
        const assistant = await newAssistant();
        // Both items in ONE Collection, which is the case the Collection-scoped
        // search cannot express: picking a file must not drag its neighbours in.
        const collection = await db.createCollection(assistant.id, {
          name: "Handbook",
        });
        const seedSource = async (name: string, content: string) => {
          const source = await db.createSource({
            collectionId: collection.id,
            name,
            kind: "text",
          });
          const concept = await db.createConcept({
            collectionId: collection.id,
            sourceId: source.id,
            path: `${name}/topic.md`,
            frontmatter: { type: "Note", title: name },
            body: content,
          });
          await db.saveChunks([
            {
              conceptId: concept.id,
              collectionId: collection.id,
              sourceId: source.id,
              content,
              embedding: null,
            },
          ]);
          return source;
        };
        const picked = await seedSource(
          "Refund policy",
          "Refunds are processed within five working days."
        );
        const neighbour = await seedSource(
          "Escalation policy",
          "Refunds above ten thousand need a manager signature."
        );

        const hits = await db.searchSourceChunks(
          ctx.organizationId,
          [picked.id],
          { embedding: null, text: "how long do refunds take" }
        );
        expect(hits.length).toBeGreaterThan(0);
        expect(hits.every((h) => h.sourceId === picked.id)).toBe(true);
        expect(hits.some((h) => h.sourceId === neighbour.id)).toBe(false);
        // The citation resolves to a Concept and its Source, exactly like the
        // other two searches (ADR-0002).
        expect(hits[0].conceptTitle).toBe("Refund policy");
        expect(hits[0].sourceName).toBe("Refund policy");
        expect(hits[0].collectionId).toBe(collection.id);
        // A Teammate cites the file, it never hands out a signed original.
        expect(hits[0].directAccess).toBe(false);

        // An empty scope is "nothing", never "everything".
        expect(
          await db.searchSourceChunks(ctx.organizationId, [], {
            embedding: null,
            text: "refunds",
          })
        ).toEqual([]);
        // Another Organization asking for these Sources gets nothing: tenancy
        // reaches a Source through its Collection, not through the caller.
        expect(
          await db.searchSourceChunks(
            ctx.missingOrganizationId,
            [picked.id, neighbour.id],
            { embedding: null, text: "refunds" }
          )
        ).toEqual([]);
      });
    });

    describe("Teammate channels (#778)", () => {
      const channels = () => db.table("teammateChannels");
      const seats = () => db.table("teammateChannelParticipants");
      const newChannel = (over: Record<string, unknown> = {}) =>
        channels().insert({
          organizationId: ctx.organizationId,
          name: "Launch week",
          createdBy: ctx.userId,
          ...over,
        });
      const newTeammateFor = (name = "Sam") =>
        db.table("teammates").insert({
          organizationId: ctx.organizationId,
          ownerId: ctx.userId,
          name,
        });
      /** The creator's own seat: the first thing every real channel gets. */
      const seatMember = (channelId: string, userId = ctx.userId) =>
        seats().insert({
          organizationId: ctx.organizationId,
          channelId,
          userId,
          addedBy: ctx.userId,
        });

      it("creates one from a name, bound to no Project", async () => {
        const channel = await newChannel();
        expect(channel.organizationId).toBe(ctx.organizationId);
        expect(channel.name).toBe("Launch week");
        expect(channel.createdBy).toBe(ctx.userId);
        expect(channel.projectId).toBeNull();
      });

      it("seats Members and Teammates in one roster, in the order added", async () => {
        const channel = await newChannel();
        const teammate = await newTeammateFor();
        const member = await seatMember(channel.id);
        const agent = await seats().insert({
          organizationId: ctx.organizationId,
          channelId: channel.id,
          teammateId: teammate.id,
          addedBy: ctx.userId,
        });
        expect(member.teammateId).toBeNull();
        expect(member.lastReadAt).toBeNull();
        expect(agent.userId).toBeNull();

        const roster = await seats().list({ channelId: channel.id });
        expect(roster.map((row) => row.id)).toEqual([member.id, agent.id]);
      });

      it("moves a Member's own read marker and nothing else", async () => {
        const channel = await newChannel();
        const seat = await seatMember(channel.id);
        const marked = await seats().update(seat.id, {
          lastReadAt: "2026-08-24T10:00:00.000Z",
        });
        expect(marked.lastReadAt).toBe("2026-08-24T10:00:00.000Z");
        expect(marked.userId).toBe(ctx.userId);
      });

      it("reads the transcript back in the order it was written", async () => {
        const channel = await newChannel();
        await seatMember(channel.id);
        const teammate = await newTeammateFor();
        const opening = await db.appendChannelMessage({
          organizationId: ctx.organizationId,
          channelId: channel.id,
          authorType: "member",
          authorUserId: ctx.userId,
          content: [{ type: "text", text: "@Sam what broke?" }],
          mentions: [teammate.id],
        });
        // Written in the same millisecond as the reply on a fast machine: the
        // per-channel order is what the contract promises, not the clock.
        const reply = await db.appendChannelMessage({
          organizationId: ctx.organizationId,
          channelId: channel.id,
          authorType: "teammate",
          authorTeammateId: teammate.id,
          content: [{ type: "text", text: "The crawl did." }],
          chainId: opening.id,
        });
        const marker = await db.appendChannelMessage({
          organizationId: ctx.organizationId,
          channelId: channel.id,
          authorType: "system",
          content: [{ type: "text", text: "Chain cap reached" }],
          chainId: opening.id,
        });

        expect(opening.chainId).toBeNull();
        expect(opening.mentions).toEqual([teammate.id]);
        expect(reply.authorUserId).toBeNull();
        expect(marker.authorTeammateId).toBeNull();

        const transcript = await db.listChannelMessages(channel.id);
        expect(transcript.map((m) => m.id)).toEqual([
          opening.id,
          reply.id,
          marker.id,
        ]);
        // The roster sorts by activity, so the channel row moved with it.
        const moved = await channels().get(channel.id);
        expect(moved!.updatedAt >= channel.updatedAt).toBe(true);
      });

      it("reads one bounded transcript tail for each requested Channel", async () => {
        const first = await newChannel({ name: "First" });
        const second = await newChannel({ name: "Second" });
        for (const [channel, prefix] of [
          [first, "a"],
          [second, "b"],
        ] as const) {
          for (let index = 0; index < 3; index += 1) {
            await db.appendChannelMessage({
              organizationId: ctx.organizationId,
              channelId: channel.id,
              authorType: "member",
              authorUserId: ctx.userId,
              content: [{ type: "text", text: `${prefix}${index}` }],
            });
          }
        }

        const windows = await db.listChannelMessageWindows(
          [first.id, second.id],
          2,
        );
        expect(
          windows.map((message) => [message.channelId, message.content]),
        ).toEqual([
          [
            first.id,
            [{ type: "text", text: "a1" }],
          ],
          [
            first.id,
            [{ type: "text", text: "a2" }],
          ],
          [
            second.id,
            [{ type: "text", text: "b1" }],
          ],
          [
            second.id,
            [{ type: "text", text: "b2" }],
          ],
        ]);
      });

      it("reads the last N messages, not the first N", async () => {
        const channel = await newChannel({ name: "Long" });
        await seatMember(channel.id);
        const written = [];
        for (const text of ["one", "two", "three"]) {
          written.push(
            await db.appendChannelMessage({
              organizationId: ctx.organizationId,
              channelId: channel.id,
              authorType: "member",
              authorUserId: ctx.userId,
              content: [{ type: "text", text }],
            })
          );
        }
        const tail = await db.listChannelMessages(channel.id, 2);
        expect(tail.map((m) => m.id)).toEqual([written[1].id, written[2].id]);
      });

      it("reads exactly one chain, which is how the caps are counted", async () => {
        const channel = await newChannel({ name: "Two chains" });
        await seatMember(channel.id);
        const teammate = await newTeammateFor();
        const first = await db.appendChannelMessage({
          organizationId: ctx.organizationId,
          channelId: channel.id,
          authorType: "member",
          authorUserId: ctx.userId,
          content: [{ type: "text", text: "first" }],
        });
        const firstReply = await db.appendChannelMessage({
          organizationId: ctx.organizationId,
          channelId: channel.id,
          authorType: "teammate",
          authorTeammateId: teammate.id,
          content: [{ type: "text", text: "answering the first" }],
          chainId: first.id,
        });
        const second = await db.appendChannelMessage({
          organizationId: ctx.organizationId,
          channelId: channel.id,
          authorType: "member",
          authorUserId: ctx.userId,
          content: [{ type: "text", text: "second" }],
        });
        await db.appendChannelMessage({
          organizationId: ctx.organizationId,
          channelId: channel.id,
          authorType: "teammate",
          authorTeammateId: teammate.id,
          content: [{ type: "text", text: "answering the second" }],
          chainId: second.id,
        });

        const chain = await db.listChannelChainMessages(channel.id, first.id);
        expect(chain.map((m) => m.id)).toEqual([firstReply.id]);
      });

      it("deleting the channel takes its roster and its transcript", async () => {
        const channel = await newChannel({ name: "Doomed" });
        const seat = await seatMember(channel.id);
        await db.appendChannelMessage({
          organizationId: ctx.organizationId,
          channelId: channel.id,
          authorType: "member",
          authorUserId: ctx.userId,
          content: [{ type: "text", text: "hello" }],
        });

        await channels().delete(channel.id);
        expect(await seats().get(seat.id)).toBeNull();
        expect(await db.listChannelMessages(channel.id)).toEqual([]);
      });

      it("deleting a Teammate takes its seat and leaves the thread's history", async () => {
        const channel = await newChannel({ name: "Survivors" });
        await seatMember(channel.id);
        const teammate = await newTeammateFor("Gone");
        const seat = await seats().insert({
          organizationId: ctx.organizationId,
          channelId: channel.id,
          teammateId: teammate.id,
        });
        const said = await db.appendChannelMessage({
          organizationId: ctx.organizationId,
          channelId: channel.id,
          authorType: "teammate",
          authorTeammateId: teammate.id,
          content: [{ type: "text", text: "I was here" }],
        });

        await db.table("teammates").delete(teammate.id);
        expect(await seats().get(seat.id)).toBeNull();
        const transcript = await db.listChannelMessages(channel.id);
        const kept = transcript.find((m) => m.id === said.id);
        // The message stays, the author reference does not: a hard delete must
        // not rewrite what the channel said.
        expect(kept).toBeDefined();
        expect(kept!.authorTeammateId).toBeNull();
      });

      it("deleting the bound Project unbinds the channel instead of deleting it", async () => {
        const project = await db.table("projects").insert({
          organizationId: ctx.organizationId,
          name: "Migration",
        });
        const channel = await newChannel({
          name: "Bound",
          projectId: project.id,
        });
        expect(channel.projectId).toBe(project.id);

        await db.table("projects").delete(project.id);
        const after = await channels().get(channel.id);
        expect(after).not.toBeNull();
        expect(after!.projectId).toBeNull();
      });
    });

    describe("generic table access (ADR-0016)", () => {
      const skills = () => db.table("skills");
      const newSkill = (over: Partial<{ name: string; prompt: string; description: string }> = {}) =>
        skills().insert({
          organizationId: ctx.organizationId,
          name: "Generic Fixture",
          prompt: "Say hi",
          ...over,
        });

      it("inserts with spec defaults, generated id and timestamps", async () => {
        const skill = await newSkill();
        expect(skill.id).toBeTruthy();
        expect(skill.organizationId).toBe(ctx.organizationId);
        expect(skill.name).toBe("Generic Fixture");
        expect(skill.prompt).toBe("Say hi");
        expect(skill.description).toBe(""); // spec default fills the omitted field
        expect(skill.createdAt).toBeTruthy();
        expect(skill.updatedAt).toBeTruthy();
      });

      it("shares the table with the named cascade delete (deleteSkill)", async () => {
        // deleteSkill kept its named method for its assistant_skills cascade
        // (ADR-0016 stage 3): rows written through the accessor must be the
        // rows it deletes.
        const viaAccessor = await newSkill({ name: "Accessor Written" });
        await db.deleteSkill(viaAccessor.id);
        expect(await skills().get(viaAccessor.id)).toBeNull();
      });

      it("filters lists by domain field names; foreign org stays invisible", async () => {
        const skill = await newSkill({ name: "Filter Target" });
        const filtered = await skills().list({
          organizationId: ctx.organizationId,
          name: "Filter Target",
        });
        expect(filtered.map((s) => s.id)).toContain(skill.id);
        expect(filtered.every((s) => s.name === "Filter Target")).toBe(true);
        expect(
          await skills().list({ organizationId: ctx.missingOrganizationId })
        ).toEqual([]);
      });

      it("orders and limits lists", async () => {
        await newSkill({ name: "Order A", description: "order-fixture" });
        await newSkill({ name: "Order B", description: "order-fixture" });
        const desc = await skills().list(
          { organizationId: ctx.organizationId, description: "order-fixture" },
          { orderBy: "name", ascending: false }
        );
        expect(desc.map((s) => s.name)).toEqual(["Order B", "Order A"]);
        const limited = await skills().list(
          { organizationId: ctx.organizationId, description: "order-fixture" },
          { orderBy: "name", ascending: true, limit: 1 }
        );
        expect(limited.map((s) => s.name)).toEqual(["Order A"]);
      });

      it("gets by id, returning null for a missing id", async () => {
        const skill = await newSkill();
        expect(await skills().get(skill.id)).toMatchObject({
          id: skill.id,
          name: skill.name,
        });
        expect(await skills().get(shortId())).toBeNull();
      });

      it("updates partially, preserving untouched fields and bumping updatedAt", async () => {
        const skill = await newSkill({ name: "Before Patch" });
        const updated = await skills().update(skill.id, { description: "patched" });
        expect(updated.description).toBe("patched");
        expect(updated.name).toBe("Before Patch"); // untouched by the patch
        expect(updated.prompt).toBe(skill.prompt);
        expect(updated.updatedAt >= skill.updatedAt).toBe(true);
        // Undefined patch fields are dropped, not written.
        const again = await skills().update(skill.id, { name: undefined, prompt: "still hi" });
        expect(again.name).toBe("Before Patch");
        expect(again.prompt).toBe("still hi");
      });

      it("rejects updates to a missing id", async () => {
        await expect(
          skills().update(shortId(), { name: "nope" })
        ).rejects.toThrow();
      });

      it("deletes by id; deleting a missing id is a no-op", async () => {
        const skill = await newSkill();
        await skills().delete(skill.id);
        expect(await skills().get(skill.id)).toBeNull();
        await expect(skills().delete(shortId())).resolves.toBeUndefined();
      });

      it("serializes concurrent assistant Skill-set replacements", async () => {
        const assistant = await newAssistant();
        const first = await newSkill({ name: "Concurrent Skill A" });
        const second = await newSkill({ name: "Concurrent Skill B" });
        await db.setAssistantSkills(assistant.id, []);

        await Promise.all([
          db.setAssistantSkills(assistant.id, [first.id]),
          db.setAssistantSkills(assistant.id, [second.id]),
        ]);
        const ids = (await db.listAssistantSkills(assistant.id)).map(
          (skill) => skill.id
        );
        expect([[first.id], [second.id]]).toContainEqual(ids);
      });
    });

    /* Our own evidence that a visitor consented (GDPR Art. 7(1)), the cookie
       on their device is evidence they hold and can erase, so it cannot
       discharge our accountability obligation on its own. Unlike everything
       else here these rows are not org-scoped: anonymous visitors have no
       organization. */
    describe("cookie consent records", () => {
      const records = () => db.table("cookieConsentRecords");
      const newRecord = (
        over: Partial<{
          consentId: string;
          revision: number;
          acceptedCategories: string[];
          rejectedCategories: string[];
          acceptType: string;
          action: string;
          consentedAt: string | null;
          pageUrl: string;
          userAgent: string;
        }> = {}
      ) =>
        records().insert({
          consentId: `consent-${shortId()}`,
          revision: 1,
          acceptedCategories: ["necessary", "analytics"],
          rejectedCategories: ["functional"],
          acceptType: "custom",
          action: "granted",
          ...over,
        });

      it("stores the decision with spec defaults and a server timestamp", async () => {
        const record = await newRecord();
        expect(record.id).toBeTruthy();
        expect(record.revision).toBe(1);
        expect(record.acceptedCategories).toEqual(["necessary", "analytics"]);
        expect(record.rejectedCategories).toEqual(["functional"]);
        expect(record.acceptType).toBe("custom");
        expect(record.action).toBe("granted");
        // Omitted context falls back to the spec defaults rather than null,
        // so a record never reads as "we failed to store something".
        expect(record.consentedAt).toBeNull();
        expect(record.pageUrl).toBe("");
        expect(record.userAgent).toBe("");
        // Ours is the trusted clock: it must be set even though the visitor's
        // `consentedAt` was not supplied.
        expect(record.createdAt).toBeTruthy();
      });

      it("keeps a withdrawal as a new row instead of editing the grant", async () => {
        const consentId = `consent-${shortId()}`;
        const granted = await newRecord({ consentId, acceptType: "all", action: "granted" });
        const withdrawn = await newRecord({
          consentId,
          acceptedCategories: ["necessary"],
          rejectedCategories: ["functional", "analytics"],
          acceptType: "necessary",
          action: "changed",
        });

        // Both survive: the history is what proves what was agreed and when.
        const history = await records().list({ consentId });
        expect(history.map((r) => r.id).sort()).toEqual(
          [granted.id, withdrawn.id].sort()
        );
        expect(history.map((r) => r.action).sort()).toEqual(["changed", "granted"]);
      });

      it("finds a visitor's records by consent id and hides other visitors'", async () => {
        const mine = await newRecord();
        const theirs = await newRecord();
        const found = await records().list({ consentId: mine.consentId });
        expect(found.map((r) => r.id)).toEqual([mine.id]);
        expect(found.map((r) => r.id)).not.toContain(theirs.id);
      });

      it("records the visitor's own timestamp alongside ours when supplied", async () => {
        const consentedAt = new Date(Date.now() - 5_000).toISOString();
        const record = await newRecord({
          consentedAt,
          pageUrl: "https://ciele.app/home",
          userAgent: "contract-suite",
        });
        expect(record.consentedAt).toBe(consentedAt);
        expect(record.pageUrl).toBe("https://ciele.app/home");
        expect(record.userAgent).toBe("contract-suite");
      });
    });

    describe("local connector relay", () => {
      const RELAY_ORIGIN = "https://relay.contract.test";
      const future = () => new Date(Date.now() + 60_000).toISOString();
      const nowIso = () => new Date().toISOString();

      const newPairing = (
        over: Partial<{ codeHash: string; origin: string; expiresAt: string }> = {}
      ) =>
        db.table("localConnectorPairings").insert({
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          codeHash: `code-${shortId()}`,
          origin: RELAY_ORIGIN,
          expiresAt: future(),
          ...over,
        });

      const newDevice = (
        over: Partial<{ origin: string; providers: string[] }> = {}
      ) =>
        db.table("localConnectorDevices").insert({
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          tokenHash: `token-${shortId()}`,
          origin: RELAY_ORIGIN,
          ...over,
        });

      const newJob = (
        deviceId: string,
        over: Partial<{ expiresAt: string; modelId: string }> = {}
      ) =>
        db.table("localInferenceJobs").insert({
          deviceId,
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          provider: "openai",
          modelId: "model-test",
          invocation: { prompt: "hello" },
          expiresAt: future(),
          ...over,
        });

      it("inserts pairings, devices and jobs with spec defaults", async () => {
        const pairing = await newPairing();
        expect(pairing.usedAt).toBeNull();
        expect(pairing.createdAt).toBeTruthy();

        const device = await newDevice();
        expect(device.providers).toEqual([]);
        expect(device.lastSeenAt).toBeNull();
        expect(device.revokedAt).toBeNull();

        const job = await newJob(device.id);
        expect(job.status).toBe("pending");
        expect(job.result).toBeNull();
        expect(job.error).toBeNull();
        expect(job.claimedAt).toBeNull();
        expect(job.completedAt).toBeNull();
        expect(job.invocation).toEqual({ prompt: "hello" });
      });

      it("consumes a pairing exactly once, matching code hash and origin", async () => {
        const pairing = await newPairing();
        const miss = await db.consumeLocalConnectorPairing({
          codeHash: pairing.codeHash,
          origin: "https://other.contract.test",
          now: nowIso(),
        });
        expect(miss).toBeNull(); // right code, wrong origin

        const consumed = await db.consumeLocalConnectorPairing({
          codeHash: pairing.codeHash,
          origin: RELAY_ORIGIN,
          now: nowIso(),
        });
        expect(consumed).toMatchObject({
          id: pairing.id,
          organizationId: ctx.organizationId,
          userId: ctx.userId,
        });
        expect(consumed!.usedAt).toBeTruthy();

        // One-time: a second consumption of the same code loses.
        expect(
          await db.consumeLocalConnectorPairing({
            codeHash: pairing.codeHash,
            origin: RELAY_ORIGIN,
            now: nowIso(),
          })
        ).toBeNull();
      });

      it("never consumes an expired pairing", async () => {
        const expired = await newPairing({
          expiresAt: new Date(Date.now() - 1_000).toISOString(),
        });
        expect(
          await db.consumeLocalConnectorPairing({
            codeHash: expired.codeHash,
            origin: RELAY_ORIGIN,
            now: nowIso(),
          })
        ).toBeNull();
      });

      it("lists only fresh, non-revoked devices of this member+origin, newest-seen first", async () => {
        const origin = `https://fresh-${shortId()}.contract.test`;
        const seenAfter = new Date(Date.now() - 30_000).toISOString();
        const devices = db.table("localConnectorDevices");

        const fresh = await newDevice({ origin, providers: ["openai"] });
        await devices.update(fresh.id, { lastSeenAt: nowIso() });
        const fresher = await newDevice({ origin, providers: ["anthropic"] });
        await devices.update(fresher.id, {
          lastSeenAt: new Date(Date.now() + 1_000).toISOString(),
        });
        const stale = await newDevice({ origin });
        await devices.update(stale.id, {
          lastSeenAt: new Date(Date.now() - 60_000).toISOString(),
        });
        const revoked = await newDevice({ origin });
        await devices.update(revoked.id, {
          lastSeenAt: nowIso(),
          revokedAt: nowIso(),
        });
        await newDevice({ origin }); // never seen (no heartbeat)

        const listed = await db.listFreshLocalConnectorDevices({
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          origin,
          seenAfter,
        });
        expect(listed.map((d) => d.id)).toEqual([fresher.id, fresh.id]);
        expect(listed[0].providers).toEqual(["anthropic"]);

        const limited = await db.listFreshLocalConnectorDevices({
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          origin,
          seenAfter,
          limit: 1,
        });
        expect(limited.map((d) => d.id)).toEqual([fresher.id]);

        // A different origin sees nothing: pairing is per-origin.
        expect(
          await db.listFreshLocalConnectorDevices({
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            origin: "https://elsewhere.contract.test",
            seenAfter,
          })
        ).toEqual([]);
      });

      it("claims pending jobs oldest-first, exactly once each", async () => {
        const device = await newDevice();
        const first = await newJob(device.id, { modelId: "first" });
        // Distinct created_at timestamps in every adapter.
        await new Promise((resolve) => setTimeout(resolve, 5));
        const second = await newJob(device.id, { modelId: "second" });

        const claimed = await db.claimNextLocalInferenceJob({
          deviceId: device.id,
          now: nowIso(),
        });
        expect(claimed).toMatchObject({ id: first.id, status: "claimed" });
        expect(claimed!.claimedAt).toBeTruthy();

        const next = await db.claimNextLocalInferenceJob({
          deviceId: device.id,
          now: nowIso(),
        });
        expect(next).toMatchObject({ id: second.id, status: "claimed" });

        expect(
          await db.claimNextLocalInferenceJob({
            deviceId: device.id,
            now: nowIso(),
          })
        ).toBeNull();
      });

      it("sweeps the device's expired jobs on claim instead of handing them out", async () => {
        const device = await newDevice();
        const expired = await newJob(device.id, {
          expiresAt: new Date(Date.now() - 1_000).toISOString(),
        });
        expect(
          await db.claimNextLocalInferenceJob({
            deviceId: device.id,
            now: nowIso(),
          })
        ).toBeNull();
        expect(await db.table("localInferenceJobs").get(expired.id)).toBeNull();
      });

      it("completes only a claimed job of the owning device, once", async () => {
        const device = await newDevice();
        const job = await newJob(device.id);

        // Pending (not yet claimed) cannot be completed.
        expect(
          await db.completeLocalInferenceJob({
            jobId: job.id,
            deviceId: device.id,
            result: { text: "early" },
            now: nowIso(),
          })
        ).toBe(false);

        await db.claimNextLocalInferenceJob({ deviceId: device.id, now: nowIso() });

        // A different device cannot complete someone else's job.
        const intruder = await newDevice();
        expect(
          await db.completeLocalInferenceJob({
            jobId: job.id,
            deviceId: intruder.id,
            result: { text: "stolen" },
            now: nowIso(),
          })
        ).toBe(false);

        expect(
          await db.completeLocalInferenceJob({
            jobId: job.id,
            deviceId: device.id,
            result: { text: "answer" },
            now: nowIso(),
          })
        ).toBe(true);
        const done = await db.table("localInferenceJobs").get(job.id);
        expect(done).toMatchObject({
          status: "completed",
          result: { text: "answer" },
          error: null,
        });
        expect(done!.completedAt).toBeTruthy();

        // Idempotence: the job already left "claimed".
        expect(
          await db.completeLocalInferenceJob({
            jobId: job.id,
            deviceId: device.id,
            result: { text: "again" },
            now: nowIso(),
          })
        ).toBe(false);
      });

      it("records a connector error as a failed job", async () => {
        const device = await newDevice();
        const job = await newJob(device.id);
        await db.claimNextLocalInferenceJob({ deviceId: device.id, now: nowIso() });
        expect(
          await db.completeLocalInferenceJob({
            jobId: job.id,
            deviceId: device.id,
            error: "provider exploded",
            now: nowIso(),
          })
        ).toBe(true);
        expect(await db.table("localInferenceJobs").get(job.id)).toMatchObject({
          status: "failed",
          error: "provider exploded",
          result: null,
        });
      });
    });

    describe("Application knowledge connectors", () => {
      it("round-trips connections, Imports, stable Source mappings, and run reports", async () => {
        const assistant = await newAssistant();
        const collection = await db.getOrCreateOrgLibraryCollection(
          ctx.organizationId
        );
        const connection = await db.createApplicationConnection({
          organizationId: ctx.organizationId,
          provider: "slack",
          name: "Support Slack",
          sealedCredentials: "sealed-contract-secret",
          scopes: ["channels:history"],
          providerAccountId: "workspace-contract",
          metadata: { team: "Support" },
        });
        expect(connection).toMatchObject({
          ownerType: "organization",
          ownerMemberId: null,
        });
        expect(
          await db.listApplicationConnections(ctx.organizationId)
        ).toContainEqual({ ...connection, sealedCredentials: "" });
        expect(await db.getApplicationConnection(connection.id)).toEqual(
          connection
        );

        const personal = await db.createApplicationConnection({
          organizationId: ctx.organizationId,
          ownerMemberId: ctx.userId,
          provider: "google_drive",
          name: "My Drive",
          sealedCredentials: "sealed-personal-secret",
        });
        expect(personal).toMatchObject({
          ownerType: "member",
          ownerMemberId: ctx.userId,
        });

        await expect(
          db.createApplicationConnection({
            organizationId: ctx.organizationId,
            provider: "onedrive",
            name: "Ownerless Drive",
            sealedCredentials: "sealed-invalid-secret",
          })
        ).rejects.toThrow("authorizing Member");

        await expect(
          db.createApplicationConnection({
            organizationId: ctx.organizationId,
            ownerMemberId: ctx.userId,
            provider: "salesforce",
            name: "Member Salesforce",
            sealedCredentials: "sealed-invalid-secret",
          })
        ).rejects.toThrow("Organization-owned");

        const applicationImport = await db.createApplicationImport({
          organizationId: ctx.organizationId,
          connectionId: connection.id,
          collectionId: collection.id,
          name: "Help channel",
          config: { channelIds: ["C01"] },
          cadence: "daily",
          assistantIds: [assistant.id],
        });
        expect(await db.getApplicationImport(applicationImport.id)).toMatchObject({
          assistantIds: [assistant.id],
          status: "idle",
          checkpoint: {},
        });

        const source = await db.createSource({
          collectionId: collection.id,
          name: "Pinned answer",
          kind: "application",
          config: {
            applicationProvider: "slack",
            applicationImportId: applicationImport.id,
            remoteId: "thread-1",
          },
        });
        const first = await db.upsertApplicationSource({
          importId: applicationImport.id,
          sourceId: source.id,
          remoteId: "thread-1",
          canonicalUrl: "https://example.slack.com/thread-1",
          revision: "1",
          contentHash: "hash-1",
          lastSeenAt: "2026-08-27T10:00:00.000Z",
        });
        await db.upsertApplicationSource({
          importId: applicationImport.id,
          sourceId: source.id,
          remoteId: "thread-1",
          revision: "2",
          contentHash: "hash-2",
          lastSeenAt: "2026-08-27T11:00:00.000Z",
        });
        const mappings = await db.listApplicationSources(applicationImport.id);
        expect(mappings).toHaveLength(1);
        expect(mappings[0]).toMatchObject({
          id: first.id,
          sourceId: first.sourceId,
          remoteId: "thread-1",
          revision: "2",
          contentHash: "hash-2",
        });

        await db.markApplicationSourceRemoved(
          applicationImport.id,
          "thread-1",
          "2026-08-27T11:30:00.000Z"
        );
        await db.deleteSource(source.id);
        expect(await db.listApplicationSources(applicationImport.id)).toEqual([
          expect.objectContaining({
            id: first.id,
            sourceId: null,
            removedAt: "2026-08-27T11:30:00.000Z",
          }),
        ]);
        const restoredSource = await db.createSource({
          collectionId: collection.id,
          name: "Pinned answer restored",
          kind: "application",
          config: {
            applicationProvider: "slack",
            applicationImportId: applicationImport.id,
            remoteId: "thread-1",
          },
        });
        expect(
          await db.upsertApplicationSource({
            importId: applicationImport.id,
            sourceId: restoredSource.id,
            remoteId: "thread-1",
            revision: "3",
            contentHash: "hash-3",
            lastSeenAt: "2026-08-27T11:45:00.000Z",
          })
        ).toMatchObject({ id: first.id, removedAt: null });

        await db.updateApplicationImport(applicationImport.id, {
          status: "ready",
          lastSyncedAt: "2026-08-26T10:00:00.000Z",
          nextSyncAt: "2026-08-27T10:00:00.000Z",
          checkpoint: { cursor: "next" },
        });
        expect(
          (await db.listDueApplicationImports("2026-08-27T12:00:00.000Z", 10)).map(
            (item) => item.id
          )
        ).toContain(applicationImport.id);

        const run = await db.recordApplicationSyncRun(applicationImport.id, {
          status: "succeeded",
          discovered: 1,
          upserted: 1,
          unchanged: 0,
          deleted: 0,
          skipped: 0,
          failed: 0,
          enqueued: 1,
          providerCalls: 2,
          bytes: 120,
          durationMs: 1000,
          skippedReasons: [],
          error: "",
          startedAt: "2026-08-27T12:00:00.000Z",
          completedAt: "2026-08-27T12:00:01.000Z",
        });
        expect(await db.listApplicationSyncRuns(applicationImport.id)).toContainEqual(
          run
        );

        const jobInput = {
          importId: applicationImport.id,
          organizationId: ctx.organizationId,
          nextRunAt: "2026-08-27T13:00:00.000Z",
        };
        await expect(
          db.createApplicationSyncJobIfAbsent(jobInput)
        ).resolves.toBe(true);
        await expect(
          db.createApplicationSyncJobIfAbsent(jobInput)
        ).resolves.toBe(false);

        const secondImport = await db.createApplicationImport({
          organizationId: ctx.organizationId,
          connectionId: connection.id,
          collectionId: collection.id,
          name: "Second help channel",
          config: { channelIds: ["C02"] },
          cadence: "daily",
          assistantIds: [assistant.id],
        });
        await expect(
          db.reserveApplicationKnowledgeBytes({
            importId: applicationImport.id,
            organizationId: ctx.organizationId,
            projectedBytes: 6,
            limitBytes: 10,
          })
        ).resolves.toBe(true);
        await expect(
          db.reserveApplicationKnowledgeBytes({
            importId: secondImport.id,
            organizationId: ctx.organizationId,
            projectedBytes: 6,
            limitBytes: 10,
          })
        ).resolves.toBe(false);
        await expect(
          db.reserveApplicationKnowledgeBytes({
            importId: secondImport.id,
            organizationId: ctx.organizationId,
            projectedBytes: 4,
            limitBytes: 10,
          })
        ).resolves.toBe(true);
        await expect(
          db.createApplicationSyncJobIfAbsent({
            importId: secondImport.id,
            organizationId: ctx.organizationId,
            nextRunAt: "2026-08-27T13:00:00.000Z",
            maxConcurrent: 1,
          })
        ).resolves.toBe(false);
        await db.deleteApplicationImport(secondImport.id);

        await db.cancelApplicationSyncJobs(
          applicationImport.id,
          "contract cancellation"
        );
        const acquired = await db.acquireApplicationImportSync(
          applicationImport.id,
          ctx.organizationId
        );
        expect(acquired).toMatchObject({
          status: "syncing",
          config: { channelIds: ["C01"] },
        });
        await expect(
          db.updateApplicationImport(applicationImport.id, {
            config: { channelIds: ["C98"] },
          })
        ).rejects.toThrow(
          "Wait for the current synchronization before editing this Import"
        );
        await db.updateApplicationImport(applicationImport.id, {
          status: "idle",
        });
        await db.updateApplicationImport(applicationImport.id, {
          config: { channelIds: ["C99"] },
          checkpoint: {},
          resetSources: true,
        });
        expect(await db.getSource(restoredSource.id)).toBeNull();
        expect(await db.listApplicationSources(applicationImport.id)).toEqual([
          expect.objectContaining({
            id: first.id,
            sourceId: null,
            removedAt: expect.any(String),
          }),
        ]);
        expect(await db.getApplicationImport(applicationImport.id)).toMatchObject({
          reservedBytes: 0,
        });

        await db.deleteApplicationImport(applicationImport.id);
        expect(await db.getApplicationImport(applicationImport.id)).toBeNull();
        expect(await db.getSource(restoredSource.id)).toBeNull();
      });
    });

    describe("platform settings", () => {
      it("stores the platform system-prompt override, defaulting to empty", async () => {
        expect(await db.getPlatformSystemPromptOverride()).toBe("");
        await db.setPlatformSystemPrompt("Rule the platform.", "owner@test");
        expect(await db.getPlatformSystemPromptOverride()).toBe(
          "Rule the platform."
        );
        // Overwrite (single-row upsert), including clearing back to default.
        await db.setPlatformSystemPrompt("", "owner@test");
        expect(await db.getPlatformSystemPromptOverride()).toBe("");
      });
    });
  });
}
