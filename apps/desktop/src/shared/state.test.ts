import { describe, expect, it } from "vitest";
import {
  DEFAULT_SAAS_BASE_URL,
  DEFAULT_SETTINGS,
  LOCAL_BASE_URL,
  normalizeBaseUrl,
  originForMode,
  parseSettings,
} from "./state";

describe("normalizeBaseUrl", () => {
  it("assumes https for a bare host, because that is what people type", () => {
    expect(normalizeBaseUrl("ciele.example.edu")).toBe("https://ciele.example.edu");
  });

  it("keeps an explicit scheme, including http for a server on a LAN", () => {
    expect(normalizeBaseUrl("http://10.0.0.5:3000")).toBe("http://10.0.0.5:3000");
  });

  it("drops path, query and fragment — a base URL is an origin", () => {
    expect(normalizeBaseUrl("https://ciele.example.edu/assistants?x=1#y")).toBe(
      "https://ciele.example.edu",
    );
  });

  it("refuses a scheme that would hand the product window the filesystem", () => {
    expect(normalizeBaseUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeBaseUrl("javascript:alert(1)")).toBeNull();
  });

  it("refuses what is not a URL at all", () => {
    expect(normalizeBaseUrl("")).toBeNull();
    expect(normalizeBaseUrl("   ")).toBeNull();
    expect(normalizeBaseUrl("https://")).toBeNull();
    expect(normalizeBaseUrl(42)).toBeNull();
  });
});

describe("parseSettings", () => {
  it("returns the defaults for anything unusable, so the app still opens", () => {
    for (const raw of [null, undefined, "corrupt", 7, []]) {
      expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("keeps the fields it can read and defaults the rest", () => {
    expect(
      parseSettings({ mode: "local", setupComplete: true, saasBaseUrl: "nonsense://x" }),
    ).toEqual({
      mode: "local",
      saasBaseUrl: DEFAULT_SAAS_BASE_URL,
      setupComplete: true,
      dismissedUpdate: null,
    });
  });

  it("treats an unknown mode as no choice made — back to the welcome screen", () => {
    expect(parseSettings({ mode: "kiosk" }).mode).toBeNull();
  });

  it("normalises a stored base URL rather than trusting the file", () => {
    expect(parseSettings({ saasBaseUrl: "ciele.example.edu/x" }).saasBaseUrl).toBe(
      "https://ciele.example.edu",
    );
  });
});

describe("originForMode", () => {
  it("follows the configured base URL in SaaS mode", () => {
    const settings = { ...DEFAULT_SETTINGS, saasBaseUrl: "https://ciele.example.edu" };
    expect(originForMode("saas", settings)).toBe("https://ciele.example.edu");
  });

  it("always uses the local stack's own origin in local mode", () => {
    const settings = { ...DEFAULT_SETTINGS, saasBaseUrl: "https://ciele.example.edu" };
    expect(originForMode("local", settings)).toBe(LOCAL_BASE_URL);
  });
});
