import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_PARTITIONS, partitionForMode } from "./failure-reasons";

/**
 * #801, CYB-17. Two window-security decisions that are one word each in a
 * config object, and that nothing else would notice going back the other way.
 * Asserted against the source because `showNative` needs a real BrowserWindow,
 * and a flag nobody checks is a flag that gets flipped during a debugging
 * session and stays flipped.
 */
describe("the native window's security posture", () => {
  const source = readFileSync(new URL("./windows.ts", import.meta.url), "utf8");

  it("runs the app's own renderer sandboxed", () => {
    expect(source).toContain("sandbox: true");
    expect(source).not.toContain("sandbox: false");
  });

  it("keeps context isolation on and Node out of the renderer", () => {
    expect(source).toContain("contextIsolation: true");
    expect(source).toContain("nodeIntegration: false");
  });
});

describe("ALL_PARTITIONS", () => {
  it("names every partition sign-out has to clear", () => {
    // Clearing only the mode being left kept a live session for the other one,
    // on a machine whose user has just said they are done.
    expect([...ALL_PARTITIONS].sort()).toEqual(
      [partitionForMode("saas"), partitionForMode("local")].sort()
    );
  });
});
