import { afterEach, describe, expect, it } from "vitest";

import {
  checkWidgetTurnAllowance,
  resetWidgetTurnAllowance,
  widgetThrottledResponse,
} from "./widget-rate-limit";

const NOW = 1_700_000_000_000;

function headersFrom(address: string) {
  return new Headers({ "x-forwarded-for": `${address}, 10.0.0.1` });
}

function send(
  times: number,
  input: { kind?: "chat" | "trigger"; subjectId: string; address?: string; assistantId?: string }
) {
  let last = { allowed: true, retryAfterMs: 0 };
  for (let i = 0; i < times; i++) {
    last = checkWidgetTurnAllowance({
      kind: input.kind ?? "chat",
      assistantId: input.assistantId ?? "a1",
      subjectId: input.subjectId,
      headers: headersFrom(input.address ?? "203.0.113.7"),
      now: NOW,
    });
  }
  return last;
}

afterEach(() => resetWidgetTurnAllowance());

describe("checkWidgetTurnAllowance", () => {
  it("lets a Visitor send twelve messages a minute and refuses the thirteenth", () => {
    expect(send(12, { subjectId: "v1" }).allowed).toBe(true);
    const refused = send(1, { subjectId: "v1" });
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterMs).toBe(60_000);
  });

  it("keeps Visitors, assistants and the two routes on separate budgets", () => {
    send(12, { subjectId: "v1" });
    expect(send(1, { subjectId: "v2" }).allowed).toBe(true);
    expect(send(1, { subjectId: "v1", assistantId: "a2" }).allowed).toBe(true);
    expect(send(1, { subjectId: "v1", kind: "trigger" }).allowed).toBe(true);
  });

  it("gives proactive triggers a looser budget than messages", () => {
    expect(send(30, { subjectId: "v1", kind: "trigger" }).allowed).toBe(true);
    expect(send(1, { subjectId: "v1", kind: "trigger" }).allowed).toBe(false);
  });

  it("caps one address across renamed visitor ids, generously for shared NATs", () => {
    for (let i = 0; i < 300; i++) {
      expect(send(1, { subjectId: `rotating-${i}` }).allowed).toBe(true);
    }
    expect(send(1, { subjectId: "rotating-final" }).allowed).toBe(false);
    expect(send(1, { subjectId: "elsewhere", address: "198.51.100.4" }).allowed).toBe(true);
  });

  it("does not spend the shared address budget on a Visitor already over theirs", () => {
    send(12, { subjectId: "noisy" });
    for (let i = 0; i < 50; i++) send(1, { subjectId: "noisy" });
    // 12 counted against the address, not 62: 288 neighbours still fit.
    for (let i = 0; i < 288; i++) {
      expect(send(1, { subjectId: `neighbour-${i}` }).allowed).toBe(true);
    }
  });
});

describe("widgetThrottledResponse", () => {
  it("answers 429 with the wait in the body and in Retry-After, keeping CORS", async () => {
    const response = widgetThrottledResponse(
      { allowed: false, retryAfterMs: 4_200 },
      { "Access-Control-Allow-Origin": "https://example.edu" }
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://example.edu");
    await expect(response.json()).resolves.toEqual({
      error: "rate_limited",
      retryAfterMs: 4_200,
    });
  });
});
