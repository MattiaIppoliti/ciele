import { describe, expect, it, vi } from "vitest";
import type { EntityRecord, EntitySnapshot } from "@agent-hub/core";
import { entityToolNameFragment, entityToolSpecs } from "./entity-tools";

/**
 * Auto-generated Entity retrieval tools (#665): schema generation from the
 * Entity's typed attributes, the shared-scope gate, and the execute paths
 * (typed filters → equality query; keyword → search query; live fetcher).
 */

function makeEntity(overrides: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    id: "en-1",
    name: "Products",
    description: "The product catalog",
    attributes: [
      { key: "sku", label: "SKU", type: "text" },
      { key: "price", label: "Price", type: "number" },
      { key: "in_stock", label: "In stock", type: "boolean" },
    ],
    scope: "shared",
    identityAttribute: null,
    ...overrides,
  };
}

function userEntity(overrides: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return makeEntity({
    name: "Orders",
    attributes: [
      { key: "order_id", label: "Order id", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "customer_email", label: "Customer email", type: "text" },
    ],
    scope: "user",
    identityAttribute: "customer_email",
    ...overrides,
  });
}

function record(values: EntityRecord["values"]): EntityRecord {
  return {
    id: "r1",
    entityId: "en-1",
    key: String(values.sku ?? "k"),
    values,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("entityToolNameFragment", () => {
  it("turns arbitrary names into tool-name-safe fragments", () => {
    expect(entityToolNameFragment("Products")).toBe("Products");
    expect(entityToolNameFragment("opening hours!")).toBe("OpeningHours");
    expect(entityToolNameFragment("catalogo prodotti 2026")).toBe(
      "CatalogoProdotti2026"
    );
    expect(entityToolNameFragment("!!!")).toBe("");
  });
});

describe("entityToolSpecs", () => {
  it("yields a filter tool and a text-search tool for a shared Entity", () => {
    const specs = entityToolSpecs(makeEntity(), vi.fn());
    expect(specs.map((s) => s.name)).toEqual(["filterProducts", "searchProducts"]);
  });

  it("yields nothing for a user-scoped Entity without an identity binding (fail safe)", () => {
    expect(entityToolSpecs(userEntity(), vi.fn())).toEqual([]);
    expect(entityToolSpecs(userEntity(), vi.fn(), null)).toEqual([]);
    // No identity attribute configured on the Entity → likewise nothing.
    expect(
      entityToolSpecs(userEntity({ identityAttribute: null }), vi.fn(), {
        value: "me@example.com",
      })
    ).toEqual([]);
  });

  it("binds a user-scoped Entity's identity attribute server-side (#667)", async () => {
    const fetch = vi.fn().mockResolvedValue([]);
    const specs = entityToolSpecs(userEntity(), fetch, {
      value: "me@example.com",
    });
    expect(specs.map((s) => s.name)).toEqual(["filterOrders", "searchOrders"]);
    const [filter, search] = specs;

    // The bound attribute never appears in the model-facing schema.
    expect(
      Object.keys((filter.inputSchema as unknown as { shape: object }).shape)
    ).toEqual(["order_id", "status"]);

    // Prompt-injection attempt: the model smuggles another subject's email —
    // the server-side binding overwrites it unconditionally.
    await filter.execute(
      { status: "delayed", customer_email: "victim@example.com" },
      {} as never
    );
    expect(fetch).toHaveBeenCalledWith("en-1", {
      filters: { status: "delayed", customer_email: "me@example.com" },
      limit: 20,
    });

    // The search tool carries the same non-negotiable filter.
    await search.execute({ query: "delayed" }, {} as never);
    expect(fetch).toHaveBeenCalledWith("en-1", {
      search: "delayed",
      filters: { customer_email: "me@example.com" },
      limit: 20,
    });
  });

  it("ignores the identity binding for shared Entities", async () => {
    const fetch = vi.fn().mockResolvedValue([]);
    const [filter] = entityToolSpecs(makeEntity(), fetch, {
      value: "me@example.com",
    });
    await filter.execute({ sku: "A-1" }, {} as never);
    expect(fetch).toHaveBeenCalledWith("en-1", {
      filters: { sku: "A-1" },
      limit: 20,
    });
  });

  it("omits the search tool when no attribute is text-typed", () => {
    const specs = entityToolSpecs(
      makeEntity({
        attributes: [{ key: "price", label: "Price", type: "number" }],
      }),
      vi.fn()
    );
    expect(specs.map((s) => s.name)).toEqual(["filterProducts"]);
  });

  it("yields nothing for an unnameable or attribute-less Entity", () => {
    expect(entityToolSpecs(makeEntity({ name: "!!!" }), vi.fn())).toEqual([]);
    expect(entityToolSpecs(makeEntity({ attributes: [] }), vi.fn())).toEqual([]);
  });

  it("filter tool passes only the provided typed values as equality filters", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue([record({ sku: "A-1", price: 10, in_stock: true })]);
    const [filter] = entityToolSpecs(makeEntity(), fetch);

    // The input schema is typed per attribute: number stays a number.
    expect(() =>
      filter.inputSchema.parse({ sku: "A-1", price: 10 })
    ).not.toThrow();
    expect(() => filter.inputSchema.parse({ price: "ten" })).toThrow();

    const output = (await filter.execute(
      { sku: "A-1", price: 10, in_stock: undefined },
      {} as never
    )) as { count: number; records: unknown[] };
    expect(fetch).toHaveBeenCalledWith("en-1", {
      filters: { sku: "A-1", price: 10 },
      limit: 20,
    });
    expect(output.count).toBe(1);
    expect(output.records).toEqual([{ sku: "A-1", price: 10, in_stock: true }]);
  });

  it("search tool runs a keyword query and reports an honest empty result", async () => {
    const fetch = vi.fn().mockResolvedValue([]);
    const [, search] = entityToolSpecs(makeEntity(), fetch);
    const output = (await search.execute({ query: "widget" }, {} as never)) as {
      count: number;
      note?: string;
    };
    expect(fetch).toHaveBeenCalledWith("en-1", { search: "widget", limit: 20 });
    expect(output.count).toBe(0);
    expect(output.note).toContain("No matching records");
  });
});
