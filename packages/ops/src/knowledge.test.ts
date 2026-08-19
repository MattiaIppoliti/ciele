import { describe, expect, it } from "vitest";
import type { Role } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { createAssistantOp } from "./assistants";
import {
  addSourceOp,
  createFaqOp,
  deleteSourceOp,
  getOrgFaqOp,
  listSourceConceptsOp,
  setDirectAccessOp,
  setSourceLinksOp,
  unlinkSourceOp,
  updateOrgFaqOp,
} from "./knowledge";
import { OperationError, type OperationContext } from "./operation";

/**
 * Knowledge-hub operations (PRD #726) over the in-memory Db, external
 * behavior only. Capability declarations are pinned; enforcement is the
 * calling surface's job.
 */

const ctx = (over: Partial<OperationContext> = {}): OperationContext => ({
  organizationId: DEMO_ORG.id,
  userId: DEMO_MEMBER.userId,
  role: "editor" as Role,
  db: getMockDb(),
  // A faithful persistFaq stub: Source-backed FAQs, like the web port.
  ports: {
    persistFaq: async (args) => {
      const db = getMockDb();
      const source = await db.createSource({
        collectionId: args.collectionId,
        name: args.question.slice(0, 500),
        kind: "faq",
      });
      const concept = await db.createConcept({
        collectionId: args.collectionId,
        sourceId: source.id,
        path: `faq/test${args.pathSuffix ?? ""}.md`,
        frontmatter: { type: "FAQ", title: args.question, ...args.provenance },
        body: args.answer,
      });
      return concept;
    },
  },
  ...over,
});

const foreignCtx = () => ctx({ organizationId: "some-other-org" });

const newAssistant = (title: string) =>
  createAssistantOp.run(ctx(), { title, description: "" });

async function newOwnedSource() {
  const db = getMockDb();
  const assistant = await newAssistant("Hub Ops Owner");
  const collection = await db.createCollection(assistant.id, {
    name: "Hub Ops Collection",
  });
  const source = await db.createSource({
    collectionId: collection.id,
    name: "Hub Ops Source",
    kind: "file",
  });
  return { db, assistant, collection, source };
}

describe("knowledge hub operations (PRD #726)", () => {
  it("declares the catalogue contract", () => {
    expect(setSourceLinksOp.capability).toBe("edit");
    expect(
      setSourceLinksOp.entities({ sourceId: "s", assistantIds: [] }, undefined as never)
    ).toEqual([{ kind: "knowledgeHub" }]);
    // Deleting an unlinked Source declares no assistant-editor entity, only
    // the hub; every linked assistant's editor is declared when links exist.
    expect(deleteSourceOp.entities({ id: "s" }, { assistantIds: [] })).toEqual([
      { kind: "knowledgeHub" },
    ]);
    expect(
      deleteSourceOp.entities({ id: "s" }, { assistantIds: ["a1", "a2"] })
    ).toEqual([
      { kind: "assistantEditor", assistantId: "a1" },
      { kind: "assistantEditor", assistantId: "a2" },
      { kind: "knowledgeHub" },
    ]);
  });

  it("replaces the linked-assistant set and reports it back", async () => {
    const { assistant, source } = await newOwnedSource();
    const second = await newAssistant("Hub Ops Second");

    const links = await setSourceLinksOp.run(ctx(), {
      sourceId: source.id,
      assistantIds: [assistant.id, second.id, second.id],
    });
    expect(links.map((l) => l.assistantId).sort()).toEqual(
      [assistant.id, second.id].sort()
    );

    const narrowed = await setSourceLinksOp.run(ctx(), {
      sourceId: source.id,
      assistantIds: [second.id],
    });
    expect(narrowed.map((l) => l.assistantId)).toEqual([second.id]);
  });

  it("denies linking across organizations, on either side", async () => {
    const { assistant, source } = await newOwnedSource();
    // Foreign caller cannot touch the source at all.
    await expect(
      setSourceLinksOp.run(foreignCtx(), {
        sourceId: source.id,
        assistantIds: [],
      })
    ).rejects.toThrowError(OperationError);
    // The caller cannot link an assistant they do not own.
    await expect(
      setSourceLinksOp.run(ctx(), {
        sourceId: source.id,
        assistantIds: [assistant.id, "as-foreign"],
      })
    ).rejects.toThrowError(OperationError);
  });

  it("adds into the org Library only with an explicit assistant set", async () => {
    const db = getMockDb();
    const library = await db.getOrCreateOrgLibraryCollection(DEMO_ORG.id);
    await expect(
      addSourceOp.run(ctx(), {
        collectionId: library.id,
        name: "Org Text",
        kind: "text",
        rawText: "hello",
      })
    ).rejects.toThrowError(/at least one assistant/i);

    const assistant = await newAssistant("Hub Ops Library");
    const { source, assistantId } = await addSourceOp.run(ctx(), {
      collectionId: library.id,
      name: "Org Text",
      kind: "text",
      rawText: "hello",
      assistantIds: [assistant.id],
    });
    expect(assistantId).toBe(assistant.id);
    const links = await db.listSourceAssistantLinks(source.id);
    expect(links.map((l) => l.assistantId)).toEqual([assistant.id]);
  });

  it("refuses the org Library to a foreign organization", async () => {
    const db = getMockDb();
    const library = await db.getOrCreateOrgLibraryCollection(DEMO_ORG.id);
    await expect(
      addSourceOp.run(foreignCtx(), {
        collectionId: library.id,
        name: "X",
        kind: "text",
        rawText: "x",
        assistantIds: ["whatever"],
      })
    ).rejects.toThrowError(OperationError);
  });

  it("guards direct access: file kind + retained original only", async () => {
    const db = getMockDb();
    const assistant = await newAssistant("Hub Ops Access");
    const collection = await db.createCollection(assistant.id, {
      name: "Access Collection",
    });
    const noOriginal = await db.createSource({
      collectionId: collection.id,
      name: "No Original",
      kind: "file",
    });
    await expect(
      setDirectAccessOp.run(ctx(), {
        sourceId: noOriginal.id,
        assistantId: assistant.id,
        directAccess: true,
      })
    ).rejects.toThrowError(/no stored original/i);

    const site = await db.createSource({
      collectionId: collection.id,
      name: "A Site",
      kind: "website",
      config: { url: "https://x.example" },
    });
    await expect(
      setDirectAccessOp.run(ctx(), {
        sourceId: site.id,
        assistantId: assistant.id,
        directAccess: true,
      })
    ).rejects.toThrowError(/file Sources only/i);

    const file = await db.createSource({
      collectionId: collection.id,
      name: "Real File",
      kind: "file",
      originalObjectPath: "org/x/real.pdf",
    });
    // The flag lives on the link row, so the link must exist first.
    await db.setSourceAssistantLinks(file.id, [assistant.id]);
    const links = await setDirectAccessOp.run(ctx(), {
      sourceId: file.id,
      assistantId: assistant.id,
      directAccess: true,
    });
    expect(links.find((l) => l.assistantId === assistant.id)?.directAccess).toBe(
      true
    );
  });

  it("lists a Source's Concepts, hiding excluded ones (view-source page)", async () => {
    const { db, collection, source } = await newOwnedSource();
    const kept = await db.createConcept({
      collectionId: collection.id,
      sourceId: source.id,
      path: "notes/kept.md",
      frontmatter: {
        type: "Note",
        title: "Kept",
        resource: "https://x.example/kept",
      },
      body: "kept",
    });
    const hidden = await db.createConcept({
      collectionId: collection.id,
      sourceId: source.id,
      path: "notes/hidden.md",
      frontmatter: { type: "Note", title: "Hidden" },
      body: "hidden",
    });
    await db.setConceptExcluded(hidden.id, true);

    const { items } = await listSourceConceptsOp.run(ctx(), {
      sourceId: source.id,
    });
    expect(items).toEqual([
      {
        id: kept.id,
        title: "Kept",
        path: "notes/kept.md",
        resourceUrl: "https://x.example/kept",
      },
    ]);
    await expect(
      listSourceConceptsOp.run(foreignCtx(), { sourceId: source.id })
    ).rejects.toThrowError(OperationError);
  });

  it("reads and edits a hub FAQ through its Source, re-embedding via the port", async () => {
    const db = getMockDb();
    const library = await db.getOrCreateOrgLibraryCollection(DEMO_ORG.id);
    const assistant = await newAssistant("Hub Ops FAQ Edit");
    const { concept } = await createFaqOp.run(ctx(), {
      collectionId: library.id,
      question: "Old question?",
      answer: "Old answer.",
      assistantIds: [assistant.id],
    });
    const sourceId = concept.sourceId!;

    expect(await getOrgFaqOp.run(ctx(), { sourceId })).toEqual({
      question: "Old question?",
      answer: "Old answer.",
    });

    const reembedded: unknown[] = [];
    const updated = await updateOrgFaqOp.run(
      ctx({
        ports: {
          reembedConcept: async (args) => {
            reembedded.push(args);
          },
        },
      }),
      { sourceId, question: "  New question?  ", answer: "New answer." }
    );
    expect(updated.body).toBe("New answer.");
    expect(updated.frontmatter.title).toBe("New question?");
    expect((await db.getSource(sourceId))?.name).toBe("New question?");
    expect(reembedded).toEqual([
      {
        assistantId: assistant.id,
        collectionId: library.id,
        conceptId: concept.id,
        title: "New question?",
        body: "New answer.",
      },
    ]);
    // The edit re-stamps authorship: an edited FAQ is generated by its editor.
    expect(updated.frontmatter.generated?.by).toContain("human:");
  });

  it("refuses a FAQ edit on a non-FAQ Source and on foreign orgs", async () => {
    const { source } = await newOwnedSource();
    await expect(
      updateOrgFaqOp.run(ctx(), {
        sourceId: source.id,
        question: "Q",
        answer: "A",
      })
    ).rejects.toThrowError(/not a faq/i);
    await expect(
      getOrgFaqOp.run(foreignCtx(), { sourceId: source.id })
    ).rejects.toThrowError(OperationError);
  });

  it("unlinks one assistant and leaves the Source and the other links alone", async () => {
    const { db, assistant, source } = await newOwnedSource();
    const second = await newAssistant("Unlink Sibling");
    await setSourceLinksOp.run(ctx(), {
      sourceId: source.id,
      assistantIds: [assistant.id, second.id],
    });
    await db.setSourceDirectAccess(source.id, second.id, true);

    const result = await unlinkSourceOp.run(ctx(), {
      assistantId: assistant.id,
      sourceId: source.id,
    });
    // Both editors are revalidated: the one that lost the Source and the one
    // whose "shared with" list just changed.
    expect(result.assistantIds.sort()).toEqual([assistant.id, second.id].sort());
    expect(result.remaining).toBe(1);

    const links = await db.listSourceAssistantLinks(source.id);
    expect(links.map((l) => l.assistantId)).toEqual([second.id]);
    // The sibling's Direct access survived the rewrite.
    expect(links[0].directAccess).toBe(true);
    // The Source itself is untouched: this is removal, not deletion.
    expect(await db.getSource(source.id)).not.toBeNull();
  });

  it("is a no-op when the assistant was not linked, and refuses cross-org", async () => {
    const { db, source } = await newOwnedSource();
    const other = await newAssistant("Never Linked");
    await setSourceLinksOp.run(ctx(), {
      sourceId: source.id,
      assistantIds: [],
    });

    const result = await unlinkSourceOp.run(ctx(), {
      assistantId: other.id,
      sourceId: source.id,
    });
    expect(result.remaining).toBe(0);
    expect(await db.listSourceAssistantLinks(source.id)).toEqual([]);

    await expect(
      unlinkSourceOp.run(foreignCtx(), {
        assistantId: other.id,
        sourceId: source.id,
      })
    ).rejects.toThrowError(OperationError);
  });

  it("creates an org FAQ as a linked, Source-backed Concept", async () => {
    const db = getMockDb();
    const library = await db.getOrCreateOrgLibraryCollection(DEMO_ORG.id);
    const assistant = await newAssistant("Hub Ops FAQ");
    const { concept } = await createFaqOp.run(ctx(), {
      collectionId: library.id,
      question: "What is the hub?",
      answer: "The org-wide knowledge page.",
      assistantIds: [assistant.id],
    });
    expect(concept.sourceId).toBeTruthy();
    const links = await db.listSourceAssistantLinks(concept.sourceId!);
    expect(links.map((l) => l.assistantId)).toEqual([assistant.id]);
  });
});
