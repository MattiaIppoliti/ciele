import { describe, expect, it } from "vitest";
import type { Concept, Role, Source } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { createAssistantOp } from "./assistants";
import {
  addOrgSourceOp,
  addSourceOp,
  createFaqOp,
  deleteSourceOp,
  extractSourceMemoriesOp,
  forgetKnowledgeMemoryOp,
  getOrgFaqOp,
  getDocumentSummaryOp,
  getSourceDocumentOp,
  setDocumentExcludedOp,
  setDocumentsExcludedOp,
  deleteSourcesOp,
  unlinkSourcesOp,
  listDocumentChunksOp,
  listDocumentMemoriesOp,
  restoreKnowledgeMemoryOp,
  listSourceDocumentsOp,
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

  it("adds to the Library without being told a Collection", async () => {
    const db = getMockDb();
    const assistant = await newAssistant("Library Door");
    // The gap this closes: a fresh Assistant derives no Collections, so a
    // caller holding only its id had no add path at all.
    expect(await db.listCollections(assistant.id)).toEqual([]);

    const { source, assistantId } = await addOrgSourceOp.run(ctx(), {
      name: "Org Text",
      kind: "text",
      rawText: "hello",
      assistantIds: [assistant.id],
    });

    expect(assistantId).toBe(assistant.id);
    const library = await db.getOrCreateOrgLibraryCollection(DEMO_ORG.id);
    expect(source.collectionId).toBe(library.id);
    const links = await db.listSourceAssistantLinks(source.id);
    expect(links.map((l) => l.assistantId)).toEqual([assistant.id]);
    // The Collection list is derived, so it answers once something is linked.
    expect((await db.listCollections(assistant.id)).map((c) => c.id)).toEqual([
      library.id,
    ]);
  });

  it("refuses an org-level add that names no assistant", async () => {
    // The Library has no owner to fall back on, so this is refused by the
    // schema rather than after a round trip.
    expect(
      addOrgSourceOp.input.safeParse({
        name: "Org Text",
        kind: "text",
        rawText: "hello",
        assistantIds: [],
      }).success
    ).toBe(false);
  });

  it("declares the org-level add's contract", async () => {
    expect(addOrgSourceOp.capability).toBe("edit");
    const assistant = await newAssistant("Library Contract");
    const { source } = await addOrgSourceOp.run(ctx(), {
      name: "Org Text",
      kind: "text",
      rawText: "hello",
      assistantIds: [assistant.id],
    });
    // Same revalidation as the collection-scoped add: the editor and the hub.
    expect(
      addOrgSourceOp.entities(
        { name: "", kind: "text", rawText: "", assistantIds: [] },
        { source, assistantId: assistant.id }
      )
    ).toEqual([
      { kind: "assistantEditor", assistantId: assistant.id },
      { kind: "knowledgeHub" },
    ]);
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

  it("pages a Source's Documents, excluded ones included with their status", async () => {
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

    // The route lists an excluded Document and says so in the Status column;
    // the dialog this replaced hid it, which is how a page could be missing
    // from the list and out of retrieval with nowhere to see why.
    const page = await listSourceDocumentsOp.run(ctx(), { sourceId: source.id });
    expect(page.total).toBe(2);
    expect(page.pageSize).toBe(50);
    expect(page.source.id).toBe(source.id);
    const byId = new Map(page.items.map((row) => [row.id, row]));
    expect(byId.get(kept.id)).toMatchObject({
      title: "Kept",
      path: "notes/kept.md",
      resourceUrl: "https://x.example/kept",
      excluded: false,
    });
    expect(byId.get(hidden.id)?.excluded).toBe(true);

    await expect(
      listSourceDocumentsOp.run(foreignCtx(), { sourceId: source.id })
    ).rejects.toThrowError(OperationError);
  });

  it("pages server-side, one page at a time, with the whole count", async () => {
    const { db, collection, source } = await newOwnedSource();
    for (const n of [1, 2, 3]) {
      await db.createConcept({
        collectionId: collection.id,
        sourceId: source.id,
        path: `notes/${n}.md`,
        frontmatter: { type: "Note", title: `Note ${n}` },
        body: `note ${n}`,
      });
    }
    const first = await listSourceDocumentsOp.run(ctx(), {
      sourceId: source.id,
      pageSize: 2,
    });
    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(3);
    expect(first.page).toBe(1);

    const second = await listSourceDocumentsOp.run(ctx(), {
      sourceId: source.id,
      pageSize: 2,
      page: 2,
    });
    expect(second.items).toHaveLength(1);
    expect(second.total).toBe(3);
    // No row appears on two pages, which is what the id tie-break buys.
    const ids = [...first.items, ...second.items].map((row) => row.id);
    expect(new Set(ids).size).toBe(3);

    // Past the end is empty, not an error: a stale bookmark should render an
    // empty table under an honest count, not a 500.
    const past = await listSourceDocumentsOp.run(ctx(), {
      sourceId: source.id,
      pageSize: 2,
      page: 9,
    });
    expect(past.items).toEqual([]);
    expect(past.total).toBe(3);
  });

  it("scopes to an Assistant's Knowledge, where an unlinked Source is not found", async () => {
    const { db, collection, source } = await newOwnedSource();
    await db.createConcept({
      collectionId: collection.id,
      sourceId: source.id,
      path: "notes/one.md",
      frontmatter: { type: "Note", title: "One" },
      body: "one",
    });
    const linked = await newAssistant("Knowledge Scoped");
    const stranger = await newAssistant("Knowledge Unlinked");
    await db.setSourceAssistantLinks(source.id, [linked.id]);

    const scoped = await listSourceDocumentsOp.run(ctx(), {
      sourceId: source.id,
      assistantId: linked.id,
    });
    expect(scoped.items).toHaveLength(1);

    await expect(
      listSourceDocumentsOp.run(ctx(), {
        sourceId: source.id,
        assistantId: stranger.id,
      })
    ).rejects.toMatchObject({ code: "not_found" });
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
    // The FAQ renders in the Library and in the Knowledge tab of every
    // Assistant it is linked to, so all of them are what the edit touched.
    expect(
      updateOrgFaqOp.entities({ sourceId, question: "x", answer: "y" }, updated)
    ).toEqual([
      { kind: "knowledgeHub" },
      { kind: "assistantEditor", assistantId: assistant.id },
    ]);
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

describe("knowledge memories (#926)", () => {
  /** A Source with one Document and one remembered sentence. */
  async function newRememberedPage() {
    const { db, collection, source } = await newOwnedSource();
    const concept = await db.createConcept({
      collectionId: collection.id,
      sourceId: source.id,
      path: "handbook/leave.md",
      frontmatter: { type: "Document", title: "Leave" },
      body: "Unused leave expires on 31 March.",
    });
    const memory = await db.table("knowledgeMemories").insert({
      organizationId: DEMO_ORG.id,
      collectionId: collection.id,
      sourceId: source.id,
      documentPath: concept.path,
      conceptId: concept.id,
      text: "Unused leave expires on 31 March.",
      quote: "Unused leave expires on 31 March.",
      generatedBy: "process:knowledge-memory-extraction",
      generatedAt: new Date().toISOString(),
    });
    return { db, collection, source, concept, memory };
  }

  it("declares the catalogue contract", () => {
    expect(listDocumentMemoriesOp.capability).toBe("member");
    // A forget is an editorial decision about the Organization's knowledge,
    // the same rank as editing the Document it was read from.
    expect(forgetKnowledgeMemoryOp.capability).toBe("edit");
    expect(restoreKnowledgeMemoryOp.capability).toBe("edit");
    expect(listDocumentMemoriesOp.entities(
      { sourceId: "s", documentPath: "p" },
      []
    )).toEqual([]);
    expect(
      forgetKnowledgeMemoryOp.entities({ id: "m" }, undefined as never)
    ).toEqual([{ kind: "knowledgeHub" }]);
  });

  it("lists live memories, and forgotten ones only when asked", async () => {
    const { source, concept, memory } = await newRememberedPage();

    const forgotten = await forgetKnowledgeMemoryOp.run(ctx(), {
      id: memory.id,
      reason: "Contradicted by the 2026 policy",
    });
    expect(forgotten.forgottenAt).not.toBeNull();
    expect(forgotten.forgetReason).toBe("Contradicted by the 2026 policy");
    expect(forgotten.forgottenBy).toBe(DEMO_MEMBER.userId);
    // The text and its evidence survive: a forget hides, it does not erase.
    expect(forgotten.text).toBe("Unused leave expires on 31 March.");
    expect(forgotten.quote).toBe("Unused leave expires on 31 March.");

    const live = await listDocumentMemoriesOp.run(ctx(), {
      sourceId: source.id,
      documentPath: concept.path,
    });
    expect(live).toEqual([]);

    const all = await listDocumentMemoriesOp.run(ctx(), {
      sourceId: source.id,
      documentPath: concept.path,
      includeForgotten: true,
    });
    expect(all.map((row) => row.id)).toEqual([memory.id]);
  });

  it("keeps the first reason when a memory is forgotten twice", async () => {
    const { memory } = await newRememberedPage();
    const first = await forgetKnowledgeMemoryOp.run(ctx(), {
      id: memory.id,
      reason: "Superseded",
    });
    const second = await forgetKnowledgeMemoryOp.run(ctx(), {
      id: memory.id,
      reason: "Something else entirely",
    });
    expect(second.forgetReason).toBe("Superseded");
    expect(second.forgottenAt).toBe(first.forgottenAt);
  });

  it("restores by clearing the whole state, and is a no-op on a live row", async () => {
    const { source, concept, memory } = await newRememberedPage();
    await forgetKnowledgeMemoryOp.run(ctx(), { id: memory.id, reason: "Wrong" });

    const restored = await restoreKnowledgeMemoryOp.run(ctx(), { id: memory.id });
    expect(restored.forgottenAt).toBeNull();
    expect(restored.forgetReason).toBeNull();
    expect(restored.forgottenBy).toBeNull();
    expect(
      (
        await listDocumentMemoriesOp.run(ctx(), {
          sourceId: source.id,
          documentPath: concept.path,
        })
      ).map((row) => row.id)
    ).toEqual([memory.id]);

    expect((await restoreKnowledgeMemoryOp.run(ctx(), { id: memory.id })).id).toBe(
      memory.id
    );
  });

  it("hides another Organization's memories behind not_found", async () => {
    const { source, concept, memory } = await newRememberedPage();
    await expect(
      listDocumentMemoriesOp.run(foreignCtx(), {
        sourceId: source.id,
        documentPath: concept.path,
      })
    ).rejects.toThrowError(OperationError);
    await expect(
      forgetKnowledgeMemoryOp.run(foreignCtx(), { id: memory.id })
    ).rejects.toThrowError(OperationError);
    await expect(
      restoreKnowledgeMemoryOp.run(ctx(), { id: "no-such-memory" })
    ).rejects.toThrowError(OperationError);
  });
});

describe("one Document (#928)", () => {
  async function newDocument() {
    const { db, collection, source } = await newOwnedSource();
    const document = await db.createConcept({
      collectionId: collection.id,
      sourceId: source.id,
      path: "handbook/leave.md",
      frontmatter: { type: "Document", title: "Leave policy" },
      body: "Unused leave expires on 31 March.",
    });
    return { db, collection, source, document };
  }

  it("reads a Document with the counts its three tabs show", async () => {
    const { db, collection, source, document } = await newDocument();
    await db.saveChunks([
      {
        conceptId: document.id,
        collectionId: collection.id,
        sourceId: source.id,
        content: "Unused leave expires on 31 March.",
        embedding: null,
      },
    ]);
    await db.table("knowledgeMemories").insert({
      organizationId: DEMO_ORG.id,
      collectionId: collection.id,
      sourceId: source.id,
      documentPath: document.path,
      text: "Leave expires at the end of March.",
      quote: "Unused leave expires on 31 March.",
      generatedBy: "process:knowledge-memory-extraction",
      generatedAt: new Date().toISOString(),
    });

    const view = await getSourceDocumentOp.run(ctx(), {
      sourceId: source.id,
      documentId: document.id,
    });
    expect(view.document.body).toBe("Unused leave expires on 31 March.");
    expect(view.source.id).toBe(source.id);
    expect(view.chunkCount).toBe(1);
    // Counted, not assumed: nothing extracts memories yet, so this is zero
    // everywhere the seed has not put one.
    expect(view.memoryCount).toBe(1);
    // Reading a body is a member right, the same as reading the row.
    expect(getSourceDocumentOp.capability).toBe("member");
  });

  it("refuses a Document id that belongs to another Source", async () => {
    const { source } = await newDocument();
    const other = await newDocument();
    await expect(
      getSourceDocumentOp.run(ctx(), {
        sourceId: source.id,
        documentId: other.document.id,
      })
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      getSourceDocumentOp.run(foreignCtx(), {
        sourceId: source.id,
        documentId: source.id,
      })
    ).rejects.toThrowError(OperationError);
  });

  it("drops the chunks on exclude and re-embeds through the port on restore", async () => {
    const { db, collection, source, document } = await newDocument();
    await db.saveChunks([
      {
        conceptId: document.id,
        collectionId: collection.id,
        sourceId: source.id,
        content: "Unused leave expires on 31 March.",
        embedding: null,
      },
    ]);
    const assistant = await newAssistant("Document Exclusion");
    await db.setSourceAssistantLinks(source.id, [assistant.id]);

    const reembedded: string[] = [];
    const editor = ctx({
      ports: { reembedConcept: async (args) => void reembedded.push(args.conceptId) },
    });

    const off = await setDocumentExcludedOp.run(editor, {
      sourceId: source.id,
      documentId: document.id,
      excluded: true,
    });
    expect(off.excluded).toBe(true);
    expect(await db.countConceptChunks(document.id)).toBe(0);
    expect((await db.getConcept(document.id))?.excluded).toBe(true);
    expect(reembedded).toEqual([]);

    const on = await setDocumentExcludedOp.run(editor, {
      sourceId: source.id,
      documentId: document.id,
      excluded: false,
    });
    expect(on.excluded).toBe(false);
    expect((await db.getConcept(document.id))?.excluded).toBe(false);
    // The restore does not write chunks itself: it asks the port, which is the
    // one place an embedding call and its usage attribution live.
    expect(reembedded).toEqual([document.id]);
    expect(on.assistantIds).toEqual([assistant.id]);
    expect(
      setDocumentExcludedOp.entities(
        { sourceId: "s", documentId: "d", excluded: true },
        { excluded: true, assistantIds: ["a1"] }
      )
    ).toEqual([
      { kind: "knowledgeHub" },
      { kind: "assistantEditor", assistantId: "a1" },
    ]);
  });

  it("flips a whole selection in one call, skipping ids from elsewhere", async () => {
    const { db, collection, source } = await newOwnedSource();
    const documents: Concept[] = [];
    for (const path of ["a.md", "b.md", "c.md"]) {
      documents.push(
        await db.createConcept({
          collectionId: collection.id,
          sourceId: source.id,
          path,
          frontmatter: { type: "Document", title: path },
          body: path,
        })
      );
    }
    const assistant = await newAssistant("Bulk Exclusion");
    await db.setSourceAssistantLinks(source.id, [assistant.id]);

    const result = await setDocumentsExcludedOp.run(ctx(), {
      sourceId: source.id,
      // The third id belongs to no Document of this Source: a tick the crawl
      // has since replaced costs the reader nothing.
      documentIds: [documents[0].id, documents[1].id, "not-a-document"],
      excluded: true,
    });
    expect(result.changed).toBe(2);
    expect(result.assistantIds).toEqual([assistant.id]);
    expect((await db.getConcept(documents[0].id))?.excluded).toBe(true);
    expect((await db.getConcept(documents[1].id))?.excluded).toBe(true);
    expect((await db.getConcept(documents[2].id))?.excluded).toBe(false);
  });

  it("clears the flag for an unlinked Source without pretending to index it", async () => {
    const { db, source, document } = await newDocument();
    const reembedded: string[] = [];
    const editor = ctx({
      ports: { reembedConcept: async (args) => void reembedded.push(args.conceptId) },
    });
    await setDocumentExcludedOp.run(editor, {
      sourceId: source.id,
      documentId: document.id,
      excluded: true,
    });
    const on = await setDocumentExcludedOp.run(editor, {
      sourceId: source.id,
      documentId: document.id,
      excluded: false,
    });
    expect(on.assistantIds).toEqual([]);
    expect(reembedded).toEqual([]);
    expect((await db.getConcept(document.id))?.excluded).toBe(false);
  });
});

describe("a Document's chunks (#929)", () => {
  async function newChunkedDocument(count: number) {
    const { db, collection, source } = await newOwnedSource();
    const document = await db.createConcept({
      collectionId: collection.id,
      sourceId: source.id,
      path: "handbook/leave.md",
      frontmatter: { type: "Document", title: "Leave" },
      body: "body",
    });
    await db.saveChunks(
      Array.from({ length: count }, (_, i) => ({
        conceptId: document.id,
        collectionId: collection.id,
        sourceId: source.id,
        content: `slice ${i}`,
        embedding: null,
      }))
    );
    return { db, collection, source, document };
  }

  it("pages a Document's chunks in body order", async () => {
    const { source, document } = await newChunkedDocument(4);
    expect(listDocumentChunksOp.capability).toBe("member");

    const all = await listDocumentChunksOp.run(ctx(), {
      sourceId: source.id,
      documentId: document.id,
    });
    expect(all.total).toBe(4);
    expect(all.pageSize).toBe(50);
    expect(all.items.map((chunk) => chunk.text)).toEqual([
      "slice 0",
      "slice 1",
      "slice 2",
      "slice 3",
    ]);

    const second = await listDocumentChunksOp.run(ctx(), {
      sourceId: source.id,
      documentId: document.id,
      pageSize: 2,
      page: 2,
    });
    expect(second.items.map((chunk) => chunk.index)).toEqual([2, 3]);
  });

  it("walks the same guards as the Document, so a chunk is no way around them", async () => {
    const { db, source, document } = await newChunkedDocument(1);
    await expect(
      listDocumentChunksOp.run(foreignCtx(), {
        sourceId: source.id,
        documentId: document.id,
      })
    ).rejects.toThrowError(OperationError);

    const stranger = await newAssistant("Chunks Unlinked");
    await db.setSourceAssistantLinks(source.id, []);
    await expect(
      listDocumentChunksOp.run(ctx(), {
        sourceId: source.id,
        documentId: document.id,
        assistantId: stranger.id,
      })
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("hands the client text and never an embedding", async () => {
    const { source, document } = await newChunkedDocument(1);
    const { items } = await listDocumentChunksOp.run(ctx(), {
      sourceId: source.id,
      documentId: document.id,
    });
    expect(Object.keys(items[0]!).sort()).toEqual(["id", "index", "text"]);
  });
});

describe("a Document's Summary (#931)", () => {
  async function newDocumentToSummarise() {
    const { db, collection, source } = await newOwnedSource();
    const document = await db.createConcept({
      collectionId: collection.id,
      sourceId: source.id,
      path: "handbook/leave.md",
      frontmatter: { type: "Document", title: "Leave policy" },
      body: "Employees accrue 25 days of paid leave a year.",
    });
    return { db, collection, source, document };
  }

  it("generates once and reads the cache after that", async () => {
    const { db, source, document } = await newDocumentToSummarise();
    let calls = 0;
    const withModel = ctx({
      ports: {
        summariseDocument: async () => {
          calls += 1;
          return { text: "How leave accrues.", by: "document-summariser/fake" };
        },
      },
    });

    const first = await getDocumentSummaryOp.run(withModel, {
      sourceId: source.id,
      documentId: document.id,
    });
    expect(first).toEqual({
      summary: "How leave accrues.",
      generatedBy: "document-summariser/fake",
    });
    expect(calls).toBe(1);
    expect((await db.getConcept(document.id))?.summary).toBe("How leave accrues.");

    // Any later opener, including one whose surface has no model wired at all.
    const second = await getDocumentSummaryOp.run(ctx(), {
      sourceId: source.id,
      documentId: document.id,
    });
    expect(second.summary).toBe("How leave accrues.");
    expect(calls).toBe(1);
  });

  it("answers null with no provider, leaving the card to show an Excerpt", async () => {
    const { db, source, document } = await newDocumentToSummarise();
    // No port at all is the zero-configuration Organization; a port that
    // answers null is a model that could not run. The card cannot tell them
    // apart and does not need to.
    expect(
      await getDocumentSummaryOp.run(ctx(), {
        sourceId: source.id,
        documentId: document.id,
      })
    ).toEqual({ summary: null, generatedBy: null });
    expect(
      await getDocumentSummaryOp.run(
        ctx({ ports: { summariseDocument: async () => null } }),
        { sourceId: source.id, documentId: document.id }
      )
    ).toEqual({ summary: null, generatedBy: null });
    // Nothing was cached, so the next open retries rather than remembering a
    // failure as an answer.
    expect((await db.getConcept(document.id))?.summary).toBeNull();
  });

  it("retries on the next open after a failure, and caches the retry", async () => {
    const { source, document } = await newDocumentToSummarise();
    let attempt = 0;
    const flaky = ctx({
      ports: {
        summariseDocument: async () => {
          attempt += 1;
          return attempt === 1
            ? null
            : { text: "How leave accrues.", by: "document-summariser/fake" };
        },
      },
    });

    expect(
      (
        await getDocumentSummaryOp.run(flaky, {
          sourceId: source.id,
          documentId: document.id,
        })
      ).summary
    ).toBeNull();
    expect(
      (
        await getDocumentSummaryOp.run(flaky, {
          sourceId: source.id,
          documentId: document.id,
        })
      ).summary
    ).toBe("How leave accrues.");
    expect(attempt).toBe(2);
  });

  it("keeps the first summary when two openers race", async () => {
    const { db, source, document } = await newDocumentToSummarise();
    await db.setConceptSummary(document.id, {
      text: "Already stored.",
      by: "document-summariser/earlier",
      at: new Date().toISOString(),
    });
    const late = await getDocumentSummaryOp.run(
      ctx({
        ports: {
          summariseDocument: async () => ({
            text: "Later and unwanted.",
            by: "document-summariser/fake",
          }),
        },
      }),
      { sourceId: source.id, documentId: document.id }
    );
    expect(late.summary).toBe("Already stored.");
  });

  it("is a member read: opening a Document is not an edit", async () => {
    expect(getDocumentSummaryOp.capability).toBe("member");
    expect(
      getDocumentSummaryOp.entities(
        { sourceId: "s", documentId: "d" },
        { summary: null, generatedBy: null }
      )
    ).toEqual([]);
  });
});

describe("the Memories tab's reads (#932)", () => {
  async function newPageWithMemories() {
    const { db, collection, source } = await newOwnedSource();
    const document = await db.createConcept({
      collectionId: collection.id,
      sourceId: source.id,
      path: "handbook/leave.md",
      frontmatter: { type: "Document", title: "Leave" },
      body: "Unused leave expires on 31 March.",
    });
    const make = (text: string) =>
      db.table("knowledgeMemories").insert({
        organizationId: DEMO_ORG.id,
        collectionId: collection.id,
        sourceId: source.id,
        documentPath: document.path,
        text,
        quote: "Unused leave expires on 31 March.",
        generatedBy: "knowledge-memory-extractor/1",
        generatedAt: new Date().toISOString(),
      });
    return { db, collection, source, document, make };
  }

  it("counts live memories per Document for the Documents table", async () => {
    const { db, source, document, make } = await newPageWithMemories();
    const first = await make("One.");
    await make("Two.");

    const before = await listSourceDocumentsOp.run(ctx(), { sourceId: source.id });
    expect(before.memoryCounts[document.path]).toBe(2);

    await forgetKnowledgeMemoryOp.run(ctx(), { id: first.id });
    const after = await listSourceDocumentsOp.run(ctx(), { sourceId: source.id });
    // Forgotten rows leave the count: the column says what the page currently
    // remembers, not how many rows exist.
    expect(after.memoryCounts[document.path]).toBe(1);
    expect(await db.getConcept(document.id)).toBeTruthy();
  });

  it("reports no count for a Document nothing remembered", async () => {
    const { source, document } = await newPageWithMemories();
    const page = await listSourceDocumentsOp.run(ctx(), { sourceId: source.id });
    expect(page.memoryCounts[document.path]).toBeUndefined();
  });

  it("round-trips a forget and a restore without touching the Document", async () => {
    const { db, source, document, make } = await newPageWithMemories();
    const memory = await make("Leave expires at the end of March.");
    const bodyBefore = (await db.getConcept(document.id))?.body;

    await forgetKnowledgeMemoryOp.run(ctx(), {
      id: memory.id,
      reason: "Superseded",
    });
    expect(
      await listDocumentMemoriesOp.run(ctx(), {
        sourceId: source.id,
        documentPath: document.path,
      })
    ).toEqual([]);
    const withForgotten = await listDocumentMemoriesOp.run(ctx(), {
      sourceId: source.id,
      documentPath: document.path,
      includeForgotten: true,
    });
    expect(withForgotten).toHaveLength(1);
    expect(withForgotten[0]!.forgetReason).toBe("Superseded");

    await restoreKnowledgeMemoryOp.run(ctx(), { id: memory.id });
    expect(
      await listDocumentMemoriesOp.run(ctx(), {
        sourceId: source.id,
        documentPath: document.path,
      })
    ).toHaveLength(1);
    // Neither Content nor Chunks were in the blast radius.
    expect((await db.getConcept(document.id))?.body).toBe(bodyBefore);
    expect(await db.countConceptChunks(document.id)).toBe(0);
  });

  it("scopes the tab's read to an Assistant that answers from the Source", async () => {
    const { db, source, document, make } = await newPageWithMemories();
    await make("One.");
    const linked = await newAssistant("Memories Scoped");
    const stranger = await newAssistant("Memories Unlinked");
    await db.setSourceAssistantLinks(source.id, [linked.id]);

    expect(
      await listDocumentMemoriesOp.run(ctx(), {
        sourceId: source.id,
        documentPath: document.path,
        assistantId: linked.id,
      })
    ).toHaveLength(1);
    await expect(
      listDocumentMemoriesOp.run(ctx(), {
        sourceId: source.id,
        documentPath: document.path,
        assistantId: stranger.id,
      })
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("the memories backfill (#933)", () => {
  it("is an edit, and reports what the port queued", async () => {
    const { source } = await newOwnedSource();
    expect(extractSourceMemoriesOp.capability).toBe("edit");

    const asked: Array<{ sourceId: string }> = [];
    const result = await extractSourceMemoriesOp.run(
      ctx({
        ports: {
          enqueueMemoryExtractions: async (args) => {
            asked.push(args);
            return 7;
          },
        },
      }),
      { sourceId: source.id }
    );
    expect(result).toEqual({ queued: 7 });
    expect(asked).toHaveLength(1);
    expect(asked[0]!.sourceId).toBe(source.id);
  });

  it("queues nothing, and says so, on a surface with no runtime wired", async () => {
    const { source } = await newOwnedSource();
    expect(
      await extractSourceMemoriesOp.run(ctx(), { sourceId: source.id })
    ).toEqual({ queued: 0 });
  });

  it("refuses another Organization's Source", async () => {
    const { source } = await newOwnedSource();
    await expect(
      extractSourceMemoriesOp.run(foreignCtx(), { sourceId: source.id })
    ).rejects.toThrowError(OperationError);
  });
});

describe("bulk Source removal from a table selection", () => {
  it("deletes every ticked Source and names each touched Assistant once", async () => {
    const db = getMockDb();
    const assistant = await newAssistant("Bulk Delete");
    const collection = await db.createCollection(assistant.id, {
      name: "Bulk Delete Collection",
    });
    const sources: Source[] = [];
    for (const name of ["One", "Two"]) {
      const source = await db.createSource({
        collectionId: collection.id,
        name,
        kind: "file",
      });
      await db.setSourceAssistantLinks(source.id, [assistant.id]);
      sources.push(source);
    }

    const result = await deleteSourcesOp.run(ctx(), {
      ids: sources.map((s) => s.id),
    });
    // Two Sources, one Assistant: the entity list is deduped, or the tree is
    // revalidated once per row for no reason.
    expect(result).toEqual({ assistantIds: [assistant.id] });
    expect(await db.getSource(sources[0].id)).toBeNull();
    expect(await db.getSource(sources[1].id)).toBeNull();
  });

  it("unlinks a selection from one Assistant and leaves the Sources standing", async () => {
    const db = getMockDb();
    const mine = await newAssistant("Unlinker");
    const other = await newAssistant("Keeps Answering");
    const collection = await db.createCollection(mine.id, {
      name: "Unlink Collection",
    });
    const source = await db.createSource({
      collectionId: collection.id,
      name: "Shared handbook",
      kind: "file",
    });
    await db.setSourceAssistantLinks(source.id, [mine.id, other.id]);

    const result = await unlinkSourcesOp.run(ctx(), {
      assistantId: mine.id,
      sourceIds: [source.id],
    });
    expect(result.assistantIds.sort()).toEqual([mine.id, other.id].sort());
    expect(await db.getSource(source.id)).not.toBeNull();
    expect(
      (await db.listSourceAssistantLinks(source.id)).map((l) => l.assistantId)
    ).toEqual([other.id]);
  });
});
