import {
  modelSelector,
  openSecret,
  type Concept,
  type ConceptFrontmatter,
  type UsageSpenders,
  type UsageSurface,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import type { OperationPorts } from "@ciele/ops";
import {
  embedConcept,
  enqueueIngestJob,
  enqueueStaleDocumentMemoryExtractions,
  persistConcept,
  restartWebsiteCrawl,
  sendEmail,
  summariseDocument,
  validateProviderApiKey,
  verifyApifyToken,
  InvalidProviderKeyError,
  enqueueReviewResumptionJob,
  resumeReviewedConversation,
  unsubscribePendingWebhooks,
  getEnterpriseCapabilities,
  enqueueApplicationSyncJob,
  evaluateCase,
} from "@agent-hub/agent";
import {
  availableEvaluationModels,
  evaluationModelsForStage,
} from "@/lib/evaluation-models";
import { listPlatformEvalModels } from "@/lib/platform";
import { improvementAssignedEmail, improvementClosedEmail } from "@/lib/notify";
import { getWidgetDb, invalidatePublication } from "@/lib/widget-db";
import { getSsoProvider } from "@/lib/sso";
import { discoverScopesKeepingCredentials } from "@/lib/application-discovery";
import { removeKnowledgeOriginals } from "@/lib/storage/assets";
import {
  createSupabaseServiceClient,
  isSupabaseServiceConfigured,
} from "@/lib/supabase/service";

/**
 * The one implementation of the operations layer's host ports (#621–#625),
 * shared by both surfaces: `lib/operations.ts` wires it over the session's
 * RLS-scoped Db, `lib/api-v1/run.ts` over the service-role Db. Operations
 * guard; these effect.
 */
export function webOperationPorts(
  db: Db,
  opts: {
    organizationId: string;
    actorEmail: string;
    /**
     * Server Actions keep the default `updateTag` path (read-your-own-writes);
     * Route Handlers must pass the `revalidateTag`-based variant, Next
     * forbids `updateTag` outside an action.
     */
    invalidatePublication?: (assistantId: string) => void;
    /**
     * Who the surface says is asking (#849), so indexing a caller triggered
     * names the caller. Absent on the ingestion pipeline's own jobs.
     */
    usage?: { spenders?: UsageSpenders; surface?: UsageSurface };
    /**
     * The API key behind this call and the Member it delegates for. Only a
     * keyed surface can ask an Assistant (`askAssistant`): the question is the
     * key's, so the Conversation is marked with it and the turn is its spend.
     */
    apiKey?: { keyId: string; memberId: string };
  }
): OperationPorts {
  const apiKey = opts.apiKey;
  return {
    /**
     * The Application Import lifecycle's host work, on the system Db: the
     * sealed credential discovery needs is hidden from the Member's RLS, and
     * the sync queue lives on the job ledger.
     */
    applicationImports: {
      discoverScopes: async (connectionId) => {
        const connection = await getWidgetDb().getApplicationConnection(connectionId);
        if (!connection || connection.organizationId !== opts.organizationId) {
          throw new Error("Application Connection not found");
        }
        return discoverScopesKeepingCredentials(connection);
      },
      enqueueSync: async (input) => {
        await enqueueApplicationSyncJob(input, { db: getWidgetDb() });
      },
      cancelSync: (importId, reason) => getWidgetDb().cancelApplicationSyncJobs(importId, reason),
    },
    listPublicationEntities: (organizationId) =>
      db.table("entities").list({ organizationId }),
    /**
     * Runs an action the approval gate stopped, once a Member approved it
     * (#958).
     *
     * On the org-pinned service-role Db, the same one every Teammate action
     * runs on, and deliberately **not** the approving Member's RLS session: a
     * grant is the Teammate's own capability, so narrowing an approval to the
     * approver's Role would make grants able only to narrow and never widen,
     * the opposite of what #770 settled.
     *
     * The tool list is rebuilt here rather than trusted from the row, which
     * re-reads the grants: an admin who revoked a domain between the card
     * being raised and a Member clicking has revoked it.
     */
    runApprovedTeammateAction: async ({ teammateId, operation, input, requestedBy }) => {
      const { getServiceRoleDb } = await import("@/lib/service-db");
      const { resolveTeammateActions } = await import("@/lib/teammates/actions");
      const serviceDb = getServiceRoleDb();
      const teammate = await serviceDb.table("teammates").get(teammateId);
      if (!teammate) throw new Error("That colleague no longer exists");
      const tools = await resolveTeammateActions({
        db: serviceDb,
        teammate,
        organizationId: teammate.organizationId,
        userId: requestedBy ?? "",
        // The Role the Teammate acted under, not the approver's: approving
        // un-pauses an action, it does not re-authorise it as somebody else.
        role: null,
      });
      const tool = tools.find((candidate) => candidate.operation === operation);
      if (!tool) {
        throw new Error("That action is no longer granted to this colleague");
      }
      await tool.run(input);
    },

    /**
     * One real Conversation Turn, on the latest Publication exactly as the
     * widget runs it, read back whole (`assistants.ask`).
     *
     * The subject is the Member the key delegates for, the same subject the
     * Preview uses: it keeps the thread out of Insights' Visitor population
     * (ADR-0010) while leaving it in the Inbox to review.
     *
     * A thread continues only when this key started it. The turn itself checks
     * the subject, and every key a Member mints shares that subject with the
     * Member's own Preview, so without the `apiKeyId` check here a key could
     * join its creator's Preview threads, or another of the creator's keys'
     * threads, and be answered from that history.
     * No `keyResolution`, so org connections only, never a personal
     * subscription, and the timeout sits under the route's `maxDuration`.
     */
    askAssistant: apiKey
      ? async ({ assistantId, question, conversationId }) => {
          const [{ answerConversationTurn }, { getLatestPublicationCached }, { getRuntimeDb }] =
            await Promise.all([
              import("@agent-hub/agent"),
              import("@/lib/widget-db"),
              import("@/lib/runtime-db"),
            ]);
          const publication = await getLatestPublicationCached(assistantId);
          if (!publication) return null;
          const config = publication.config;
          if (config.assistant.organizationId !== opts.organizationId) {
            throw new Error("askAssistant: organization mismatch");
          }
          const continued = conversationId ? await db.getConversation(conversationId) : null;
          const ownThread =
            continued?.metadata?.apiKeyId === apiKey.keyId ? continued.id : null;
          const turn = await answerConversationTurn({
            db,
            systemDb: getRuntimeDb(db),
            assistant: {
              ...config.assistant,
              createdAt: publication.createdAt,
              updatedAt: publication.createdAt,
            },
            flows: config.flows,
            skills: config.skills ?? [],
            entities: config.entities ?? [],
            connections: await db.listProviderConnections(opts.organizationId),
            organizationId: opts.organizationId,
            subjectType: "member",
            subjectId: apiKey.memberId,
            conversationId: ownThread,
            message: question,
            metadata: { apiKeyId: apiKey.keyId },
            usageAttribution: { surface: "api", apiKeyId: apiKey.keyId },
            signal: AbortSignal.timeout(280_000),
          });
          return {
            conversationId: turn.conversationId,
            messageId: turn.messageId,
            flowName: turn.flowName,
            answer: turn.answer,
            sources: turn.sources.map((source) => ({
              documentId: source.conceptId ?? null,
              documentTitle: source.conceptTitle,
              sourceId: source.sourceId ?? null,
              sourceName: source.sourceName,
              collectionName: source.collectionName,
              url: source.url ?? null,
            })),
            error: turn.error,
          };
        }
      : undefined,
    /**
     * Knowledge search with no turn (`knowledge.search`). On this surface's
     * own Db, the service Db over /api/v1, because the chunk search is not on
     * the org-pinned view; pinned to this port's Organization regardless of
     * what the operation passed, the same discipline as `grantSystemTeammate`.
     * Org connections only: whoever holds the key spends the embedding and
     * the rerank, attributed through `usage`.
     */
    searchKnowledge: async ({ query, assistantId }) => {
      const { searchKnowledge } = await import("@agent-hub/agent");
      if (assistantId) {
        const assistant = await db.getAssistant(assistantId);
        if (!assistant || assistant.organizationId !== opts.organizationId) {
          throw new Error("searchKnowledge: organization mismatch");
        }
      }
      return searchKnowledge({
        db,
        connections: await db.listProviderConnections(opts.organizationId),
        organizationId: opts.organizationId,
        query,
        assistantId,
        usage: opts.usage,
      });
    },
    /**
     * The Improvements board's dedup and priority decisions (#959). Bound here
     * because `ops` cannot reach a model; the answers come back raw and the
     * derivations that read them live in `@agent-hub/core`, so the weights and
     * thresholds stay in one reviewable place.
     *
     * Org connections only, and a failure returns null rather than throwing:
     * a triage run is unattended, and a board that stops being filed because a
     * backend had a bad minute is worse than one filed the old way.
     */
    triageDecisions: async ({ evidence, candidates }) => {
      try {
        const { runTriageDecision } = await import("@agent-hub/agent");
        return await runTriageDecision({
          evidence,
          candidates,
          connections: await db.listProviderConnections(opts.organizationId),
        });
      } catch {
        return null;
      }
    },
    // The Flows Agent's creation grant (#838). Only meaningful when `db` is the
    // system Db: the grant table's RLS is admin-only and the canvas is an
    // Editor's surface. Pinned to the caller's Organization regardless of what
    // the operation passed, so a port wired with the wrong org cannot grant
    // across tenants.
    grantSystemTeammate: async (grant) => {
      if (grant.organizationId !== opts.organizationId) {
        throw new Error("grantSystemTeammate: organization mismatch");
      }
      await db.table("teammateGrants").insert(grant);
    },
    // The webhook gate's exit on delete (#842): the subscription table has no
    // member write policy, so the settle-and-unsubscribe runs on the system
    // Db. The operation already checked the Conversation's Organization; the
    // read here checks it again before anything leaves.
    unsubscribeWebhooks: async (conversationId) => {
      const system = getWidgetDb();
      const conversation = await system.getConversation(conversationId);
      if (!conversation?.assistantId) return;
      const assistant = await system.getAssistant(conversation.assistantId);
      if (assistant?.organizationId !== opts.organizationId) return;
      await unsubscribePendingWebhooks({ db: system }, conversationId);
    },
    // Knowledge originals live in a private bucket written with the service
    // client, so they are removed with it. Paths are already scoped to this
    // Organization's prefix by the operation; re-checked here.
    removeKnowledgeOriginals: async (paths) => {
      if (!isSupabaseServiceConfigured()) return;
      const own = paths.filter((path) => path.startsWith(`org/${opts.organizationId}/`));
      await removeKnowledgeOriginals(createSupabaseServiceClient(), own);
    },
    // The decision write (#841): a compare-and-set on the system Db, because
    // the table has no member write policy; the operation already checked the
    // row's Organization, and the pinned read below checks it again.
    decideReviewRequest: async (id, patch) => {
      const system = getWidgetDb();
      const current = await system.table("reviewRequests").get(id);
      if (!current || current.organizationId !== opts.organizationId) return null;
      return system.decideReviewRequest(id, patch);
    },
    // Human review continuation (#841). A simulated (Preview) request resumes
    // inline so the transcript shows the next message; a real one rides the
    // job ledger like every other unattended turn. Both run on the system Db
    // the caller wired here: the resumption is a Conversation Turn on a
    // Conversation the deciding Member does not own.
    afterReviewDecided: async (review) => {
      if (review.organizationId !== opts.organizationId) {
        throw new Error("afterReviewDecided: organization mismatch");
      }
      if (review.simulated) {
        return resumeReviewedConversation({ db: getWidgetDb() }, review.id);
      }
      await enqueueReviewResumptionJob({ db: getWidgetDb() }, review);
      return null;
    },
    validateProviderApiKey: async (provider, apiKey) => {
      try {
        await validateProviderApiKey(provider, apiKey);
        return { ok: true };
      } catch (error) {
        if (error instanceof InvalidProviderKeyError) {
          return { ok: false, error: error.message };
        }
        throw error;
      }
    },
    verifyCrawlerToken: async (_provider, token) => {
      try {
        const { accountId } = await verifyApifyToken(token);
        return { ok: true, accountId };
      } catch {
        // Never echo the provider's error body: it can quote the token back.
        return {
          ok: false,
          error: "Apify did not accept that token. Copy it again from Apify Console → Settings → API & Integrations.",
        };
      }
    },
    validateSsoConnection: async (connection) => {
      const provider = getSsoProvider(connection.provider);
      if (!provider?.validate) {
        return { ok: false, error: "This provider can't be validated." };
      }
      return provider.validate({
        config: connection.config,
        clientSecret: connection.encryptedSecret
          ? openSecret(connection.encryptedSecret)
          : null,
      });
    },
    enqueueIngest: (job) =>
      enqueueIngestJob({ kind: "ingest_source", ...job }, { db }),
    persistFaq: (args) =>
      persistFaqConcept({
        db,
        organizationId: opts.organizationId,
        usage: opts.usage,
        ...args,
      }),
    reembedConcept: async (args) => {
      const connections = await db.listProviderConnections(opts.organizationId);
      await embedConcept({ db, connections, usage: opts.usage, ...args });
    },
    enqueueMemoryExtractions: (args) =>
      enqueueStaleDocumentMemoryExtractions(
        { db },
        { organizationId: opts.organizationId, ...args }
      ),
    summariseDocument: (args) =>
      summariseDocument({ db, organizationId: opts.organizationId, ...args }),
    restartCrawl: async (sourceId) => {
      await restartWebsiteCrawl({ db, sourceId });
    },
    invalidatePublication: (assistantId) =>
      (opts.invalidatePublication ?? invalidatePublication)(assistantId),
    // The plan's meters (#853). A port because caps are an enterprise concept
    // and the operations layer must stay free of one; unwired, and on every
    // open-source deployment, this answers null and the read says "unmetered".
    readUsageLimits: (organizationId) =>
      getEnterpriseCapabilities().metering.getUsageLimits(organizationId),
    notifyImprovementUpdate: async ({ before, updated, patch }) => {
      const key = `IMP-${updated.seq}`;
      const members = await db.listMembers(opts.organizationId);
      const emailOf = (userId: string | null) =>
        userId
          ? (members.find((m) => m.userId === userId)?.email ?? null)
          : null;

      if (
        patch.assigneeId !== undefined &&
        patch.assigneeId !== before.assigneeId &&
        updated.assigneeId
      ) {
        const to = emailOf(updated.assigneeId);
        if (to)
          await sendEmail(
            improvementAssignedEmail({
              to,
              key,
              title: updated.title,
              actorEmail: opts.actorEmail,
            })
          );
      }

      if (patch.status === "done" && before.status !== "done") {
        const to = emailOf(updated.createdBy);
        if (to)
          await sendEmail(
            improvementClosedEmail({
              to,
              key,
              title: updated.title,
              actorEmail: opts.actorEmail,
            })
          );
      }
    },
    evaluation: {
      async prepare({ assistant, stage }) {
        const [flows, connections, platformModels] = await Promise.all([
          db.listFlows(assistant.id),
          db.listProviderConnections(opts.organizationId),
          listPlatformEvalModels(),
        ]);
        const allowedCandidates = evaluationModelsForStage(
          availableEvaluationModels(
            connections,
            Boolean(process.env.AI_GATEWAY_API_KEY),
            platformModels
          ),
          stage,
          assistant.modelProvider
        );
        return {
          allowedCandidates,
          runCase: (example, candidate) =>
            evaluateCase({
              db,
              assistant,
              flows,
              connections,
              example,
              candidate,
              stage,
              modelPrice: platformModels.find(
                (model) => modelSelector(model) === modelSelector(candidate)
              ),
            }),
        };
      },
    },
  };
}

/**
 * One FAQ = one OKF Concept at `faq/<slug>.md`. Reached only through the
 * `persistFaq` port above, which is how the FAQ operations and the
 * Suggested-Fix acceptance in `@ciele/ops` both write one.
 */
async function persistFaqConcept(args: {
  db: Db;
  organizationId: string;
  assistantId: string;
  collectionId: string;
  question: string;
  answer: string;
  /**
   * OKF v0.2 trust + provenance for the Concept this writes (§5.1/§5.2), who
   * authored it, who confirmed it, what it derives from. Required rather than
   * defaulted: callers differ exactly here (a person typing a FAQ is `human:`
   * generated; an accepted Suggested Fix is agent-generated and
   * human-*verified*), and silently defaulting would misattribute one.
   */
  provenance: Pick<ConceptFrontmatter, "generated" | "verified" | "sources">;
  /** Disambiguates bundle paths in bulk imports (e.g. "-3"). */
  pathSuffix?: string;
  /** Who asked for the indexing this triggers (#849). */
  usage?: { spenders?: UsageSpenders; surface?: UsageSurface };
}): Promise<Concept> {
  const question = args.question.trim();
  const slug =
    (question
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "faq") + (args.pathSuffix ?? "");
  const connections = await args.db.listProviderConnections(args.organizationId);
  // Every FAQ is a first-class `faq` Source (PRD #726): the question is the
  // Source name, the answer stays on the Concept, which is what gives FAQs
  // linked-assistant chips, status, and timestamps in the Library.
  const source = await args.db.createSource({
    collectionId: args.collectionId,
    name: question.slice(0, 500),
    kind: "faq",
  });
  const concept = await persistConcept({
    db: args.db,
    assistantId: args.assistantId,
    collectionId: args.collectionId,
    sourceId: source.id,
    path: `faq/${slug}.md`,
    frontmatter: {
      type: "FAQ",
      title: question,
      description: args.answer.slice(0, 140),
      ...args.provenance,
    },
    body: args.answer,
    connections,
    usage: args.usage,
  });
  await args.db.updateSource(source.id, { status: "ready" });
  return concept;
}
