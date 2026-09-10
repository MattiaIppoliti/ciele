import { describe, expect, it } from "vitest";
// The reply-part contract is asserted through the client barrel on purpose:
// the runtime owns ChatReplyPart (spec #194) and client code reaches it only
// via `@agent-hub/agent/client`.
import type { ChatReplyPart } from "./client";
import * as server from "./index";
import * as client from "./client";
import * as localProviders from "./local-providers";

/**
 * Locks the package's public interface (ADR-0005, as amended by ADR-0018).
 *
 * `@agent-hub/agent` is a deep module: its internals change freely, but its
 * three public entry points are deliberately narrow. Growing them should be a
 * reviewed decision, not an accident, if you add an export to `index.ts`,
 * `client.ts` or `local-providers.ts`, update the expected set below on purpose.
 *
 * Note: only *value* exports (functions/consts) are observable at runtime;
 * type-only exports erase and are intentionally not covered here.
 */

const valueKeys = (mod: object) =>
  Object.keys(mod)
    .filter((k) => (mod as Record<string, unknown>)[k] !== undefined)
    .sort();

describe("runtime public interface", () => {
  it("server barrel exports exactly its declared surface", () => {
    expect(valueKeys(server)).toEqual([
      // The channel chain's ndjson framing (#778): its own constant because a
      // channel stream carries `channel-*` events beside the turn events.
      // Detection-as-code thresholds (#801, CYB-19): exported so the rules
      // stay tunable as code, with tests, rather than as vendor config.
      "BULK_DOWNLOAD_THRESHOLD",
      "CHANNEL_NDJSON_HEADERS",
      "CRAWL_FINALIZE_BATCH_SIZE",
      "CRAWL_FINALIZE_LEASE_MS",
      // The shipped platform prompt layer: public so the owner-only editor can
      // show "the default" and the host's cached reader can fall back to it.
      "DEFAULT_PLATFORM_PROMPT",
      "DETECTION_WINDOW_HOURS",
      "InvalidProviderKeyError",
      "NDJSON_HEADERS",
      "NEW_ADDRESS_BASELINE_DAYS",
      "NEW_ADDRESS_MIN_BASELINE",
      // Ledger retention (#801, CYB-19), beside the other sweep constants.
      "OBJECT_ACCESS_RETENTION_DAYS",
      "RECRAWL_SWEEP_BATCH_SIZE",
      "REFUSAL_PROBE_THRESHOLD",
      // The warn threshold: a deliberate widening (#509). The admin Usage
      // surface must colour a gauge amber at exactly the fraction the
      // enterprise ladder warns at, and open-source code cannot import from
      // src/ee, so the constant is declared here and consumed by both.
      "USAGE_WARN_FRACTION",
      // Alert sourceKey registry: a deliberate widening so EE capability
      // implementations mint keys through the one namespace registry (#442).
      "alertKeys",
      "backfillCollectionToGraph",
      "beginWebsiteCrawl",
      "connectorAlertKey",
      "dbConnectorRuntime",
      "dbReviewRuntime",
      "deliverWebhookCallback",
      // The pure detection rules over the object-access ledger (#801,
      // CYB-19); the cron tick composing them is runSecurityDetections.
      "detectBulkDownloads",
      "detectNewAddressDownloads",
      "detectRefusalProbes",
      "discoverApplicationConnectionScopes",
      // The Agent memory layer's writer (#771). Public because the job ledger
      // and the cron drain both reach it; nothing else should.
      "distillAgentLearning",
      "embedConcept",
      "enqueueApplicationSyncJob",
      "enqueueDraftProposalJob",
      "enqueueEntitySyncJob",
      "enqueueGraphSyncJob",
      "enqueueIngestJob",
      "enqueueReviewResumptionJob",
      "expireDueReviews",
      "expireDueWebhooks",
      "extractSourceText",
      "feedbackScore",
      // The two scheduled drains. The cron endpoints in apps/web are auth-and-
      // serialize adapters over these, so the tick's policy is tested here.
      "finalizeDueCrawls",
      "finalizeWebsiteCrawl",
      "forwardGraphFeedback",
      "getEnterpriseCapabilities",
      "loadConnectorOptions",
      "persistConcept",
      "providerAvailability",
      "refuseHttpFlow",
      "registerEnterpriseCapabilities",
      // The host port registry: how a framework-free package gets the two
      // facts only its host knows (see host.ts).
      "registerRuntimeHost",
      "restartWebsiteCrawl",
      "resumeReviewedConversation",
      "resumeWebhookConversation",
      "reviewLinkUrl",
      "revokeApplicationConnectionCredentials",
      // The nightly agentic-ops drain, one export for the verify-goals cron
      // route; the four loops it sequences (goals, verifier, trust, compost)
      // are internals of scheduled.ts, not surface.
      "runDetectionRules",
      "runDueAgenticOps",
      // The one per-kind drain still public: apps/web's reingest test drives
      // it directly. Its siblings (graph-sync / proposals / memories /
      // entity-sync) are composed only by finalizeDueCrawls and stay internal.
      "runDueIngestJobs",
      // The unattended Routine drain (#772): its own schedule, so it is not a
      // job-ledger kind, and the cron tick composes it directly.
      "runDueReviewJobs",
      "runDueRoutines",
      "runDueWebhookJobs",
      "runGraphLearning",
      "runHttpFlow",
      "runSecurityDetections",
      "sendEmail",
      "sendEscalationApiRequest",
      "sessionMetadata",
      // Teammate channels (#778): one entrypoint for a whole chain, like
      // `streamConversationTurn` is for one turn.
      "streamChannelChain",
      "streamConversationTurn",
      "sweepDueRecrawls",
      // The retention drains: traces (#573), transcripts (CYB-12), and the
      // object-access ledger (CYB-19), all deliberate widenings.
      "sweepExpiredObjectAccess",
      "sweepExpiredTraces",
      "sweepExpiredTranscripts",
      "testApiRequest",
      // The Connector action's shared core (#839): Run node, option loaders,
      // connection test and the Db-bound runtime the hosts pass in.
      "testConnectorAction",
      "testConnectorConnection",
      // "Test connection" for OpenAI-compatible endpoints, a deliberate
      // widening for the connection form (#436).
      "testOpenAiCompatibleConnection",
      // The exit nobody configured (#842): a Conversation deleted while its
      // gate is open; the ops layer calls it through a port before the delete.
      "unsubscribePendingWebhooks",
      "updateWebsiteSourceConfiguration",
      "validateProviderApiKey",
      "verifyReviewLinkToken",
      "verifyWebhookCallbackToken",
      "webhookCallbackUrl",
      "websiteCrawlerCapabilities",
    ]);
  });

  it("client barrel exports exactly its declared surface", () => {
    expect(valueKeys(client)).toEqual([
      "EMPTY_TURN_TRACE",
      // The iteration budget the Inbox export quotes back in its `[System note]`.
      "MAX_AGENT_ITERATIONS",
      "MODEL_CATALOG",
      "PROVIDER_NAMES",
      "TEMPLATE_VARIABLES",
      "canEmbedWithConnection",
      // Flattens a rendered component to text for the Inbox export (generative UI).
      "componentPartText",
      // The channel chain's consumer (#778), over the same fold.
      "consumeChannelStream",
      "consumeTurnStream",
      "decodeRuntimeEvents",
      "foldTraceEvent",
      // The Reply Component shape rules, shared with the chat clients.
      "normalizeTable",
    ]);
  });

  /**
   * The client barrel's *other* contract, which the export list above cannot
   * express: nothing reachable from it may import the AI SDK or a Node built-in
   * (`client.ts`: "either type-only or pure static data, so importing it from a
   * client component never drags in the AI SDK or other server-only code").
   *
   * It is easy to break by accident and invisible when you do, a client-safe
   * constant re-exported through a *barrel* that happens to also export a
   * server function pulls that function's whole dependency tree into the browser
   * bundle. `MAX_AGENT_ITERATIONS` did exactly that until it was pointed at
   * `agentic-search/loop-budget` instead of `agentic-search`.
   *
   * So this walks the static import graph rather than trusting the barrel: only
   * type-only imports (erased) and relative modules are followed.
   */
  it("client barrel reaches no server-only module", async () => {
    const { readFile } = await import("node:fs/promises");
    const { dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));

    const BANNED = /^(ai|next|node:|@ai-sdk\/|@supabase\/)/;
    const seen = new Set<string>();
    const offenders: string[] = [];

    const walk = async (file: string): Promise<void> => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = await readFile(file, "utf8");
      // `import type` / `export type` erase at runtime, so they cannot pull a
      // bundle, everything else is a real edge.
      const edges = [
        ...source.matchAll(/^(?:import|export)\s+(?!type\s)[^;]*?from\s+"([^"]+)"/gm),
        ...source.matchAll(/^import\s+"([^"]+)"/gm),
      ].map((m) => m[1]);
      for (const specifier of edges) {
        if (BANNED.test(specifier)) {
          offenders.push(`${file.slice(here.length + 1)} → ${specifier}`);
          continue;
        }
        if (!specifier.startsWith(".")) continue;
        await walk(resolve(dirname(file), `${specifier}.ts`));
      }
    };

    await walk(resolve(here, "client.ts"));
    expect(offenders).toEqual([]);
    // Sanity: the walk actually traversed rather than silently finding no edges.
    expect(seen.size).toBeGreaterThan(3);
  });

  // The local provider-CLI surface (ADR-0015) is its own barrel so the server
  // interface above stays about answering messages. Its consumers are the admin
  // Settings surface, the connect flow and the relay routes.
  it("local-providers barrel exports exactly its declared surface", () => {
    expect(valueKeys(localProviders)).toEqual([
      "LOCAL_SUBSCRIPTION_PROVIDERS",
      "cancelLocalSubscriptionLogin",
      "clearLocalSubscriptionReadinessProbe",
      "connectedLocalSubscriptionProviders",
      "createLocalCliRunner",
      "disconnectLocalSubscription",
      "getLocalSubscriptionStatus",
      "isLocalSubscriptionDirectEnabled",
      "isLocalSubscriptionProvider",
      "isLoopbackHost",
      "listLocalSubscriptionStatuses",
      "startLocalSubscriptionLogin",
      "verifiedLocalSubscriptionProviders",
    ]);
  });

  // The runtime's reply-part contract (ChatReplyPart, flowing through the
  // client-facing RuntimeEvent `part` event) is part of the public surface.
  // Adding the Agentic Search terminal `clarify` variant (#156) is a
  // deliberate, reviewed widening, asserted here so it can't regress silently.
  it("carries the Agentic Search clarify reply-part variant (deliberate #156 surface change)", () => {
    const clarify: ChatReplyPart = {
      type: "clarify",
      action: "search_knowledge",
      question: "Which course or topic are you asking about?",
      found: ["Reading week schedule"],
    };
    expect(clarify).toMatchObject({ type: "clarify", action: "search_knowledge" });
    // `found` is optional, a clarify with nothing surfaced is still valid.
    const bare: ChatReplyPart = {
      type: "clarify",
      action: "search_knowledge",
      question: "Could you tell me a bit more?",
    };
    expect("found" in bare).toBe(false);
  });
});
