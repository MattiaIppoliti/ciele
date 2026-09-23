import { describe, expect, it } from "vitest";
import type { KnowledgeMemory } from "@agent-hub/core";
import {
  forgettableIds,
  liveMemoryCount,
  memoryActorLabel,
  memoryStateLabel,
  visibleMemories,
} from "./document-memories";

const memory = (over: Partial<KnowledgeMemory>): KnowledgeMemory => ({
  id: "m1",
  organizationId: "org",
  collectionId: "col",
  sourceId: "src",
  documentPath: "handbook/leave.md",
  conceptId: "doc",
  text: "Leave expires at the end of March.",
  quote: "Unused leave expires on 31 March.",
  chunkId: null,
  generatedBy: "knowledge-memory-extractor/1",
  generatedAt: "2026-09-01T00:00:00.000Z",
  forgottenAt: null,
  forgetReason: null,
  forgottenBy: null,
  sourceCount: 1,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...over,
});

describe("visibleMemories", () => {
  const live = memory({ id: "live", updatedAt: "2026-09-02T00:00:00.000Z" });
  const forgotten = memory({
    id: "forgotten",
    updatedAt: "2026-09-03T00:00:00.000Z",
    forgottenAt: "2026-09-03T00:00:00.000Z",
  });

  it("hides forgotten rows until they are asked for", () => {
    expect(visibleMemories([live, forgotten], false).map((m) => m.id)).toEqual([
      "live",
    ]);
    expect(visibleMemories([live, forgotten], true).map((m) => m.id)).toEqual([
      "forgotten",
      "live",
    ]);
  });

  it("sorts by Updated, newest first", () => {
    const older = memory({ id: "older", updatedAt: "2026-08-01T00:00:00.000Z" });
    expect(visibleMemories([older, live], false).map((m) => m.id)).toEqual([
      "live",
      "older",
    ]);
  });
});

describe("liveMemoryCount", () => {
  it("counts only what is live", () => {
    expect(
      liveMemoryCount([
        memory({ id: "a" }),
        memory({ id: "b", forgottenAt: "2026-09-03T00:00:00.000Z" }),
      ])
    ).toBe(1);
    expect(liveMemoryCount([])).toBe(0);
  });
});

describe("memoryActorLabel", () => {
  it("says who wrote the sentence, not which version it is", () => {
    expect(memoryActorLabel("knowledge-memory-extractor/claude-haiku-4-5")).toBe(
      "Extracted"
    );
    expect(memoryActorLabel("process:knowledge-memory-extraction")).toBe(
      "Extracted"
    );
    expect(memoryActorLabel("human:u-1")).toBe("Written by a person");
    // An unknown producer is named rather than guessed at.
    expect(memoryActorLabel("some-tool/2")).toBe("some-tool");
  });
});

describe("memoryStateLabel", () => {
  it("leaves the live rows quiet", () => {
    expect(memoryStateLabel({ forgottenAt: null })).toBe("—");
    expect(memoryStateLabel({ forgottenAt: "2026-09-03T00:00:00.000Z" })).toBe(
      "Forgotten"
    );
  });
});

describe("forgettableIds", () => {
  it("is the live half of a selection", () => {
    const rows = [
      memory({ id: "live" }),
      memory({ id: "already", forgottenAt: "2026-09-03T00:00:00.000Z" }),
      memory({ id: "unselected" }),
    ];
    expect(forgettableIds(rows, new Set(["live", "already"]))).toEqual(["live"]);
    expect(forgettableIds(rows, new Set())).toEqual([]);
  });
});
