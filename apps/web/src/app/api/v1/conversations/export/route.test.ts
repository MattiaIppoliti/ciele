import { describe, expect, it } from "vitest";

import { POST } from "./route";

describe("POST /api/v1/conversations/export", () => {
  it.each([
    {},
    { conversationIds: [] },
    { conversationIds: Array.from({ length: 501 }, (_, index) => `c-${index}`) },
  ])("rejects an invalid conversation selection before authorization", async (body) => {
    const response = await POST(
      new Request("http://localhost/api/v1/conversations/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_input" },
    });
  });
});
