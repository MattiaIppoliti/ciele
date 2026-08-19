import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailTransportConfigured, sendEmail } from "./email";

/**
 * The email transport tested through its public seam: what it reports and
 * what leaves over the wire (mocked fetch), Resend never called for real.
 */

const MESSAGE = {
  to: "desk@example.com",
  subject: "Wifi down",
  body: "It drops every few minutes.",
  replyTo: "visitor@example.com",
};

describe("sendEmail", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "Ciele <no-reply@ciele.app>");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reports not_configured (and sends nothing) without env config", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(emailTransportConfigured()).toBe(false);
    expect(await sendEmail(MESSAGE)).toEqual({
      delivered: false,
      reason: "not_configured",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("delivers via the Resend API with from/to/reply_to composed", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    expect(emailTransportConfigured()).toBe(true);
    expect(await sendEmail(MESSAGE)).toEqual({ delivered: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_test_key");
    const payload = JSON.parse(String(init?.body));
    expect(payload).toMatchObject({
      from: "Ciele <no-reply@ciele.app>",
      to: ["desk@example.com"],
      subject: "Wifi down",
      text: "It drops every few minutes.",
      reply_to: "visitor@example.com",
    });
  });

  it("splits comma-separated recipients", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    await sendEmail({ ...MESSAGE, to: "a@example.com, b@example.com" });
    const payload = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(payload.to).toEqual(["a@example.com", "b@example.com"]);
  });

  it("reports send_failed on a provider error response, never throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 422 })
    );
    expect(await sendEmail(MESSAGE)).toEqual({
      delivered: false,
      reason: "send_failed",
    });
  });

  it("reports send_failed on a network error, never throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));
    expect(await sendEmail(MESSAGE)).toEqual({
      delivered: false,
      reason: "send_failed",
    });
  });
});

describe("the optional HTML part", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "Ciele <no-reply@ciele.app>");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends html alongside text when a caller supplies it", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    await sendEmail({ ...MESSAGE, html: "<p>It drops every few minutes.</p>" });

    const payload = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(payload.text).toBe(MESSAGE.body);
    expect(payload.html).toBe("<p>It drops every few minutes.</p>");
  });

  it("omits the key entirely for the text-only messages, rather than sending an empty part", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    await sendEmail(MESSAGE);

    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).not.toHaveProperty("html");
  });
});
