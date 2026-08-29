import { describe, expect, it } from "vitest";
import { composePathSeparator, dockerDownloadUrl } from "./platform";

describe("composePathSeparator", () => {
  it("is a semicolon on Windows, where a colon is a drive letter", () => {
    expect(composePathSeparator("win32")).toBe(";");
  });

  it("is a colon everywhere else, matching what bootstrap.sh writes", () => {
    expect(composePathSeparator("darwin")).toBe(":");
    expect(composePathSeparator("linux")).toBe(":");
  });
});

describe("dockerDownloadUrl", () => {
  it("sends a Windows user to the Windows install page", () => {
    expect(dockerDownloadUrl("win32")).toContain("windows");
  });

  it("sends a macOS user to the Mac install page", () => {
    expect(dockerDownloadUrl("darwin")).toContain("mac");
  });

  it("falls back to the product page on any other platform", () => {
    const url = dockerDownloadUrl("linux");
    expect(url).toContain("docker");
    expect(url.startsWith("https://")).toBe(true);
  });
});
