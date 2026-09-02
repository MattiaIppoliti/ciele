import { describe, expect, it } from "vitest";
import { mailLinkOrigin } from "./origins";

const headersWith = (host: string | null) => ({
  get: (key: string) => (key.toLowerCase() === "host" ? host : null),
});

/**
 * #801, CYB-10. A confirmation email carries a signed token in its URL, so the
 * origin in that URL is a security decision. These cases pin the two halves:
 * configuration wins, and an unrecognised host produces no link at all rather
 * than a link to wherever the header said.
 */
describe("mailLinkOrigin", () => {
  it("uses the configured public origin whatever the host claims", () => {
    expect(
      mailLinkOrigin(headersWith("attacker.example"), {
        CIELE_PUBLIC_ORIGIN: "https://ciele.app",
      }),
    ).toBe("https://ciele.app");
  });

  it("accepts NEXT_PUBLIC_APP_URL as the same answer", () => {
    expect(
      mailLinkOrigin(headersWith("attacker.example"), {
        NEXT_PUBLIC_APP_URL: "https://ciele.app/",
      }),
    ).toBe("https://ciele.app");
  });

  it("allows a host the deployment already claims, always over https", () => {
    expect(mailLinkOrigin(headersWith("ciele.app"), {})).toBe("https://ciele.app");
    expect(mailLinkOrigin(headersWith("WWW.Ciele.App"), {})).toBe(
      "https://www.ciele.app",
    );
  });

  it("allows loopback so development still mails a working link", () => {
    expect(mailLinkOrigin(headersWith("localhost:3000"), {})).toBe(
      "http://localhost:3000",
    );
    expect(mailLinkOrigin(headersWith("127.0.0.1"), {})).toBe("http://127.0.0.1");
    // A bracketed IPv6 literal does not split on ":" the way a name does.
    expect(mailLinkOrigin(headersWith("[::1]:3000"), {})).toBe("http://[::1]:3000");
  });

  it("refuses an unrecognised or absent host", () => {
    expect(mailLinkOrigin(headersWith("attacker.example"), {})).toBeNull();
    expect(mailLinkOrigin(headersWith("ciele.app.attacker.example"), {})).toBeNull();
    expect(mailLinkOrigin(headersWith(null), {})).toBeNull();
  });

  it("refuses a configured origin that is not http(s), rather than mailing it", () => {
    expect(
      mailLinkOrigin(headersWith("attacker.example"), {
        CIELE_PUBLIC_ORIGIN: "javascript:alert(1)",
      }),
    ).toBeNull();
  });
});
