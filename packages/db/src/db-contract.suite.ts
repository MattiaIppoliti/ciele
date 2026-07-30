import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiUsageStage, FlowCondition } from "@agent-hub/core";
import { ASSISTANT_GOAL_CAP, buildPublicationConfig, shortId } from "@agent-hub/core";
import type { Db } from "./types";

/**
 * Db contract tests: interface-level behavior every Db adapter must share.
 * The suite is written against a context factory so the same expectations can
 * run over the Supabase adapter (with a test database) — that is what makes it
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
  /**
   * Optional: hand back the user id of a Member of `organizationId` other
   * than the caller (creating one if needed) — for cases that exercise
   * member-scoped rows (e.g. assistant-access cascades). Adapters that
   * can't seed extra members omit it and those cases self-skip.
   */
  seedOrgMember?: () => Promise<string>;
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

    // Generous timeout: the PGlite context boots Postgres and applies every
    // migration in this hook.
    beforeAll(async () => {
      ctx = await makeContext();
      db = ctx.db;
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

    describe("assistant access overrides", () => {
      it("set â†’ list â†’ clear round-trips an override with audit stamps", async () => {
        const assistant = await newAssistant();
        expect(await db.listAssistantAccess(assistant.id)).toHaveLength(0);

        await db.setAssistantAccess(assistant.id, ctx.userId, "denied");
        let entries = await db.listAssistantAccess(assistant.id);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ userId: ctx.userId, role: "denied" });
        // Audit stamps are set server-side on every write.
        expect(entries[0].grantedAt).toBeTruthy();
        expect(entries[0].grantedBy).toBe(ctx.userId);
        // Profile data rides along (same join contract as listMembers).
        expect(entries[0].email).toBeTruthy();

        // Setting again is an upsert: same member stays a single row.
        await db.setAssistantAccess(assistant.id, ctx.userId, "editor");
        entries = await db.listAssistantAccess(assistant.id);
        expect(entries).toHaveLength(1);
        expect(entries[0].role).toBe("editor");

        // Clear = back to "System Role": the row disappears.
        await db.clearAssistantAccess(assistant.id, ctx.userId);
        expect(await db.listAssistantAccess(assistant.id)).toHaveLength(0);
      });

      it("scopes overrides to their assistant", async () => {
        const a = await newAssistant();
        const b = await newAssistant();
        await db.setAssistantAccess(a.id, ctx.userId, "admin");
        expect(await db.listAssistantAccess(b.id)).toHaveLength(0);
        await db.clearAssistantAccess(a.id, ctx.userId);
      });

      it("deleting the assistant deletes its overrides", async () => {
        const assistant = await newAssistant();
        await db.setAssistantAccess(assistant.id, ctx.userId, "viewer");
        await db.deleteAssistant(assistant.id);
        expect(await db.listAssistantAccess(assistant.id)).toHaveLength(0);
      });

      it("removing a member from the org clears their overrides", async () => {
        if (!ctx.seedOrgMember) return; // adapter can't seed a second member
        const memberId = await ctx.seedOrgMember();
        const assistant = await newAssistant();
        await db.setAssistantAccess(assistant.id, memberId, "admin");
        expect(await db.listAssistantAccess(assistant.id)).toHaveLength(1);
        await db.removeMember(ctx.organizationId, memberId);
        expect(await db.listAssistantAccess(assistant.id)).toHaveLength(0);
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
        // SSO is off by default — a fresh assistant never gates chat.
        expect(assistant.requireSignIn).toBe(false);

        const flows = await db.listFlows(assistant.id);
        expect(flows.length).toBeGreaterThan(0);
        // Exactly one Default behavior, sorted last (context.md invariant).
        expect(flows.filter((f) => f.isDefault)).toHaveLength(1);
        expect(flows.at(-1)?.isDefault).toBe(true);
        expect(flows.every((flow) => flow.actions.length === 0)).toBe(true);
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
        await db.reorderFlows(assistant.id, [b.id, a.id]);
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
        // createSource defaults to `processing` — the leasable state.
        return db.createSource({
          collectionId: collection.id,
          name: "Leased crawl",
          kind: "website",
          config: { url: "https://lease.edu" },
        });
      };

      it("renews a lease for the owning worker only, and renewal extends it", async () => {
        const source = await leasedSource();
        // Renewing a lease that was never claimed proves nothing — refuse.
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
        const graphAssistant = await newAssistant();
        const graphCollection = await db.createCollection(graphAssistant.id, {
          name: "Graph KB",
        });
        const vectorAssistant = await newAssistant();
        await db.updateAssistant(vectorAssistant.id, { knowledgeEngine: "vector" });
        const vectorCollection = await db.createCollection(vectorAssistant.id, {
          name: "Vector KB",
        });

        const datasets = await db.listActiveGraphDatasets();
        expect(
          datasets.some(
            (d) =>
              d.collectionId === graphCollection.id &&
              d.organizationId === ctx.organizationId
          )
        ).toBe(true);
        expect(datasets.some((d) => d.collectionId === vectorCollection.id)).toBe(
          false
        );
      });
    });

    describe("conversations & messages", () => {
      const newConversation = async (assistantId: string) =>
        db.createConversation({
          assistantId,
          subjectType: "visitor",
          subjectId: "visitor-contract",
          title: "contract",
          metadata: { browser: "Firefox", os: "macOS" },
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
              assistantId: assistant.id,
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

    describe("knowledge search (lexical fallback)", () => {
      it("ranks by term hits, scopes by assistant + collection, respects limit", async () => {
        const assistant = await newAssistant();
        const collection = await db.createCollection(assistant.id, {
          name: "Contract Collection",
        });
        const concept = await db.createConcept({
          collectionId: collection.id,
          sourceId: null,
          path: "contract/topic.md",
          frontmatter: { type: "Note", title: "Enrollment deadlines" },
          body: "Enrollment closes in September.",
        });
        await db.saveChunks([
          {
            conceptId: concept.id,
            collectionId: collection.id,
            assistantId: assistant.id,
            content: "Enrollment closes in September for all programs.",
            embedding: null,
          },
          {
            conceptId: concept.id,
            collectionId: collection.id,
            assistantId: assistant.id,
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
          const concept = await db.createConcept({
            collectionId: collection.id,
            sourceId: null,
            path,
            frontmatter: { type: "Note", title: path },
            body: "content",
          });
          await db.saveChunks([
            {
              conceptId: concept.id,
              collectionId: collection.id,
              assistantId: assistant.id,
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
        const faq = await db.createConcept({
          collectionId: collection.id,
          sourceId: null,
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
        const concept = await db.createConcept({
          collectionId: collection.id,
          sourceId: null,
          path: "contract/excluded.md",
          frontmatter: { type: "Web Page", title: "Old tuition page" },
          body: "Tuition fees for 2019.",
        });
        await db.saveChunks([
          {
            conceptId: concept.id,
            collectionId: collection.id,
            assistantId: assistant.id,
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

      const seedChunk = async (
        assistantId: string,
        collectionId: string,
        path: string,
        content: string,
        embedding: number[] | null
      ) => {
        const concept = await db.createConcept({
          collectionId,
          sourceId: null,
          path,
          frontmatter: { type: "Web Page", title: path },
          body: content,
        });
        await db.saveChunks([
          { conceptId: concept.id, collectionId, assistantId, content, embedding },
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
        // another assistant's — even with an identical embedding and content.
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

    describe("background jobs", () => {
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
        const job = await db.createBackgroundJob({
          kind: "ingest_source",
          sourceId: source.id,
          payload: {
            kind: "ingest_source",
            assistantId: assistant.id,
            collectionId: collection.id,
            sourceId: source.id,
            rawText: "hello",
          },
          nextRunAt: "2026-07-09T10:00:00.000Z",
        });

        const claimed = await db.claimBackgroundJobs({
          kind: "ingest_source",
          workerId: "worker-1",
          now: "2026-07-09T10:01:00.000Z",
          staleBefore: "2026-07-09T09:45:00.000Z",
          limit: 5,
        });
        expect(claimed).toHaveLength(1);
        expect(claimed[0]).toMatchObject({
          id: job.id,
          status: "running",
          attempts: 1,
          lockedBy: "worker-1",
        });

        await db.updateBackgroundJob(job.id, {
          status: "succeeded",
          lockedAt: null,
          lockedBy: null,
        });
        const secondClaim = await db.claimBackgroundJobs({
          kind: "ingest_source",
          workerId: "worker-2",
          now: "2026-07-09T10:02:00.000Z",
          staleBefore: "2026-07-09T09:45:00.000Z",
          limit: 5,
        });
        expect(secondClaim).toEqual([]);
        expect(await db.listBackgroundJobsForSource(source.id, "ingest_source")).toHaveLength(1);
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

        const quarantined = await db.updateAssistantGoal(goal.id, {
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

        await db.deleteAssistantGoal(goal.id);
        const remaining = await db.listAssistantGoals(assistant.id);
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
        // Each stage in the type must be insertable — a stage added to the
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
        // and was reported as €120 — enough to trip a euro budget on
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
      // credentialKind) — never an absolute read.
      type UsageKey = string;
      const keyOf = (r: {
        day: string;
        kind: string;
        credentialKind: string;
      }): UsageKey => `${r.day}|${r.kind}|${r.credentialKind}`;
      // The rollup's grain includes the provider and model that ran, so more
      // than one row can share a (day, kind, credential) key — fold them.
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
      // partial-day arithmetic — including UTC pinning — is driven against real
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
        // Two legal spellings of one instant must not compare differently — a
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
          platform: "jira",
          name: "Jira Cloud",
          config: { ...config, clientSecret: "sealed:rotated" },
        });
        expect(replaced.ticketingIntegration).toMatchObject({
          platform: "jira",
          name: "Jira Cloud",
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
          // Stored verbatim — this seam never seals and never unseals.
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
        await db.updateAssistantGoal(quarantined.id, { status: "quarantined" });

        // The claim is cross-org; other fixtures may be due too — filter by id.
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

        // A stale claim (older than staleBefore) is re-claimable — a crashed
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

      it("reads and writes the same table as the named passthroughs", async () => {
        const viaAccessor = await newSkill({ name: "Accessor Written" });
        const named = await db.listSkills(ctx.organizationId);
        expect(named.some((s) => s.id === viaAccessor.id)).toBe(true);

        const viaNamed = await db.createSkill(ctx.organizationId, {
          name: "Named Written",
          prompt: "Say hi",
        });
        const listed = await skills().list({ organizationId: ctx.organizationId });
        expect(listed.some((s) => s.id === viaNamed.id)).toBe(true);
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
    });

    /* Our own evidence that a visitor consented (GDPR Art. 7(1)) — the cookie
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
        // Ours is the trusted clock — it must be set even though the visitor's
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

        // A different origin sees nothing — pairing is per-origin.
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
