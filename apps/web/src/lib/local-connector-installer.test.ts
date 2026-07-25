import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONNECTOR_SHA256,
  connectorInstallationScope,
  normalizeConnectorOrigin,
} from "./local-connector-installer";

describe("normalizeConnectorOrigin", () => {
  it.each([
    ["https://ciele.example.com", "https://ciele.example.com"],
    ["http://localhost:3000", "http://localhost:3000"],
    ["http://127.0.0.1:3000", "http://127.0.0.1:3000"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeConnectorOrigin(input)).toBe(expected);
  });

  it.each([
    "file:///tmp/ciele",
    "javascript:alert(1)",
    "https://user:password@ciele.example.com",
    "http://ciele.example.com",
  ])("rejects unsafe origin %s", (origin) => {
    expect(() => normalizeConnectorOrigin(origin)).toThrow();
  });
});

describe("connector release", () => {
  it("pins the digest of the versioned public runtime", () => {
    const runtime = readFileSync(
      new URL(
        "../../public/connectors/ciele-local-connector-0.3.4.mjs",
        import.meta.url
      )
    );

    expect(createHash("sha256").update(runtime).digest("hex")).toBe(
      CONNECTOR_SHA256
    );
    expect(runtime.toString("utf8")).toContain(".volta/bin");
    expect(runtime.toString("utf8")).toContain(".nvm/versions/node");
    expect(runtime.toString("utf8")).toContain(".asdf/shims");
    expect(runtime.toString("utf8")).toContain("npmShimEntrypoint");
    expect(runtime.toString("utf8")).toContain("command: process.execPath");
    expect(runtime.toString("utf8")).not.toContain('"-ExecutionPolicy"');
    expect(runtime.toString("utf8")).not.toContain('command: process.env.ComSpec');
  });

  it("derives a stable account and organization scope", () => {
    expect(connectorInstallationScope("org-1", "user-1")).toMatch(
      /^[a-f0-9]{64}$/
    );
    expect(connectorInstallationScope("org-1", "user-1")).not.toBe(
      connectorInstallationScope("org-2", "user-1")
    );
  });
});
