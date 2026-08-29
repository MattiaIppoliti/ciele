import { describe, expect, it } from "vitest";
import { PUBLIC_REPO, RELEASES_API_URL, compareVersions, latestReleaseUrl } from "./version";

describe("compareVersions", () => {
  it("orders releases by each part, not lexically", () => {
    // The bug this exists to avoid: "0.10.0" < "0.9.0" as strings, which
    // would tell every user on 0.10.0 that 0.9.0 is an update.
    expect(compareVersions("v0.10.0", "v0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("v1.0.0", "v0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("v1.2.3", "v1.2.4")).toBeLessThan(0);
  });

  it("does not care whether the v is there", () => {
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.4", "v1.2.3")).toBeGreaterThan(0);
  });

  it("sorts a pre-release before the release it leads to", () => {
    expect(compareVersions("v1.2.3-beta.1", "v1.2.3")).toBeLessThan(0);
    expect(compareVersions("v1.2.3", "v1.2.3-beta.1")).toBeGreaterThan(0);
    expect(compareVersions("v1.2.3-beta.1", "v1.2.3-beta.2")).toBeLessThan(0);
  });

  it("treats anything it cannot read as equal, never as newer", () => {
    // A version this app cannot parse must not become a false "update
    // available" nag that no download would ever clear.
    expect(compareVersions("nightly", "v1.0.0")).toBe(0);
    expect(compareVersions("v1.0.0", "")).toBe(0);
  });
});

describe("release addresses", () => {
  it("points the check and the download link at the same repository", () => {
    expect(RELEASES_API_URL).toContain(PUBLIC_REPO);
    expect(latestReleaseUrl()).toContain(PUBLIC_REPO);
  });
});
