import { describe, expect, it } from "vitest";
import { filtersFromSearchParams, withFilterParams } from "./url-state";

const DEFAULTS = { from: "2026-08-27", to: "2026-09-26", feedback: "", q: "" };

describe("withFilterParams", () => {
  it("writes only the values that differ from the defaults", () => {
    const params = withFilterParams(
      new URLSearchParams(),
      { ...DEFAULTS, feedback: "down", q: "refund" },
      DEFAULTS,
    );
    expect(params.toString()).toBe("feedback=down&q=refund");
  });

  it("drops a filter that went back to its default", () => {
    const params = withFilterParams(
      new URLSearchParams("feedback=down"),
      DEFAULTS,
      DEFAULTS,
    );
    expect(params.toString()).toBe("");
  });

  it("keeps parameters that are not filters", () => {
    const params = withFilterParams(
      new URLSearchParams("conversation=c1"),
      { ...DEFAULTS, feedback: "up" },
      DEFAULTS,
    );
    expect(params.get("conversation")).toBe("c1");
    expect(params.get("feedback")).toBe("up");
  });
});

describe("filtersFromSearchParams", () => {
  it("overlays the URL on the defaults", () => {
    const filters = filtersFromSearchParams(
      new URLSearchParams("feedback=down&from=2026-01-01"),
      DEFAULTS,
    );
    expect(filters).toEqual({ ...DEFAULTS, feedback: "down", from: "2026-01-01" });
  });

  it("ignores unknown keys", () => {
    const filters = filtersFromSearchParams(
      new URLSearchParams("evil=1"),
      DEFAULTS,
    );
    expect(filters).toEqual(DEFAULTS);
  });

  it("falls back to the default for a value outside the allowed set", () => {
    const filters = filtersFromSearchParams(
      new URLSearchParams("feedback=sideways"),
      DEFAULTS,
      { feedback: ["", "up", "down"] },
    );
    expect(filters.feedback).toBe("");
  });

  it("accepts a Next.js searchParams record, taking the first of a repeated key", () => {
    const filters = filtersFromSearchParams(
      { feedback: ["down", "up"], q: "refund" },
      DEFAULTS,
    );
    expect(filters.feedback).toBe("down");
    expect(filters.q).toBe("refund");
  });

  it("round-trips through withFilterParams", () => {
    const chosen = { ...DEFAULTS, feedback: "up", q: "late order" };
    const params = withFilterParams(new URLSearchParams(), chosen, DEFAULTS);
    expect(filtersFromSearchParams(params, DEFAULTS)).toEqual(chosen);
  });
});
