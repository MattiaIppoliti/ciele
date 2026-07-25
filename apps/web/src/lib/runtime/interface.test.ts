import { describe, expect, it } from "vitest";
// The reply-part contract is asserted through the client barrel on purpose:
// the runtime owns ChatReplyPart (spec #194) and client code reaches it only
// via `@/lib/runtime/client`.
import type { ChatReplyPart } from "./client";
import * as server from "./index";
import * as client from "./client";

/**
 * Locks the runtime module's public interface (ADR-0005).
 *
 * The runtime is a deep, gray-box module: its internals change freely, but its
 * two public entry points are deliberately narrow. Growing them should be a
 * reviewed decision, not an accident — if you add an export to `index.ts` or
 * `client.ts`, update the expected set below on purpose.
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
      "CRAWL_FINALIZE_LEASE_MS",
      "InvalidProviderKeyError",
      "NDJSON_HEADERS",
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
      "finalizeWebsiteCrawl",
      "forwardGraphFeedback",
      "getEnterpriseCapabilities",
      "persistConcept",
      "providerAvailability",
      "registerEnterpriseCapabilities",
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
