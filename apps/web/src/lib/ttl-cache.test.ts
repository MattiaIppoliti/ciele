import { describe, expect, it } from "vitest";
import { createTtlCache } from "./ttl-cache";

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createTtlCache", () => {
  it("serves a fresh value without loading again", async () => {
    const c = clock();
    const cache = createTtlCache<string>({ ttlMs: 1000, now: c.now });
    let loads = 0;
    const load = async () => `v${++loads}`;
    expect(await cache.wrap("k", load)).toBe("v1");
    c.advance(999);
    expect(await cache.wrap("k", load)).toBe("v1");
    expect(loads).toBe(1);
  });

  it("loads again once the value is older than the ttl", async () => {
    const c = clock();
    const cache = createTtlCache<string>({ ttlMs: 1000, now: c.now });
    let loads = 0;
    const load = async () => `v${++loads}`;
    await cache.wrap("k", load);
    c.advance(1000);
    expect(await cache.wrap("k", load)).toBe("v2");
  });

  it("shares one load between callers that ask while it is in flight", async () => {
    const cache = createTtlCache<string>({ ttlMs: 1000 });
    let loads = 0;
    let release!: (v: string) => void;
    const load = () => {
      loads += 1;
      return new Promise<string>((resolve) => (release = resolve));
    };
    const a = cache.wrap("k", load);
    const b = cache.wrap("k", load);
    await Promise.resolve(); // the load starts a microtask after wrap returns
    release("shared");
    expect(await a).toBe("shared");
    expect(await b).toBe("shared");
    expect(loads).toBe(1);
  });

  it("does not keep a failure: the next caller tries again", async () => {
    const cache = createTtlCache<string>({ ttlMs: 1000 });
    let calls = 0;
    const load = async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return "ok";
    };
    await expect(cache.wrap("k", load)).rejects.toThrow("boom");
    expect(await cache.wrap("k", load)).toBe("ok");
  });

  it("keeps keys apart and drops the oldest entry past its size cap", async () => {
    const cache = createTtlCache<string>({ ttlMs: 1000, max: 2 });
    let loads = 0;
    const load = (v: string) => async () => {
      loads += 1;
      return v;
    };
    await cache.wrap("a", load("A"));
    await cache.wrap("b", load("B"));
    await cache.wrap("c", load("C")); // evicts "a"
    expect(loads).toBe(3);
    await cache.wrap("b", load("B2"));
    await cache.wrap("c", load("C2"));
    expect(loads).toBe(3); // both still cached
    await cache.wrap("a", load("A2"));
    expect(loads).toBe(4); // "a" was evicted
  });

  it("hands a value the caller marks as not worth keeping to its caller and asks again next time", async () => {
    const cache = createTtlCache<{ v: number; partial: boolean }>({ ttlMs: 1000 });
    let n = 0;
    const load = async () => ({ v: ++n, partial: n === 1 });
    const keep = (value: { partial: boolean }) => !value.partial;
    expect((await cache.wrap("k", load, keep)).v).toBe(1); // partial: returned, not kept
    expect((await cache.wrap("k", load, keep)).v).toBe(2); // asked again, complete, kept
    expect((await cache.wrap("k", load, keep)).v).toBe(2);
  });

  it("expires every key under a prefix, and nothing else", async () => {
    const cache = createTtlCache<string>({ ttlMs: 60_000 });
    let loads = 0;
    const load = async () => `v${++loads}`;
    await cache.wrap("org-a:m1", load);
    await cache.wrap("org-a:m2", load);
    await cache.wrap("org-b:m1", load);
    cache.expire("org-a:");
    expect(await cache.wrap("org-a:m1", load)).toBe("v4");
    expect(await cache.wrap("org-b:m1", load)).toBe("v3");
  });

  it("does not store a load that was in flight when its key expired", async () => {
    const cache = createTtlCache<string>({ ttlMs: 60_000 });
    let release!: (v: string) => void;
    const before = cache.wrap("org-a:k", () => new Promise<string>((r) => (release = r)));
    await Promise.resolve(); // the load starts on the next microtask
    cache.expire("org-a:");
    release("stale");
    expect(await before).toBe("stale");
    expect(await cache.wrap("org-a:k", async () => "fresh")).toBe("fresh");
  });
});
