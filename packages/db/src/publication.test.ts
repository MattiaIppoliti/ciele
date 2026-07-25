import { describe, expect, it } from "vitest";
import { buildPublicationConfig } from "./publication";
import type { Assistant, Flow, KnowledgeCollection } from "./types";

/**
 * The Publication snapshot builder (context.md: Publication). The point of the
 * seam is that the frozen field selection lives in one tested place — so the
 * central test asserts exactly which Assistant fields are captured, and will
 * fail loudly if a field is added or dropped.
 */

function makeAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return {
    id: "as-1",
    organizationId: "org-1",
    title: "Campus Assistant",
    nickname: "Campus AI",
    description: "Helps students",
    welcomeMessage: "Hi!",
    aiDisclaimer: "Double-check important info.",
    suggestedQuestions: ["Study plan"],
    quickReplies: [],
    avatarUrl:
      "https://example.supabase.co/storage/v1/object/public/public-assets/org/org-1/avatars/assistant/as-1.png",
    answeringStyle: "Be warm and concise.",
    chatLauncherEnabled: true,
    modelProvider: "anthropic",
    modelId: "claude-opus-4-8",
    style: { brandColor: "#123456", position: "right" },
    allowedDomains: ["campus.edu"],
    helpDeskSettings: { contactButtonLabel: "Get help" },
    tools: { builtIns: { remember: true } },
    requireSignIn: false,
    knowledgeEngine: "graph",
    // Deliberately-excluded live fields:
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

const EXPECTED_ASSISTANT_KEYS = [
  "id",
  "organizationId",
  "title",
  "nickname",
  "description",
  "welcomeMessage",
  "aiDisclaimer",
  "suggestedQuestions",
  "quickReplies",
  "avatarUrl",
  "answeringStyle",
  "chatLauncherEnabled",
  "modelProvider",
  "modelId",
  "style",
  "allowedDomains",
  "helpDeskSettings",
  "tools",
  "requireSignIn",
  "knowledgeEngine",
].sort();

describe("buildPublicationConfig", () => {
  it("captures exactly the snapshot fields (not createdAt/updatedAt)", () => {
    const config = buildPublicationConfig(makeAssistant(), [], []);
    expect(Object.keys(config.assistant).sort()).toEqual(EXPECTED_ASSISTANT_KEYS);
    expect(config.assistant).not.toHaveProperty("createdAt");
    expect(config.assistant).not.toHaveProperty("updatedAt");
  });

  it("copies the captured values verbatim", () => {
    const assistant = makeAssistant();
    const config = buildPublicationConfig(assistant, [], []);
    expect(config.assistant.style).toEqual({
      brandColor: "#123456",
      position: "right",
    });
    expect(config.assistant.allowedDomains).toEqual(["campus.edu"]);
    expect(config.assistant.helpDeskSettings).toEqual({
      contactButtonLabel: "Get help",
    });
    expect(config.assistant.avatarUrl).toBe(
      "https://example.supabase.co/storage/v1/object/public/public-assets/org/org-1/avatars/assistant/as-1.png"
    );
  });

  it("passes flows through and reduces collections to id+name references", () => {
    const flows = [{ id: "f1", name: "Default behavior" } as unknown as Flow];
    const collections: KnowledgeCollection[] = [
      {
        id: "col-1",
        assistantId: "as-1",
        name: "MARKETING (A)",
        description: "long description that must not be snapshotted",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    const config = buildPublicationConfig(makeAssistant(), flows, collections);
    expect(config.flows).toBe(flows);
    expect(config.collections).toEqual([{ id: "col-1", name: "MARKETING (A)" }]);
  });

  it("freezes attached skills to their runtime snapshot fields", () => {
    const config = buildPublicationConfig(makeAssistant(), [], [], [
      {
        id: "sk-1",
        name: "Citation format",
        description: "How to cite",
        prompt: "Always cite sources as [n].",
      },
    ]);
    expect(config.skills).toEqual([
      {
        id: "sk-1",
        name: "Citation format",
        description: "How to cite",
        prompt: "Always cite sources as [n].",
      },
    ]);
  });

  it("defaults skills to an empty snapshot list", () => {
    expect(buildPublicationConfig(makeAssistant(), [], []).skills).toEqual([]);
  });
});
