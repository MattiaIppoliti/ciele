import { expect, it } from "vitest";
import { FAQ_DUPLICATE_THRESHOLD, faqDuplicateScore } from "./faq-duplicates";
it("warns on a paraphrase but leaves a neighbouring account topic distinct", () => {
  expect(faqDuplicateScore("How do I reset the password?", "Where can I reset my password?")).toBeGreaterThanOrEqual(FAQ_DUPLICATE_THRESHOLD);
  expect(faqDuplicateScore("How do I reset the password?", "How do I change my account email?")).toBeLessThan(FAQ_DUPLICATE_THRESHOLD);
  expect(faqDuplicateScore("Forgotten password", "Recover account access", 0.91)).toBeGreaterThanOrEqual(FAQ_DUPLICATE_THRESHOLD);
});
