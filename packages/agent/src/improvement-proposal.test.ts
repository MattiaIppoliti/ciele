import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Conversation,
  Improvement,
  KnowledgeSearchResult,
  StoredMessage,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { EMBEDDING_DIMS } from "./embeddings";
import { draftImprovementProposal } from "./improvement-proposal";

// Only the two calls that would leave the machine are faked, the drafter's
// structured-output call and the embedding call. Everything else (context
// gathering, credential resolution, the vector retrieval path) is the real
// code running against a fake Db, so both mocks spread the original module:
// a partial factory silently breaks any *other* import of it in the graph
// (`embeddings.ts` pulls `resolveProviderCredential` from "./models"), and the
// drafter swallows that error, which reads as a passing test over a path that
// never ran.
const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  embed: vi.fn(),
  getClassifierModel: vi.fn(),
}));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateObject: mocks.generateObject,
  embed: mocks.embed,
}));
vi.mock("./models", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./models")>()),
  getClassifierModel: mocks.getClassifierModel,
}));

function msg(id: string, role: "user" | "assistant", text: string): StoredMessage {
  return {
    id,
    conversationId: "conv1",
    role,
    content: [{ type: "text", text }],
    flowId: null,
    flowName: null,
    feedback: 0,
    createdAt: "2026-07-19T00:00:00Z",
  } as StoredMessage;
}

function chunk(over: Partial<KnowledgeSearchResult> = {}): KnowledgeSearchResult {
  return {
    conceptId: "c1",
    conceptTitle: "Password reset",
    conceptPath: "identity/password-reset.md",
    collectionId: "col1",
    collectionName: "Handbook",
    sourceName: "Staff handbook",
    resourceUrl: null,
    content: "Reset from the Identity Portal, then confirm by email.",
    similarity: 0.9,
    ...over,
  };
}

function fakeDb(over: Partial<Db> = {}): Db {
  const conversation = {
    id: "conv1",
    assistantId: "a1",
    collectionId: "col1",
    subjectType: "visitor",
    subjectId: "v1",
    title: "t",
    metadata: {},
    sessionState: {},
    pinned: false,
    createdAt: "2026-07-19T00:00:00Z",
    updatedAt: "2026-07-19T00:00:00Z",
  } as Conversation;
  return {
    getImprovement: vi
      .fn()
      .mockResolvedValue({ id: "imp1", description: "missed the portal step" } as Improvement),
    getConversationForMessage: vi.fn().mockResolvedValue(conversation),
    getAssistant: vi
      .fn()
      .mockResolvedValue({ id: "a1", organizationId: "org1", knowledgeEngine: "vector" }),
    listMessages: vi
      .fn()
      .mockResolvedValue([msg("u1", "user", "how do I reset?"), msg("m1", "assistant", "bad answer")]),
    listProviderConnections: vi.fn().mockResolvedValue([]),
    searchChunks: vi.fn().mockResolvedValue([]),
    createImprovementProposal: vi.fn().mockResolvedValue({ id: "prop1" }),
    recordAiUsage: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as Db;
}

/** The query the drafter builds from the visitor question + the reviewer note. */
const QUERY = "how do I reset? missed the portal step";

let errors: string[];

beforeEach(() => {
  vi.clearAllMocks();
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  mocks.embed.mockResolvedValue({ embedding: [0.1, 0.2], usage: { tokens: 3 } });
  mocks.getClassifierModel.mockReturnValue({
    model: {},
    modelId: "test-model",
    provider: "anthropic",
  });
  mocks.generateObject.mockResolvedValue({
    object: {
      draftQuestion: "How do I reset my password?",
      draftAnswer: "Open the Identity Portal.",
      rationale: "The answer omitted the portal.",
    },
    usage: { inputTokens: 10, outputTokens: 20 },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("draftImprovementProposal", () => {
  it("drafts and stores a proposal targeted at the flagged answer's assistant/collection", async () => {
    const db = fakeDb();
    await draftImprovementProposal({ db, improvementId: "imp1", messageId: "m1" });
    expect(db.createImprovementProposal).toHaveBeenCalledWith({
      improvementId: "imp1",
      organizationId: "org1",
      payload: expect.objectContaining({
        draftQuestion: "How do I reset my password?",
        draftAnswer: "Open the Identity Portal.",
        model: "test-model",
        targetAssistantId: "a1",
        targetCollectionId: "col1",
      }),
    });
    // Retrieval ran for real: with no embedding-capable connection the searcher
    // falls back to lexical (null embedding) instead of erroring out.
    expect(db.searchChunks).toHaveBeenCalledWith("a1", null, {
      embedding: null,
      text: QUERY,
      limit: 6,
    });
    expect(errors).toEqual([]);
  });

  it("embeds the query, widens to assistant scope, and carries Sources into the proposal", async () => {
    // A platform key makes the real credential resolution yield an embedding
    // model, so this drives the whole vector path (embed → searchChunks).
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const db = fakeDb({ searchChunks: vi.fn().mockResolvedValue([chunk()]) });
    await draftImprovementProposal({ db, improvementId: "imp1", messageId: "m1" });

    expect(mocks.embed).toHaveBeenCalledWith(
      expect.objectContaining({ value: QUERY })
    );
    const [assistantId, collectionId, query] = vi.mocked(db.searchChunks).mock.calls[0];
    expect(assistantId).toBe("a1");
    expect(collectionId).toBeNull(); // scope: "assistant" widens past col1
    expect(query.text).toBe(QUERY);
    expect(query.embedding?.slice(0, 2)).toEqual([0.1, 0.2]);
    expect(query.embedding).toHaveLength(EMBEDDING_DIMS); // padded for pgvector

    // The retrieved excerpt reaches the drafter, and its citation is stored.
    const prompt = mocks.generateObject.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("## Password reset");
    expect(prompt).toContain("Reset from the Identity Portal");
    expect(db.createImprovementProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          sources: [
            {
              conceptId: "c1",
              conceptTitle: "Password reset",
              sourceName: "Staff handbook",
            },
          ],
        }),
      })
    );
    expect(errors).toEqual([]);
  });

  it("still drafts, with no context and no Sources, when retrieval fails", async () => {
    const db = fakeDb({
      searchChunks: vi.fn().mockRejectedValue(new Error("vector store down")),
    });
    await draftImprovementProposal({ db, improvementId: "imp1", messageId: "m1" });

    // The searcher was reached: the failure under test is the store's, not a
    // mock gap upstream of it.
    expect(db.searchChunks).toHaveBeenCalled();
    const prompt = mocks.generateObject.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("(none found)");
    expect(db.createImprovementProposal).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ sources: [] }) })
    );
    expect(errors.join("\n")).toContain("[proposal] context retrieval failed");
  });

  it("leaves no proposal when there is no model credential", async () => {
    mocks.getClassifierModel.mockReturnValue(null);
    const db = fakeDb();
    await draftImprovementProposal({ db, improvementId: "imp1", messageId: "m1" });
    expect(db.createImprovementProposal).not.toHaveBeenCalled();
  });

  it("leaves no proposal when the flagged message has no text", async () => {
    const db = fakeDb({
      listMessages: vi.fn().mockResolvedValue([msg("u1", "user", "q")]), // no m1
    });
    await draftImprovementProposal({ db, improvementId: "imp1", messageId: "m1" });
    expect(db.createImprovementProposal).not.toHaveBeenCalled();
  });

  it("does not throw and stores nothing when the LLM call fails", async () => {
    mocks.generateObject.mockRejectedValue(new Error("model down"));
    const db = fakeDb();
    await expect(
      draftImprovementProposal({ db, improvementId: "imp1", messageId: "m1" })
    ).resolves.toBeUndefined();
    expect(db.createImprovementProposal).not.toHaveBeenCalled();
  });
});
