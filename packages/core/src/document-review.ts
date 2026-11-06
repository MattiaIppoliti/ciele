import type { ConceptFrontmatter } from "./okf";
import { verificationEvents } from "./okf";

/** A review signs the current text. Each Member controls only their own stamp. */
export function documentReview(frontmatter: ConceptFrontmatter, memberId: string, reviewed: boolean, at: string): ConceptFrontmatter {
  const by = `human:${memberId}`;
  const verified = verificationEvents(frontmatter).filter(event => event.by !== by);
  if (reviewed) verified.push({ by, at });
  const { verified: _previous, ...rest } = frontmatter;
  return verified.length ? { ...rest, verified } : rest;
}

/** Provenance for old text must never vouch for new text. */
export function documentEditFrontmatter(previous: ConceptFrontmatter, previousBody: string, next: ConceptFrontmatter, nextBody: string): ConceptFrontmatter {
  const changed = previousBody !== nextBody || (previous.type === "FAQ" && previous.title !== next.title);
  if (!changed) return next;
  const { verified: _previous, ...rest } = next;
  return rest;
}
