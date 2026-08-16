import { describe, expect, it } from "vitest";
import { canServeOriginal } from "./direct-access";

const okSource = { kind: "file" as const, originalObjectPath: "org/x/y.pdf" };

describe("canServeOriginal", () => {
  it("allows only when every leg holds", () => {
    expect(
      canServeOriginal({
        published: true,
        linkDirectAccess: true,
        source: okSource,
      })
    ).toBe(true);
  });

  it("refuses an unpublished assistant", () => {
    expect(
      canServeOriginal({
        published: false,
        linkDirectAccess: true,
        source: okSource,
      })
    ).toBe(false);
  });

  it("refuses when the source is not linked or the flag is off", () => {
    expect(
      canServeOriginal({
        published: true,
        linkDirectAccess: null,
        source: okSource,
      })
    ).toBe(false);
    expect(
      canServeOriginal({
        published: true,
        linkDirectAccess: false,
        source: okSource,
      })
    ).toBe(false);
  });

  it("refuses non-file kinds", () => {
    for (const kind of ["website", "url", "text", "faq"] as const) {
      expect(
        canServeOriginal({
          published: true,
          linkDirectAccess: true,
          source: { kind, originalObjectPath: "org/x/y.pdf" },
        })
      ).toBe(false);
    }
  });

  it("refuses a missing or empty original", () => {
    expect(
      canServeOriginal({
        published: true,
        linkDirectAccess: true,
        source: { kind: "file", originalObjectPath: null },
      })
    ).toBe(false);
    expect(
      canServeOriginal({
        published: true,
        linkDirectAccess: true,
        source: { kind: "file", originalObjectPath: "" },
      })
    ).toBe(false);
    expect(
      canServeOriginal({
        published: true,
        linkDirectAccess: true,
        source: null,
      })
    ).toBe(false);
  });
});
