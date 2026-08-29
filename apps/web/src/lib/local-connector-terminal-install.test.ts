import { describe, expect, it } from "vitest";
import {
  buildConnectorInstallScript,
  connectorInstallCommand,
  isConnectorInstallShell,
} from "./local-connector-terminal-install";

const ORIGIN = "https://ciele.example.com";

describe("isConnectorInstallShell", () => {
  it("accepts the supported shells and rejects others", () => {
    expect(isConnectorInstallShell("sh")).toBe(true);
    expect(isConnectorInstallShell("ps1")).toBe(true);
    expect(isConnectorInstallShell("bat")).toBe(false);
    expect(isConnectorInstallShell("")).toBe(false);
  });
});

describe("connectorInstallCommand", () => {
  it("is a single copy-paste line per shell", () => {
    expect(connectorInstallCommand(ORIGIN, "sh")).toBe(
      "curl -fsSL https://ciele.example.com/api/local-connector/install/sh | sh"
    );
    expect(connectorInstallCommand(ORIGIN, "ps1")).toBe(
      "irm https://ciele.example.com/api/local-connector/install/ps1 | iex"
    );
  });

  it("rejects an unsafe origin", () => {
    expect(() => connectorInstallCommand("http://ciele.example.com", "sh")).toThrow();
  });
});

describe("buildConnectorInstallScript", () => {
  it("downloads the runtime and runs it in bootstrap on the fixed port (sh)", () => {
    const script = buildConnectorInstallScript(ORIGIN, "sh");
    expect(script).toContain("#!/bin/sh");
    expect(script).toContain("command -v node");
    expect(script).toContain(
      'curl -fsSL "https://ciele.example.com/api/local-connector/runtime"'
    );
    expect(script).toContain(
      'exec node "$dir/connector.mjs" --origin "https://ciele.example.com" --return-url "https://ciele.example.com/settings/ai" --port 49321 --bootstrap'
    );
  });

  it("downloads the runtime and runs it in bootstrap on the fixed port (ps1)", () => {
    const script = buildConnectorInstallScript(ORIGIN, "ps1");
    expect(script).toContain('$ProgressPreference = "SilentlyContinue"');
    expect(script).toContain("Get-Command node");
    expect(script).toContain(
      'Invoke-WebRequest "https://ciele.example.com/api/local-connector/runtime"'
    );
    expect(script).toContain('--port 49321 --bootstrap');
  });

  it("rejects an unsafe origin", () => {
    expect(() => buildConnectorInstallScript("javascript:alert(1)", "sh")).toThrow();
  });
});
