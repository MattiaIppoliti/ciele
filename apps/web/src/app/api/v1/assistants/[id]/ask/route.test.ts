import { describe, expect, it } from "vitest";
import {
  apiKeySecretHint,
  generateApiKeySecret,
  hashApiKeySecret,
} from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { POST } from "./route";

/**
 * `POST /api/v1/assistants/{id}/ask` over the in-memory demo Db: a real key,
 * the real operation and port, the real Conversation Turn on the seeded
 * Publication. vitest configures no provider, so the turn answers the way an
 * Assistant with no model does; what is asserted is where that answer lands.
 */

async function mintKey() {
  const secret = generateApiKeySecret();
  const key = await getMockDb().createApiKey(DEMO_ORG.id, {
    name: "ask key",
    role: "viewer",
    secretHash: hashApiKeySecret(secret),
    secretHint: apiKeySecretHint(secret),
    createdBy: DEMO_MEMBER.userId,
  });
  return { secret, keyId: key.id };
}

const ask = (secret: string, assistantId: string, body: unknown) =>
  POST(
    new Request(`http://test.local/api/v1/assistants/${assistantId}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: assistantId }) }
  );

async function publishedAssistantId() {
  const db = getMockDb();
  for (const assistant of await db.listAssistants(DEMO_ORG.id)) {
    if (await db.getLatestPublication(assistant.id)) return assistant.id;
  }
  throw new Error("the demo seed publishes no Assistant");
}

describe("POST /api/v1/assistants/{id}/ask", () => {
  it("runs a turn on the Publication and files it as the key's Member traffic", async () => {
    const { secret, keyId } = await mintKey();
    const assistantId = await publishedAssistantId();
    const res = await ask(secret, assistantId, { question: "What are your opening hours?" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.conversationId).toBe("string");
    expect(typeof body.answer).toBe("string");
    expect(Array.isArray(body.sources)).toBe(true);

    // The Preview's subject, so Insights leaves it out; marked with the key,
    // so the Inbox can tell it from the Member's own Preview.
    const conversation = await getMockDb().getConversation(body.conversationId);
    expect(conversation).toMatchObject({
      subjectType: "member",
      subjectId: DEMO_MEMBER.userId,
      assistantId,
    });
    expect(conversation?.metadata?.apiKeyId).toBe(keyId);
  });

  it("continues a thread only when this key started it", async () => {
    const assistantId = await publishedAssistantId();
    const first = await mintKey();
    const opened = await (await ask(first.secret, assistantId, { question: "Hello" })).json();

    // The same key joins its own thread.
    const again = await (
      await ask(first.secret, assistantId, {
        question: "And another thing",
        conversationId: opened.conversationId,
      })
    ).json();
    expect(again.conversationId).toBe(opened.conversationId);

    // Another key the same Member minted shares the subject, not the thread.
    const second = await mintKey();
    const sibling = await (
      await ask(second.secret, assistantId, {
        question: "Hello",
        conversationId: opened.conversationId,
      })
    ).json();
    expect(sibling.conversationId).not.toBe(opened.conversationId);

    // Nor does a key join its creator's own Preview thread.
    const preview = await getMockDb().createConversation({
      assistantId,
      subjectType: "member",
      subjectId: DEMO_MEMBER.userId,
      title: "Preview",
    });
    const joined = await (
      await ask(first.secret, assistantId, { question: "Hello", conversationId: preview.id })
    ).json();
    expect(joined.conversationId).not.toBe(preview.id);
  });

  it("refuses a missing or unknown key", async () => {
    const assistantId = await publishedAssistantId();
    expect((await ask("ck_not_a_real_key", assistantId, { question: "Hi" })).status).toBe(401);
  });

  it("asks for a Publication first, and hides another Organization's Assistant", async () => {
    const { secret } = await mintKey();
    const draft = await getMockDb().createAssistant(DEMO_ORG.id, { title: "Never published" });
    const unpublished = await ask(secret, draft.id, { question: "Hello?" });
    expect(unpublished.status).toBe(409);

    const foreign = await getMockDb().createAssistant("org_other", { title: "Theirs" });
    expect((await ask(secret, foreign.id, { question: "Hello?" })).status).toBe(404);
    expect((await ask(secret, draft.id, { question: "  " })).status).toBe(422);
  });

  it("budgets each key at twenty questions a minute", async () => {
    const { secret } = await mintKey();
    const draft = await getMockDb().createAssistant(DEMO_ORG.id, { title: "Budget probe" });
    // A refused question costs no turn, so an unpublished Assistant is enough
    // to spend the budget: the limiter runs before the operation.
    let last: Response | null = null;
    for (let i = 0; i < 21; i += 1) last = await ask(secret, draft.id, { question: "Hi" });
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
