import { describe, expect, it } from "vitest";
import {
  apiKeySecretHint,
  generateApiKeySecret,
  hashApiKeySecret,
} from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { POST as postAssistant } from "@/app/api/v1/assistants/route";
import {
  GET as getFlows,
  POST as postFlow,
} from "@/app/api/v1/assistants/[id]/flows/route";
import { POST as reorderFlows } from "@/app/api/v1/assistants/[id]/flows/reorder/route";
import {
  DELETE as deleteFlow,
  PATCH as patchFlow,
} from "@/app/api/v1/flows/[id]/route";
import { GET as getCollections } from "@/app/api/v1/assistants/[id]/collections/route";
import {
  GET as getSources,
  POST as postSource,
} from "@/app/api/v1/collections/[id]/sources/route";
import { GET as getSource } from "@/app/api/v1/sources/[id]/route";
import { POST as importFaqs } from "@/app/api/v1/collections/[id]/faqs/import/route";
import {
  DELETE as unpublish,
  GET as publishStatus,
  POST as publish,
} from "@/app/api/v1/assistants/[id]/publish/route";
import { GET as listConversations } from "@/app/api/v1/conversations/route";
import { GET as getConversation } from "@/app/api/v1/conversations/[id]/route";
import { GET as listImprovements } from "@/app/api/v1/improvements/route";
import { PATCH as patchImprovement } from "@/app/api/v1/improvements/[id]/route";
import { GET as whoami } from "@/app/api/v1/whoami/route";
import { GET as listEntities, POST as postEntity } from "@/app/api/v1/entities/route";
import { PATCH as patchEntity } from "@/app/api/v1/entities/[id]/route";
import { POST as importRecords } from "@/app/api/v1/entities/[id]/records/import/route";
import { POST as queryRecords } from "@/app/api/v1/entities/[id]/records/query/route";
import { GET as memorySettings, PATCH as patchMemorySettings } from "@/app/api/v1/memories/settings/route";
import { GET as listMemorySubjects } from "@/app/api/v1/memories/subjects/route";
import { GET as getAssistantEntities, PATCH as patchAssistantEntities } from "@/app/api/v1/assistants/[id]/entities/route";
import { GET as getSsoIdentity, PATCH as patchSsoIdentity } from "@/app/api/v1/sso/identity/route";
import { GET as listInvites } from "@/app/api/v1/invites/route";

/** Route-level coverage for the #621–#625 domains over the demo Db. */

async function mintKey(role: "owner" | "admin" | "editor" | "viewer") {
  const secret = generateApiKeySecret();
  await getMockDb().createApiKey(DEMO_ORG.id, {
    name: `domains ${role} key`,
    role,
    secretHash: hashApiKeySecret(secret),
    secretHint: apiKeySecretHint(secret),
    createdBy: DEMO_MEMBER.userId,
  });
  return secret;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (
  url: string,
  secret: string,
  init: { method?: string; body?: unknown; form?: FormData } = {}
) =>
  new Request(`http://t.local${url}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${secret}` },
    body:
      init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });

async function makeAssistant(secret: string, title: string) {
  const res = await postAssistant(
    req("/api/v1/assistants", secret, { method: "POST", body: { title } })
  );
  return res.json();
}

describe("whoami over /api/v1 (#627)", () => {
  it("returns the key's org and role; 401 without a key", async () => {
    const editor = await mintKey("editor");
    const res = await whoami(req("/api/v1/whoami", editor));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.organizationId).toBe(DEMO_ORG.id);
    expect(body.role).toBe("editor");
    expect(body.keyId).toBeTruthy();

    expect((await whoami(new Request("http://t.local/api/v1/whoami"))).status).toBe(
      401
    );
  });
});

describe("organization administration over /api/v1", () => {
  it("does not expose invite bearer tokens to editor keys", async () => {
    const editor = await mintKey("editor");
    const admin = await mintKey("admin");
    expect((await listInvites(req("/api/v1/invites", editor))).status).toBe(403);
    expect((await listInvites(req("/api/v1/invites", admin))).status).toBe(200);
  });
});

describe("flows over /api/v1 (#621)", () => {
  it("CRUD + reorder + invariants through the shared operations", async () => {
    const editor = await mintKey("editor");
    const viewer = await mintKey("viewer");
    const assistant = await makeAssistant(editor, "Flows API");
    const flowsUrl = `/api/v1/assistants/${assistant.id}/flows`;

    const listed = await getFlows(req(flowsUrl, viewer), params(assistant.id));
    expect(listed.status).toBe(200);
    const { data: seeded } = await listed.json();
    const defaultFlow = seeded.find((f: { isDefault: boolean }) => f.isDefault);

    // Viewer cannot create; editor can.
    expect(
      (
        await postFlow(
          req(flowsUrl, viewer, { method: "POST", body: { name: "x" } }),
          params(assistant.id)
        )
      ).status
    ).toBe(403);
    const created = await (
      await postFlow(
        req(flowsUrl, editor, { method: "POST", body: { name: "Fees intent" } }),
        params(assistant.id)
      )
    ).json();

    // The #541 pairing rule 400s; the Default-behavior lock 409s.
    expect(
      (
        await patchFlow(
          req(`/api/v1/flows/${created.id}`, editor, {
            method: "PATCH",
            body: { trigger: "page_load", actions: ["search_knowledge"] },
          }),
          params(created.id)
        )
      ).status
    ).toBe(400);
    expect(
      (
        await deleteFlow(
          req(`/api/v1/flows/${defaultFlow.id}`, editor, { method: "DELETE" }),
          params(defaultFlow.id)
        )
      ).status
    ).toBe(409);

    const reordered = await reorderFlows(
      req(`${flowsUrl}/reorder`, editor, {
        method: "POST",
        body: { orderedIds: [created.id] },
      }),
      params(assistant.id)
    );
    expect(reordered.status).toBe(200);
    const { data: after } = await reordered.json();
    expect(after[after.length - 1].isDefault).toBe(true);

    expect(
      (
        await deleteFlow(
          req(`/api/v1/flows/${created.id}`, editor, { method: "DELETE" }),
          params(created.id)
        )
      ).status
    ).toBe(204);
  });
});

describe("knowledge over /api/v1 (#622)", () => {
  it("adds a text Source, polls its status, bulk-imports FAQs", async () => {
    const editor = await mintKey("editor");
    const assistant = await makeAssistant(editor, "Knowledge API");
    const collection = await getMockDb().createCollection(assistant.id, {
      name: "docs",
    });

    const collectionsRes = await getCollections(
      req(`/api/v1/assistants/${assistant.id}/collections`, editor),
      params(assistant.id)
    );
    expect(
      (await collectionsRes.json()).data.map((c: { id: string }) => c.id)
    ).toContain(collection.id);

    const created = await postSource(
      new Request(`http://t.local/api/v1/collections/${collection.id}/sources`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${editor}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "text",
          name: "Handbook",
          text: "Tuition is due in October.",
        }),
      }),
      params(collection.id)
    );
    expect(created.status).toBe(201);
    const source = await created.json();
    expect(source.status).toBeTruthy(); // pollable

    const polled = await getSource(
      req(`/api/v1/sources/${source.id}`, editor),
      params(source.id)
    );
    expect((await polled.json()).id).toBe(source.id);

    const listedSources = await getSources(
      req(`/api/v1/collections/${collection.id}/sources`, editor),
      params(collection.id)
    );
    expect(
      (await listedSources.json()).data.map((s: { id: string }) => s.id)
    ).toContain(source.id);

    const form = new FormData();
    form.set(
      "file",
      new File(["question,answer\nQ1,A1\nQ2,A2\n"], "faqs.csv", {
        type: "text/csv",
      })
    );
    const imported = await importFaqs(
      req(`/api/v1/collections/${collection.id}/faqs/import`, editor, {
        method: "POST",
        form,
      }),
      params(collection.id)
    );
    expect(imported.status).toBe(200);
    const body = await imported.json();
    expect(body.imported).toBe(2);
  });
});

describe("publish over /api/v1 (#623)", () => {
  it("publish is admin+; status and unpublish round-trip", async () => {
    const editor = await mintKey("editor");
    const admin = await mintKey("admin");
    const assistant = await makeAssistant(editor, "Publish API");
    const url = `/api/v1/assistants/${assistant.id}/publish`;

    expect(
      (await publish(req(url, editor, { method: "POST" }), params(assistant.id)))
        .status
    ).toBe(403);

    const published = await publish(
      req(url, admin, { method: "POST" }),
      params(assistant.id)
    );
    expect(published.status).toBe(201);
    expect((await published.json()).version).toBeGreaterThan(0);

    const status = await publishStatus(req(url, editor), params(assistant.id));
    expect((await status.json()).published).toBe(true);

    expect(
      (
        await unpublish(
          req(url, admin, { method: "DELETE" }),
          params(assistant.id)
        )
      ).status
    ).toBe(204);
    const after = await publishStatus(req(url, editor), params(assistant.id));
    expect((await after.json()).published).toBe(false);
  });
});

describe("inbox over /api/v1 (#624)", () => {
  it("viewer key lists and reads transcripts, trace gated to admin+", async () => {
    const viewer = await mintKey("viewer");
    const admin = await mintKey("admin");

    const listed = await listConversations(req("/api/v1/conversations", viewer));
    expect(listed.status).toBe(200);
    const { data } = await listed.json();
    expect(data.length).toBeGreaterThan(0);

    const id = data[0].id;
    const asViewer = await getConversation(
      req(`/api/v1/conversations/${id}`, viewer),
      params(id)
    );
    expect(asViewer.status).toBe(200);
    const viewerBody = await asViewer.json();
    for (const message of viewerBody.messages) {
      expect("trace" in message).toBe(false);
    }

    const asAdmin = await getConversation(
      req(`/api/v1/conversations/${id}`, admin),
      params(id)
    );
    const adminBody = await asAdmin.json();
    expect(
      adminBody.messages.some((m: object) => "trace" in m)
    ).toBe(true);
  });
});

describe("improvements over /api/v1 (#625)", () => {
  it("lists and patches through the shared operation", async () => {
    const viewer = await mintKey("viewer");
    const editor = await mintKey("editor");

    const listed = await listImprovements(req("/api/v1/improvements", viewer));
    const { data } = await listed.json();
    expect(data.length).toBeGreaterThan(0);
    const id = data[0].id;

    // Viewer reads but cannot update.
    expect(
      (
        await patchImprovement(
          req(`/api/v1/improvements/${id}`, viewer, {
            method: "PATCH",
            body: { priority: "low" },
          }),
          params(id)
        )
      ).status
    ).toBe(403);

    const patched = await patchImprovement(
      req(`/api/v1/improvements/${id}`, editor, {
        method: "PATCH",
        body: { priority: "high" },
      }),
      params(id)
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).priority).toBe("high");

    // The web kanban reads the same row.
    const direct = await getMockDb().getImprovement(id);
    expect(direct?.priority).toBe("high");
  });
});

describe("Entities and Memories over /api/v1 (#663–#667)", () => {
  it("creates/imports/queries typed Records and gates writes by API-key role", async () => {
    const viewer = await mintKey("viewer");
    const editor = await mintKey("editor");
    const input = {
      name: "API Orders",
      attributes: [
        { key: "order_id", label: "Order ID", type: "text" },
        { key: "delayed", label: "Delayed", type: "boolean" },
      ],
      keyAttribute: "order_id",
      scope: "shared",
    };
    expect((await postEntity(req("/api/v1/entities", viewer, { method: "POST", body: input }))).status).toBe(403);
    expect((await postEntity(req("/api/v1/entities", editor, {
      method: "POST",
      body: { ...input, name: "   " },
    }))).status).toBe(400);
    const entityResponse = await postEntity(req("/api/v1/entities", editor, { method: "POST", body: input }));
    expect(entityResponse.status).toBe(201);
    const entity = await entityResponse.json();
    expect((await patchEntity(
      req(`/api/v1/entities/${entity.id}`, editor, {
        method: "PATCH",
        body: { name: "   " },
      }),
      params(entity.id)
    )).status).toBe(400);

    const imported = await importRecords(
      req(`/api/v1/entities/${entity.id}/records/import`, editor, {
        method: "POST",
        body: { csv: "order_id,delayed\nA-1,true\nA-2,false\n" },
      }),
      params(entity.id)
    );
    expect(await imported.json()).toMatchObject({ upserted: 2, rejected: [] });
    const queried = await queryRecords(
      req(`/api/v1/entities/${entity.id}/records/query`, viewer, {
        method: "POST",
        body: { filters: { delayed: true } },
      }),
      params(entity.id)
    );
    expect((await queried.json()).data.map((record: { key: string }) => record.key)).toEqual(["A-1"]);
    expect((await listEntities(req("/api/v1/entities", viewer))).status).toBe(200);

    const assistant = await makeAssistant(editor, "Entity-enabled Assistant");
    await getMockDb().updateAssistant(assistant.id, {
      tools: { builtIns: { fetchUrl: true } },
    });
    const selection = await patchAssistantEntities(
      req(`/api/v1/assistants/${assistant.id}/entities`, editor, {
        method: "PATCH",
        body: { entityIds: [entity.id] },
      }),
      params(assistant.id)
    );
    expect(await selection.json()).toEqual({ entityIds: [entity.id] });
    expect(
      await (
        await getAssistantEntities(
          req(`/api/v1/assistants/${assistant.id}/entities`, viewer),
          params(assistant.id)
        )
      ).json()
    ).toEqual({ entityIds: [entity.id] });
    expect((await getMockDb().getAssistant(assistant.id))?.tools).toEqual({
      builtIns: { fetchUrl: true },
      entities: [entity.id],
    });
  });

  it("reads memory settings for viewers and limits changes to admins", async () => {
    const viewer = await mintKey("viewer");
    const admin = await mintKey("admin");
    expect((await memorySettings(req("/api/v1/memories/settings", viewer))).status).toBe(200);
    expect((await patchMemorySettings(req("/api/v1/memories/settings", viewer, { method: "PATCH", body: { enabled: true } }))).status).toBe(403);
    const enabled = await patchMemorySettings(req("/api/v1/memories/settings", admin, { method: "PATCH", body: { enabled: true } }));
    expect(await enabled.json()).toEqual({ enabled: true });
    expect((await listMemorySubjects(req("/api/v1/memories/subjects", viewer))).status).toBe(200);
  });

  it("reads, sets, and clears the verified SSO identity claim for admins", async () => {
    const admin = await mintKey("admin");
    await getMockDb().setSsoConnection(DEMO_ORG.id, {
      provider: "entra",
      config: { clientId: "client", tenantId: "tenant" },
      encryptedSecret: "plain:test-secret",
    });
    const viewer = await mintKey("viewer");
    expect((await getSsoIdentity(req("/api/v1/sso/identity", viewer))).status).toBe(403);
    const set = await patchSsoIdentity(req("/api/v1/sso/identity", admin, {
      method: "PATCH",
      body: { identityClaim: "email" },
    }));
    expect(await set.json()).toEqual({ identityClaim: "email" });
    const status = await getSsoIdentity(req("/api/v1/sso/identity", admin));
    expect(await status.json()).toMatchObject({
      connected: true,
      provider: "entra",
      identityClaim: "email",
      validationStatus: "unvalidated",
    });
    const cleared = await patchSsoIdentity(req("/api/v1/sso/identity", admin, {
      method: "PATCH",
      body: { identityClaim: null },
    }));
    expect(await cleared.json()).toEqual({ identityClaim: null });
  });
});
