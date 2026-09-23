import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * The demo memories in `seed.sql` (#926), checked against the chain they load
 * over rather than by reading them.
 *
 * The quote assertion is the one that matters. A memory's quote is the span a
 * Member checks it against, so a seeded quote that paraphrases its Document
 * would teach the wrong shape to every screenshot, every demo and the tab that
 * renders them (#932). The CI migrations gate proves the seed applies; this
 * proves it still says something true.
 */
describe("seeded knowledge memories", () => {
  it("quotes its Document verbatim, and carries one forgotten row", async () => {
    const pg = await createSchemaLoadedPglite();
    await pg.exec(readFileSync("../../supabase/seed.sql", "utf8"));

    const document = await pg.query(
      `select body from public.concepts where id = 'demo-leave-policy'`
    );
    const body = (document.rows[0] as { body: string }).body;

    const memories = (
      await pg.query(
        `select id, quote, forgotten_at, forget_reason
         from public.knowledge_memories
         where document_path = 'handbook/leave.md'
         order by id`
      )
    ).rows as Array<{
      id: string;
      quote: string;
      forgotten_at: string | null;
      forget_reason: string | null;
    }>;

    expect(memories.length).toBeGreaterThanOrEqual(3);
    for (const memory of memories) expect(body).toContain(memory.quote);

    // One forgotten row, so the tab's second state renders without a click,
    // and it keeps both its evidence and its reason: that is what makes a
    // forget something a Member can undo.
    const forgotten = memories.filter((memory) => memory.forgotten_at !== null);
    expect(forgotten).toHaveLength(1);
    expect(forgotten[0]!.forget_reason).toBeTruthy();
    expect(body).toContain(forgotten[0]!.quote);
  }, 120_000);
});
