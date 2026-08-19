import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addNewsletterContact,
  newsletterAudienceConfigured,
} from "./newsletter-audience";

describe("addNewsletterContact", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_AUDIENCE_ID", "aud_123");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts the confirmed address to the audience as subscribed", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 201 }));

    expect(await addNewsletterContact("dean@example.edu")).toEqual({ added: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/audiences/aud_123/contacts");
    expect(JSON.parse(String(init?.body))).toEqual({
      email: "dean@example.edu",
      unsubscribed: false,
    });
  });

  it("reports not_configured without a network call when the audience is unset", async () => {
    vi.stubEnv("RESEND_AUDIENCE_ID", "");
    const fetchMock = vi.spyOn(globalThis, "fetch");

    expect(newsletterAudienceConfigured()).toBe(false);
    expect(await addNewsletterContact("dean@example.edu")).toEqual({
      added: false,
      reason: "not_configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports failed on a rejected request", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 422 })
    );
    expect(await addNewsletterContact("dean@example.edu")).toEqual({
      added: false,
      reason: "failed",
    });
  });

  it("never throws when the network does", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    expect(await addNewsletterContact("dean@example.edu")).toEqual({
      added: false,
      reason: "failed",
    });
  });
});
