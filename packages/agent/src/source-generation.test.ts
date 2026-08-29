import { describe, expect, it } from "vitest";
import { DEMO_ORG, getMockDb } from "@agent-hub/db";

import {
  checkpointSourceGeneration,
  clearSourceGenerationCheckpoint,
  commitSourceGeneration,
  openSourceGeneration,
  sourceGenerationCheckpoint,
} from "./source-generation";

describe("Source generation", () => {
  it("keeps a staged generation hidden, commits it once, and reports the retired Concepts", async () => {
    const db = getMockDb();
    const assistant = await db.createAssistant(DEMO_ORG.id, {
      title: "Generation test",
    });
    const collection = await db.createCollection(assistant.id, {
      name: "Generation test",
    });
    const source = await db.createSource({
      collectionId: collection.id,
      name: "Generation source",
      kind: "text",
    });
    const prior = await db.createConcept({
      collectionId: collection.id,
      sourceId: source.id,
      path: "prior.md",
      frontmatter: { type: "Document", title: "Prior" },
      body: "Prior knowledge",
    });

    const generation = await openSourceGeneration({ db, sourceId: source.id });
    const staged = await db.createConcept({
      collectionId: collection.id,
      sourceId: source.id,
      generationId: generation.generationId,
      path: "next.md",
      frontmatter: { type: "Document", title: "Next" },
      body: "Next knowledge",
    });
    expect((await db.listConcepts(collection.id)).map((item) => item.id)).toEqual([
      prior.id,
    ]);

    const retired: string[] = [];
    await expect(
      commitSourceGeneration({
        db,
        sourceId: source.id,
        generation,
        onRetired: async (conceptIds) => {
          retired.push(...conceptIds);
        },
      }),
    ).resolves.toBe("committed");

    expect((await db.listConcepts(collection.id)).map((item) => item.id)).toEqual([
      staged.id,
    ]);
    expect(retired).toEqual([prior.id]);
  });

  it("finishes cleanup when a retry resumes after the atomic cutover", async () => {
    const db = getMockDb();
    const assistant = await db.createAssistant(DEMO_ORG.id, {
      title: "Generation retry test",
    });
    const collection = await db.createCollection(assistant.id, {
      name: "Generation retry test",
    });
    const source = await db.createSource({
      collectionId: collection.id,
      name: "Generation retry source",
      kind: "text",
    });
    const prior = await db.createConcept({
      collectionId: collection.id,
      sourceId: source.id,
      path: "prior.md",
      frontmatter: { type: "Document", title: "Prior" },
      body: "Prior knowledge",
    });

    const started = await openSourceGeneration({ db, sourceId: source.id });
    const staged = await db.createConcept({
      collectionId: collection.id,
      sourceId: source.id,
      generationId: started.generationId,
      path: "next.md",
      frontmatter: { type: "Document", title: "Next" },
      body: "Next knowledge",
    });
    await expect(
      db.commitSourceKnowledgeGeneration({
        sourceId: source.id,
        expectedActiveGenerationId: started.expectedActiveGenerationId,
        generationId: started.generationId,
      }),
    ).resolves.toBe(true);

    const resumed = await openSourceGeneration({
      db,
      sourceId: source.id,
      resume: started,
    });
    expect(resumed.alreadyCommitted).toBe(true);
    const retired: string[] = [];
    await expect(
      commitSourceGeneration({
        db,
        sourceId: source.id,
        generation: resumed,
        onRetired: async (conceptIds) => {
          retired.push(...conceptIds);
        },
      }),
    ).resolves.toBe("committed");

    expect((await db.listConcepts(collection.id)).map((item) => item.id)).toEqual([
      staged.id,
    ]);
    expect(retired).toEqual([prior.id]);
  });

  it("owns the durable paging checkpoint a crawl resumes from", async () => {
    const db = getMockDb();
    const assistant = await db.createAssistant(DEMO_ORG.id, {
      title: "Generation checkpoint test",
    });
    const collection = await db.createCollection(assistant.id, {
      name: "Generation checkpoint test",
    });
    const source = await db.createSource({
      collectionId: collection.id,
      name: "Checkpoint source",
      kind: "website",
      config: { url: "https://example.edu" },
    });
    const generation = await openSourceGeneration({ db, sourceId: source.id });

    const config = await checkpointSourceGeneration({
      db,
      sourceId: source.id,
      config: source.config,
      generation,
      cursor: "page-2",
      ingestedPages: 25,
    });
    expect(sourceGenerationCheckpoint(config)).toEqual({
      generationId: generation.generationId,
      expectedActiveGenerationId: generation.expectedActiveGenerationId,
      cursor: "page-2",
      ingestedPages: 25,
    });
    expect(sourceGenerationCheckpoint(clearSourceGenerationCheckpoint(config))).toBeNull();
  });
});
