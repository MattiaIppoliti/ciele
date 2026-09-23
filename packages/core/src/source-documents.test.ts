import { describe, expect, it } from "vitest";
import {
  sourceDocumentStatus,
  sourceDocumentStatusLabel,
} from "./source-documents";

describe("sourceDocumentStatus", () => {
  it("is ready once the Document is chunked", () => {
    expect(sourceDocumentStatus({ excluded: false, indexed: true })).toBe("ready");
  });

  it("is pending while it is stored but not yet retrievable", () => {
    expect(sourceDocumentStatus({ excluded: false, indexed: false })).toBe(
      "pending"
    );
  });

  it("calls an excluded Document excluded, chunked or not", () => {
    // An excluded Document is never going to be chunked, so "pending" would be
    // a promise rather than a fresher fact.
    expect(sourceDocumentStatus({ excluded: true, indexed: false })).toBe(
      "excluded"
    );
    expect(sourceDocumentStatus({ excluded: true, indexed: true })).toBe(
      "excluded"
    );
  });

  it("labels each state once", () => {
    expect(sourceDocumentStatusLabel("ready")).toBe("Ready");
    expect(sourceDocumentStatusLabel("excluded")).toBe("Excluded");
    expect(sourceDocumentStatusLabel("pending")).toBe("Pending");
  });
});
