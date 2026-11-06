import { capabilitiesForLadderRole } from "@agent-hub/core";
import { GET as getInboxConversations } from "@/app/api/v1/conversations/route";
import { PUT as setAccess, DELETE as clearAccess } from "@/app/api/v1/assistants/[id]/access/[userId]/route";
import { GET as listAccess } from "@/app/api/v1/assistants/[id]/access/route";
import { GET as getSource } from "@/app/api/v1/sources/[id]/route";
import { POST as checkFaqDuplicates } from "@/app/api/v1/knowledge/faqs/check/route";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  apiKeySecretHint,
  generateApiKeySecret,
  hashApiKeySecret,
} from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { GET as getMeta } from "@/app/api/v1/meta/route";
import {
  GET as getAssistants,
  POST as postAssistant,
} from "@/app/api/v1/assistants/route";
import {
  DELETE as deleteAssistant,
  GET as getAssistant,
  PATCH as patchAssistant,
} from "@/app/api/v1/assistants/[id]/route";
import { POST as duplicateAssistant } from "@/app/api/v1/assistants/[id]/duplicate/route";
import { resolveApiKeyContext, requireApiCapability } from "./auth";
import { parseListParams } from "./http";
import { clearIdempotencyStore, withIdempotency } from "./idempotency";

/**
 * Route-level tests for the /api/v1 skeleton (#619), run over the in-memory
 * demo Db (no Supabase env in vitest), exactly how demo mode serves the API.
 */

async function mintKey(role: "owner" | "admin" | "editor" | "viewer") {
  const secret = generateApiKeySecret();
  const key = await getMockDb().createApiKey(DEMO_ORG.id, {
    name: `test ${role} key`,
    role,
    roleId: `builtin:${role}`,
    secretHash: hashApiKeySecret(secret),
    secretHint: apiKeySecretHint(secret),
    createdBy: DEMO_MEMBER.userId,
  });
  return { secret, key };
}

const request = (url: string, secret?: string, headers?: Record<string, string>) =>
  new Request(url, {
    headers: {
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
      ...headers,
    },
  });

const LIST_URL = "http://test.local/api/v1/assistants";

describe("GET /api/v1/meta", () => {
  it("answers without auth and advertises the shipped domains", async () => {
    const res = await getMeta();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.apiVersion).toBe(1);
    expect(body.domains).toContain("assistants");
  });
});

describe("API key authentication", () => {
  it("401s a missing, malformed, non-bearer or unknown credential", async () => {
    for (const req of [
      request(LIST_URL),
      request(LIST_URL, "not-a-ciele-key"),
      new Request(LIST_URL, { headers: { authorization: "Basic ciele_sk_x" } }),
      request(LIST_URL, generateApiKeySecret()), // well-formed, never minted
    ]) {
      const res = await getAssistants(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("unauthorized");
    }
  });

  it("401s a revoked key with the same envelope", async () => {
    const { secret, key } = await mintKey("viewer");
    await getMockDb().revokeApiKey(key.id);
    const res = await getAssistants(request(LIST_URL, secret));
    expect(res.status).toBe(401);
  });

  it("resolves a valid key to its org and role, and stamps last-used", async () => {
    const { secret, key } = await mintKey("editor");
    const ctx = await resolveApiKeyContext(request(LIST_URL, secret));
    if (ctx instanceof Response) throw new Error("expected a context");
    expect(ctx.organizationId).toBe(DEMO_ORG.id);
    expect(ctx.role).toBe("editor");

    const listed = await getMockDb().listApiKeys(DEMO_ORG.id);
    expect(listed.find((k) => k.id === key.id)?.lastUsedAt).toBeTruthy();
  });

  it("caps a key at its creator's current role after a demotion (CYB-04)", async () => {
    const { secret } = await mintKey("admin");
    const db = getMockDb();
    try {
      await db.updateMemberRole(DEMO_ORG.id, DEMO_MEMBER.userId, "builtin:viewer");
      const ctx = await resolveApiKeyContext(request(LIST_URL, secret));
      if (ctx instanceof Response) throw new Error("expected a context");
      // The stored role is the ceiling the key was minted with; the
      // membership row is the floor it lives under now.
      expect(ctx.role).toBe("viewer");
      expect(requireApiCapability(ctx, "flows:edit")?.status).toBe(403);
    } finally {
      await db.updateMemberRole(DEMO_ORG.id, DEMO_MEMBER.userId, `builtin:${DEMO_MEMBER.role}`);
    }
  });

  it("never widens a key past the role it was minted with", async () => {
    // A viewer-scoped key stays viewer-scoped even though its creator is an
    // owner: re-promotion (or a generous creator) must not grow old keys.
    const { secret } = await mintKey("viewer");
    const ctx = await resolveApiKeyContext(request(LIST_URL, secret));
    if (ctx instanceof Response) throw new Error("expected a context");
    expect(ctx.role).toBe("viewer");
  });

  it("403s below the required capability, passes at or above it", async () => {
    const { secret } = await mintKey("viewer");
    const ctx = await resolveApiKeyContext(request(LIST_URL, secret));
    if (ctx instanceof Response) throw new Error("expected a context");

    expect(requireApiCapability(ctx, "member")).toBeNull();
    const denied = requireApiCapability(ctx, "flows:edit");
    expect(denied?.status).toBe(403);
    const body = await denied!.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("pins a representative Capability × key Role table", () => {
    const roles = ["owner", "admin", "editor", "viewer"] as const;
    const allowed = {
      member: ["owner", "admin", "editor", "viewer"],
      "flows:edit": ["owner", "admin", "editor"],
      "assistants:publish": ["owner", "admin"],
      "members:manage": ["owner", "admin"],
      "apiKeys:manage": ["owner", "admin"],
      "personalSubscriptions:manage": ["owner"],
    } as const;
    for (const [capability, expected] of Object.entries(allowed)) {
      const actual = roles.filter(
        (role) =>
          requireApiCapability(
            { role, capabilities: capabilitiesForLadderRole(role) } as Parameters<typeof requireApiCapability>[0],
            capability as keyof typeof allowed
          ) === null
      );
      expect([capability, actual]).toEqual([capability, expected]);
    }
  });

  it("acts at most as the creator may, Capability by Capability", async () => {
    const db = getMockDb();
    const narrow = await db.createOrgRole(DEMO_ORG.id, {
      name: "API test reporting",
      description: "",
      capabilities: ["assistants:view", "insights:view"],
      organizationLevel: true,
      assistantLevel: false,
    });
    const { secret } = await mintKey("editor");
    try {
      await db.updateMemberRole(DEMO_ORG.id, DEMO_MEMBER.userId, narrow.id);
      const ctx = await resolveApiKeyContext(request(LIST_URL, secret));
      if (ctx instanceof Response) throw new Error("expected a context");
      expect(ctx.capabilities).toEqual(["assistants:view", "insights:view"]);
      expect(requireApiCapability(ctx, "assistants:view")).toBeNull();
      expect(requireApiCapability(ctx, "flows:view")?.status).toBe(403);
    } finally {
      await db.updateMemberRole(DEMO_ORG.id, DEMO_MEMBER.userId, `builtin:${DEMO_MEMBER.role}`);
    }
  });
});

describe("GET /api/v1/assistants (tracer read)", () => {
  let secret: string;
  beforeAll(async () => {
    ({ secret } = await mintKey("viewer"));
  });

  it("returns the demo org's assistants for a valid key", async () => {
    const res = await getAssistants(request(LIST_URL, secret));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBeGreaterThan(0);
    const direct = await getMockDb().listAssistants(DEMO_ORG.id);
    expect(body.data.map((a: { id: string }) => a.id).sort()).toEqual(
      direct.map((a) => a.id).sort()
    );
    // The route serves a projection, never the raw config row.
    expect(body.data[0]).not.toHaveProperty("tools");
  });

  it("walks pages by cursor without duplicates or gaps", async () => {
    const all = await getMockDb().listAssistants(DEMO_ORG.id);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const url = `${LIST_URL}?limit=1${cursor ? `&cursor=${cursor}` : ""}`;
      const res = await getAssistants(request(url, secret));
      const body: { data: { id: string }[]; nextCursor: string | null } =
        await res.json();
      expect(body.data.length).toBeLessThanOrEqual(1);
      seen.push(...body.data.map((a) => a.id));
      cursor = body.nextCursor;
    } while (cursor);
    expect(seen.sort()).toEqual(all.map((a) => a.id).sort());
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("assistants CRUD over /api/v1 (#620)", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const jsonRequest = (
    url: string,
    method: string,
    secret: string,
    body?: unknown,
    headers?: Record<string, string>
  ) =>
    new Request(url, {
      method,
      headers: { authorization: `Bearer ${secret}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it("creates, reads, patches and deletes through the shared operations", async () => {
    const { secret: editor } = await mintKey("editor");
    const { secret: admin } = await mintKey("admin");

    const created = await postAssistant(
      jsonRequest(LIST_URL, "POST", editor, { title: "API-born" })
    );
    expect(created.status).toBe(201);
    const assistant = await created.json();
    expect(assistant.title).toBe("API-born");

    const url = `${LIST_URL}/${assistant.id}`;
    const read = await getAssistant(request(url, editor), params(assistant.id));
    expect((await read.json()).title).toBe("API-born");

    const patched = await patchAssistant(
      jsonRequest(url, "PATCH", editor, { answeringStyle: "concise" }),
      params(assistant.id)
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).answeringStyle).toBe("concise");

    // Delete is publish-capability: the editor key is refused, admin passes.
    const editorDelete = await deleteAssistant(
      jsonRequest(url, "DELETE", editor),
      params(assistant.id)
    );
    expect(editorDelete.status).toBe(403);
    const adminDelete = await deleteAssistant(
      jsonRequest(url, "DELETE", admin),
      params(assistant.id)
    );
    expect(adminDelete.status).toBe(204);

    const gone = await getAssistant(request(url, editor), params(assistant.id));
    expect(gone.status).toBe(404);
  });

  it("403s mutations from a viewer key, 422s invalid input, 404s unknown ids", async () => {
    const { secret: viewer } = await mintKey("viewer");
    const { secret: editor } = await mintKey("editor");

    const denied = await postAssistant(
      jsonRequest(LIST_URL, "POST", viewer, { title: "nope" })
    );
    expect(denied.status).toBe(403);

    const invalid = await postAssistant(
      jsonRequest(LIST_URL, "POST", editor, { title: "" })
    );
    expect(invalid.status).toBe(422);
    expect((await invalid.json()).error.code).toBe("invalid_input");

    const missing = await getAssistant(
      request(`${LIST_URL}/nope`, viewer),
      params("nope")
    );
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("not_found");
  });

  it("duplicates config + flows through the same operation as the dashboard", async () => {
    const { secret: editor } = await mintKey("editor");
    const source = await (
      await postAssistant(jsonRequest(LIST_URL, "POST", editor, { title: "Dup src" }))
    ).json();
    const styled = await patchAssistant(
      jsonRequest(`${LIST_URL}/${source.id}`, "PATCH", editor, {
        answeringStyle: "playful",
      }),
      params(source.id)
    );
    expect(styled.status).toBe(200);
    expect((await styled.json()).answeringStyle).toBe("playful");

    const res = await duplicateAssistant(
      jsonRequest(`${LIST_URL}/${source.id}/duplicate`, "POST", editor),
      params(source.id)
    );
    expect(res.status).toBe(201);
    const copy = await res.json();
    expect(copy.title).toBe("Dup src (copy)");
    expect(copy.answeringStyle).toBe("playful");

    const sourceFlows = await getMockDb().listFlows(source.id);
    const copyFlows = await getMockDb().listFlows(copy.id);
    expect(copyFlows.map((f) => f.name).sort()).toEqual(
      sourceFlows.map((f) => f.name).sort()
    );
  });

  it("replays a POST with the same Idempotency-Key instead of creating twice", async () => {
    clearIdempotencyStore();
    const { secret: editor } = await mintKey("editor");
    const make = () =>
      postAssistant(
        jsonRequest(LIST_URL, "POST", editor, { title: "Once" }, {
          "idempotency-key": "create-once",
        })
      );
    const first = await (await make()).json();
    const second = await (await make()).json();
    expect(second.id).toBe(first.id);
    const titles = (await getMockDb().listAssistants(DEMO_ORG.id)).filter(
      (a) => a.title === "Once"
    );
    expect(titles).toHaveLength(1);
  });
});

describe("pagination helpers", () => {
  it("clamps limit", () => {
    expect(parseListParams(new URL("http://x/?limit=9999")).limit).toBe(100);
    expect(parseListParams(new URL("http://x/?limit=0")).limit).toBe(1);
    expect(parseListParams(new URL("http://x/?limit=junk")).limit).toBe(50);
  });
});

describe("Idempotency-Key", () => {
  it("replays a completed mutation for the same key and scope", async () => {
    clearIdempotencyStore();
    let runs = 0;
    const mutate = () => {
      runs += 1;
      return Promise.resolve(Response.json({ run: runs }));
    };
    const withKey = (key?: string) =>
      new Request("http://x/api/v1/things", {
        method: "POST",
        headers: key ? { "idempotency-key": key } : {},
      });

    const first = await withIdempotency(withKey("k1"), "org:POST /things", mutate);
    expect((await first.json()).run).toBe(1);

    // Same key: replayed, not re-run, and marked as a replay.
    const replay = await withIdempotency(withKey("k1"), "org:POST /things", mutate);
    expect((await replay.json()).run).toBe(1);
    expect(replay.headers.get("idempotent-replay")).toBe("true");
    expect(runs).toBe(1);

    // Different key or scope executes again; no header disables caching.
    await withIdempotency(withKey("k2"), "org:POST /things", mutate);
    await withIdempotency(withKey("k1"), "other:POST /things", mutate);
    await withIdempotency(withKey(), "org:POST /things", mutate);
    expect(runs).toBe(4);
  });

  it("pins failed responses rather than risking an ambiguous mutation replay", async () => {
    clearIdempotencyStore();
    let runs = 0;
    const flaky = () => {
      runs += 1;
      return Promise.resolve(
        runs === 1
          ? Response.json({ error: { code: "boom", message: "x" } }, { status: 500 })
          : Response.json({ ok: true })
      );
    };
    const req = () =>
      new Request("http://x/y", {
        method: "POST",
        headers: { "idempotency-key": "retry" },
      });
    expect((await withIdempotency(req(), "s", flaky)).status).toBe(500);
    const replay = await withIdempotency(req(), "s", flaky);
    expect(replay.status).toBe(500);
    expect(replay.headers.get("idempotent-replay")).toBe("true");
    expect(runs).toBe(1);
  });

  it("rejects concurrent execution and conflicting payload reuse", async () => {
    clearIdempotencyStore();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const executionStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let runs = 0;
    const request = (body: string) =>
      new Request("http://x/api/v1/things", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "corporate-retry",
        },
        body,
      });
    const first = withIdempotency(request('{"name":"a"}'), "org:POST /things", async () => {
      runs += 1;
      started();
      await gate;
      return Response.json({ ok: true });
    });
    await executionStarted;

    const concurrent = await withIdempotency(
      request('{"name":"a"}'),
      "org:POST /things",
      async () => Response.json({ duplicate: true })
    );
    expect(concurrent.status).toBe(409);
    expect(concurrent.headers.get("retry-after")).toBe("2");
    release();
    expect((await first).status).toBe(200);
    expect(runs).toBe(1);

    const conflict = await withIdempotency(
      request('{"name":"b"}'),
      "org:POST /things",
      async () => Response.json({ duplicate: true })
    );
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("idempotency_conflict");
  });
});

describe("Assistant override and Audit log API boundary", () => {
  it("applies Denied to a key's creator for detail, lists and child resources", async () => {
    const db = getMockDb();
    const assistant = await db.createAssistant(DEMO_ORG.id,{ title:"Denied creator fixture" });
    const { secret } = await mintKey("editor");
    try {
      await db.updateMemberRole(DEMO_ORG.id,DEMO_MEMBER.userId,"editor");
      await db.setAssistantAccess(assistant.id,DEMO_MEMBER.userId,"denied");
      const collection=await db.createCollection(assistant.id,{ name:"Denied source scope" });
      const source=await db.createSource({ collectionId:collection.id,name:"Reset hidden password",kind:"faq" });
      await db.setSourceAssistantLinks(source.id,[assistant.id]);
      const concept=await db.createConcept({ collectionId:collection.id,sourceId:source.id,path:"faq/denied.md",frontmatter:{ type:"FAQ",title:"Reset hidden password" },body:"Hidden answer" });
      await db.saveChunks([{ collectionId:collection.id,conceptId:concept.id,sourceId:source.id,content:"Reset hidden password",embedding:null }]);
      expect((await getSource(request(`http://test.local/api/v1/sources/${source.id}`,secret),{ params:Promise.resolve({ id:source.id }) })).status).toBe(404);
      for (const key of ["OPENAI_API_KEY","GOOGLE_GENERATIVE_AI_API_KEY","OPENAI_COMPATIBLE_BASE_URL"]) vi.stubEnv(key,undefined);
      const duplicateResponse=await checkFaqDuplicates(new Request("http://test.local/api/v1/knowledge/faqs/check",{ method:"POST",headers:{ authorization:`Bearer ${secret}`,"content-type":"application/json" },body:JSON.stringify({ collectionId:collection.id,question:"Reset hidden password" }) }));
      expect(duplicateResponse.status).toBe(200);
      expect((await duplicateResponse.json()).data).toEqual([]);
      const contextBeforeOwner = await resolveApiKeyContext(request(LIST_URL, secret));
      if (contextBeforeOwner instanceof Response) throw new Error("Expected key context");
      const library = await contextBeforeOwner.db.listOrgKnowledgeSources(DEMO_ORG.id, { kinds: ["faq"] });
      expect(library.items.map(row => row.id)).not.toContain(source.id);
      await expect(contextBeforeOwner.db.listSourceDocuments(source.id)).rejects.toThrow();
      expect((await contextBeforeOwner.db.listSources(collection.id)).map(row => row.id)).not.toContain(source.id);
      expect((await contextBeforeOwner.db.listConcepts(collection.id)).map(row => row.id)).not.toContain(concept.id);
      const conversation = await db.createConversation({ assistantId: assistant.id, subjectType: "visitor", subjectId: "denied-visitor", title: "Hidden Inbox", metadata: { city: "Hidden test city" } });
      await db.appendMessage({ conversationId: conversation.id, role: "user", content: [{ type: "text", text: "Secret body" }] });
      const inbox = await getInboxConversations(request(`http://test.local/api/v1/conversations?assistantId=${assistant.id}`, secret));
      // Denied on this Assistant: the same answer as an Assistant that does not exist.
      expect(inbox.status).toBe(404);
      expect((await contextBeforeOwner.db.getInboxFacets(DEMO_ORG.id)).cities).not.toContain("Hidden test city");
      const params = { params:Promise.resolve({ id:assistant.id }) };
      const res = await getAssistant(request(`${LIST_URL}/${assistant.id}`,secret),params);
      expect(res.status).toBe(404);
      const list = await getAssistants(request(LIST_URL,secret));
      expect((await list.json()).data.map((row: { id:string }) => row.id)).not.toContain(assistant.id);
      const context = await resolveApiKeyContext(request(LIST_URL,secret));
      if (context instanceof Response) throw new Error("Expected key context");
      await expect(context.db.listFlows(assistant.id)).rejects.toThrow();
      // Owners retain access even when an old Denied row remains.
      await db.updateMemberRole(DEMO_ORG.id,DEMO_MEMBER.userId,"owner");
      expect((await getAssistant(request(`${LIST_URL}/${assistant.id}`,secret),params)).status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
      await db.clearAssistantAccess(assistant.id,DEMO_MEMBER.userId);
      await db.updateMemberRole(DEMO_ORG.id,DEMO_MEMBER.userId,DEMO_MEMBER.role);
    }
  });
  it("keeps hidden shared links while allowing an editable unlink and refuses shared content writes", async () => {
    const db = getMockDb();
    const editable = await db.createAssistant(DEMO_ORG.id, { title: "Editable shared knowledge" });
    const hidden = await db.createAssistant(DEMO_ORG.id, { title: "Hidden shared knowledge" });
    const collection = await db.createCollection(editable.id, { name: "Shared" });
    const source = await db.createSource({ collectionId: collection.id, name: "Shared Source", kind: "faq" });
    await db.setSourceAssistantLinks(source.id, [editable.id, hidden.id]);
    const { secret } = await mintKey("editor");
    try {
      await db.updateMemberRole(DEMO_ORG.id, DEMO_MEMBER.userId, "editor");
      await db.setAssistantAccess(hidden.id, DEMO_MEMBER.userId, "denied");
      const ctx = await resolveApiKeyContext(request(LIST_URL, secret));
      if (ctx instanceof Response) throw new Error("Expected key context");
      const page = await ctx.db.listOrgKnowledgeSources(DEMO_ORG.id, { kinds: ["faq"] });
      expect(page.items.find(row => row.id === source.id)?.linkedAssistants.map(row => row.assistantId)).toEqual([editable.id]);
      await expect(ctx.db.deleteSource(source.id)).rejects.toThrow();
      await ctx.db.setSourceAssistantLinks(source.id, []);
      expect((await db.listSourceAssistantLinks(source.id)).map(row => row.assistantId)).toEqual([hidden.id]);
      await db.setAssistantAccess(editable.id, DEMO_MEMBER.userId, "viewer");
      await expect(ctx.db.updateAssistant(editable.id, { title: "Forbidden" })).rejects.toThrow();
    } finally {
      await db.clearAssistantAccess(hidden.id, DEMO_MEMBER.userId);
      await db.clearAssistantAccess(editable.id, DEMO_MEMBER.userId);
      await db.updateMemberRole(DEMO_ORG.id, DEMO_MEMBER.userId, `builtin:${DEMO_MEMBER.role}`);
    }
  });
  it("sets, lists and clears access through the public API and records consequential outcomes", async () => {
    const db = getMockDb();
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Manage access API" });
    const { secret } = await mintKey("admin");
    const params = { params: Promise.resolve({ id: assistant.id, userId: DEMO_MEMBER.userId }) };
    const response = await setAccess(new Request(`${LIST_URL}/${assistant.id}/access/${DEMO_MEMBER.userId}`, { method: "PUT", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify({ role: "viewer" }) }), params);
    expect(response.status).toBe(204);
    const listed = await listAccess(request(`${LIST_URL}/${assistant.id}/access`, secret), { params: Promise.resolve({ id: assistant.id }) });
    expect((await listed.json()).data.find((row: { userId: string }) => row.userId === DEMO_MEMBER.userId).override.role).toBe("viewer");
    expect((await clearAccess(request(`${LIST_URL}/${assistant.id}/access/${DEMO_MEMBER.userId}`, secret), params)).status).toBe(204);
    expect(await db.listAssistantAccess(assistant.id)).toEqual([]);
    const entries = await db.listAuditEntries(DEMO_ORG.id, { domain: "assistants" });
    expect(entries.filter(entry => entry.operation === "assistants.access.set" && entry.entities.some(entity => entity.id === assistant.id))).toHaveLength(2);
    expect(entries.find(entry => entry.operation === "assistants.access.set")?.effect).toBe("consequential");
  });
  it("records an API-key write through the pinned Db without persisting input content", async () => {
    const { secret,key } = await mintKey("editor");
    const res = await postAssistant(new Request(LIST_URL,{ method:"POST", headers:{ authorization:`Bearer ${secret}`,"content-type":"application/json","x-ciele-surface":"mcp" },body:JSON.stringify({ title:"private title must not enter audit" }) }));
    expect(res.status).toBe(201);
    const [entry] = (await getMockDb().listAuditEntries(DEMO_ORG.id,{})).filter(row => row.apiKeyId===key.id);
    expect(entry).toMatchObject({ operation:"assistants.create",effect:"write",outcome:"ok",surface:"mcp",memberId:DEMO_MEMBER.userId });
    expect(JSON.stringify(entry)).not.toContain("private title");
  });
});
