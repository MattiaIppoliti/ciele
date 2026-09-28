import { afterEach, describe, expect, it, vi } from "vitest";

const success = vi.fn();
const error = vi.fn();
vi.mock("@/lib/toast", () => ({ toast: { success, error } }));

const { copyToClipboard } = await import("./clipboard");

function stubClipboard(writeText: (text: string) => Promise<void>) {
  vi.stubGlobal("navigator", { clipboard: { writeText } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  success.mockClear();
  error.mockClear();
});

describe("copyToClipboard", () => {
  it("announces the copy only once the write resolved", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    await copyToClipboard("abc", "ID copied.");
    expect(writeText).toHaveBeenCalledWith("abc");
    expect(success).toHaveBeenCalledWith("ID copied.");
    expect(error).not.toHaveBeenCalled();
  });

  it("reports a refused write with the default or the given message", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    await copyToClipboard("abc", "ID copied.");
    await copyToClipboard("abc", "ID copied.", "Could not copy the ID.");
    expect(success).not.toHaveBeenCalled();
    expect(error.mock.calls).toEqual([
      ["Could not copy to the clipboard"],
      ["Could not copy the ID."],
    ]);
  });

  it("treats a missing clipboard as a refusal", async () => {
    vi.stubGlobal("navigator", {});
    await copyToClipboard("abc", "Copied.");
    expect(error).toHaveBeenCalledWith("Could not copy to the clipboard");
  });
});
