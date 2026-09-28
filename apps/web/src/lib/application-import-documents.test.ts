import { describe, expect, it } from "vitest";
import {
  applicationImportHref,
  applicationImportPageHref,
  applicationImportRowHref,
  applicationImportRowStatusLabel,
  applicationImportRowTone,
  applicationImportStatusLabel,
  applicationImportStatusTone,
  applicationSourcePrefix,
} from "./application-import-documents";

describe("application import drill-down hrefs", () => {
  it("opens an Import from the Library or inside the Assistant that reads it", () => {
    expect(applicationImportHref("imp_1")).toBe("/library/imports/imp_1");
    expect(applicationImportHref("imp_1", "as_1")).toBe(
      "/assistants/as_1/knowledge/imports/imp_1"
    );
  });

  it("opens a row onto its Document, or onto its Source when it has none", () => {
    const library = applicationSourcePrefix();
    expect(applicationImportRowHref(library, { sourceId: "s1", documentId: "d1" })).toBe(
      "/library/applications/s1/d1"
    );
    expect(applicationImportRowHref(library, { sourceId: "s1", documentId: null })).toBe(
      "/library/applications/s1"
    );
    expect(
      applicationImportRowHref(applicationSourcePrefix("as_1"), {
        sourceId: "s1",
        documentId: "d1",
      })
    ).toBe("/assistants/as_1/knowledge/s1/d1");
  });

  it("keeps page one the bare route", () => {
    expect(applicationImportPageHref("/library/imports/i", 1)).toBe("/library/imports/i");
    expect(applicationImportPageHref("/library/imports/i", 3)).toBe(
      "/library/imports/i?page=3"
    );
  });
});

describe("application import status", () => {
  it("reads a paused Import as the admin's choice, whatever it last did", () => {
    expect(applicationImportStatusLabel("error", false)).toBe("Paused");
    expect(applicationImportStatusTone("error", false)).toBe("gray");
    expect(applicationImportStatusLabel("syncing", true)).toBe("Syncing");
    expect(applicationImportStatusTone("syncing", true)).toBe("amber");
    expect(applicationImportStatusTone("ready", true)).toBe("green");
    expect(applicationImportStatusTone("error", true)).toBe("red");
  });

  it("adds the Source's failure to a Document's three states", () => {
    expect(applicationImportRowStatusLabel("error")).toBe("Error");
    expect(applicationImportRowTone("error")).toBe("red");
    expect(applicationImportRowStatusLabel("ready")).toBe("Ready");
    expect(applicationImportRowTone("ready")).toBe("green");
  });
});
