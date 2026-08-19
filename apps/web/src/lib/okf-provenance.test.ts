import { describe, expect, it } from "vitest";
import type { ConceptFrontmatter } from "@agent-hub/core";
import { conceptProvenanceView } from "./okf-provenance";

describe("conceptProvenanceView", () => {
  it("renders a bare v0.1-shaped concept as unverified and stable", () => {
    const view = conceptProvenanceView({
      type: "Document",
      timestamp: "2026-01-01T00:00:00Z",
    });
    expect(view.tier).toBe("unverified");
    expect(view.trustLabel).toBe("Unverified");
    expect(view.status).toBe("stable");
    // A stable concept says nothing about status, the default is not news.
    expect(view.showStatus).toBe(false);
    expect(view.stale).toBe(false);
    expect(view.generatedBy).toBeNull();
    // The legacy timestamp still surfaces as the content's last change.
    expect(view.generatedAt).toBe("2026-01-01T00:00:00Z");
    expect(view.sources).toEqual([]);
  });

  it("names the actor of the LATEST verification, not the first listed", () => {
    const view = conceptProvenanceView({
      type: "FAQ",
      verified: [
        { by: "human:reviewer", at: "2026-06-25T09:00:00Z" },
        { by: "process:nightly", at: "2026-06-26T02:00:00Z" },
      ],
    });
    expect(view.tier).toBe("human-reviewed");
    expect(view.verifiedAt).toBe("2026-06-26T02:00:00Z");
    expect(view.verifiedBy).toBe("process:nightly");
  });

  it("links only followable sources, leaving descriptors and keys as text", () => {
    const frontmatter: ConceptFrontmatter = {
      type: "Document",
      sources: [
        { id: "a", resource: "https://example.test/policy", title: "Policy" },
        { id: "b", resource: "org/1/knowledge/abc.pdf", title: "Fees.pdf" },
        { id: "c", resource: 'text source "Pasted notes"' },
      ],
    };
    expect(conceptProvenanceView(frontmatter).sources).toEqual([
      { label: "Policy", href: "https://example.test/policy" },
      { label: "Fees.pdf", href: null },
      // No title ⇒ the resource itself is the label.
      { label: 'text source "Pasted notes"', href: null },
    ]);
  });

  it("flags a non-default status and a passed stale_after", () => {
    const view = conceptProvenanceView(
      { type: "Metric", status: "deprecated", stale_after: "2026-06-15" },
      "2026-07-26"
    );
    expect(view.showStatus).toBe(true);
    expect(view.status).toBe("deprecated");
    expect(view.stale).toBe(true);
  });
});
