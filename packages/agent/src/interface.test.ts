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
 * reviewed decision, not an accident — if you add an export to `index.ts`,
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
      "CRAWL_FINALIZE_BATCH_SIZE",
      "CRAWL_FINALIZE_LEASE_MS",
      // The shipped platform prompt layer — public so the owner-only editor can
      // show "the default" and the host's cached reader can fall back to it.
      "DEFAULT_PLATFORM_PROMPT",
      "InvalidProviderKeyError",
      "NDJSON_HEADERS",
      "RECRAWL_SWEEP_BATCH_SIZE",
      // The warn threshold: a deliberate widening (#509). The admin Usage
      // surface must colour a gauge amber at exactly the fraction the
      // enterprise ladder warns at, and open-source code cannot import from
      // src/ee — so the constant is declared here and consumed by both.
      "USAGE_WARN_FRACTION",
      // Alert sourceKey registry — a deliberate widening so EE capability
      // implementations mint keys through the one namespace registry (#442).
      "alertKeys",
      "backfillCollectionToGraph",
      "beginWebsiteCrawl",
      "draftImprovementProposal",
      "embedConcept",
      "enqueueDraftProposalJob",
      "enqueueGraphSyncJob",
      "enqueueIngestJob",
      "extractSourceText",
      "feedbackScore",
      // The two scheduled drains. The cron endpoints in apps/web are auth-and-
      // serialize adapters over these, so the tick's policy is tested here.
      "finalizeDueCrawls",
      "finalizeWebsiteCrawl",
      "forwardGraphFeedback",
      "getEnterpriseCapabilities",
      "persistConcept",
      "providerAvailability",
      "registerEnterpriseCapabilities",
      // The host port registry — how a framework-free package gets the two
      // facts only its host knows (see host.ts).
      "registerRuntimeHost",
      "restartWebsiteCrawl",
      "runCompostPass",
      "runDueAnswerVerifications",
      "runDueGoalEvals",
      "runDueGraphSyncJobs",
      "runDueIngestJobs",
      "runDueProposalJobs",
      "runGraphLearning",
      "runTrustMaterialization",
      "sendEmail",
      "sendEscalationApiRequest",
      "sessionMetadata",
      "streamConversationTurn",
      "sweepDueRecrawls",
      "testApiRequest",
      // "Test connection" for OpenAI-compatible endpoints — a deliberate
      // widening for the connection form (#436).
      "testOpenAiCompatibleConnection",
      "updateWebsiteSourceConfiguration",
      "validateProviderApiKey",
      "websiteCrawlerCapabilities",
    ]);
  });

  it("client barrel exports exactly its declared surface", () => {
    expect(valueKeys(client)).toEqual([
      "MODEL_CATALOG",
      "PROVIDER_NAMES",
      "TEMPLATE_VARIABLES",
      "canEmbedWithConnection",
      "consumeTurnStream",
      "decodeRuntimeEvents",
    ]);
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
      "isLocalSubscriptionProvider",
      "isLocalSubscriptionTestEnabled",
      "isLoopbackHost",
      "listLocalSubscriptionStatuses",
      "startLocalSubscriptionLogin",
      "verifiedLocalSubscriptionProviders",
    ]);
  });

  // The runtime's reply-part contract (ChatReplyPart, flowing through the
  // client-facing RuntimeEvent `part` event) is part of the public surface.
  // Adding the Agentic Search terminal `clarify` variant (#156) is a
  // deliberate, reviewed widening — asserted here so it can't regress silently.
  it("carries the Agentic Search clarify reply-part variant (deliberate #156 surface change)", () => {
    const clarify: ChatReplyPart = {
      type: "clarify",
      action: "search_knowledge",
      question: "Which course or topic are you asking about?",
      found: ["Reading week schedule"],
    };
    expect(clarify).toMatchObject({ type: "clarify", action: "search_knowledge" });
    // `found` is optional — a clarify with nothing surfaced is still valid.
    const bare: ChatReplyPart = {
      type: "clarify",
      action: "search_knowledge",
      question: "Could you tell me a bit more?",
    };
    expect("found" in bare).toBe(false);
  });
});
