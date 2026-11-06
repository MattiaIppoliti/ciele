import { expect, it } from "vitest";
import { documentReview, documentEditFrontmatter } from "./document-review";
import { trustTier, verificationEvents } from "./okf";
it("removes only the acting Member's review and retains agent and other Member verifications", () => {
  const initial = { type: "FAQ", verified: [{ by: "human:other", at: "2026-01-01" }, { by: "checker/1", at: "2026-01-02" }] };
  const reviewed = documentReview(initial, "me", true, "2026-10-22T12:00:00Z");
  expect(trustTier(reviewed)).toBe("human-reviewed");
  expect(verificationEvents(reviewed)).toHaveLength(3);
  expect(documentReview(reviewed, "me", false, "2026-10-22T13:00:00Z")).toEqual(initial);
});
it("clears verifications only when the body or FAQ question changes", () => {
  const previous = { type: "FAQ", title: "Question", verified: { by: "human:reviewer" } };
  expect(documentEditFrontmatter(previous, "Answer", { ...previous }, "Answer").verified).toEqual(previous.verified);
  expect(documentEditFrontmatter(previous, "Answer", { ...previous }, "Changed").verified).toBeUndefined();
  expect(documentEditFrontmatter(previous, "Answer", { ...previous, title: "New question" }, "Answer").verified).toBeUndefined();
});
