import { describe, expect, it } from "vitest";
import type { Assistant, Flow } from "@agent-hub/core";
import { memoryPromptSections } from "@agent-hub/core";
import { buildSystemPrompt } from "./run";

/**
 * What the model is told about itself and about its tools.
 *
 * The prompt is assembled from layers whose precedence is the product's
 * (platform → who you are → skills → memory → retrieval → routing), so the
 * cases here are about which layer wins and which instructions are honest for
 * the turn that is actually running.
 */

function makeAssistant(over: Partial<Assistant> = {}): Assistant {
  return {
    id: "a1",
    organizationId: "org1",
    title: "Campus Assistant",
    nickname: "Campy",
    description: "Answers questions about the site",
    welcomeMessage: "",
    aiDisclaimer: "",
    suggestedQuestions: [],
    quickReplies: [],
    answeringStyle: "",
    simplifiedThinking: false,
    chatLauncherEnabled: true,
    modelProvider: "anthropic",
    modelId: "claude-opus-4-8",
    style: {},
    allowedDomains: [],
    helpDeskSettings: {},
    tools: {},
    requireSignIn: false,
    knowledgeEngine: "vector",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

const flow: Flow = {
  id: "f1",
  assistantId: "a1",
  name: "Default behavior",
  description: "No other flow matches",
  builtIn: true,
  enabled: true,
  position: 0,
  trigger: "message",
  triggerSettings: {},
  conditionLogic: "any",
  conditions: [],
  actions: [],
  actionSettings: {},
  customMessage: "",
  isDefault: true,
};

describe("buildSystemPrompt", () => {
  it("introduces an Assistant as a website assistant", () => {
    const prompt = buildSystemPrompt("PLATFORM", makeAssistant(), flow);
    expect(prompt).toContain("You are Campy, an AI assistant embedded in an organization's website.");
    expect(prompt).toContain("About you: Answers questions about the site");
  });

  it("lets a Teammate persona replace that identity outright (#768)", () => {
    const prompt = buildSystemPrompt("PLATFORM", makeAssistant(), flow, {
      persona: "You are Nora, the Support Copywriter on this organization's team.",
    });
    expect(prompt).toContain("You are Nora, the Support Copywriter");
    // A colleague is not a visitor: the widget identity must not survive
    // underneath the persona, or the model answers as the public assistant.
    expect(prompt).not.toContain("embedded in an organization's website");
    expect(prompt).not.toContain("About you:");
    // The platform layer still outranks everything.
    expect(prompt.indexOf("PLATFORM")).toBeLessThan(prompt.indexOf("You are Nora"));
  });

  it("injects the memory layers it was given, and nothing when given none (#771)", () => {
    const bare = buildSystemPrompt("PLATFORM", makeAssistant(), flow, {
      persona: "You are Nora.",
      memoryDocuments: [],
    });
    // Empty layers inject nothing at all, not empty headings: a heading with
    // nothing under it invites the model to explain that it knows nothing.
    expect(bare).not.toContain("colleague you are talking to");

    const withLayers = buildSystemPrompt("PLATFORM", makeAssistant(), flow, {
      persona: "You are Nora.",
      memoryDocuments: memoryPromptSections({
        user: "Marta works in CET.",
        project: "We ship on Thursdays.",
        projectName: "Atlas",
      }),
    });
    expect(withLayers).toContain("Marta works in CET.");
    expect(withLayers).toContain("Atlas");
    // Standing context sits above per-conversation context: who the colleague
    // is and what the team decided outrank what was said ten messages ago.
    const memoryAt = withLayers.indexOf("Marta works in CET.");
    const routingAt = withLayers.indexOf("# Current routing context");
    expect(memoryAt).toBeGreaterThan(withLayers.indexOf("You are Nora."));
    expect(memoryAt).toBeLessThan(routingAt);
  });

  it("tells a turn with no searcher not to look anything up", () => {
    const grounded = buildSystemPrompt("PLATFORM", makeAssistant(), flow, {
      phase: "gather",
    });
    expect(grounded).toContain("call searchKnowledge before answering");

    const scopeless = buildSystemPrompt("PLATFORM", makeAssistant(), flow, {
      phase: "gather",
      canSearchKnowledge: false,
    });
    expect(scopeless).not.toContain("call searchKnowledge");
    expect(scopeless).toContain("You have NO knowledge base this turn");
  });
});
