import { describe, expect, it, vi } from "vitest";

/**
 * The barrel must be safe to evaluate where there is no browser: a server
 * component that imports a primitive from `@agent-hub/ui` pulls this in, and
 * `@foleyjs/core` reaches for `AudioContext` the moment anyone plays a cue.
 * So the libraries are imported dynamically inside the first gesture, and this
 * test is what makes that a rule rather than a habit.
 */
describe("feedback barrel", () => {
  it("evaluates under Node without touching AudioContext or the libraries", async () => {
    const touched: string[] = [];
    const trap = (name: string) =>
      new Proxy(function () {}, {
        construct() {
          touched.push(name);
          return {};
        },
        get() {
          touched.push(name);
          return undefined;
        },
      });
    vi.stubGlobal("AudioContext", trap("AudioContext"));
    vi.stubGlobal("webkitAudioContext", trap("webkitAudioContext"));

    const mod = await import("./index");

    expect(typeof mod.FeedbackProvider).toBe("function");
    expect(typeof mod.decide).toBe("function");
    expect(touched).toEqual([]);
    vi.unstubAllGlobals();
  });

  it("has no static import of either library anywhere in the module", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = __dirname;
    const offenders: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!/\.(ts|tsx)$/.test(file) || file.endsWith(".test.ts")) continue;
      const src = readFileSync(join(dir, file), "utf8");
      // `import type` is erased and allowed; a value import is not.
      const valueImport = /^import\s+(?!type\b)[^;]*from\s+["'](@foleyjs\/core|web-haptics)["']/m;
      if (valueImport.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
