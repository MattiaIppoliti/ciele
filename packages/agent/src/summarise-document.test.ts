import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@agent-hub/db";
import { SUMMARY_INPUT_CHARS, summariseDocument } from "./summarise-document";

// Only the call that would leave the machine is faked, and the module is
// spread rather than replaced: a partial factory silently breaks any *other*
// import of it in the graph, and this function swallows its own errors, which
// would read as a passing test over a path that never ran.
const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  getClassifierModel: vi.fn(),
}));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: mocks.generateText,
}));
vi.mock("./models", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./models")>()),
  getClassifierModel: mocks.getClassifierModel,
}));

const recorded: unknown[] = [];

const db = {
  listProviderConnections: async () => [],
  recordAiUsage: async (rows: unknown[]) => void recorded.push(...rows),
} as unknown as Db;

const classifier = {
  model: {} as never,
  modelId: "claude-sonnet-5",
  provider: "anthropic" as const,
  credentialKind: "platform" as const,
};

beforeEach(() => {
  recorded.length = 0;
  mocks.generateText.mockReset();
  mocks.getClassifierModel.mockReset();
  mocks.getClassifierModel.mockReturnValue(classifier);
});

describe("summariseDocument", () => {
  it("returns the summary with an OKF actor naming the model", async () => {
    mocks.generateText.mockResolvedValue({
      text: "  How leave accrues.  ",
      usage: { inputTokens: 900, outputTokens: 40 },
    });

    const result = await summariseDocument({
      db,
      organizationId: "org-1",
      title: "Leave policy",
      body: "Employees accrue 25 days of paid leave a year.",
    });

    expect(result).toEqual({
      text: "How leave accrues.",
      by: "document-summariser/claude-sonnet-5",
    });
  });

  it("meters the call as knowledge work, whoever's click triggered it", async () => {
    mocks.generateText.mockResolvedValue({
      text: "A summary.",
      usage: { inputTokens: 900, outputTokens: 40 },
    });

    await summariseDocument({
      db,
      organizationId: "org-1",
      title: "Leave policy",
      body: "body",
    });

    expect(recorded).toEqual([
      {
        organizationId: "org-1",
        assistantId: null,
        stage: "enrich",
        provider: "anthropic",
        modelId: "claude-sonnet-5",
        credentialKind: "platform",
        inputTokens: 900,
        outputTokens: 40,
        surface: "ingestion",
      },
    ]);
  });

  it("makes no call and meters nothing without a Provider Connection", async () => {
    mocks.getClassifierModel.mockReturnValue(null);

    expect(
      await summariseDocument({
        db,
        organizationId: "org-1",
        title: "Leave policy",
        body: "body",
      })
    ).toBeNull();
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(recorded).toEqual([]);
  });

  it("answers null on a model error rather than throwing into the route", async () => {
    mocks.generateText.mockRejectedValue(new Error("upstream is down"));

    expect(
      await summariseDocument({
        db,
        organizationId: "org-1",
        title: "Leave policy",
        body: "body",
      })
    ).toBeNull();
    // Nothing metered: the call produced no tokens anybody should pay for.
    expect(recorded).toEqual([]);
  });

  it("answers null for an empty body and for an empty completion", async () => {
    expect(
      await summariseDocument({
        db,
        organizationId: "org-1",
        title: "Empty",
        body: "   ",
      })
    ).toBeNull();
    expect(mocks.generateText).not.toHaveBeenCalled();

    mocks.generateText.mockResolvedValue({ text: "   ", usage: undefined });
    expect(
      await summariseDocument({
        db,
        organizationId: "org-1",
        title: "Leave policy",
        body: "body",
      })
    ).toBeNull();
  });

  it("truncates a huge body and says so in the prompt", async () => {
    mocks.generateText.mockResolvedValue({ text: "A summary.", usage: undefined });

    await summariseDocument({
      db,
      organizationId: "org-1",
      title: "Huge",
      body: "x".repeat(SUMMARY_INPUT_CHARS * 3),
    });

    const prompt = mocks.generateText.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain("truncated");
    // The model is told what it was given, so it describes that rather than
    // inventing an ending it never saw.
    expect(prompt.length).toBeLessThan(SUMMARY_INPUT_CHARS + 200);
  });
});
