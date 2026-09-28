import { describe, expect, it } from "vitest";
import {
  camelToSnakeKey,
  domainToRow,
  patchRow,
  rowToDomain,
  snakeToCamelKey,
} from "./table-access";

describe("table-access key mapping", () => {
  it("maps camelCase field names to snake_case columns and back", () => {
    expect(camelToSnakeKey("organizationId")).toBe("organization_id");
    expect(camelToSnakeKey("name")).toBe("name");
    expect(snakeToCamelKey("organization_id")).toBe("organizationId");
    expect(snakeToCamelKey("created_at")).toBe("createdAt");
  });

  it("round-trips every domain key of a mapped table", () => {
    const domain = {
      id: "sk_1",
      organizationId: "org_1",
      name: "n",
      description: "",
      prompt: "p",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    expect(rowToDomain(domainToRow(domain))).toEqual(domain);
  });

  it("domainToRow drops undefined values (partial patches stay partial)", () => {
    expect(domainToRow({ name: undefined, prompt: "p" })).toEqual({ prompt: "p" });
  });

  it("patchRow keeps only the listed keys that are set, as columns", () => {
    const patch = { logoUrl: null, name: undefined, extra: "not listed" };
    expect(patchRow(patch, ["logoUrl", "name"])).toEqual({ logo_url: null });
  });

  it("rowToDomain passes values through verbatim, nulls included", () => {
    expect(rowToDomain({ logo_url: null })).toEqual({ logoUrl: null });
  });
});
