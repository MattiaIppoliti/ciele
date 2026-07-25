import { describe, expect, it, vi } from "vitest";
import { DEMO_ORG, getMockDb } from "./index";
import { IMPROVEMENT_TITLE_MAX, raiseImprovement } from "./improvements";
import type { Db } from "./types";

const db = getMockDb();

describe("raiseImprovement", () => {
  it("creates an Improvement with a trimmed title and null message link", async () => {
    const improvement = await raiseImprovement(db, DEMO_ORG.id, {
      title: "  Needs a better answer  ",
    });
    expect(improvement).not.toBeNull();
    expect(improvement!.title).toBe("Needs a better answer");
    expect(improvement!.status).toBe("to_do");
  });

  it(`clamps titles at ${IMPROVEMENT_TITLE_MAX} characters`, async () => {
    const improvement = await raiseImprovement(db, DEMO_ORG.id, {
      title: "x".repeat(500),
    });
    expect(improvement!.title).toHaveLength(IMPROVEMENT_TITLE_MAX);
  });

  it("rejects an empty title", async () => {
    await expect(
      raiseImprovement(db, DEMO_ORG.id, { title: "   " })
    ).rejects.toThrow("Title is required");
  });

  it("propagates tracker failures by default", async () => {
    const failing = {
      createImprovement: async () => {
        throw new Error("tracker down");
      },
    } as unknown as Db;
    await expect(
      raiseImprovement(failing, DEMO_ORG.id, { title: "Boom" })
    ).rejects.toThrow("tracker down");
  });

  it("swallows tracker failures for background callers", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = {
      createImprovement: async () => {
        throw new Error("tracker down");
      },
    } as unknown as Db;
    await expect(
      raiseImprovement(
        failing,
        DEMO_ORG.id,
        { title: "Boom" },
        { swallowErrors: true }
      )
    ).resolves.toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
