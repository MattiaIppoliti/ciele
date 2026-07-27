import { describe, expect, it } from "vitest";
import type { Db } from "@agent-hub/db";
import { getMockDb } from "@agent-hub/db";

import { errorClassOf, errorMessageOf, recordRuntimeEvent } from "./telemetry";

describe("errorClassOf", () => {
  it("reads the error's class name", () => {
    expect(errorClassOf(new TypeError("bad"))).toBe("TypeError");
    expect(errorClassOf(new Error("plain"))).toBe("Error");
  });

  it("falls back for non-Error throws", () => {
    expect(errorClassOf("boom")).toBe("UnknownError");
    expect(errorClassOf(undefined)).toBe("UnknownError");
  });
});

describe("errorMessageOf", () => {
  it("reads an Error message and its cause", () => {
    expect(errorMessageOf(new Error("boom"))).toBe("boom");
    expect(
      errorMessageOf(new Error("outer", { cause: new Error("inner") }))
    ).toBe("outer (cause: inner)");
  });

  it("extracts a message from a plain object instead of [object Object]", () => {
    expect(errorMessageOf({ message: "schema rejected" })).toBe(
      "schema rejected"
    );
    expect(errorMessageOf({ error: "quota exceeded" })).toBe("quota exceeded");
    // The regression: AI SDK stream errors are plain objects.
    expect(errorMessageOf({ statusCode: 400, foo: "bar" })).toContain(
      "statusCode"
    );
    expect(errorMessageOf({ message: "schema rejected" })).not.toContain(
      "[object Object]"
    );
  });

  it("falls back cleanly for empty or unserializable values", () => {
    expect(errorMessageOf(undefined)).toBe("unknown error");
    expect(errorMessageOf("raw string")).toBe("raw string");
  });
});

describe("recordRuntimeEvent", () => {
  it("swallows a sink failure instead of throwing (fire-safe)", async () => {
    const failingDb: Db = {
      ...getMockDb(),
      recordRuntimeEvent: async () => {
        throw new Error("sink down");
      },
    };
    await expect(
      recordRuntimeEvent(failingDb, {
        organizationId: "org-1",
        kind: "chat_turn",
        status: "succeeded",
      })
    ).resolves.toBeUndefined();
  });
});
