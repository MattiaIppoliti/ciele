import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registerRuntimeHost: vi.fn(),
  after: vi.fn(),
  getPlatformSystemPrompt: vi.fn(async () => "the stored override"),
}));

vi.mock("next/server", () => ({ after: mocks.after }));
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
 * prompt, which means a missed registration would not throw or log — the runtime
 * would just quietly stop honouring the platform owner's stored override. That
 * silence is why this file is tested: the registration IS the wiring.
 */

const NODE = "nodejs";

beforeEach(() => {
  mocks.registerRuntimeHost.mockReset();
  mocks.after.mockReset();
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

  it("relaxes egress only outside Vercel production", async () => {
    const previous = process.env.VERCEL_ENV;
    try {
      await register();
      const [ports] = mocks.registerRuntimeHost.mock.calls[0]!;

      process.env.VERCEL_ENV = "production";
      expect(ports.allowRelaxedEgress()).toBe(false);
      process.env.VERCEL_ENV = "preview";
      expect(ports.allowRelaxedEgress()).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = previous;
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

  it("does nothing outside the Node runtime — the edge bundle must stay clean", async () => {
    process.env.NEXT_RUNTIME = "edge";
    await register();
    expect(mocks.registerRuntimeHost).not.toHaveBeenCalled();
  });
});
