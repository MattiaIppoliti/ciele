import { describe, expect, it, vi } from "vitest";
import { lazyModule } from "./lazy-module";

describe("lazyModule", () => {
  it("imports once and hands the module back synchronously after", async () => {
    const importer = vi.fn(async () => ({ value: 1 }));
    const mod = lazyModule(importer);
    expect(mod.get()).toBeNull();
    mod.prefetch();
    const loaded = await mod.load();
    expect(importer).toHaveBeenCalledTimes(1);
    expect(mod.get()).toBe(loaded);
  });

  it("forgets a failed import so the next load retries", async () => {
    const importer = vi
      .fn<() => Promise<{ value: number }>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ value: 2 });
    const mod = lazyModule(importer);
    await expect(mod.load()).rejects.toThrow("offline");
    expect(mod.get()).toBeNull();
    await expect(mod.load()).resolves.toEqual({ value: 2 });
    expect(importer).toHaveBeenCalledTimes(2);
  });
});
