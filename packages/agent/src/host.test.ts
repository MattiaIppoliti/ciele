import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PLATFORM_PROMPT,
  getRuntimeHost,
  registerRuntimeHost,
  resetRuntimeHost,
} from "./host";

/**
 * The host port registry is the seam that makes this package framework-free.
 *
 * Both ports have defaults that keep the runtime *correct* with nothing
 * registered — a host that never calls `registerRuntimeHost` gets the shipped
 * platform prompt and loses only the after-response latency optimization. That
 * property is what these tests pin: the runtime must never depend on its host
 * having wired itself up.
 */

afterEach(() => {
  resetRuntimeHost();
});

describe("runtime host ports", () => {
  it("serves the shipped platform prompt when no host registered one", async () => {
    await expect(getRuntimeHost().getPlatformSystemPrompt()).resolves.toBe(
      DEFAULT_PLATFORM_PROMPT
    );
  });

  it("drops after-response work by default — the ledger, not this port, is the contract", () => {
    const work = vi.fn();
    expect(() => getRuntimeHost().scheduleAfterResponse(work)).not.toThrow();
    // Deliberately NOT called: every caller has already written a durable job
    // row, and cron drains it. An unregistered host costs latency, never work.
    expect(work).not.toHaveBeenCalled();
  });

  it("uses a registered platform prompt reader", async () => {
    registerRuntimeHost({
      getPlatformSystemPrompt: async () => "the org-owner override",
    });
    await expect(getRuntimeHost().getPlatformSystemPrompt()).resolves.toBe(
      "the org-owner override"
    );
  });

  it("hands after-response work to a registered scheduler", () => {
    const scheduled: Array<() => unknown> = [];
    registerRuntimeHost({
      scheduleAfterResponse: (work) => scheduled.push(work),
    });
    const work = vi.fn();
    getRuntimeHost().scheduleAfterResponse(work);
    expect(scheduled).toHaveLength(1);
    // Handed over, not invoked — the host decides when it runs.
    expect(work).not.toHaveBeenCalled();
    scheduled[0]!();
    expect(work).toHaveBeenCalledOnce();
  });

  it("shallow-merges so a host may register one port and keep the other default", async () => {
    registerRuntimeHost({ scheduleAfterResponse: (work) => void work() });
    await expect(getRuntimeHost().getPlatformSystemPrompt()).resolves.toBe(
      DEFAULT_PLATFORM_PROMPT
    );
    const work = vi.fn();
    getRuntimeHost().scheduleAfterResponse(work);
    expect(work).toHaveBeenCalledOnce();
  });

  it("restores the defaults on reset", async () => {
    registerRuntimeHost({ getPlatformSystemPrompt: async () => "override" });
    resetRuntimeHost();
    await expect(getRuntimeHost().getPlatformSystemPrompt()).resolves.toBe(
      DEFAULT_PLATFORM_PROMPT
    );
  });

  it("shares one registry across duplicated module instances", async () => {
    // Hosts bundle this package (`transpilePackages`), and the Next dev server
    // compiles instrumentation.ts and each route entry as separate module
    // graphs — so host.ts is instantiated several times per process. The
    // registration made by one copy must be visible to every other copy, or
    // the after-response accelerator silently degrades to the no-op default
    // in dev. Two `vi.resetModules()` imports simulate exactly that split.
    vi.resetModules();
    const copyA = await import("./host");
    vi.resetModules();
    const copyB = await import("./host");
    expect(copyB).not.toBe(copyA);

    const scheduled: Array<() => unknown> = [];
    copyA.registerRuntimeHost({
      scheduleAfterResponse: (work) => scheduled.push(work),
    });
    copyB.getRuntimeHost().scheduleAfterResponse(() => "accelerated");
    expect(scheduled).toHaveLength(1);
  });

  it("ships a platform prompt that states the non-negotiable rules", () => {
    // The prompt itself is content, not behavior — pin only that the layer
    // exists and carries the precedence claim the two-layer model depends on.
    expect(DEFAULT_PLATFORM_PROMPT).toContain("highest precedence");
    expect(DEFAULT_PLATFORM_PROMPT.length).toBeGreaterThan(200);
  });
});
