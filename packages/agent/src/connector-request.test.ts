import { beforeEach, describe, expect, it } from "vitest";
import type { ApplicationConnection } from "@agent-hub/core";
import { sealSecret } from "@agent-hub/core";
import type { ApplicationHttpClient, ApplicationHttpResponse } from "./application-provider-http";
import {
  connectorAlertKey,
  connectorTemplatePatch,
  dbConnectorRuntime,
  executeConnectorAction,
  loadConnectorOptions,
  resetConnectorOptionsCache,
  testConnectorConnection,
  type ConnectorRuntime,
} from "./connector-request";

/**
 * The Connector execution core over a fake HTTP client (#839): request shaping
 * per provider, output extraction, the normalized error shape, the refresh /
 * reauthorization path, and the option loaders. No network.
 */

process.env.APP_ENCRYPTION_KEY ??= "connector-test-key";

interface Call {
  url: string;
  method: string | undefined;
  headers: Record<string, string> | undefined;
  body: string | undefined;
}

function respond(
  status: number,
  text: string,
  headers: Record<string, string> = {}
): ApplicationHttpResponse {
  return { status, ok: status >= 200 && status < 300, headers: new Headers(headers), text };
}

function fakeClient(
  handler: (call: Call) => ApplicationHttpResponse
): { client: ApplicationHttpClient; calls: Call[] } {
  const calls: Call[] = [];
  const client: ApplicationHttpClient = async (url, options) => {
    const call = { url, method: options.method, headers: options.headers, body: options.body };
    calls.push(call);
    return handler(call);
  };
  return { client, calls };
}

function connection(over: Partial<ApplicationConnection> = {}): ApplicationConnection {
  return {
    id: "conn-1",
    organizationId: "org-1",
    ownerType: "organization",
    ownerMemberId: null,
    provider: "slack",
    name: "Campus Slack",
    status: "connected",
    sealedCredentials: sealSecret(JSON.stringify({ accessToken: "xoxb-token" })),
    scopes: ["channels:read", "chat:write", "channels:manage", "channels:join"],
    providerAccountId: null,
    metadata: {},
    error: "",
    lastConnectedAt: null,
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
    ...over,
  };
}

function runtimeFor(row: ApplicationConnection | null): ConnectorRuntime & {
  marked: string[];
  persisted: string[];
} {
  const marked: string[] = [];
  const persisted: string[] = [];
  return {
    marked,
    persisted,
    getConnection: async (id) => (row && row.id === id ? row : null),
    persistCredentials: async (_id, sealed) => {
      persisted.push(sealed);
    },
    markReauthorizationRequired: async (_connection, message) => {
      marked.push(message);
    },
  };
}

const context = { "user.name": "Ada", "workflow.message": "My laptop broke" };

beforeEach(() => resetConnectorOptionsCache());

describe("Slack", () => {
  it("posts a message with the bearer token and reads ts/channel back", async () => {
    const { client, calls } = fakeClient(() =>
      respond(200, JSON.stringify({ ok: true, ts: "1725.1", channel: "C1" }))
    );
    const outcome = await executeConnectorAction(
      {
        provider: "slack",
        connectionId: "conn-1",
        action: "slack.message.post",
        params: { channel: "C1", text: "From {{user.name}}: {{workflow.message}}" },
      },
      context,
      runtimeFor(connection()),
      { client }
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.outputs).toEqual({ ts: "1725.1", channel: "C1" });
    expect(calls[0]!.url).toBe("https://slack.com/api/chat.postMessage");
    expect(calls[0]!.headers?.authorization).toBe("Bearer xoxb-token");
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      channel: "C1",
      text: "From Ada: My laptop broke",
    });
    expect(connectorTemplatePatch(outcome)).toEqual({
      "connector.ok": "true",
      "connector.ts": "1725.1",
      "connector.channel": "C1",
    });
  });

  it("treats ok:false as the failure it is, with a scope code for missing_scope", async () => {
    const { client } = fakeClient(() =>
      respond(200, JSON.stringify({ ok: false, error: "missing_scope", needed: "chat:write" }))
    );
    const outcome = await executeConnectorAction(
      { action: "slack.channel.create", connectionId: "conn-1", params: { name: "x" } },
      context,
      runtimeFor(connection()),
      { client }
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatchObject({ provider: "slack", code: "scope" });
  });

  it("marks the connection for reauthorization when Slack says invalid_auth", async () => {
    const { client } = fakeClient(() =>
      respond(200, JSON.stringify({ ok: false, error: "invalid_auth" }))
    );
    const runtime = runtimeFor(connection());
    const outcome = await executeConnectorAction(
      { action: "slack.channel.list", connectionId: "conn-1" },
      context,
      runtime,
      { client }
    );
    expect(outcome.error?.code).toBe("authorization");
    expect(runtime.marked).toHaveLength(1);
  });

  it("marks the connection when the refresh itself is refused, before any call", async () => {
    // A token past its expiry with nothing to refresh it is the same fact as a
    // 401 on the call: this Connection cannot act until someone reconnects it.
    // It used to throw before the session existed and so marked nothing.
    const { client, calls } = fakeClient(() => respond(200, "{}"));
    const runtime = runtimeFor(
      connection({
        sealedCredentials: sealSecret(
          JSON.stringify({ accessToken: "stale", expiresAt: "2020-01-01T00:00:00.000Z" })
        ),
      })
    );
    const outcome = await executeConnectorAction(
      { action: "slack.channel.list", connectionId: "conn-1" },
      context,
      runtime,
      { client }
    );
    expect(outcome.error?.code).toBe("authorization");
    expect(runtime.marked).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });

  it("refuses before any call when the connection lacks the scope", async () => {
    const { client, calls } = fakeClient(() => respond(200, "{}"));
    const outcome = await executeConnectorAction(
      { action: "slack.message.post", connectionId: "conn-1", params: { channel: "C1", text: "x" } },
      context,
      runtimeFor(connection({ scopes: ["channels:read"] })),
      { client }
    );
    expect(outcome.error).toMatchObject({ code: "scope" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a personal connection unless the surface allows it", async () => {
    const { client, calls } = fakeClient(() =>
      respond(200, JSON.stringify({ ok: true, channels: [] }))
    );
    const personal = connection({ ownerType: "member", ownerMemberId: "m1" });
    const refused = await executeConnectorAction(
      { action: "slack.channel.list", connectionId: "conn-1" },
      context,
      runtimeFor(personal),
      { client }
    );
    expect(refused.error?.code).toBe("connection");
    expect(calls).toHaveLength(0);
    const allowed = await executeConnectorAction(
      { action: "slack.channel.list", connectionId: "conn-1" },
      context,
      { ...runtimeFor(personal), allowPersonal: true },
      { client }
    );
    expect(allowed.ok).toBe(true);
  });
});

describe("ServiceNow", () => {
  const servicenow = () =>
    connection({
      provider: "servicenow",
      scopes: ["useraccount"],
      sealedCredentials: sealSecret(
        JSON.stringify({ accessToken: "sn-token", baseUrl: "https://acme.service-now.com" })
      ),
    });

  it("creates a record from the JSON fields template and returns sys_id/number", async () => {
    const { client, calls } = fakeClient(() =>
      respond(201, JSON.stringify({ result: { sys_id: "abc", number: "INC0001" } }))
    );
    const outcome = await executeConnectorAction(
      {
        action: "servicenow.record.create",
        connectionId: "conn-1",
        params: {
          table: "incident",
          fields: '{ "short_description": "{{workflow.message}}", "caller": "{{user.name}}" }',
        },
      },
      context,
      runtimeFor(servicenow()),
      { client }
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.outputs).toEqual({ sys_id: "abc", number: "INC0001" });
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://acme.service-now.com/api/now/table/incident");
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      short_description: "My laptop broke",
      caller: "Ada",
    });
  });

  it("lists with an encoded query and a bounded limit", async () => {
    const { client, calls } = fakeClient(() =>
      respond(200, JSON.stringify({ result: [{ sys_id: "1" }, { sys_id: "2" }] }))
    );
    const outcome = await executeConnectorAction(
      {
        action: "servicenow.record.list",
        connectionId: "conn-1",
        params: { table: "incident", query: "active=true", limit: "5000" },
      },
      context,
      runtimeFor(servicenow()),
      { client }
    );
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("sysparm_query")).toBe("active=true");
    expect(url.searchParams.get("sysparm_limit")).toBe("100");
    expect(outcome.outputs.count).toBe("2");
    expect(outcome.outputs.first_sys_id).toBe("1");
  });

  it("refuses a table that is not an identifier before any call", async () => {
    const { client, calls } = fakeClient(() => respond(200, "{}"));
    const outcome = await executeConnectorAction(
      {
        action: "servicenow.record.delete",
        connectionId: "conn-1",
        params: { table: "incident/../../evil", sys_id: "x" },
      },
      context,
      runtimeFor(servicenow()),
      { client }
    );
    expect(outcome.error?.code).toBe("invalid_params");
    expect(calls).toHaveLength(0);
  });

  it("strips clause separators from template values in an encoded query", async () => {
    const { client, calls } = fakeClient(() => respond(200, JSON.stringify({ result: [] })));
    await executeConnectorAction(
      {
        action: "servicenow.record.list",
        connectionId: "conn-1",
        params: { table: "incident", query: "caller_id.email={{user.email}}" },
      },
      { ...context, "user.email": "a@b.c^ORactive=false" },
      runtimeFor(servicenow()),
      { client }
    );
    expect(new URL(calls[0]!.url).searchParams.get("sysparm_query")).toBe(
      "caller_id.email=a@b.cORactive=false"
    );
  });

  it("rejects fields that are not a JSON object without calling the provider", async () => {
    const { client, calls } = fakeClient(() => respond(200, "{}"));
    const outcome = await executeConnectorAction(
      {
        action: "servicenow.record.create",
        connectionId: "conn-1",
        params: { table: "incident", fields: "not json" },
      },
      context,
      runtimeFor(servicenow()),
      { client }
    );
    expect(outcome.error?.code).toBe("invalid_params");
    expect(calls).toHaveLength(0);
  });

  it("loads tables and columns as options, cached per connection", async () => {
    const { client, calls } = fakeClient((call) =>
      call.url.includes("sys_db_object")
        ? respond(200, JSON.stringify({ result: [{ name: "incident", label: "Incident" }] }))
        : respond(200, JSON.stringify({ result: [{ element: "short_description", column_label: "Short description" }] }))
    );
    const runtime = runtimeFor(servicenow());
    const unknown = await loadConnectorOptions("nonsense.loader" as never, "conn-1", "", runtime, { client });
    expect(unknown).toEqual({
      options: [],
      error: expect.objectContaining({ code: "not_configured" }),
    });
    const tables = await loadConnectorOptions("servicenow.tables", "conn-1", "", runtime, { client });
    expect(tables.options).toEqual([{ value: "incident", label: "Incident (incident)" }]);
    const columns = await loadConnectorOptions("servicenow.columns", "conn-1", "incident", runtime, { client });
    expect(columns.options[0]).toEqual({
      value: "short_description",
      label: "Short description (short_description)",
    });
    await loadConnectorOptions("servicenow.tables", "conn-1", "", runtime, { client });
    expect(calls).toHaveLength(2);
  });
});

describe("Salesforce", () => {
  const salesforce = (metadata: Record<string, unknown> = {}) =>
    connection({
      provider: "salesforce",
      scopes: ["api", "refresh_token"],
      metadata,
      sealedCredentials: sealSecret(
        JSON.stringify({
          accessToken: "sf-token",
          instanceUrl: "https://acme.my.salesforce.com",
          expiresAt: Date.now() + 3_600_000,
        })
      ),
    });

  it("queries the bound object with the pinned API version and surfaces the limit header", async () => {
    const { client, calls } = fakeClient(() =>
      respond(
        200,
        JSON.stringify({
          totalSize: 1,
          records: [{ attributes: { type: "Case" }, Id: "500x", CaseNumber: "0001" }],
        }),
        { "Sforce-Limit-Info": "api-usage=12/15000" }
      )
    );
    const outcome = await executeConnectorAction(
      {
        action: "salesforce.case.get",
        connectionId: "conn-1",
        params: { fields: "Id, CaseNumber", where: "Status = 'New'", limit: "5" },
      },
      context,
      runtimeFor(salesforce({ apiVersion: "v62.0" })),
      { client }
    );
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/services/data/v62.0/query");
    expect(url.searchParams.get("q")).toBe("SELECT Id, CaseNumber FROM Case WHERE Status = 'New' LIMIT 5");
    expect(outcome.outputs).toMatchObject({
      count: "1",
      first_id: "500x",
      api_usage: "api-usage=12/15000",
    });
    expect(outcome.outputs.records).not.toContain("attributes");
  });

  it("maps the daily request cap to a non-retryable rate_limit", async () => {
    const { client } = fakeClient(() =>
      respond(403, JSON.stringify([{ errorCode: "REQUEST_LIMIT_EXCEEDED", message: "cap" }]))
    );
    const outcome = await executeConnectorAction(
      { action: "salesforce.contact.get", connectionId: "conn-1", params: {} },
      context,
      runtimeFor(salesforce()),
      { client }
    );
    expect(outcome.error).toMatchObject({ code: "rate_limit", status: 403 });
    expect(outcome.error?.retryAfterMs).toBeUndefined();
  });

  it("escapes template values inside the SOQL literal, so a Visitor cannot widen the query", async () => {
    const { client, calls } = fakeClient(() =>
      respond(200, JSON.stringify({ totalSize: 0, records: [] }))
    );
    await executeConnectorAction(
      {
        action: "salesforce.contact.get",
        connectionId: "conn-1",
        params: { fields: "Id", where: "Email = '{{user.email}}'" },
      },
      { ...context, "user.email": "x' OR Name != '" },
      runtimeFor(salesforce()),
      { client }
    );
    expect(new URL(calls[0]!.url).searchParams.get("q")).toBe(
      "SELECT Id FROM Contact WHERE Email = 'x\\' OR Name != \\'' LIMIT 10"
    );
  });

  it("rejects a fields list that is not field names", async () => {
    const { client, calls } = fakeClient(() => respond(200, "{}"));
    const outcome = await executeConnectorAction(
      {
        action: "salesforce.contact.get",
        connectionId: "conn-1",
        params: { fields: "Id; DROP TABLE" },
      },
      context,
      runtimeFor(salesforce()),
      { client }
    );
    expect(outcome.error?.code).toBe("invalid_params");
    expect(calls).toHaveLength(0);
  });
});

describe("OneDrive (#840)", () => {
  const onedrive = () =>
    connection({
      provider: "onedrive",
      ownerType: "member",
      ownerMemberId: "m1",
      scopes: ["offline_access", "Files.Read", "User.Read", "Files.ReadWrite"],
      sealedCredentials: sealSecret(
        JSON.stringify({ accessToken: "ms-token", expiresAt: Date.now() + 3_600_000 })
      ),
    });
  const personal = (row: ApplicationConnection) => ({ ...runtimeFor(row), allowPersonal: true });

  it("is refused outside the operator surfaces, before any call", async () => {
    const { client, calls } = fakeClient(() => respond(200, "{}"));
    const outcome = await executeConnectorAction(
      { action: "onedrive.file.find", connectionId: "conn-1", params: { query: "x" } },
      context,
      runtimeFor(onedrive()),
      { client }
    );
    expect(outcome.error?.message).toMatch(/Preview and Teammate chat/);
    expect(calls).toHaveLength(0);
  });

  it("creates a text file by upload into a folder and reads id/name/link back", async () => {
    const { client, calls } = fakeClient(() =>
      respond(201, JSON.stringify({ id: "it1", name: "note.txt", webUrl: "https://x/note" }))
    );
    const outcome = await executeConnectorAction(
      {
        action: "onedrive.file.create",
        connectionId: "conn-1",
        params: { folder: "root", name: "note.txt", content: "From {{user.name}}" },
      },
      context,
      personal(onedrive()),
      { client }
    );
    expect(outcome.outputs).toEqual({ id: "it1", name: "note.txt", web_url: "https://x/note" });
    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.url).toBe("https://graph.microsoft.com/v1.0/me/drive/root:/note.txt:/content");
    expect(calls[0]!.headers?.["content-type"]).toMatch(/text\/plain/);
    expect(calls[0]!.body).toBe("From Ada");
  });

  it("reads content through the download URL Graph names, and nowhere else", async () => {
    const { client, calls } = fakeClient((call) =>
      call.url.includes("graph.microsoft.com")
        ? respond(200, JSON.stringify({ id: "it1", "@microsoft.graph.downloadUrl": "https://tenant-my.sharepoint.com/dl/abc" }))
        : respond(200, "hello world")
    );
    const outcome = await executeConnectorAction(
      { action: "onedrive.file.get_content", connectionId: "conn-1", params: { item_id: "it1" } },
      context,
      personal(onedrive()),
      { client }
    );
    expect(outcome.outputs).toEqual({ content: "hello world" });
    expect(calls.map((c) => new URL(c.url).hostname)).toEqual([
      "graph.microsoft.com",
      "tenant-my.sharepoint.com",
    ]);
    // The download URL is pre-authenticated: the Graph bearer stays home.
    expect(calls[0]!.headers?.authorization).toBe("Bearer ms-token");
    expect(calls[1]!.headers?.authorization).toBeUndefined();
  });

  it("does not follow a download URL on a host Graph should not name", async () => {
    const { client, calls } = fakeClient(() =>
      respond(200, JSON.stringify({ id: "it1", "@microsoft.graph.downloadUrl": "https://evil.example/dl" }))
    );
    const outcome = await executeConnectorAction(
      { action: "onedrive.file.get_content", connectionId: "conn-1", params: { item_id: "it1" } },
      context,
      personal(onedrive()),
      { client }
    );
    expect(calls).toHaveLength(1);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatchObject({ code: "provider" });
    expect(outcome.outputs).toEqual({});
  });

  it("quotes the Graph search term by doubling apostrophes", async () => {
    const { client, calls } = fakeClient(() => respond(200, JSON.stringify({ value: [] })));
    await executeConnectorAction(
      { action: "onedrive.file.find", connectionId: "conn-1", params: { query: "{{workflow.message}}" } },
      { ...context, "workflow.message": "it's here" },
      personal(onedrive()),
      { client }
    );
    expect(calls[0]!.url).toContain("/me/drive/root/search(q='it''s%20here')");
  });

  it("refuses a folder id that is not an item id", async () => {
    const { client, calls } = fakeClient(() => respond(200, "{}"));
    const outcome = await executeConnectorAction(
      { action: "onedrive.file.find", connectionId: "conn-1", params: { folder: "../evil", query: "x" } },
      context,
      personal(onedrive()),
      { client }
    );
    expect(outcome.error?.code).toBe("invalid_params");
    expect(calls).toHaveLength(0);
  });
});

describe("Google Drive (#840)", () => {
  const google = () =>
    connection({
      provider: "google_drive",
      ownerType: "member",
      ownerMemberId: "m1",
      scopes: ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file"],
      sealedCredentials: sealSecret(
        JSON.stringify({ accessToken: "g-token", expiresAt: Date.now() + 3_600_000 })
      ),
    });
  const personal = (row: ApplicationConnection) => ({ ...runtimeFor(row), allowPersonal: true });

  it("creates a file with a multipart upload carrying metadata and text", async () => {
    const { client, calls } = fakeClient(() =>
      respond(200, JSON.stringify({ id: "f1", name: "note.txt", webViewLink: "https://drive/f1" }))
    );
    const outcome = await executeConnectorAction(
      {
        action: "google_drive.file.create",
        connectionId: "conn-1",
        params: { folder: "folder1", name: "note.txt", content: "{{workflow.message}}" },
      },
      context,
      personal(google()),
      { client }
    );
    expect(outcome.outputs).toEqual({ id: "f1", name: "note.txt", web_url: "https://drive/f1" });
    expect(calls[0]!.url).toMatch(/^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?uploadType=multipart/);
    expect(calls[0]!.headers?.["content-type"]).toMatch(/^multipart\/related; boundary=/);
    expect(calls[0]!.body).toContain('{"name":"note.txt","parents":["folder1"]}');
    expect(calls[0]!.body).toContain("My laptop broke");
  });

  it("escapes the whole search value inside the q literal", async () => {
    const { client, calls } = fakeClient(() => respond(200, JSON.stringify({ files: [] })));
    await executeConnectorAction(
      { action: "google_drive.file.find", connectionId: "conn-1", params: { query: "{{workflow.message}}" } },
      { ...context, "workflow.message": "it's ' or 1=1" },
      personal(google()),
      { client }
    );
    expect(new URL(calls[0]!.url).searchParams.get("q")).toBe(
      "trashed = false and name contains 'it\\'s \\' or 1=1' and 'root' in parents"
    );
  });

  it("share link: creates the permission, then reads the view link in a second hop", async () => {
    const { client, calls } = fakeClient((call) =>
      call.method === "POST"
        ? respond(200, JSON.stringify({ id: "perm1" }))
        : respond(200, JSON.stringify({ id: "f1", webViewLink: "https://drive/f1/view" }))
    );
    const outcome = await executeConnectorAction(
      { action: "google_drive.file.share_link", connectionId: "conn-1", params: { file_id: "f1" } },
      context,
      personal(google()),
      { client }
    );
    expect(outcome.outputs).toEqual({ url: "https://drive/f1/view" });
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ role: "reader", type: "anyone" });
  });
});

describe("outcomes and the Db runtime", () => {
  it("reports an unconfigured action without touching the connection", async () => {
    const { client, calls } = fakeClient(() => respond(200, "{}"));
    const outcome = await executeConnectorAction(
      { provider: "slack" },
      context,
      runtimeFor(connection()),
      { client }
    );
    expect(outcome.error).toMatchObject({ provider: "slack", code: "not_configured" });
    expect(calls).toHaveLength(0);
  });

  it("reports a missing connection", async () => {
    const outcome = await executeConnectorAction(
      { action: "slack.channel.list", connectionId: "gone" },
      context,
      runtimeFor(null),
      { client: fakeClient(() => respond(200, "{}")).client }
    );
    expect(outcome.error).toMatchObject({ code: "connection" });
  });

  it("test connection: auth.test for Slack, honest on a dead token", async () => {
    const live = await testConnectorConnection(
      "conn-1",
      runtimeFor(connection()),
      { client: fakeClient(() => respond(200, JSON.stringify({ ok: true }))).client }
    );
    expect(live).toEqual({ ok: true, error: null });
    const dead = await testConnectorConnection(
      "conn-1",
      runtimeFor(connection()),
      { client: fakeClient(() => respond(401, "")).client }
    );
    expect(dead.ok).toBe(false);
    expect(dead.error?.code).toBe("authorization");
  });

  it("the Db runtime scopes reads to the Organization and raises the Alert on reauthorization", async () => {
    const updates: unknown[] = [];
    const alerts: unknown[] = [];
    const row = connection();
    const runtime = dbConnectorRuntime(
      {
        getApplicationConnection: async (id) => (id === row.id ? row : null),
        updateApplicationConnection: async (id, patch) => {
          updates.push({ id, patch });
        },
        raiseAlert: async (organizationId, input) => {
          alerts.push({ organizationId, input });
        },
      },
      "org-1"
    );
    expect(await runtime.getConnection("conn-1")).toBe(row);
    const foreign = dbConnectorRuntime(
      { getApplicationConnection: async () => row, updateApplicationConnection: async () => {}, raiseAlert: async () => {} },
      "org-2"
    );
    expect(await foreign.getConnection("conn-1")).toBeNull();

    // A personal Connection is visible only to the Member who owns it (#840).
    const personalRow = connection({ ownerType: "member", ownerMemberId: "m1" });
    const stub = { getApplicationConnection: async () => personalRow, updateApplicationConnection: async () => {}, raiseAlert: async () => {} };
    expect(await dbConnectorRuntime(stub, "org-1", { memberId: "m1" }).getConnection("conn-1")).toBe(personalRow);
    expect(await dbConnectorRuntime(stub, "org-1", { memberId: "m2" }).getConnection("conn-1")).toBeNull();
    expect(await dbConnectorRuntime(stub, "org-1").getConnection("conn-1")).toBeNull();

    await runtime.markReauthorizationRequired!(row, "token revoked");
    expect(updates[0]).toMatchObject({
      id: "conn-1",
      patch: { status: "reauthorization_required", error: "token revoked" },
    });
    expect(alerts[0]).toMatchObject({
      organizationId: "org-1",
      input: { type: "integration", sourceKey: connectorAlertKey("conn-1") },
    });
  });
});
