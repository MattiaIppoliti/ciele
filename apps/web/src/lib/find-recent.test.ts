import { afterEach, describe, expect, it, vi } from "vitest";
import { findScopeKey } from "./find-index";
import { pushRecentSearch, readRecentSearches, writeRecentSearches } from "./find-recent";

describe("recent searches", () => {
  it("keeps the last five, newest first, without duplicates", () => {
    let list: string[] = [];
    for (const q of ["alpha", "beta", "gamma", "delta", "eps", "zeta"]) list = pushRecentSearch(list, q);
    expect(list).toEqual(["zeta", "eps", "delta", "gamma", "beta"]);
    expect(pushRecentSearch(list, "Gamma")).toEqual(["Gamma", "zeta", "eps", "delta", "beta"]);
    expect(pushRecentSearch(list, "   ")).toEqual(list);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("keeps a Member's list when their Role changes", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) },
    });
    const editor = findScopeKey({ organizationId: "o1", userId: "u1", role: "editor" });
    const admin = findScopeKey({ organizationId: "o1", userId: "u1", role: "admin" });
    writeRecentSearches(editor, ["rota"]);
    expect(readRecentSearches(admin)).toEqual(["rota"]);
    expect(readRecentSearches(findScopeKey({ organizationId: "o1", userId: "u2", role: "editor" }))).toEqual([]);
  });
});
