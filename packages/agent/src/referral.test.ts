import { describe, expect, it } from "vitest";
import type { Assistant, ReferralCandidate } from "@agent-hub/core";
import { createTurnSession } from "./session";
import { buildToolset, type ToolRuntimeContext } from "./tools";
import type { ChatReplyPart, RuntimeEvent } from "./types";

/**
 * The referral tool (#773).
 *
 * Two things are worth pinning here. The tool must not exist when there is
 * nobody to refer to, because a model holding a tool it cannot usefully call
 * reaches for it anyway. And the target id must be validated rather than
 * trusted: a hallucinated id would render a card that goes nowhere, and a
 * guessed real one would be a disclosure.
 */

function makeAssistant(): Assistant {
  return {
    id: "tm-origin",
    organizationId: "org-1",
    title: "Nora",
    nickname: "Nora",
    description: "",
    welcomeMessage: "",
    aiDisclaimer: "",
    suggestedQuestions: [],
    quickReplies: [],
    answeringStyle: "",
    simplifiedThinking: false,
    chatLauncherEnabled: false,
    modelProvider: "anthropic",
    modelId: "claude-opus-4-8",
    style: {},
    allowedDomains: [],
    helpDeskSettings: {},
    tools: {},
    requireSignIn: false,
    knowledgeEngine: "vector",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  };
}

const ADA: ReferralCandidate = {
  id: "tm-ada",
  name: "Ada",
  description: "Data Analyst. Answers questions about our metrics.",
};

function makeContext(candidates: ReferralCandidate[]) {
  const events: RuntimeEvent[] = [];
  const parts: ChatReplyPart[] = [];
  const ctx: ToolRuntimeContext = {
    assistant: makeAssistant(),
    session: createTurnSession("c1", {}),
    usedSources: [],
    searchPasses: [],
    referralCandidates: candidates,
    emitPart: (part) => parts.push(part),
    emit: (event) => events.push(event),
  };
  return { ctx, events, parts };
}

async function run(
  toolset: ReturnType<typeof buildToolset>,
  name: string,
  input: Record<string, unknown>
) {
  const entry = toolset[name] as {
    execute: (i: unknown, o: unknown) => Promise<unknown>;
  };
  return entry.execute(input, { toolCallId: `call-${name}`, messages: [] });
}

describe("the referral tool", () => {
  it("is absent when the organization has no other visible Teammates", () => {
    // The gate that matters: a one-Teammate organization must never be offered
    // a handoff with nowhere to go.
    const { ctx } = makeContext([]);
    expect(Object.keys(buildToolset(ctx))).not.toContain("referToTeammate");
  });

  it("appears as soon as there is somebody to refer to", () => {
    const { ctx } = makeContext([ADA]);
    expect(Object.keys(buildToolset(ctx))).toContain("referToTeammate");
  });

  it("emits a card naming the target, the reason and the summary", async () => {
    const { ctx, parts, events } = makeContext([ADA]);
    await run(buildToolset(ctx), "referToTeammate", {
      teammateId: "tm-ada",
      reason: "Ada knows our metrics better than I do.",
      summary: "They want last quarter's retention split by plan.",
    });

    expect(parts).toEqual([
      {
        type: "teammate_referral",
        action: "refer_teammate",
        teammateId: "tm-ada",
        teammateName: "Ada",
        reason: "Ada knows our metrics better than I do.",
        summary: "They want last quarter's retention split by plan.",
      },
    ]);
    // And it shows in the transcript's tool cards like any other action.
    expect(events.find((event) => event.type === "tool-end")).toMatchObject({
      ok: true,
      result: { operation: "teammates.refer", entity: "teammate Ada" },
    });
  });

  it("tells the model to stop rather than answer anyway", async () => {
    const { ctx } = makeContext([ADA]);
    const output = (await run(buildToolset(ctx), "referToTeammate", {
      teammateId: "tm-ada",
      reason: "r",
      summary: "s",
    })) as { note?: string };
    // Without this a referral reads as a preamble and the model answers the
    // question it just said it could not answer.
    expect(output.note).toContain("do not answer the original question");
  });

  it("refuses an id that is not on the list, and says what is", async () => {
    const { ctx, parts } = makeContext([ADA]);
    const output = (await run(buildToolset(ctx), "referToTeammate", {
      teammateId: "tm-does-not-exist",
      reason: "r",
      summary: "s",
    })) as { error?: string };

    // A hallucinated id would render a card that goes nowhere; a guessed real
    // one would disclose a Teammate the Member cannot see.
    expect(output.error).toContain("No colleague with that id");
    // The list comes back so a model that passed a name can correct itself.
    expect(output.error).toContain("Ada (tm-ada)");
    expect(parts).toEqual([]);
  });

  it("emits nothing at all when it refuses", async () => {
    const { ctx, events } = makeContext([ADA]);
    await run(buildToolset(ctx), "referToTeammate", {
      teammateId: "nope",
      reason: "r",
      summary: "s",
    });
    // A card the Member cannot act on is worse than no card.
    expect(events.find((event) => event.type === "tool-end")).toMatchObject({
      ok: false,
    });
  });
});
