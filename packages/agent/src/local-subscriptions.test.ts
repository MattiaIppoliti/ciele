import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectedLocalSubscriptionProviders,
  isLocalSubscriptionTestEnabled,
  isLoopbackHost,
  localSubscriptionCommand,
  parseClaudeLoginStatus,
  parseCodexLoginStatus,
} from "./local-subscriptions";

afterEach(() => vi.unstubAllEnvs());

function stubLocalDemoEnvironment() {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", undefined);
}

describe("isLocalSubscriptionTestEnabled", () => {
  it("is disabled by default", () => {
    stubLocalDemoEnvironment();
    vi.stubEnv("ENABLE_LOCAL_SUBSCRIPTION_TEST", undefined);
    expect(isLocalSubscriptionTestEnabled()).toBe(false);
  });

  it.each(["1", "true", "on"])("accepts the explicit value %s", (value) => {
    stubLocalDemoEnvironment();
    vi.stubEnv("ENABLE_LOCAL_SUBSCRIPTION_TEST", value);
    expect(isLocalSubscriptionTestEnabled()).toBe(true);
  });

  it("cannot be enabled in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_LOCAL_SUBSCRIPTION_TEST", "1");
    expect(isLocalSubscriptionTestEnabled()).toBe(false);
  });

  it("stays enabled on a locally-run Supabase-backed instance", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_LOCAL_SUBSCRIPTION_TEST", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    expect(isLocalSubscriptionTestEnabled()).toBe(true);
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

describe("isLoopbackHost", () => {
  it.each(["localhost", "localhost:3000", "127.0.0.1:3000", "[::1]:3000"])(
    "accepts %s",
    (host) => expect(isLoopbackHost(host)).toBe(true)
  );

  it.each([null, "192.168.1.6:3000", "ciele.example.com"])(
    "rejects %s",
    (host) => expect(isLoopbackHost(host)).toBe(false)
  );
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
