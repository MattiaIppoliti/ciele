import { describe, expect, it } from "vitest";
import { createTurnSession } from "./session";

/**
 * The Turn Session seam: persistent cross-turn state with change tracking —
 * turn.ts only writes the state back when `dirty` flipped, so the contract
 * that reads stay clean and writes mark dirty is what these tests pin. The
 * interface is deliberately memory-only (remember/memory/snapshot/dirty); a
 * generic key/value bag returns only when a second tool needs it.
 */

describe("createTurnSession", () => {
  it("reads without marking dirty", () => {
    const session = createTurnSession("c1", { memory: ["fact"] });
    expect(session.memory()).toEqual(["fact"]);
    expect(session.dirty).toBe(false);
  });

  it("carries non-memory stored state through the snapshot untouched", () => {
    const session = createTurnSession("c1", { legacyKey: "kept" });
    session.remember("new fact");
    expect(session.snapshot()).toEqual({
      legacyKey: "kept",
      memory: ["new fact"],
    });
  });

  it("does not mutate the initial state object", () => {
    const initial: Record<string, unknown> = {};
    const session = createTurnSession("c1", initial);
    session.remember("v");
    expect(initial).toEqual({});
  });

  it("remember appends, dedupes, trims and caps", () => {
    const session = createTurnSession("c1", {});
    session.remember("  Enrolled in Marketing (A)  ");
    session.remember("Enrolled in Marketing (A)");
    session.remember("   ");
    expect(session.memory()).toEqual(["Enrolled in Marketing (A)"]);
    expect(session.dirty).toBe(true);

    for (let i = 0; i < 30; i++) session.remember(`fact ${i}`);
    expect(session.memory()).toHaveLength(20);
    expect(session.memory().at(-1)).toBe("fact 29");
  });

  it("tolerates a corrupt memory value in stored state", () => {
    const session = createTurnSession("c1", { memory: "not-an-array" });
    expect(session.memory()).toEqual([]);
    session.remember("clean fact");
    expect(session.memory()).toEqual(["clean fact"]);
  });
});
