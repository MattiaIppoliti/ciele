import { describe, expect, it } from "vitest";
import type { MemoryDocumentEntry } from "./types";
import {
  MEMORY_DOCUMENT_MAX_CHARS,
  appendAgentLearning,
  capMemoryDocument,
  memoryDocumentChanges,
  memoryDocumentOwner,
  memoryDocumentScope,
  memoryPromptSections,
  projectInjects,
} from "./memory-documents";

/**
 * The three memory layers (#771). Pure: no database, no clock, no runtime.
 *
 * The cases that matter are the absences and the edges. An empty layer must
 * inject nothing at all, an archived Project must stop injecting, and a
 * document at the cap must not hand the model half a sentence it will read as
 * whole.
 */

describe("scope and owner", () => {
  it("reads the layer off whichever owner column is set", () => {
    const row = { memberId: null, teammateId: null, projectId: null };
    expect(memoryDocumentScope({ ...row, memberId: "u-1" })).toBe("user");
    expect(memoryDocumentScope({ ...row, teammateId: "tm-1" })).toBe("agent");
    expect(memoryDocumentScope({ ...row, projectId: "p-1" })).toBe("project");
  });

  it("round-trips the owner back to the argument reads take", () => {
    expect(
      memoryDocumentOwner({ memberId: "u-1", teammateId: null, projectId: null })
    ).toEqual({ scope: "user", memberId: "u-1" });
    expect(
      memoryDocumentOwner({ memberId: null, teammateId: "tm-1", projectId: null })
    ).toEqual({ scope: "agent", teammateId: "tm-1" });
  });
});

describe("capMemoryDocument", () => {
  it("leaves a document under the cap exactly as it is", () => {
    expect(capMemoryDocument("short")).toBe("short");
  });

  it("cuts on a line boundary when one is near the end", () => {
    // A decision cut in half reads as a whole decision, which is worse than
    // one decision fewer.
    const body = `${"a".repeat(90)}\n${"b".repeat(20)}`;
    expect(capMemoryDocument(body, 100)).toBe("a".repeat(90));
  });

  it("falls back to a hard cut when one line is longer than the cap", () => {
    expect(capMemoryDocument("x".repeat(200), 100)).toHaveLength(100);
  });
});

describe("memoryPromptSections", () => {
  it("injects nothing when every layer is empty", () => {
    // Not an empty heading: "# What you have learned" with nothing under it
    // invites the model to explain that it has learned nothing.
    expect(memoryPromptSections({})).toEqual([]);
    expect(
      memoryPromptSections({ user: "  ", agent: null, project: "" })
    ).toEqual([]);
  });

  it("injects only the layers that have something in them", () => {
    const sections = memoryPromptSections({ user: "Prefers short answers." });
    expect(sections).toHaveLength(1);
    expect(sections[0]).toContain("Prefers short answers.");
    expect(sections[0]).toContain("colleague you are talking to");
  });

  it("names the Project so the model can say what it is citing", () => {
    const [section] = memoryPromptSections({
      project: "We ship on Thursdays.",
      projectName: "Atlas",
    });
    expect(section).toContain("Atlas");
    expect(section).toContain("We ship on Thursdays.");
  });

  it("orders the layers so decisions outrank the agent's own notes", () => {
    const sections = memoryPromptSections({
      user: "u",
      agent: "a",
      project: "p",
    });
    expect(sections).toHaveLength(3);
    // The Agent layer is told in words that it is the weakest of the three;
    // a note the Teammate made to itself must not beat a settled decision.
    expect(sections[1]).toContain("weaker than anything below");
    expect(sections[2]).toContain("settled");
  });

  it("caps each layer independently", () => {
    const [section] = memoryPromptSections({ user: "x".repeat(10_000) });
    expect(section.length).toBeLessThan(MEMORY_DOCUMENT_MAX_CHARS + 400);
  });
});

describe("projectInjects", () => {
  it("stops at the archive flag", () => {
    expect(projectInjects({ archived: false })).toBe(true);
    expect(projectInjects({ archived: true })).toBe(false);
    expect(projectInjects(null)).toBe(false);
    expect(projectInjects(undefined)).toBe(false);
  });
});

describe("appendAgentLearning", () => {
  it("appends a dated line to an empty layer", () => {
    expect(
      appendAgentLearning("", "Marta prefers bullet points", "2026-08-23T10:00:00Z")
    ).toBe("- 2026-08-23: Marta prefers bullet points");
  });

  it("keeps earlier learnings above the new one", () => {
    const body = appendAgentLearning(
      "- 2026-08-01: An older note",
      "A newer one",
      "2026-08-23T10:00:00Z"
    );
    expect(body.split("\n")).toEqual([
      "- 2026-08-01: An older note",
      "- 2026-08-23: A newer one",
    ]);
  });

  it("drops the oldest learnings when the layer is full", () => {
    // Front-capped on purpose: a note from March that no longer holds is
    // exactly the one to lose.
    const old = Array.from({ length: 20 }, (_, i) => `- 2026-01-01: note ${i}`);
    const body = appendAgentLearning(
      old.join("\n"),
      "the newest thing",
      "2026-08-23T10:00:00Z",
      120
    );
    expect(body.length).toBeLessThanOrEqual(120);
    expect(body).toContain("the newest thing");
    expect(body).not.toContain("note 0");
  });

  it("never leaves half a learning behind", () => {
    const body = appendAgentLearning(
      "- 2026-01-01: a".repeat(1),
      "b".repeat(50),
      "2026-08-23T10:00:00Z",
      80
    );
    for (const line of body.split("\n")) {
      expect(line.startsWith("- ")).toBe(true);
    }
  });
});

describe("memoryDocumentChanges", () => {
  const entry = (
    id: string,
    bodyBefore: string,
    createdAt: string
  ): MemoryDocumentEntry => ({
    id,
    organizationId: "org-1",
    documentId: "doc-1",
    teammateId: null,
    authorId: "u-1",
    note: `wrote ${id}`,
    bodyBefore,
    createdAt,
  });

  it("pairs each entry with the text the write produced", () => {
    // Newest first, the order both Db implementations return.
    const entries = [
      entry("e3", "two lines\nhere", "2026-08-03T00:00:00.000Z"),
      entry("e2", "one line", "2026-08-02T00:00:00.000Z"),
      entry("e1", "", "2026-08-01T00:00:00.000Z"),
    ];
    const changes = memoryDocumentChanges(entries, "three lines\nhere\nnow");

    // The newest write ended at the document as it now reads.
    expect(changes[0]?.before).toBe("two lines\nhere");
    expect(changes[0]?.after).toBe("three lines\nhere\nnow");
    // Older ones ended where the next-newer one began.
    expect(changes[1]?.before).toBe("one line");
    expect(changes[1]?.after).toBe("two lines\nhere");
    expect(changes[2]?.before).toBe("");
    expect(changes[2]?.after).toBe("one line");
  });

  it("reports the net character change per write", () => {
    const changes = memoryDocumentChanges(
      [entry("e1", "abc", "2026-08-01T00:00:00.000Z")],
      "abcdef"
    );
    expect(changes[0]?.delta).toBe(3);
  });

  it("is empty when nothing has been written", () => {
    expect(memoryDocumentChanges([], "anything")).toEqual([]);
  });
});
