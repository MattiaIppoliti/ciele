import { describe, expect, it } from "vitest";
import type { FlowActionSettings } from "./types";
import { mergeFlowSecrets, redactFlowSecrets } from "./flow-secrets";

/**
 * A Flow's `api_request` credentials sit in plain jsonb, and every read surface
 * serves that blob: `/api/v1` at `capability: "member"`, the MCP `list`/`get`
 * read actions, and the Flow Builder's RSC payload. So a Viewer-role member, a
 * Viewer-role API key and a read-only MCP agent were all receiving the org's
 * real outbound tokens. A failure here is a credential-disclosure regression.
 */
const settings = (over: Partial<NonNullable<FlowActionSettings["api_request"]>> = {}) =>
  ({
    api_request: {
      method: "POST" as const,
      url: "https://api.example.com/tickets",
      auth: { type: "bearer" as const, token: "sk-live-abc123" },
      headers: [{ id: "h1", name: "X-Tenant", value: "acme-secret" }],
      queryParams: [{ id: "q1", name: "key", value: "qs-secret" }],
      ...over,
    },
  }) satisfies FlowActionSettings;

describe("redactFlowSecrets", () => {
  it("drops a bearer token and reports that one is stored", () => {
    const out = redactFlowSecrets({ actionSettings: settings() });
    expect(out.actionSettings.api_request.auth).toEqual({
      type: "bearer",
      hasToken: true,
    });
    expect(JSON.stringify(out)).not.toContain("sk-live-abc123");
  });

  it("drops an api-key value but keeps the header name", () => {
    const out = redactFlowSecrets({
      actionSettings: settings({
        auth: { type: "api_key", header: "X-API-Key", key: "k-secret" },
      }),
    });
    expect(out.actionSettings.api_request.auth).toEqual({
      type: "api_key",
      header: "X-API-Key",
      hasKey: true,
    });
    expect(JSON.stringify(out)).not.toContain("k-secret");
  });

  it("drops a basic password but keeps the username", () => {
    const out = redactFlowSecrets({
      actionSettings: settings({
        auth: { type: "basic", username: "svc", password: "p-secret" },
      }),
    });
    expect(out.actionSettings.api_request.auth).toEqual({
      type: "basic",
      username: "svc",
      hasPassword: true,
    });
    expect(JSON.stringify(out)).not.toContain("p-secret");
  });

  it("blanks header and query-param values, which is where a credential also hides", () => {
    const out = redactFlowSecrets({ actionSettings: settings() });
    expect(out.actionSettings.api_request.headers).toEqual([
      { id: "h1", name: "X-Tenant", value: "" },
    ]);
    expect(out.actionSettings.api_request.queryParams).toEqual([
      { id: "q1", name: "key", value: "" },
    ]);
  });

  it("says so when no secret is stored, so an editor can tell the difference", () => {
    const out = redactFlowSecrets({
      actionSettings: settings({ auth: { type: "bearer" } }),
    });
    expect(out.actionSettings.api_request.auth).toEqual({
      type: "bearer",
      hasToken: false,
    });
  });

  it("leaves a flow with no api_request action alone", () => {
    const flow = {
      actionSettings: { custom_message: { message: "hi" } } as FlowActionSettings,
    };
    expect(redactFlowSecrets(flow)).toBe(flow);
  });
});

describe("mergeFlowSecrets", () => {
  it("restores a token the caller was never given", () => {
    const incoming = settings({ auth: { type: "bearer", hasToken: true } });
    const merged = mergeFlowSecrets(incoming, settings());
    expect(merged?.api_request?.auth).toMatchObject({ token: "sk-live-abc123" });
  });

  it("lets a caller replace a token", () => {
    const incoming = settings({ auth: { type: "bearer", token: "sk-new" } });
    const merged = mergeFlowSecrets(incoming, settings());
    expect(merged?.api_request?.auth).toMatchObject({ token: "sk-new" });
  });

  it("does not carry a secret across a change of auth type", () => {
    const incoming = settings({ auth: { type: "basic", username: "svc" } });
    const merged = mergeFlowSecrets(incoming, settings());
    expect(JSON.stringify(merged)).not.toContain("sk-live-abc123");
  });

  it("restores a blanked header value only for a name that still matches", () => {
    const incoming = settings({
      headers: [
        { id: "h1", name: "X-Tenant", value: "" },
        { id: "h2", name: "X-New", value: "" },
      ],
    });
    const merged = mergeFlowSecrets(incoming, settings());
    expect(merged?.api_request?.headers).toEqual([
      { id: "h1", name: "X-Tenant", value: "acme-secret" },
      { id: "h2", name: "X-New", value: "" },
    ]);
  });

  it("round-trips: redact then merge restores exactly what was stored", () => {
    const stored = settings();
    const shown = redactFlowSecrets({ actionSettings: stored }).actionSettings;
    expect(mergeFlowSecrets(shown, stored)).toMatchObject({
      api_request: {
        auth: { type: "bearer", token: "sk-live-abc123" },
        headers: [{ id: "h1", name: "X-Tenant", value: "acme-secret" }],
        queryParams: [{ id: "q1", name: "key", value: "qs-secret" }],
      },
    });
  });
});
