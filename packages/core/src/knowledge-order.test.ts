import { describe, expect, it } from "vitest";
import {
  compareOrgKnowledgeSources,
  compareSourceDocuments,
} from "./knowledge-order";
import type { SourceStatus } from "./types";

function source(
  id: string,
  name: string,
  status: SourceStatus,
  createdAt: string,
  updatedAt?: string
) {
  return { id, name, status, createdAt, updatedAt };
}

const rows = [
  source("b", "Beta", "ready", "2026-01-02T00:00:00Z", "2026-03-01T00:00:00Z"),
  source("a", "alpha", "error", "2026-01-03T00:00:00Z", "2026-01-03T00:00:00Z"),
  source("c", "Gamma", "processing", "2026-01-01T00:00:00Z"),
];

const order = (o: Parameters<typeof compareOrgKnowledgeSources>[0]) =>
  [...rows].sort(compareOrgKnowledgeSources(o)).map((r) => r.id);

describe("compareOrgKnowledgeSources", () => {
  it("defaults to newest first, which is what every caller had before", () => {
    expect(order({})).toEqual(["a", "b", "c"]);
    expect(order({ sort: "createdAt" })).toEqual(["a", "b", "c"]);
  });

  it("sorts names case-insensitively", () => {
    // "alpha" before "Beta": a byte comparison would put every capital first.
    expect(order({ sort: "name", ascending: true })).toEqual(["a", "b", "c"]);
    expect(order({ sort: "name" })).toEqual(["c", "b", "a"]);
  });

  it("sorts Status as states rather than alphabetically", () => {
    // error → processing → ready, worst first, not e/p/r by accident.
    expect(order({ sort: "status", ascending: true })).toEqual(["a", "c", "b"]);
  });

  it("falls back to createdAt where a row has never been updated", () => {
    expect(order({ sort: "updatedAt" })).toEqual(["b", "a", "c"]);
  });

  it("is total, so paging cannot lose a row", () => {
    const same = [
      source("z", "Same", "ready", "2026-01-01T00:00:00Z"),
      source("y", "Same", "ready", "2026-01-01T00:00:00Z"),
    ];
    expect(
      [...same].sort(compareOrgKnowledgeSources({ sort: "name" })).map((r) => r.id)
    ).toEqual(["z", "y"]);
    expect(
      [...same].reverse().sort(compareOrgKnowledgeSources({ sort: "name" })).map((r) => r.id)
    ).toEqual(["z", "y"]);
  });

  it("flips the tie-break with the direction", () => {
    // Otherwise ties stay put and a flipped sort does not look flipped.
    const tied = [
      source("a", "Same", "ready", "2026-01-01T00:00:00Z"),
      source("b", "Same", "ready", "2026-01-01T00:00:00Z"),
    ];
    expect(
      [...tied].sort(compareOrgKnowledgeSources({ sort: "name", ascending: true })).map((r) => r.id)
    ).toEqual(["a", "b"]);
    expect(
      [...tied].sort(compareOrgKnowledgeSources({ sort: "name" })).map((r) => r.id)
    ).toEqual(["b", "a"]);
  });
});

describe("compareSourceDocuments", () => {
  const documents = [
    { id: "1", title: "Zebra", createdAt: "2026-01-01T00:00:00Z" },
    { id: "2", title: "apple", createdAt: "2026-01-02T00:00:00Z" },
  ];
  const sorted = (o: Parameters<typeof compareSourceDocuments>[0]) =>
    [...documents].sort(compareSourceDocuments(o)).map((d) => d.id);

  it("defaults to newest first", () => {
    expect(sorted({})).toEqual(["2", "1"]);
    expect(sorted({ ascending: true })).toEqual(["1", "2"]);
  });

  it("sorts titles case-insensitively", () => {
    expect(sorted({ sort: "title", ascending: true })).toEqual(["2", "1"]);
  });

  it("breaks a tied title on createdAt before the id, as the SQL read does", () => {
    // `get_source_document_page` orders title, then created_at, then id.
    // Jumping straight to the id would hand the same query back in the
    // opposite order from the database, which is the drift this file exists
    // to prevent. "Untitled" is a title two Documents really do share.
    const tied = [
      { id: "aa", title: "Untitled", createdAt: "2026-01-02T00:00:00Z" },
      { id: "zz", title: "Untitled", createdAt: "2026-01-01T00:00:00Z" },
    ];
    const order = (o: Parameters<typeof compareSourceDocuments>[0]) =>
      [...tied].sort(compareSourceDocuments(o)).map((d) => d.id);
    expect(order({ sort: "title", ascending: true })).toEqual(["zz", "aa"]);
    expect(order({ sort: "title" })).toEqual(["aa", "zz"]);
  });

  it("falls through to the id when createdAt ties too", () => {
    const same = [
      { id: "b", title: "Untitled", createdAt: "2026-01-01T00:00:00Z" },
      { id: "a", title: "Untitled", createdAt: "2026-01-01T00:00:00Z" },
    ];
    const order = (o: Parameters<typeof compareSourceDocuments>[0]) =>
      [...same].sort(compareSourceDocuments(o)).map((d) => d.id);
    expect(order({ sort: "title", ascending: true })).toEqual(["a", "b"]);
    expect(order({ sort: "title" })).toEqual(["b", "a"]);
  });
});
