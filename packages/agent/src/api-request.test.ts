import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./egress", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./egress")>()),
  egressFetch: vi.fn(),
}));

import { egressFetch, EgressPolicyError } from "./egress";
import { testApiRequest } from "./api-request";

const egressFetchMock = vi.mocked(egressFetch);

function ok(text: string, status = 200) {
  return {
    response: { status, ok: status >= 200 && status < 300, headers: new Headers(), text },
    finalUrl: "https://api.example.com/",
  };
}

describe("testApiRequest", () => {
  beforeEach(() => {
    egressFetchMock.mockReset();
    egressFetchMock.mockResolvedValue(ok("{}") as never);
  });

  it("runs with distinguishable sample values for template variables", async () => {
    await testApiRequest({
      method: "GET",
      url: "https://api.example.com/users/{{user.id}}",
    });
    // Sample values are wrapped in guillemets so they can't be mistaken for real data.
    expect(egressFetchMock.mock.calls[0][0]).toBe(
      `https://api.example.com/users/${encodeURIComponent("«user.id»")}`
    );
  });

  it("returns status, a bounded excerpt and extracted values on success", async () => {
    egressFetchMock.mockResolvedValueOnce(ok('{"data":{"id":"42"}}') as never);
    const result = await testApiRequest({
      method: "POST",
      url: "https://api.example.com/",
      jsonPaths: [{ id: "j1", path: "$.data.id", variable: "id" }],
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.excerpt).toBe('{"data":{"id":"42"}}');
    expect(result.extracted).toEqual([{ variable: "id", value: "42", missed: false }]);
    expect(result.error).toBeNull();
  });

  it("never returns the auth secret in the result", async () => {
    egressFetchMock.mockResolvedValueOnce(ok("{}") as never);
    const result = await testApiRequest({
      method: "POST",
      url: "https://api.example.com/",
      auth: { type: "bearer", token: "s3cret-token" },
    });
    expect(JSON.stringify(result)).not.toContain("s3cret-token");
    // ...but the secret was composed into the outbound request.
    expect(egressFetchMock.mock.calls[0][1].headers?.authorization).toBe(
      "Bearer s3cret-token"
    );
  });

  it("maps a policy block to a human message + code, never a resolved IP", async () => {
    egressFetchMock.mockRejectedValueOnce(
      new EgressPolicyError("Private or loopback endpoints are not allowed", "blocked_address")
    );
    const result = await testApiRequest({
      method: "GET",
      url: "https://169.254.169.254/",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("blocked_address");
    expect(result.error?.message).toMatch(/private address/i);
    expect(JSON.stringify(result)).not.toMatch(/169\.254/);
  });

  it("rejects a template variable in the URL host", async () => {
    const result = await testApiRequest({
      method: "GET",
      url: "https://{{user.id}}/path",
    });
    expect(egressFetchMock).not.toHaveBeenCalled();
    expect(result.error?.code).toBe("template_in_origin");
  });
});
