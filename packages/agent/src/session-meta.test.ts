import { describe, expect, it } from "vitest";
import { sessionMetadata } from "./session-meta";

/**
 * Best-effort session context extraction from request headers (Inbox details
 * panel). Covers UA parsing, IP precedence, proxy geo headers, and URL fields.
 */

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

describe("sessionMetadata", () => {
  it("parses OS and browser from the user-agent (Edge beats Chrome)", () => {
    const edge = sessionMetadata(
      new Headers({
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0",
      })
    );
    expect(edge.os).toBe("Windows");
    expect(edge.browser).toBe("Microsoft Edge");

    const chrome = sessionMetadata(new Headers({ "user-agent": CHROME_MAC }));
    expect(chrome.os).toBe("macOS");
    expect(chrome.browser).toBe("Google Chrome");
  });

  it("takes the first x-forwarded-for hop, falling back to x-real-ip", () => {
    expect(
      sessionMetadata(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))
        .ip
    ).toBe("203.0.113.7");
    expect(
      sessionMetadata(new Headers({ "x-real-ip": "198.51.100.2" })).ip
    ).toBe("198.51.100.2");
  });

  it("reads geo from Vercel or Cloudflare headers and URI-decodes the city", () => {
    const vercel = sessionMetadata(
      new Headers({
        "x-vercel-ip-country": "IT",
        "x-vercel-ip-city": "Reggio%20Emilia",
      })
    );
    expect(vercel.location).toBe("IT");
    expect(vercel.city).toBe("Reggio Emilia");

    const cf = sessionMetadata(
      new Headers({ "cf-ipcountry": "FR", "cf-ipcity": "Paris" })
    );
    expect(cf.location).toBe("FR");
    expect(cf.city).toBe("Paris");
  });

  it("prefers referer over origin for the launch URL, and takes the first language", () => {
    const meta = sessionMetadata(
      new Headers({
        referer: "https://campus.edu/course/1",
        origin: "https://campus.edu",
        "accept-language": "it-IT,it;q=0.9,en;q=0.8",
      })
    );
    expect(meta.launchUrl).toBe("https://campus.edu/course/1");
    expect(meta.language).toBe("it-IT");
  });

  // The chat runs in a cross-origin iframe, so `referer` describes the widget,
  // not the page the visitor is on. The embed reports it instead (spec #550).
  it("prefers the embed-reported page URL over the headers", () => {
    const meta = sessionMetadata(
      new Headers({ referer: "https://platform.ciele.app/widget/abc?theme=light" }),
      "https://campus.edu/courses/psychology"
    );
    expect(meta.launchUrl).toBe("https://campus.edu/courses/psychology");
  });

  it("falls back to the headers when the reported page URL is unusable", () => {
    const headers = new Headers({ referer: "https://campus.edu/course/1" });
    expect(sessionMetadata(headers, "   ").launchUrl).toBe(
      "https://campus.edu/course/1"
    );
    expect(sessionMetadata(headers, "not a url").launchUrl).toBe(
      "https://campus.edu/course/1"
    );
    // A non-http scheme must never reach a field the Inbox renders.
    expect(sessionMetadata(headers, "javascript:alert(1)").launchUrl).toBe(
      "https://campus.edu/course/1"
    );
    expect(
      sessionMetadata(headers, `https://campus.edu/${"x".repeat(600)}`).launchUrl
    ).toBe("https://campus.edu/course/1");
  });

  it("leaves everything undefined for an empty header set", () => {
    const meta = sessionMetadata(new Headers());
    expect(meta.os).toBeUndefined();
    expect(meta.browser).toBeUndefined();
    expect(meta.ip).toBeUndefined();
    expect(meta.location).toBeUndefined();
    expect(meta.city).toBeUndefined();
    expect(meta.launchUrl).toBeUndefined();
    expect(meta.language).toBeUndefined();
  });
});
