import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  createPrefetchRequester,
  getLinkPrefetchMode,
  type PrefetchRouter,
} from "@/components/ui/link-prefetch";

const linkSource = readFileSync(new URL("./link.tsx", import.meta.url), "utf8");

describe("Link prefetch policy", () => {
  it("uses intent by default and viewport only when explicitly requested", () => {
    expect(getLinkPrefetchMode("/assistants", undefined)).toBe("intent");
    expect(getLinkPrefetchMode("/assistants", null)).toBe("intent");
    expect(getLinkPrefetchMode("/assistants", "auto")).toBe("intent");
    expect(getLinkPrefetchMode("/assistants", true)).toBe("viewport");
    expect(getLinkPrefetchMode("/assistants", false)).toBe("none");
  });

  it("does not manage external or non-string hrefs", () => {
    expect(getLinkPrefetchMode("https://example.com", true)).toBe("none");
    expect(getLinkPrefetchMode("mailto:help@example.com", undefined)).toBe(
      "none",
    );
    expect(getLinkPrefetchMode(null, true)).toBe("none");
  });

  it("deduplicates a destination during the intent window", () => {
    const prefetch = vi.fn();
    const router: PrefetchRouter = { prefetch };
    let now = 1_000;
    const requestPrefetch = createPrefetchRequester(() => now);

    requestPrefetch(router, "/assistants");
    requestPrefetch(router, "/assistants");

    expect(prefetch).toHaveBeenCalledOnce();
    now += 30_000;
    requestPrefetch(router, "/assistants");
    expect(prefetch).toHaveBeenCalledTimes(2);
  });

  it("allows retry when the router rejects a prefetch synchronously", () => {
    const prefetch = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("prefetch failed");
      })
      .mockImplementation(() => undefined);
    const router: PrefetchRouter = { prefetch };
    const requestPrefetch = createPrefetchRequester();

    expect(() => requestPrefetch(router, "/inbox")).toThrow("prefetch failed");
    expect(() => requestPrefetch(router, "/inbox")).not.toThrow();
    expect(prefetch).toHaveBeenCalledTimes(2);
  });

  it("keeps navigation on Next's standard click path", () => {
    expect(linkSource).not.toContain("IntersectionObserver");
    expect(linkSource).not.toContain("onMouseDown");
    expect(linkSource).not.toContain("router.push");
    expect(linkSource).not.toContain("router.replace");
  });
});
