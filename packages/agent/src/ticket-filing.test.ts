import { describe, expect, it } from "vitest";
import type { ApplicationConnection } from "@agent-hub/core";
import { sealSecret } from "@agent-hub/core";
import type { ApplicationHttpClient, ApplicationHttpResponse } from "./application-provider-http";
import type { ConnectorRuntime } from "./connector-request";
import { fileTicket } from "./ticket-filing";

/**
 * Ticket channel filing (#1088, #1089) over a fake HTTP client: the request
 * each provider receives, the record read back, and the refusals. No network.
 */

process.env.APP_ENCRYPTION_KEY ??= "connector-test-key";

interface Call {
  url: string;
  method: string | undefined;
  body: string | undefined;
}

function respond(status: number, text: string): ApplicationHttpResponse {
  return { status, ok: status >= 200 && status < 300, headers: new Headers(), text };
}

function fakeClient(handler: (call: Call) => ApplicationHttpResponse) {
  const calls: Call[] = [];
  const client: ApplicationHttpClient = async (url, options) => {
    const call = { url, method: options.method, body: options.body as string | undefined };
    calls.push(call);
    return handler(call);
  };
  return { client, calls };
}

function connection(over: Partial<ApplicationConnection>): ApplicationConnection {
  return {
    id: "conn-1",
    organizationId: "org-1",
    ownerType: "organization",
    ownerMemberId: null,
    provider: "salesforce",
    name: "Service org",
    status: "connected",
    sealedCredentials: sealSecret(
      JSON.stringify({
        accessToken: "token",
        instanceUrl: "https://acme.my.salesforce.com",
        baseUrl: "https://acme.service-now.com",
        expiresAt: Date.now() + 3_600_000,
      })
    ),
    scopes: [],
    metadata: {},
    error: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    ...over,
  } as ApplicationConnection;
}

const runtimeFor = (row: ApplicationConnection): ConnectorRuntime => ({
  getConnection: async (id) => (row.id === id ? row : null),
  allowPersonal: true,
});

const draft = {
  subject: "Hello {{user.name}}",
  description: 'It says "no"',
  requesterEmail: "ada@example.org",
  requesterName: "",
};

describe("fileTicket", () => {
  it("opens a Salesforce Case with the Visitor's words taken literally", async () => {
    const { client, calls } = fakeClient((call) =>
      call.method === "GET"
        ? respond(200, JSON.stringify({ Id: "500Ws00000AbCdEIAV", CaseNumber: "00001026" }))
        : respond(201, JSON.stringify({ id: "500Ws00000AbCdEIAV", success: true }))
    );
    const outcome = await fileTicket(
      { provider: "salesforce", connectionId: "conn-1" },
      draft,
      runtimeFor(connection({})),
      { client }
    );
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      Subject: "Hello {{user.name}}",
      Description: 'It says "no"',
      Origin: "Web",
      SuppliedEmail: "ada@example.org",
    });
    expect(outcome).toEqual({
      ok: true,
      ticket: {
        provider: "salesforce",
        id: "500Ws00000AbCdEIAV",
        number: "00001026",
        url: "https://acme.my.salesforce.com/lightning/r/Case/500Ws00000AbCdEIAV/view",
      },
    });
  });

  it("files a ServiceNow record into the target table, with a link back", async () => {
    const { client, calls } = fakeClient(() =>
      respond(201, JSON.stringify({ result: { sys_id: "abc123", number: "INC0010001" } }))
    );
    const outcome = await fileTicket(
      { provider: "servicenow", connectionId: "conn-1", table: "incident", requesterEmailField: "u_requester_email" },
      draft,
      runtimeFor(connection({ provider: "servicenow" })),
      { client }
    );
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://acme.service-now.com/api/now/table/incident",
    });
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      short_description: "Hello {{user.name}}",
      description: 'It says "no"',
      u_requester_email: "ada@example.org",
    });
    expect(outcome).toEqual({
      ok: true,
      ticket: {
        provider: "servicenow",
        id: "abc123",
        number: "INC0010001",
        url: "https://acme.service-now.com/nav_to.do?uri=incident.do%3Fsys_id%3Dabc123",
      },
    });
  });

  it("returns the provider's own error when the record is refused", async () => {
    const { client } = fakeClient(() =>
      respond(
        403,
        JSON.stringify([{ errorCode: "INSUFFICIENT_ACCESS_OR_READONLY", message: "insufficient access rights" }])
      )
    );
    const outcome = await fileTicket(
      { provider: "salesforce", connectionId: "conn-1" },
      draft,
      runtimeFor(connection({})),
      { client }
    );
    expect(outcome).toMatchObject({
      ok: false,
      error: {
        code: "provider",
        message: "INSUFFICIENT_ACCESS_OR_READONLY: insufficient access rights",
      },
    });
  });

  it("refuses a Member-owned Connection before any call, whatever the runtime allows", async () => {
    const { client, calls } = fakeClient(() => respond(201, "{}"));
    const outcome = await fileTicket(
      { provider: "salesforce", connectionId: "conn-1" },
      draft,
      runtimeFor(connection({ ownerType: "member", ownerMemberId: "m1" })),
      { client }
    );
    expect(outcome.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
