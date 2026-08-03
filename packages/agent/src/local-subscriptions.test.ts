import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectedLocalSubscriptionProviders,
  executableVariants,
  isLocalSubscriptionDirectEnabled,
  isLoopbackHost,
  localSubscriptionCliEnvironment,
  localSubscriptionCommand,
  localSubscriptionInvocation,
  npmShimEntrypoint,
  parseClaudeLoginStatus,
  parseCodexLoginStatus,
  resolveExecutableCandidate,
} from "./local-subscriptions";

afterEach(() => vi.unstubAllEnvs());

function stubLocalDemoEnvironment() {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", undefined);
}

describe("isLocalSubscriptionDirectEnabled", () => {
  it("is enabled by default on a local instance — no opt-in flag", () => {
    stubLocalDemoEnvironment();
    vi.stubEnv("ENABLE_LOCAL_SUBSCRIPTION_TEST", undefined);
    expect(isLocalSubscriptionDirectEnabled()).toBe(true);
  });

  it.each(["1", "true", "on"])("stays enabled with the legacy value %s", (value) => {
    stubLocalDemoEnvironment();
    vi.stubEnv("ENABLE_LOCAL_SUBSCRIPTION_TEST", value);
    expect(isLocalSubscriptionDirectEnabled()).toBe(true);
  });

  it.each(["0", "false", "off"])("can be opted out with %s", (value) => {
    stubLocalDemoEnvironment();
    vi.stubEnv("ENABLE_LOCAL_SUBSCRIPTION_TEST", value);
    expect(isLocalSubscriptionDirectEnabled()).toBe(false);
  });

  it("cannot be enabled in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_LOCAL_SUBSCRIPTION_TEST", "1");
    expect(isLocalSubscriptionDirectEnabled()).toBe(false);
  });

  it("stays enabled on a locally-run Supabase-backed instance", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    expect(isLocalSubscriptionDirectEnabled()).toBe(true);
  });
});

describe("localSubscriptionCommand", () => {
  it("prefers the explicit env override", () => {
    vi.stubEnv("CODEX_CLI_PATH", "/custom/path/codex");
    expect(localSubscriptionCommand("openai")).toBe("/custom/path/codex");
  });

  it("keeps the bare command when it resolves on PATH", () => {
    const dir = mkdtempSync(join(tmpdir(), "ciele-cli-"));
    const binary = join(dir, "codex");
    writeFileSync(binary, "#!/bin/sh\n");
    chmodSync(binary, 0o755);
    vi.stubEnv("CODEX_CLI_PATH", undefined);
    vi.stubEnv("PATH", dir);
    expect(localSubscriptionCommand("openai")).toBe("codex");
  });
});

describe("localSubscriptionCommand on Windows", () => {
  it("resolves the runnable .exe variant to an absolute path", () => {
    const dir = mkdtempSync(join(tmpdir(), "ciele-cli-win-"));
    writeFileSync(join(dir, "claude"), "#!/bin/sh\n"); // npm's POSIX shim
    writeFileSync(join(dir, "claude.exe"), "MZ");
    vi.stubEnv("CLAUDE_CLI_PATH", undefined);
    vi.stubEnv("PATH", dir);
    expect(localSubscriptionCommand("anthropic", "win32")).toBe(
      join(dir, "claude.exe")
    );
  });

  it("resolves an npm .cmd shim to the JS entrypoint it launches", () => {
    const dir = mkdtempSync(join(tmpdir(), "ciele-cli-shim-"));
    const entrypoint = join(dir, "node_modules", "@openai", "codex", "bin");
    mkdirSync(entrypoint, { recursive: true });
    writeFileSync(join(entrypoint, "codex.js"), "#!/usr/bin/env node\n");
    writeFileSync(
      join(dir, "codex.cmd"),
      '"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\n'
    );
    vi.stubEnv("CODEX_CLI_PATH", undefined);
    vi.stubEnv("PATH", dir);
    expect(localSubscriptionCommand("openai", "win32")).toBe(
      join(entrypoint, "codex.js")
    );
  });

  it("skips shell-only shims rather than executing them", () => {
    const dir = mkdtempSync(join(tmpdir(), "ciele-cli-ps1-"));
    writeFileSync(join(dir, "codex.ps1"), "#!/usr/bin/env pwsh\n");
    expect(resolveExecutableCandidate(join(dir, "codex.ps1"), "win32")).toBeNull();
    expect(executableVariants(join(dir, "codex"), "win32")).toEqual([
      join(dir, "codex.exe"),
      join(dir, "codex.cmd"),
    ]);
    expect(executableVariants("/usr/local/bin/codex", "darwin")).toEqual([
      "/usr/local/bin/codex",
    ]);
  });

  it("refuses a shim entrypoint that escapes the shim directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "ciele-cli-escape-"));
    writeFileSync(
      join(dir, "codex.cmd"),
      '"%_prog%"  "%dp0%\\node_modules\\..\\..\\evil.js" %*\n'
    );
    expect(npmShimEntrypoint(join(dir, "codex.cmd"), "win32")).toBeNull();
  });
});

describe("localSubscriptionInvocation", () => {
  it("keeps the POSIX env launcher so a bare command resolves on PATH", () => {
    expect(localSubscriptionInvocation("codex", ["login"], "darwin")).toEqual({
      command: "/usr/bin/env",
      args: ["codex", "login"],
    });
  });

  it("spawns a Windows executable directly — there is no /usr/bin/env", () => {
    expect(
      localSubscriptionInvocation("C:\\bin\\claude.exe", ["auth"], "win32")
    ).toEqual({ command: "C:\\bin\\claude.exe", args: ["auth"] });
  });

  it("runs a resolved JS entrypoint under this process's Node", () => {
    expect(
      localSubscriptionInvocation("C:\\bin\\codex.js", ["exec"], "win32")
    ).toEqual({ command: process.execPath, args: ["C:\\bin\\codex.js", "exec"] });
  });
});

describe("localSubscriptionCliEnvironment", () => {
  it("forwards the Windows variables the CLIs need to run at all", () => {
    vi.stubEnv("USERPROFILE", "C:\\Users\\member");
    vi.stubEnv("LOCALAPPDATA", "C:\\Users\\member\\AppData\\Local");
    vi.stubEnv("SystemRoot", "C:\\Windows");
    const environment = localSubscriptionCliEnvironment();
    expect(environment.USERPROFILE).toBe("C:\\Users\\member");
    expect(environment.LOCALAPPDATA).toBe("C:\\Users\\member\\AppData\\Local");
    expect(environment.SystemRoot).toBe("C:\\Windows");
  });
});

describe("isLoopbackHost", () => {
  it.each([
    "localhost",
    "localhost:3000",
    "127.0.0.1",
    "127.0.0.1:3000",
    "::1",
    "[::1]",
    "[::1]:3000",
    // Any *.localhost label resolves to loopback, and dev servers use them.
    "ciele.localhost:3000",
    "app.staging.localhost",
  ])("accepts %s", (host) => expect(isLoopbackHost(host)).toBe(true));

  it.each([
    null,
    "192.168.1.6:3000",
    "ciele.example.com",
    // Not loopback: a registrable domain that merely ends in the same letters.
    "notlocalhost:3000",
    "localhost.attacker.example",
  ])("rejects %s", (host) => expect(isLoopbackHost(host)).toBe(false));
});

describe("parseCodexLoginStatus", () => {
  it("accepts only ChatGPT-backed login", () => {
    expect(parseCodexLoginStatus("Logged in using ChatGPT")).toEqual({
      connected: true,
      authMethod: "ChatGPT",
    });
    expect(parseCodexLoginStatus("Logged in using an API key")).toMatchObject({
      connected: false,
      authMethod: "API key",
    });
  });
});

describe("parseClaudeLoginStatus", () => {
  it("returns real subscription identity metadata", () => {
    expect(
      parseClaudeLoginStatus(
        JSON.stringify({
          loggedIn: true,
          authMethod: "claude.ai",
          email: "member@example.edu",
          subscriptionType: "max",
        })
      )
    ).toEqual({
      connected: true,
      authMethod: "claude.ai",
      accountLabel: "member@example.edu",
      plan: "max",
    });
  });

  it("rejects API-backed Claude authentication", () => {
    expect(
      parseClaudeLoginStatus(
        JSON.stringify({ loggedIn: true, authMethod: "console" })
      )
    ).toMatchObject({ connected: false, authMethod: "console" });
  });
});

describe("connectedLocalSubscriptionProviders", () => {
  it("exposes only authenticated CLIs as local Preview capabilities", () => {
    expect(
      connectedLocalSubscriptionProviders([
        {
          provider: "openai",
          label: "ChatGPT Subscription",
          detail: "Codex",
          available: true,
          connected: true,
          connecting: false,
        },
        {
          provider: "anthropic",
          label: "Claude Subscription",
          detail: "Claude",
          available: true,
          connected: false,
          connecting: true,
        },
      ])
    ).toEqual(["openai"]);
  });
});
