import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sweepOrphanedKnowledgeOriginals } from "./knowledge-orphans";

type Entry = { name: string; id: string | null; created_at?: string };

/** A bucket and a sources table, the two things the sweep compares. */
function fakeClient(objects: Record<string, Entry[]>, referenced: string[]) {
  const removed: string[] = [];
  const bucket = {
    async list(path: string, opts: { limit: number; offset?: number }) {
      const all = objects[path] ?? [];
      const offset = opts.offset ?? 0;
      return { data: all.slice(offset, offset + opts.limit), error: null };
    },
    async remove(paths: string[]) {
      removed.push(...paths);
      return { data: [], error: null };
    },
  };
  const sources = (like: string) => ({
    range: async () => ({
      data: referenced
        .filter((path) => path.startsWith(like.replace(/%$/, "")))
        .map((original_object_path) => ({ original_object_path })),
      error: null,
    }),
  });
  const client = {
    storage: { from: () => bucket },
    from: () => ({
      select: () => ({ like: (_column: string, pattern: string) => sources(pattern) }),
    }),
  } as unknown as SupabaseClient;
  return { client, removed };
}

const old = "2026-09-01T00:00:00.000Z";
const now = new Date("2026-09-27T12:00:00.000Z");

describe("sweepOrphanedKnowledgeOriginals", () => {
  it("removes files no Source names, including a deleted Organization's", async () => {
    const { client, removed } = fakeClient(
      {
        org: [
          { name: "live-org", id: null },
          { name: "gone-org", id: null },
        ],
        "org/live-org/knowledge": [
          { name: "kept.pdf", id: "1", created_at: old },
          { name: "orphan.pdf", id: "2", created_at: old },
        ],
        "org/gone-org/knowledge": [{ name: "left-behind.docx", id: "3", created_at: old }],
      },
      ["org/live-org/knowledge/kept.pdf"]
    );
    const report = await sweepOrphanedKnowledgeOriginals(client, { now });
    expect(removed.sort()).toEqual([
      "org/gone-org/knowledge/left-behind.docx",
      "org/live-org/knowledge/orphan.pdf",
    ]);
    expect(report).toEqual({ knowledgeOrphansScannedOrgs: 2, knowledgeOrphansRemoved: 2 });
  });

  it("never touches an upload younger than the grace window", async () => {
    const { client, removed } = fakeClient(
      {
        org: [{ name: "live-org", id: null }],
        "org/live-org/knowledge": [
          { name: "in-flight.pdf", id: "1", created_at: "2026-09-27T11:59:00.000Z" },
        ],
      },
      []
    );
    await sweepOrphanedKnowledgeOriginals(client, { now });
    expect(removed).toEqual([]);
  });

  it("stops at the removal cap and leaves the rest for the next tick", async () => {
    const files = Array.from({ length: 5 }, (_, i) => ({
      name: `f${i}.pdf`,
      id: String(i),
      created_at: old,
    }));
    const { client, removed } = fakeClient(
      { org: [{ name: "o", id: null }], "org/o/knowledge": files },
      []
    );
    const report = await sweepOrphanedKnowledgeOriginals(client, { now, maxRemovals: 3 });
    expect(removed).toHaveLength(3);
    expect(report.knowledgeOrphansRemoved).toBe(3);
  });
});
