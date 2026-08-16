import { describe, expect, it } from "vitest";
import type { Role } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { createAssistantOp } from "./assistants";
import {
  addSourceOp,
  createFaqOp,
  deleteSourceOp,
  setDirectAccessOp,
  setSourceLinksOp,
} from "./knowledge";
import { OperationError, type OperationContext } from "./operation";

/**
 * Knowledge-hub operations (PRD #726) over the in-memory Db — external
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
    // Deleting an org-owned Source (no legacy owner) declares no
    // assistant-editor entity, only the hub.
    expect(deleteSourceOp.entities({ id: "s" }, { assistantId: "" })).toEqual([
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
    const links = await setDirectAccessOp.run(ctx(), {
      sourceId: file.id,
      assistantId: assistant.id,
      directAccess: true,
    });
    expect(links.find((l) => l.assistantId === assistant.id)?.directAccess).toBe(
      true
    );
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
