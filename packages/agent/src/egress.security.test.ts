import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("./pinned-fetch", () => ({
  pinnedRequest: vi.fn(),
  fetchPinnedPage: vi.fn(),
}));

import { lookup } from "node:dns/promises";
import { pinnedRequest, type PinnedFetchResponse } from "./pinned-fetch";
import {
  EgressPolicyError,
  egressFetch,
  validateEgressTarget,
} from "./egress";

/**
 * Table-driven coverage of the shared egress guard (SSRF policy,
 * docs/audits/api-request-egress-policy.md). Style precedent:
 * ingest.security.test.ts.
 */

const lookupMock = vi.mocked(lookup);
const requestMock = vi.mocked(pinnedRequest);

const PUBLIC_ADDRESS = { address: "93.184.216.34", family: 4 };

function pinnedResponse(
  status: number,
  headers: Record<string, string> = {},
  text = ""
): PinnedFetchResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    text,
  };
}

async function policyCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "none";
  } catch (error) {
    if (error instanceof EgressPolicyError) return error.code;
    throw error;
  }
}

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([PUBLIC_ADDRESS] as never);
  requestMock.mockReset();
});

describe("validateEgressTarget", () => {
  it.each([
    "file:///etc/passwd",
    "ftp://example.com/pub",
    "data:text/html,hi",
    "ws://example.com/socket",
    "gopher://example.com/",
  ])("rejects non-HTTP(S) scheme %s", async (url) => {
    expect(await policyCode(validateEgressTarget(url))).toBe("scheme");
  });

  it("rejects http when allowHttp is false, keeps https", async () => {
    expect(
      await policyCode(
        validateEgressTarget("http://example.com/", { allowHttp: false })
      )
    ).toBe("scheme");
    await expect(
      validateEgressTarget("https://example.com/", { allowHttp: false })
    ).resolves.toMatchObject({ addresses: [PUBLIC_ADDRESS.address] });
  });

  it("rejects embedded credentials", async () => {
    expect(
      await policyCode(validateEgressTarget("https://admin:secret@example.com/"))
    ).toBe("credentials");
  });

  it.each([
    "http://localhost/admin",
    "http://sub.localhost/admin",
    "http://LOCALHOST./admin",
    "http://metadata.google.internal/computeMetadata",
    "http://service.internal/health",
    "http://printer.local/status",
  ])("rejects blocked hostname %s without touching DNS", async (url) => {
    expect(await policyCode(validateEgressTarget(url))).toBe("blocked_host");
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it.each([
    "http://0.0.0.0/",
    "http://10.1.2.3/",
    "http://100.64.0.1/",
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://172.16.0.1/",
    "http://192.168.1.10/",
    "http://198.18.0.1/",
    "http://224.0.0.1/",
    "http://255.255.255.255/",
    "http://[::]/",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[fe80::1]/",
    "http://[ff02::1]/",
    "http://[::ffff:10.0.0.1]/",
    "http://[::ffff:169.254.169.254]/",
  ])("rejects blocked IP literal %s", async (url) => {
    expect(await policyCode(validateEgressTarget(url))).toBe("blocked_address");
  });

  it.each(["http://2130706433/", "http://0x7f000001/", "http://017700000001/"])(
    "catches the non-dotted IPv4 literal %s",
    async (url) => {
      // WHATWG URL parsing normalizes decimal/hex/octal IPv4 forms to the
      // dotted quad (here 127.0.0.1), so these are blocked as IP literals; a
      // form the parser left alone would still be caught at resolution time,
      // since every resolved address is checked.
      expect(await policyCode(validateEgressTarget(url))).toBe(
        "blocked_address"
      );
    }
  );

  it("rejects a hostname that resolves to a private address", async () => {
    lookupMock.mockResolvedValueOnce([
      { address: "10.0.0.5", family: 4 },
    ] as never);
    expect(
      await policyCode(validateEgressTarget("https://internal.example/"))
    ).toBe("blocked_address");
  });

  it("rejects when any one resolved record is private (rebinding primitive)", async () => {
    lookupMock.mockResolvedValueOnce([
      PUBLIC_ADDRESS,
      { address: "192.168.1.10", family: 4 },
    ] as never);
    expect(
      await policyCode(validateEgressTarget("https://rebind.example/"))
    ).toBe("blocked_address");
  });

  it("maps empty and failed resolution to resolution_failed", async () => {
    lookupMock.mockResolvedValueOnce([] as never);
    expect(
      await policyCode(validateEgressTarget("https://ghost.example/"))
    ).toBe("resolution_failed");
    lookupMock.mockRejectedValueOnce(
      Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" })
    );
    expect(
      await policyCode(validateEgressTarget("https://missing.example/"))
    ).toBe("resolution_failed");
  });

  it("returns the URL and every resolved address for pinning", async () => {
    lookupMock.mockResolvedValueOnce([
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      PUBLIC_ADDRESS,
    ] as never);
    const target = await validateEgressTarget("https://public.example/docs");
    expect(target.url.href).toBe("https://public.example/docs");
    expect(target.addresses).toEqual([
      "2606:2800:220:1:248:1893:25c8:1946",
      PUBLIC_ADDRESS.address,
    ]);
  });

  it("allowLoopback admits loopback only, other private ranges stay blocked", async () => {
    await expect(
      validateEgressTarget("http://127.0.0.1:3000/test", { allowLoopback: true })
    ).resolves.toMatchObject({ addresses: ["127.0.0.1"] });
    await expect(
      validateEgressTarget("http://[::1]:3000/test", { allowLoopback: true })
    ).resolves.toMatchObject({ addresses: ["::1"] });
    lookupMock.mockResolvedValueOnce([
      { address: "127.0.0.1", family: 4 },
    ] as never);
    await expect(
      validateEgressTarget("http://localhost:3000/test", { allowLoopback: true })
    ).resolves.toBeDefined();
    expect(
      await policyCode(
        validateEgressTarget("http://10.0.0.5/", { allowLoopback: true })
      )
    ).toBe("blocked_address");
    expect(
      await policyCode(
        validateEgressTarget("http://metadata.google.internal/", {
          allowLoopback: true,
        })
      )
    ).toBe("blocked_host");
  });
});

describe("egressFetch", () => {
  const OPTIONS = { timeoutMs: 10_000, maxResponseBytes: 1024 * 1024 };

  it("passes method, headers, body and limits through to the pinned request", async () => {
    requestMock.mockResolvedValueOnce(pinnedResponse(200, {}, "ok"));
    const result = await egressFetch("https://api.example/things", {
      ...OPTIONS,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"a":1}',
    });
    expect(result.response.text).toBe("ok");
    expect(result.finalUrl).toBe("https://api.example/things");
    expect(requestMock).toHaveBeenCalledOnce();
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ addresses: [PUBLIC_ADDRESS.address] }),
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"a":1}',
        timeoutMs: 10_000,
        maxResponseBytes: 1024 * 1024,
      })
    );
  });

  it("fails any 3xx when redirects are disabled (the default)", async () => {
    requestMock.mockResolvedValueOnce(
      pinnedResponse(302, { location: "https://elsewhere.example/" })
    );
    expect(
      await policyCode(egressFetch("https://api.example/things", OPTIONS))
    ).toBe("redirect");
    expect(requestMock).toHaveBeenCalledOnce();
  });

  it("re-validates a redirect Location and refuses a private hop", async () => {
    requestMock.mockResolvedValueOnce(
      pinnedResponse(302, { location: "http://169.254.169.254/latest/meta-data" })
    );
    expect(
      await policyCode(
        egressFetch("https://public.example/start", {
          ...OPTIONS,
          maxRedirects: 3,
        })
      )
    ).toBe("blocked_address");
    expect(requestMock).toHaveBeenCalledOnce();
  });

  it("re-resolves a redirect hop's hostname and refuses a private record", async () => {
    lookupMock.mockImplementation((async (hostname: string) =>
      hostname === "internal.example"
        ? [{ address: "10.0.0.5", family: 4 }]
        : [PUBLIC_ADDRESS]) as never);
    requestMock.mockResolvedValueOnce(
      pinnedResponse(302, { location: "https://internal.example/admin" })
    );
    expect(
      await policyCode(
        egressFetch("https://public.example/start", {
          ...OPTIONS,
          maxRedirects: 3,
        })
      )
    ).toBe("blocked_address");
    expect(requestMock).toHaveBeenCalledOnce();
  });

  it("follows validated redirects up to the cap and reports the final URL", async () => {
    requestMock
      .mockResolvedValueOnce(pinnedResponse(301, { location: "/moved" }))
      .mockResolvedValueOnce(
        pinnedResponse(302, { location: "https://cdn.example/asset" })
      )
      .mockResolvedValueOnce(pinnedResponse(200, {}, "found it"));
    const result = await egressFetch("https://public.example/start", {
      ...OPTIONS,
      maxRedirects: 3,
    });
    expect(result.response.text).toBe("found it");
    expect(result.finalUrl).toBe("https://cdn.example/asset");
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it("fails once the redirect cap is exhausted", async () => {
    requestMock.mockResolvedValue(
      pinnedResponse(302, { location: "https://public.example/loop" })
    );
    expect(
      await policyCode(
        egressFetch("https://public.example/start", {
          ...OPTIONS,
          maxRedirects: 2,
        })
      )
    ).toBe("redirect");
    expect(requestMock).toHaveBeenCalledTimes(3); // initial + 2 hops
  });

  it("fails a 3xx without a Location header", async () => {
    requestMock.mockResolvedValueOnce(pinnedResponse(304));
    expect(
      await policyCode(
        egressFetch("https://public.example/start", {
          ...OPTIONS,
          maxRedirects: 3,
        })
      )
    ).toBe("redirect");
  });
});
