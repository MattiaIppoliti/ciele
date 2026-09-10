import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_ORG, getMockDb } from "@agent-hub/db";
import { loadFlowBuilderCatalogue } from "./flow-builder-catalogue";

afterEach(() => vi.restoreAllMocks());

describe("Flow Builder catalogue", () => {
  it("uses the compact FAQ read without scanning Collection bodies", async () => {
    const db = getMockDb();
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Catalogue test" });
    const options = [{ id: "faq", question: "When is enrolment?" }];
    const readOptions = vi.spyOn(db, "listAssistantFaqOptions").mockResolvedValue(options);
    const readBodies = vi.spyOn(db, "listConcepts").mockRejectedValue(new Error("Unexpected body read"));
    try {
      const catalogue = await loadFlowBuilderCatalogue(db, assistant, "member");
      expect(catalogue.faqs).toEqual(options);
      expect(readOptions).toHaveBeenCalledExactlyOnceWith(assistant.id);
      expect(readBodies).not.toHaveBeenCalled();
    } finally {
      await db.deleteAssistant(assistant.id);
    }
  });
});
