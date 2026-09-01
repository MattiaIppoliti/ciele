import { describe, expect, it } from "vitest";
import { isStaleBundleError } from "./stale-bundle";

describe("isStaleBundleError", () => {
  it("recognises the browser's and the bundler's module-load failures", () => {
    expect(isStaleBundleError({ name: "ChunkLoadError", message: "x" })).toBe(true);
    expect(
      isStaleBundleError({ message: "Loading chunk 1t7par5szxib9 failed." })
    ).toBe(true);
    expect(
      isStaleBundleError({
        message: "Failed to fetch dynamically imported module: /_next/static/chunks/a.js",
      })
    ).toBe(true);
    expect(
      isStaleBundleError({ message: "Importing a module script failed." })
    ).toBe(true);
    expect(
      isStaleBundleError({ message: "Module not found: 3xw2a1j5tyan7" })
    ).toBe(true);
  });

  it("leaves the app's own throws alone, so a real bug is never reloaded over", () => {
    expect(isStaleBundleError({ message: "Not a member of this organization" })).toBe(false);
    expect(
      isStaleBundleError({
        name: "TypeError",
        message: "Cannot read properties of undefined (reading 'unread')",
      })
    ).toBe(false);
    expect(isStaleBundleError({})).toBe(false);
  });
});
