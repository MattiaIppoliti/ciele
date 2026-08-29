import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InvalidRelayPairingCodeError } from "@/lib/local-relay-pairing-code";

const mocks = vi.hoisted(() => ({
  exchangeRelayPairing: vi.fn(),
}));

vi.mock("@/lib/local-inference-relay", () => ({
  exchangeRelayPairing: mocks.exchangeRelayPairing,
}));

import { POST } from "./route";

describe("POST /api/local-connector/relay/exchange", () => {
  beforeEach(() => {
    mocks.exchangeRelayPairing.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exchanges a valid one-time pairing code", async () => {
    mocks.exchangeRelayPairing.mockResolvedValueOnce({
      token: "device-token",
      deviceId: "device-1",
    });

    const response = await exchangeRequest({
      code: "a".repeat(43),
      origin: "https://ciele.example.com",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      token: "device-token",
      deviceId: "device-1",
    });
  });

  it.each(["short", `${"a".repeat(42)}!`, "a".repeat(44)])(
    "rejects malformed pairing code %s before querying storage",
    async (code) => {
      const response = await exchangeRequest({
        code,
        origin: "https://ciele.example.com",
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_pairing" });
      expect(mocks.exchangeRelayPairing).not.toHaveBeenCalled();
    }
  );

  it("rejects an oversized request before parsing it", async () => {
    const response = await POST(
      new NextRequest(
        "https://ciele.example.com/api/local-connector/relay/exchange",
        {
          method: "POST",
          body: JSON.stringify({ padding: "x".repeat(2_048) }),
        }
      )
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "invalid_pairing" });
    expect(mocks.exchangeRelayPairing).not.toHaveBeenCalled();
  });

  it("stops reading a chunked request once it exceeds the body limit", async () => {
    let chunksRead = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksRead += 1;
        controller.enqueue(new TextEncoder().encode("x".repeat(600)));
        if (chunksRead === 3) controller.close();
      },
    });
    const request = new NextRequest(
      "https://ciele.example.com/api/local-connector/relay/exchange",
      { method: "POST", body }
    );

    expect(request.headers.has("content-length")).toBe(false);
    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(chunksRead).toBe(2);
    expect(mocks.exchangeRelayPairing).not.toHaveBeenCalled();
  });

  it("rejects a code submitted for a different origin", async () => {
    const response = await exchangeRequest({
      code: "a".repeat(43),
      origin: "https://other.example.com",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_pairing" });
    expect(mocks.exchangeRelayPairing).not.toHaveBeenCalled();
  });

  it("keeps structured storage errors out of the public response", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.exchangeRelayPairing.mockRejectedValueOnce({
      code: "42P01",
      message: "Could not create the connector device.",
    });

    const code = "a".repeat(43);
    const response = await exchangeRequest({
      code,
      origin: "https://ciele.example.com",
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "pairing_failed" });
    const logged = String(errorLog.mock.calls[0]?.[0]);
    expect(logged).toContain("Local connector relay exchange failed");
    expect(logged).toContain("42P01");
    expect(logged).not.toContain(code);
    expect(logged).not.toContain("Could not create the connector device.");
  });

  it("returns a stable response for an invalid or replayed signed code", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.exchangeRelayPairing.mockRejectedValueOnce(
      new InvalidRelayPairingCodeError()
    );

    const response = await exchangeRequest({
      code: "a".repeat(43),
      origin: "https://ciele.example.com",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "invalid_or_expired_pairing",
    });
    expect(errorLog).not.toHaveBeenCalled();
  });
});

function exchangeRequest(body: { code: string; origin: string }) {
  return POST(
    new NextRequest(
      "https://ciele.example.com/api/local-connector/relay/exchange",
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    )
  );
}
