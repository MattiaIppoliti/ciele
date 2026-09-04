import { describe, expect, it } from "vitest";

import { MUTE_STORAGE_KEY, mutedFromStorageEvent, readMuted, writeMuted, type StorageLike } from "./mute";

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe("mute preference", () => {
  it("defaults to sound on", () => {
    expect(readMuted(memoryStorage())).toBe(false);
    expect(readMuted(null)).toBe(false);
    expect(readMuted(undefined)).toBe(false);
  });

  it("round-trips", () => {
    const s = memoryStorage();
    writeMuted(s, true);
    expect(readMuted(s)).toBe(true);
    writeMuted(s, false);
    expect(readMuted(s)).toBe(false);
  });

  it("treats malformed values as not muted", () => {
    expect(readMuted(memoryStorage({ [MUTE_STORAGE_KEY]: "{not json" }))).toBe(false);
    expect(readMuted(memoryStorage({ [MUTE_STORAGE_KEY]: "true" }))).toBe(false);
    expect(readMuted(memoryStorage({ [MUTE_STORAGE_KEY]: '{"muted":"yes"}' }))).toBe(false);
    expect(readMuted(memoryStorage({ [MUTE_STORAGE_KEY]: "null" }))).toBe(false);
  });

  it("survives a storage that throws", () => {
    const hostile: StorageLike = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readMuted(hostile)).toBe(false);
    expect(() => writeMuted(hostile, true)).not.toThrow();
  });

  it("reads the cross-tab storage event for its own key only", () => {
    expect(mutedFromStorageEvent({ key: MUTE_STORAGE_KEY, newValue: '{"muted":true}' })).toBe(true);
    expect(mutedFromStorageEvent({ key: MUTE_STORAGE_KEY, newValue: null })).toBe(false);
    expect(mutedFromStorageEvent({ key: "theme", newValue: "dark" })).toBeNull();
  });
});
