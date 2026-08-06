import { beforeAll, describe, expect, it } from "vitest";
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
import { paginate, parseListParams } from "./http";
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

  it("403s below the required capability, passes at or above it", async () => {
    const { secret } = await mintKey("viewer");
    const ctx = await resolveApiKeyContext(request(LIST_URL, secret));
    if (ctx instanceof Response) throw new Error("expected a context");

    expect(requireApiCapability(ctx, "member")).toBeNull();
    const denied = requireApiCapability(ctx, "edit");
    expect(denied?.status).toBe(403);
    const body = await denied!.json();
    expect(body.error.code).toBe("forbidden");
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

  it("403s mutations from a viewer key, 400s invalid input, 404s unknown ids", async () => {
    const { secret: viewer } = await mintKey("viewer");
    const { secret: editor } = await mintKey("editor");

    const denied = await postAssistant(
      jsonRequest(LIST_URL, "POST", viewer, { title: "nope" })
    );
    expect(denied.status).toBe(403);

    const invalid = await postAssistant(
      jsonRequest(LIST_URL, "POST", editor, { title: "" })
    );
    expect(invalid.status).toBe(400);
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
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("clamps limit and treats unknown cursors as a restart", () => {
    expect(parseListParams(new URL("http://x/?limit=9999")).limit).toBe(100);
    expect(parseListParams(new URL("http://x/?limit=0")).limit).toBe(1);
    expect(parseListParams(new URL("http://x/?limit=junk")).limit).toBe(50);
    const restarted = paginate(items, { limit: 2, cursor: "missing" });
    expect(restarted.data.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("chains cursors to the end", () => {
    const first = paginate(items, { limit: 2, cursor: null });
    expect(first.data.map((i) => i.id)).toEqual(["a", "b"]);
    expect(first.nextCursor).toBe("b");
    const second = paginate(items, { limit: 2, cursor: first.nextCursor });
    expect(second.data.map((i) => i.id)).toEqual(["c"]);
    expect(second.nextCursor).toBeNull();
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

  it("does not pin failed responses", async () => {
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
    expect((await withIdempotency(req(), "s", flaky)).status).toBe(200);
    expect(runs).toBe(2);
  });
});
