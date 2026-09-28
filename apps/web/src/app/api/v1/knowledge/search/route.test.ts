import { describe, expect, it } from "vitest";
import {
  apiKeySecretHint,
  generateApiKeySecret,
  hashApiKeySecret,
} from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { POST } from "./route";

/**
 * `POST /api/v1/knowledge/search` over the in-memory demo Db, the way demo
 * mode serves it: a real key, the real operation, the real port, the mock's
 * lexical search (no embedding provider is configured in vitest).
 */

async function mintKey(role: "owner" | "viewer" = "viewer") {
  const secret = generateApiKeySecret();
  await getMockDb().createApiKey(DEMO_ORG.id, {
    name: `search ${role} key`,
    role,
    secretHash: hashApiKeySecret(secret),
    secretHint: apiKeySecretHint(secret),
    createdBy: DEMO_MEMBER.userId,
  });
  return secret;
}

const search = (secret: string | null, body: unknown) =>
  POST(
    new Request("http://test.local/api/v1/knowledge/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret ? { authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify(body),
    })
  );

describe("POST /api/v1/knowledge/search", () => {
  it("lets a Viewer key search the Library and cites each passage's Source", async () => {
    const db = getMockDb();
    const library = await db.getOrCreateOrgLibraryCollection(DEMO_ORG.id);
    const source = await db.createSource({
      collectionId: library.id,
      name: "Search probe",
      kind: "text",
    });
    const concept = await db.createConcept({
      collectionId: library.id,
      sourceId: source.id,
      path: "probe/zebra.md",
      frontmatter: { type: "Reference", title: "Zebra crossing policy" } as never,
      body: "Zebra crossings are repainted every spring.",
    });
    await db.saveChunks([
      {
        conceptId: concept.id,
        collectionId: library.id,
        sourceId: source.id,
        content: "Zebra crossings are repainted every spring.",
        embedding: null,
      },
    ]);

    const res = await search(await mintKey("viewer"), { query: "zebra crossings repainted" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assistantId).toBeNull();
    const hit = body.results.find(
      (result: { documentId: string }) => result.documentId === concept.id
    );
    expect(hit).toMatchObject({
      rank: expect.any(Number),
      documentTitle: "Zebra crossing policy",
      sourceId: source.id,
      sourceName: "Search probe",
    });
  });

  it("401s without a key and 422s an empty query", async () => {
    expect((await search(null, { query: "anything" })).status).toBe(401);
    const res = await search(await mintKey(), { query: "   " });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("invalid_input");
  });

  it("answers another Organization's Assistant as not found", async () => {
    const foreign = await getMockDb().createAssistant("org_other", { title: "Theirs" });
    const res = await search(await mintKey(), { query: "anything", assistantId: foreign.id });
    expect(res.status).toBe(404);
  });

  it("budgets each key and says when to come back", async () => {
    const secret = await mintKey();
    let last: Response | null = null;
    for (let i = 0; i < 61; i += 1) last = await search(secret, { query: "budget probe" });
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another key has its own budget.
    expect((await search(await mintKey(), { query: "budget probe" })).status).toBe(200);
  });
});
