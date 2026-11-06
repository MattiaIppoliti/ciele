import { afterEach, expect, it, vi } from "vitest";
import { DEMO_ORG, getMockDb } from "@agent-hub/db";
import { findFaqDuplicates } from "./faq-duplicates";
const ai = vi.hoisted(() => ({ embed: vi.fn(), embedMany: vi.fn() }));
vi.mock("ai", () => ai);
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); ai.embed.mockReset(); });
async function fixture() {
  const db = getMockDb();
  const collection = await db.getOrCreateOrgLibraryCollection(DEMO_ORG.id);
  for (const question of ["How do I reset my password", "How do I change my email address"]) {
    const source = await db.createSource({ collectionId: collection.id, name: question, kind: "faq" });
    const document = await db.createConcept({ collectionId: collection.id, sourceId: source.id, path: `faq/${source.id}.md`, frontmatter: { type: "FAQ", title: question }, body: "Open the account page." });
    await db.saveChunks([{ collectionId: collection.id, conceptId: document.id, sourceId: source.id, content: question, embedding: null }]);
  }
  return { db, collection };
}
it("uses one metered embedding for a check and excludes neighbouring topics", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  ai.embed.mockResolvedValue({ embedding: [0.1, 0.2], usage: { tokens: 7 } });
  const { db, collection } = await fixture();
  const meter = vi.spyOn(db, "recordAiUsage");
  const result = await findFaqDuplicates({ db, collectionId: collection.id, organizationId: DEMO_ORG.id, connections: [], question: "Where can I reset my password" });
  expect(ai.embed).toHaveBeenCalledTimes(1);
  expect(result).toHaveLength(1);
  expect(result[0].question).toContain("reset my password");
  expect(meter).toHaveBeenCalledWith([expect.objectContaining({ organizationId: DEMO_ORG.id, stage: "embed" })]);
});
it("falls back to lexical lookup without a provider and refuses foreign Collections", async () => {
  for (const key of ["OPENAI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "OPENAI_COMPATIBLE_BASE_URL"]) vi.stubEnv(key, undefined);
  const { db, collection } = await fixture();
  const result = await findFaqDuplicates({ db, collectionId: collection.id, organizationId: DEMO_ORG.id, connections: [], question: "How do I reset my password" });
  expect(result[0].question).toContain("reset my password");
  expect(ai.embed).not.toHaveBeenCalled();
  await expect(findFaqDuplicates({ db, collectionId: collection.id, organizationId: "other-org", connections: [], question: "password" })).rejects.toThrow("Collection not found");
});

it("finds an exact FAQ after more than thirty matching non-FAQ Documents", async () => {
  for (const key of ["OPENAI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "OPENAI_COMPATIBLE_BASE_URL"]) vi.stubEnv(key, undefined);
  const db = getMockDb();
  const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Mixed duplicate scope" });
  const collection = await db.createCollection(assistant.id, { name: "Mixed scope" });
  for (let index = 0; index < 32; index++) {
    const source = await db.createSource({ collectionId: collection.id, name: "Reset password", kind: index === 31 ? "faq" : "file" });
    const concept = await db.createConcept({ collectionId: collection.id, sourceId: source.id, path: `${source.id}.md`, frontmatter: { type: index === 31 ? "FAQ" : "Document", title: "Reset password" }, body: "Reset password" });
    await db.saveChunks([{ collectionId: collection.id, conceptId: concept.id, sourceId: source.id, content: "Reset password", embedding: null }]);
  }
  const result = await findFaqDuplicates({ db, collectionId: collection.id, organizationId: DEMO_ORG.id, connections: [], question: "Reset password" });
  expect(result).toHaveLength(1);
});
