import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.fn();
const addNewsletterContact = vi.fn();
const headerMap = new Map<string, string>([
  ["host", "platform.ciele.app"],
  ["x-forwarded-proto", "https"],
  ["x-forwarded-for", "203.0.113.7"],
]);

vi.mock("@agent-hub/agent", () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }));
vi.mock("@/lib/marketing/newsletter-audience", () => ({
  addNewsletterContact: (...args: unknown[]) => addNewsletterContact(...args),
}));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (key: string) => headerMap.get(key) ?? null }),
}));

const { subscribeToNewsletterAction, confirmNewsletterAction } = await import("./actions");
const { mintConfirmationToken } = await import("@/lib/marketing/newsletter");

/**
 * The wiring, not the crypto (that is newsletter.test.ts). What matters here is
 * that nothing joins the list from the form alone, and that every failure is
 * reported instead of dressed up as success.
 */
describe("subscribeToNewsletterAction", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "test-signing-secret");
    sendEmail.mockResolvedValue({ delivered: true });
    addNewsletterContact.mockResolvedValue({ added: true });
    headerMap.set("x-forwarded-for", `198.51.100.${Math.floor(Math.random() * 250) + 1}`);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends a confirmation link and subscribes nobody yet", async () => {
    const result = await subscribeToNewsletterAction({ email: "Dean@Example.EDU" });

    expect(result).toEqual({ status: "check_inbox" });
    expect(addNewsletterContact).not.toHaveBeenCalled();
    const [message] = sendEmail.mock.calls[0];
    expect(message.to).toBe("dean@example.edu");
    expect(message.body).toContain(
      "https://platform.ciele.app/newsletter/confirm?token="
    );
  });

  it("swallows a honeypot post without sending anything", async () => {
    const result = await subscribeToNewsletterAction({
      email: "bot@example.com",
      organizationReference: "spam",
    });

    expect(result).toEqual({ status: "check_inbox" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects a bad address before touching the transport", async () => {
    const result = await subscribeToNewsletterAction({ email: "not-an-address" });

    expect(result.status).toBe("invalid");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("reports unavailable when the transport could not deliver", async () => {
    sendEmail.mockResolvedValue({ delivered: false, reason: "not_configured" });

    expect(await subscribeToNewsletterAction({ email: "dean@example.edu" })).toEqual({
      status: "unavailable",
    });
  });

  it("rate-limits a third attempt from the same caller", async () => {
    headerMap.set("x-forwarded-for", "192.0.2.99");
    await subscribeToNewsletterAction({ email: "one@example.edu" });
    await subscribeToNewsletterAction({ email: "two@example.edu" });

    const third = await subscribeToNewsletterAction({ email: "three@example.edu" });
    expect(third.status).toBe("rate_limited");
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });
});

describe("confirmNewsletterAction", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "test-signing-secret");
    addNewsletterContact.mockResolvedValue({ added: true });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("adds the address the token carries", async () => {
    const token = mintConfirmationToken("dean@example.edu");

    expect(await confirmNewsletterAction(token)).toEqual({ status: "subscribed" });
    expect(addNewsletterContact).toHaveBeenCalledWith("dean@example.edu");
  });

  it("calls an expired link expired and a forged one invalid", async () => {
    const stale = mintConfirmationToken("dean@example.edu", {
      now: new Date(Date.now() - 72 * 60 * 60 * 1000),
    });

    expect(await confirmNewsletterAction(stale)).toEqual({ status: "expired" });
    expect(await confirmNewsletterAction("forged.token")).toEqual({ status: "invalid" });
    expect(addNewsletterContact).not.toHaveBeenCalled();
  });

  it("blames itself, not the link, when no signing key is set", async () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "");

    expect(await confirmNewsletterAction("any.token")).toEqual({ status: "unavailable" });
    expect(addNewsletterContact).not.toHaveBeenCalled();
  });

  it("reports unavailable when the audience rejects the contact", async () => {
    addNewsletterContact.mockResolvedValue({ added: false, reason: "failed" });

    expect(
      await confirmNewsletterAction(mintConfirmationToken("dean@example.edu"))
    ).toEqual({ status: "unavailable" });
  });
});
