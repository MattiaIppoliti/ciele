import { describe, expect, it } from "vitest";
import {
  documentExcerpt,
  documentOrigin,
  documentTabHref,
  parseDocumentTab,
} from "./document-view";

describe("parseDocumentTab", () => {
  it("defaults to Content while Memories has nothing to show", () => {
    expect(parseDocumentTab(undefined)).toBe("content");
    expect(parseDocumentTab("nonsense")).toBe("content");
    expect(parseDocumentTab(["chunks", "memories"])).toBe("chunks");
  });

  it("reads the three tabs", () => {
    expect(parseDocumentTab("memories")).toBe("memories");
    expect(parseDocumentTab("chunks")).toBe("chunks");
  });
});

describe("documentTabHref", () => {
  it("keeps the default tab out of the URL", () => {
    expect(documentTabHref("/library/files/s/d", "content")).toBe(
      "/library/files/s/d"
    );
    expect(documentTabHref("/library/files/s/d", "chunks")).toBe(
      "/library/files/s/d?tab=chunks"
    );
  });

  it("keeps the Documents table's place on every tab", () => {
    // Switching tabs must not lose the breadcrumb's page and sort (#928).
    expect(
      documentTabHref("/library/files/s/d", "content", "page=3&sort=oldest")
    ).toBe("/library/files/s/d?page=3&sort=oldest");
    expect(
      documentTabHref("/library/files/s/d", "chunks", "page=3&sort=oldest")
    ).toBe("/library/files/s/d?tab=chunks&page=3&sort=oldest");
  });
});

describe("documentOrigin", () => {
  it("says how each kind of Source produced its Documents", () => {
    expect(documentOrigin("website")).toBe("Crawl");
    expect(documentOrigin("url")).toBe("Crawl");
    expect(documentOrigin("file")).toBe("Upload");
    expect(documentOrigin("text")).toBe("Pasted text");
    expect(documentOrigin("faq")).toBe("FAQ");
    expect(documentOrigin("application")).toBe("Import");
  });
});

describe("documentExcerpt", () => {
  it("takes the first real paragraph, not the title", () => {
    const body = "# Leave policy\n\nEmployees accrue 25 days.\n\nMore text.";
    expect(documentExcerpt(body)).toBe("Employees accrue 25 days.");
  });

  it("flattens line breaks inside the paragraph", () => {
    expect(documentExcerpt("one\ntwo\n\nthree")).toBe("one two");
  });

  it("cuts at a word boundary and says it was cut", () => {
    const excerpt = documentExcerpt("alpha beta gamma delta epsilon", 12);
    expect(excerpt).toBe("alpha beta…");
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("is empty for a body with nothing but headings", () => {
    expect(documentExcerpt("# One\n\n## Two")).toBe("");
    expect(documentExcerpt("")).toBe("");
  });
});
