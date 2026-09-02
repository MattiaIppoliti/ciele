import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registerRuntimeHost: vi.fn(),
  after: vi.fn(),
  getPlatformSystemPrompt: vi.fn(async () => "the stored override"),
  isSupabaseConfigured: vi.fn(() => false),
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@agent-hub/db", () => ({ isSupabaseConfigured: mocks.isSupabaseConfigured }));
vi.mock("@agent-hub/agent", () => ({ registerRuntimeHost: mocks.registerRuntimeHost }));
vi.mock("@/lib/platform", () => ({
  getPlatformSystemPrompt: mocks.getPlatformSystemPrompt,
}));
// The enterprise entrypoint is stubbed only so importing it is inert here. It is
// deliberately NOT asserted: `await import()` is cached by the module registry,
// so a per-call assertion would pass on the cached module rather than on this
// run's behaviour. That `register()` resolves at all is the honest signal.
vi.mock("@/ee/register", () => ({}));

import { register } from "./instrumentation";

/**
 * `@agent-hub/agent` is framework-free and reaches Next only through the ports it
 * registers here. Its `getPlatformSystemPrompt` port falls back to the SHIPPED
 * prompt, which means a missed registration would not throw or log, the runtime
 * would just quietly stop honouring the platform owner's stored override. That
 * silence is why this file is tested: the registration IS the wiring.
 */

const NODE = "nodejs";

beforeEach(() => {
  mocks.registerRuntimeHost.mockReset();
  mocks.after.mockReset();
  mocks.isSupabaseConfigured.mockReset();
  mocks.isSupabaseConfigured.mockReturnValue(false);
  process.env.NEXT_RUNTIME = NODE;
});

describe("instrumentation register()", () => {
  it("registers every runtime host port", async () => {
    await register();

    expect(mocks.registerRuntimeHost).toHaveBeenCalledOnce();
    const [ports] = mocks.registerRuntimeHost.mock.calls[0]!;
    // All of them, by name: a partial registration silently keeps a shipped default.
    expect(Object.keys(ports).sort()).toEqual([
      "allowRelaxedEgress",
      "getPlatformSystemPrompt",
      "scheduleAfterResponse",
    ]);
  });

  it("relaxes egress for dev and Vercel preview, never for a production build", async () => {
    const previousVercel = process.env.VERCEL_ENV;
    const previousNode = process.env.NODE_ENV;
    const setNodeEnv = (value: string) => {
      // NODE_ENV is readonly in the Next types; the test owns the process.
      (process.env as Record<string, string>).NODE_ENV = value;
    };
    try {
      await register();
      const [ports] = mocks.registerRuntimeHost.mock.calls[0]!;

      setNodeEnv("production");
      process.env.VERCEL_ENV = "production";
      expect(ports.allowRelaxedEgress()).toBe(false);
      process.env.VERCEL_ENV = "preview";
      expect(ports.allowRelaxedEgress()).toBe(true);

      // The case that actually ships, and the one the old `!== "production"`
      // test got backwards: VERCEL_ENV is unset on every non-Vercel host, so a
      // self-host, Docker or Desktop install must still be strict.
      delete process.env.VERCEL_ENV;
      expect(ports.allowRelaxedEgress()).toBe(false);

      // `next dev` keeps the carve-out for local plain-HTTP mocks.
      setNodeEnv("development");
      expect(ports.allowRelaxedEgress()).toBe(true);
    } finally {
      if (previousVercel === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = previousVercel;
      setNodeEnv(previousNode ?? "test");
    }
  });

  it("wires the platform prompt port to the app's cached reader, not the default", async () => {
    await register();
    const [ports] = mocks.registerRuntimeHost.mock.calls[0]!;

    await expect(ports.getPlatformSystemPrompt()).resolves.toBe("the stored override");
    expect(mocks.getPlatformSystemPrompt).toHaveBeenCalled();
  });

  it("hands after-response work to Next's `after`, which keeps the invocation alive", async () => {
    await register();
    const [ports] = mocks.registerRuntimeHost.mock.calls[0]!;

    const work = () => Promise.resolve("drained");
    ports.scheduleAfterResponse(work);

    // Passed through as the callback, NOT invoked here and NOT awaited-and-dropped:
    // `after` awaiting the returned promise is what stops a serverless instance
    // freezing mid-drain (see the port's contract in host.ts).
    expect(mocks.after).toHaveBeenCalledWith(work);
  });

  it("does nothing outside the Node runtime, the edge bundle must stay clean", async () => {
    process.env.NEXT_RUNTIME = "edge";
    await register();
    expect(mocks.registerRuntimeHost).not.toHaveBeenCalled();
  });

  /**
   * CYB-16 (#801). The rule itself is tested in `lib/secure-origin.security.test.ts`;
   * this asserts the wiring: a production process with a public plain-HTTP
   * origin never reaches the port registration.
   */
  describe("public origin startup assertion", () => {
    const previous = {
      NODE_ENV: process.env.NODE_ENV,
      PUBLIC_URL: process.env.PUBLIC_URL,
      CIELE_PUBLIC_ORIGIN: process.env.CIELE_PUBLIC_ORIGIN,
      CIELE_ALLOW_INSECURE_HTTP: process.env.CIELE_ALLOW_INSECURE_HTTP,
    };
    const setNodeEnv = (value: string | undefined) => {
      if (value === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
      else (process.env as Record<string, string>).NODE_ENV = value;
    };
    afterEach(() => {
      setNodeEnv(previous.NODE_ENV);
      for (const key of ["PUBLIC_URL", "CIELE_PUBLIC_ORIGIN", "CIELE_ALLOW_INSECURE_HTTP"] as const) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });

    it("refuses to start a production build on a public http:// origin", async () => {
      setNodeEnv("production");
      delete process.env.PUBLIC_URL;
      process.env.CIELE_PUBLIC_ORIGIN = "http://ciele.example.edu";
      delete process.env.CIELE_ALLOW_INSECURE_HTTP;

      await expect(register()).rejects.toThrow(/plain HTTP/);
      expect(mocks.registerRuntimeHost).not.toHaveBeenCalled();
    });

    it("refuses the self-host's own variable: PUBLIC_URL on a LAN address", async () => {
      // The compose stack passes PUBLIC_URL and an empty CIELE_PUBLIC_ORIGIN;
      // this is the BIND_ADDRESS=0.0.0.0 case the first cut booted quietly.
      setNodeEnv("production");
      process.env.PUBLIC_URL = "http://192.168.1.20:3000";
      process.env.CIELE_PUBLIC_ORIGIN = "";
      delete process.env.CIELE_ALLOW_INSECURE_HTTP;

      await expect(register()).rejects.toThrow(/PUBLIC_URL/);
      expect(mocks.registerRuntimeHost).not.toHaveBeenCalled();
    });

    it("starts when the operator opts in by name", async () => {
      setNodeEnv("production");
      delete process.env.PUBLIC_URL;
      process.env.CIELE_PUBLIC_ORIGIN = "http://ciele.example.edu";
      process.env.CIELE_ALLOW_INSECURE_HTTP = "1";
      process.env.APP_ENCRYPTION_KEY ??= "test";

      await register();
      expect(mocks.registerRuntimeHost).toHaveBeenCalledOnce();
    });
  });

  /**
   * CYB-02 (#801). `sealSecret` refuses each write without a key, but a
   * per-write refusal reaches whoever submits a Settings form, weeks after the
   * deploy that lost the variable. Startup is the moment the operator who
   * caused the misconfiguration is watching, so a Supabase-backed process
   * refuses to start; the keyless demo mode stores no credentials and must
   * keep working out of the box.
   */
  describe("APP_ENCRYPTION_KEY startup assertion", () => {
    const previousKey = process.env.APP_ENCRYPTION_KEY;
    afterEach(() => {
      if (previousKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
      else process.env.APP_ENCRYPTION_KEY = previousKey;
    });

    it("refuses to start Supabase-backed without the key", async () => {
      mocks.isSupabaseConfigured.mockReturnValue(true);
      delete process.env.APP_ENCRYPTION_KEY;

      await expect(register()).rejects.toThrow(/APP_ENCRYPTION_KEY/);
      expect(mocks.registerRuntimeHost).not.toHaveBeenCalled();
    });

    it("starts Supabase-backed once the key is present", async () => {
      mocks.isSupabaseConfigured.mockReturnValue(true);
      process.env.APP_ENCRYPTION_KEY = "any string, it is hashed to the key";

      await register();
      expect(mocks.registerRuntimeHost).toHaveBeenCalledOnce();
    });

    it("gives keyless demo mode an ephemeral per-process key", async () => {
      // Demo mode still seals what you paste into Settings, into the
      // in-memory store; a per-process key is exactly as durable as that
      // store, and it keeps the core fail-closed instead of re-growing a
      // plaintext fallback for the demo's sake.
      mocks.isSupabaseConfigured.mockReturnValue(false);
      delete process.env.APP_ENCRYPTION_KEY;

      await register();
      expect(mocks.registerRuntimeHost).toHaveBeenCalledOnce();
      expect(process.env.APP_ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/);
    });

    it("never overrides a key the operator set, demo mode included", async () => {
      mocks.isSupabaseConfigured.mockReturnValue(false);
      process.env.APP_ENCRYPTION_KEY = "operator-chosen";

      await register();
      expect(process.env.APP_ENCRYPTION_KEY).toBe("operator-chosen");
    });
  });
});
